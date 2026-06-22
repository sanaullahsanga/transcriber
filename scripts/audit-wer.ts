import "dotenv/config";
import { Op } from "sequelize";
import { initDb, CallReview, TranscriptionJob, BenchmarkRun } from "../src/lib/models";
import { buildJobMetrics, findDeepgramJob } from "../src/lib/review-metrics";
import { computeWordErrorRate } from "../src/lib/wer";
import { prepareTextForWer } from "../src/lib/wer-normalize";

function rawWer(reference: string, hypothesis: string) {
  const ref = reference
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const hyp = hypothesis
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!ref.length) return { werPercent: hyp.length ? 100 : 0, refWords: 0, hypWords: hyp.length };
  const r = computeWordErrorRate(reference, hypothesis);
  return { ...r, refWords: ref.length, hypWords: hyp.length };
}

async function main() {
  await initDb();

  const reviews = await CallReview.findAll({
    where: { status: "finalized" },
    order: [["updatedAt", "DESC"]],
  });

  console.log(`\n=== WER AUDIT: ${reviews.length} finalized review(s) ===\n`);

  if (!reviews.length) {
    console.log("No finalized reviews found.");
    process.exit(0);
  }

  const providerTotals = new Map<
    string,
    { errors: number; refWords: number; werSum: number; calls: number }
  >();

  for (const [index, review] of reviews.entries()) {
    let jobs: TranscriptionJob[] = [];
    let source = "";

    if (review.benchmarkRunId) {
      const run = await BenchmarkRun.findByPk(review.benchmarkRunId);
      jobs = await TranscriptionJob.findAll({ where: { benchmarkRunId: review.benchmarkRunId } });
      source = `benchmark · ${run?.originalFilename ?? review.originalFilename}`;
    } else if (review.transcriptionJobId) {
      const job = await TranscriptionJob.findByPk(review.transcriptionJobId);
      if (job) jobs = [job];
      source = `transcribe · ${review.originalFilename}`;
    }

    const deepgram = findDeepgramJob(jobs);
    const savedRef = review.referenceTranscript?.trim() ?? "";
    const fallbackRef =
      deepgram?.transcript?.trim() ||
      jobs.find((j) => j.status === "completed" && j.transcript?.trim())?.transcript?.trim() ||
      "";
    const refForWer = savedRef || fallbackRef;

    console.log(`--- Call ${index + 1}: ${review.originalFilename} ---`);
    console.log(`  Source: ${source}`);
    console.log(`  Review id: ${review.id}`);
    console.log(`  Saved reference words: ${savedRef.split(/\s+/).filter(Boolean).length}`);
    console.log(`  Reference used for WER words: ${refForWer.split(/\s+/).filter(Boolean).length}`);
    if (!savedRef && fallbackRef) {
      console.log(`  ⚠ Using Deepgram/fallback reference (saved reference was empty)`);
    }
    if (savedRef && deepgram?.transcript?.trim() && savedRef !== deepgram.transcript.trim()) {
      const savedNorm = prepareTextForWer(savedRef).split(/\s+/).filter(Boolean).length;
      const dgNorm = prepareTextForWer(deepgram.transcript).split(/\s+/).filter(Boolean).length;
      if (Math.abs(savedNorm - dgNorm) > 5) {
        console.log(
          `  ⚠ Reference differs from Deepgram (${savedNorm} vs ${dgNorm} normalized words)`,
        );
      }
    }

    const metrics = buildJobMetrics(jobs, refForWer);

    for (const job of metrics) {
      if (job.status !== "completed" || !job.transcript?.trim()) {
        console.log(`  ${job.provider}/${job.model}: ${job.status} — not scored`);
        continue;
      }

      const app = job.metrics;
      const recomputed = computeWordErrorRate(refForWer, job.transcript);
      const raw = rawWer(refForWer, job.transcript);
      const rawNoDialogue = computeWordErrorRate(
        prepareTextForWer(refForWer),
        prepareTextForWer(job.transcript),
      );

      const match = app && app.werPercent === recomputed.werPercent;
      const flag = match ? "✓" : "✗ MISMATCH";

      console.log(
        `  ${job.provider}/${job.model}: WER ${recomputed.werPercent}% (S${recomputed.substitutions} D${recomputed.deletions} I${recomputed.insertions} / ${recomputed.refWordCount} ref words) ${flag}`,
      );

      if (!match && app) {
        console.log(`    App reported: ${app.werPercent}% — recomputed: ${recomputed.werPercent}%`);
      }

      if (raw.werPercent !== recomputed.werPercent) {
        console.log(`    Without norm: ${raw.werPercent}% (dialogue/digits not normalized)`);
      }

      const key = `${job.provider}::${job.model}`;
      const t = providerTotals.get(key) ?? { errors: 0, refWords: 0, werSum: 0, calls: 0 };
      t.calls++;
      t.errors += recomputed.errorCount;
      t.refWords += recomputed.refWordCount;
      t.werSum += recomputed.wer;
      providerTotals.set(key, t);

      // Show first few token diffs if WER > 15%
      if (recomputed.werPercent > 15) {
        const refTok = prepareTextForWer(refForWer)
          .toLowerCase()
          .replace(/[^\w\s']/g, " ")
          .split(/\s+/)
          .filter(Boolean);
        const hypTok = prepareTextForWer(job.transcript)
          .toLowerCase()
          .replace(/[^\w\s']/g, " ")
          .split(/\s+/)
          .filter(Boolean);
        const refPreview = refTok.slice(0, 12).join(" ");
        const hypPreview = hypTok.slice(0, 12).join(" ");
        console.log(`    Ref start: "${refPreview}..."`);
        console.log(`    Hyp start: "${hypPreview}..."`);
      }
    }
    console.log("");
  }

  console.log("=== CUMULATIVE (recomputed from finalized reviews) ===");
  for (const [key, t] of [...providerTotals.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cum = t.refWords > 0 ? Math.round((t.errors / t.refWords) * 1000) / 10 : 0;
    const avg = t.calls > 0 ? Math.round((t.werSum / t.calls) * 1000) / 10 : 0;
    console.log(
      `  ${key}: ${t.calls} call(s), avg ${avg}%, cumulative ${cum}% (${t.errors}/${t.refWords} errors/words)`,
    );
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
