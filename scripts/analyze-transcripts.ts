import "dotenv/config";
import { initDb, CallReview, TranscriptionJob, BenchmarkRun } from "../src/lib/models";
import { computeWordErrorRate } from "../src/lib/wer";
import { prepareTextForWer, normalizeNumberTokens } from "../src/lib/wer-normalize";

function tokenize(text: string): string[] {
  return normalizeNumberTokens(
    prepareTextForWer(text)
      .toLowerCase()
      .replace(/[^\w\s']/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function refVsDeepgramEditRate(reference: string, deepgram: string) {
  const m = computeWordErrorRate(reference, deepgram);
  return {
    werPercent: m.werPercent,
    errors: m.errorCount,
    refWords: m.refWordCount,
    identical: reference.trim() === deepgram.trim(),
  };
}

function sampleDiffs(ref: string[], hyp: string[], max = 5): string[] {
  const lines: string[] = [];
  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  const ops: ("=" | "S" | "D" | "I")[][] = Array.from({ length: rows }, () =>
    Array(cols).fill("=" as const),
  );

  for (let i = 1; i < rows; i++) {
    dp[i]![0] = i;
    ops[i]![0] = "D";
  }
  for (let j = 1; j < cols; j++) {
    dp[0]![j] = j;
    ops[0]![j] = "I";
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
        ops[i]![j] = "=";
      } else {
        const sub = dp[i - 1]![j - 1]! + 1;
        const del = dp[i - 1]![j]! + 1;
        const ins = dp[i]![j - 1]! + 1;
        const min = Math.min(sub, del, ins);
        dp[i]![j] = min;
        if (min === sub) ops[i]![j] = "S";
        else if (min === del) ops[i]![j] = "D";
        else ops[i]![j] = "I";
      }
    }
  }

  let i = ref.length;
  let j = hyp.length;
  const edits: Array<{ op: string; ref?: string; hyp?: string }> = [];
  while ((i > 0 || j > 0) && edits.length < max * 3) {
    const op = ops[i]![j]!;
    if (op === "=") {
      i--;
      j--;
    } else if (op === "S") {
      edits.push({ op: "S", ref: ref[i - 1], hyp: hyp[j - 1] });
      i--;
      j--;
    } else if (op === "D") {
      edits.push({ op: "D", ref: ref[i - 1] });
      i--;
    } else {
      edits.push({ op: "I", hyp: hyp[j - 1] });
      j--;
    }
  }

  for (const e of edits.slice(0, max)) {
    if (e.op === "S") lines.push(`  sub: "${e.ref}" → "${e.hyp}"`);
    if (e.op === "D") lines.push(`  del from ref: "${e.ref}"`);
    if (e.op === "I") lines.push(`  ins in hyp: "${e.hyp}"`);
  }
  return lines;
}

function shortName(filename: string) {
  const m = filename.match(/CALLIN-\d+/);
  return m ? m[0] : filename.slice(0, 40);
}

async function main() {
  await initDb();

  const reviews = await CallReview.findAll({
    where: { status: "finalized" },
    order: [["updatedAt", "DESC"]],
  });

  console.log(`\n${"=".repeat(72)}`);
  console.log(`TRANSCRIPT ANALYSIS — ${reviews.length} finalized reviews`);
  console.log(`${"=".repeat(72)}\n`);

  let benchmarkCount = 0;
  let refIdenticalToDg = 0;
  let refEditRates: number[] = [];
  const sonioxVsDgWhenRefClose: number[] = [];

  for (const [idx, review] of reviews.entries()) {
    let jobs: TranscriptionJob[] = [];
    let source = "unknown";

    if (review.benchmarkRunId) {
      const run = await BenchmarkRun.findByPk(review.benchmarkRunId);
      jobs = await TranscriptionJob.findAll({ where: { benchmarkRunId: review.benchmarkRunId } });
      source = `benchmark`;
      benchmarkCount++;
    } else if (review.transcriptionJobId) {
      const job = await TranscriptionJob.findByPk(review.transcriptionJobId);
      if (job) jobs = [job];
      source = "transcribe";
    }

    const dg = jobs.find((j) => j.provider === "deepgram" && j.status === "completed");
    const sx5 = jobs.find((j) => j.model === "stt-async-v5" && j.status === "completed");
    const sx4 = jobs.find((j) => j.model === "stt-async-v4" && j.status === "completed");

    const ref = review.referenceTranscript?.trim() ?? "";
    const dgText = dg?.transcript?.trim() ?? "";

    console.log(`[${idx + 1}] ${shortName(review.originalFilename)} (${source})`);

    if (!jobs.length || !ref) {
      console.log("  ⚠ Skipped — no jobs or empty reference");
      if (review.transcriptionJobId) {
        const exists = await TranscriptionJob.findByPk(review.transcriptionJobId);
        console.log(`  Job ${review.transcriptionJobId} exists: ${!!exists}`);
      }
      console.log("");
      continue;
    }

    if (dgText) {
      const edit = refVsDeepgramEditRate(ref, dgText);
      refEditRates.push(edit.werPercent);
      if (edit.identical) refIdenticalToDg++;

      console.log(
        `  Your reference vs Deepgram: ${edit.werPercent}% edited (${edit.errors} word edits / ${edit.refWords} ref words)${edit.identical ? " — IDENTICAL" : ""}`,
      );

      if (edit.werPercent < 3 && sx5?.transcript) {
        const sxVsDg = computeWordErrorRate(dgText, sx5.transcript).werPercent;
        sonioxVsDgWhenRefClose.push(sxVsDg);
        console.log(`  Soniox v5 vs Deepgram (no human ref): ${sxVsDg}%`);
      }
    } else {
      console.log("  No Deepgram transcript on this call");
    }

    const refTok = tokenize(ref);

    for (const [label, job] of [
      ["Deepgram", dg],
      ["Soniox v5", sx5],
      ["Soniox v4", sx4],
    ] as const) {
      if (!job?.transcript?.trim()) continue;
      const m = computeWordErrorRate(ref, job.transcript);
      console.log(
        `  ${label} vs your reference: ${m.werPercent}% (S${m.substitutions} D${m.deletions} I${m.insertions})`,
      );
    }

    // Sample edits: Soniox v5 vs reference (where user cares most)
    if (sx5?.transcript && dgText) {
      const sxTok = tokenize(sx5.transcript);
      const dgTok = tokenize(dgText);
      const sxVsRef = computeWordErrorRate(ref, sx5.transcript);
      const sxVsDg = computeWordErrorRate(dgText, sx5.transcript);

      if (sxVsRef.werPercent >= 8) {
        console.log(`  Sample Soniox v5 disagreements with YOUR reference:`);
        sampleDiffs(refTok, sxTok, 4).forEach((l) => console.log(l));

        // Words Soniox differs from Deepgram but matches reference?
        const sxVsRefOnly = sxVsRef.werPercent - computeWordErrorRate(ref, dgText).werPercent;
        console.log(
          `  Soniox vs Deepgram: ${sxVsDg.werPercent}% | Extra Soniox penalty vs your edits: ~${sxVsRefOnly.toFixed(1)}pp`,
        );
      }
    }

    console.log("");
  }

  console.log(`${"=".repeat(72)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(72)}`);
  console.log(`Benchmark calls analyzed: ${benchmarkCount}`);
  console.log(`References identical to Deepgram: ${refIdenticalToDg}`);
  if (refEditRates.length) {
    const avgEdit =
      Math.round((refEditRates.reduce((a, b) => a + b, 0) / refEditRates.length) * 10) / 10;
    const minEdit = Math.min(...refEditRates);
    const maxEdit = Math.max(...refEditRates);
    console.log(
      `How much you changed Deepgram when building reference: avg ${avgEdit}% (min ${minEdit}%, max ${maxEdit}%)`,
    );
  }
  if (sonioxVsDgWhenRefClose.length) {
    const avg =
      Math.round(
        (sonioxVsDgWhenRefClose.reduce((a, b) => a + b, 0) / sonioxVsDgWhenRefClose.length) * 10,
      ) / 10;
    console.log(
      `When your reference stayed close to Deepgram (<3% edits), Soniox vs Deepgram averaged: ${avg}%`,
    );
  }
  console.log(`
INTERPRETATION:
- If "reference vs Deepgram" is low (0-3%), you kept most of Deepgram's words after listening.
- Soniox WER vs your reference will then be close to "Soniox vs Deepgram".
- High Soniox WER with low reference edits usually means Soniox genuinely differs on word choice,
  names, fillers, or segment boundaries — not a calculation bug.
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
