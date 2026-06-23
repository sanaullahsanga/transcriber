import "dotenv/config";
import { batchApplyReferenceTranscripts } from "../src/lib/reviews";
import { REFERENCE_PROVIDER } from "../src/lib/reference-provider";
import { PROVIDERS } from "../src/lib/providers";

async function main() {
  const forceRetranscribe = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");
  const providerName = PROVIDERS[REFERENCE_PROVIDER].name;

  if (dryRun) {
    const { initDb, BenchmarkRun, TranscriptionJob, CallReview } = await import(
      "../src/lib/models"
    );
    await initDb();
    const runs = await BenchmarkRun.findAll({ attributes: ["id", "originalFilename"] });
    const reviews = await CallReview.findAll({ attributes: ["benchmarkRunId", "referenceTranscript"] });
    const savedByRun = new Map(
      reviews
        .filter((r) => r.benchmarkRunId && r.referenceTranscript?.trim())
        .map((r) => [r.benchmarkRunId!, true]),
    );

    let count = 0;
    let missing = 0;
    for (const run of runs) {
      const jobs = await TranscriptionJob.findAll({
        where: { benchmarkRunId: run.id },
        attributes: ["status", "transcript"],
      });
      if (!jobs.some((j) => j.status === "completed" && j.transcript?.trim())) continue;
      count++;
      const needsWork = forceRetranscribe || !savedByRun.has(run.id);
      if (needsWork) {
        missing++;
        console.log(`  ${run.originalFilename}${savedByRun.has(run.id) ? " (would re-transcribe)" : ""}`);
      }
    }
    console.log(`\n${count} reviewable call(s), ${missing} would be processed.`);
    console.log(
      forceRetranscribe
        ? `Mode: re-transcribe all with ${providerName}`
        : `Mode: only calls missing a saved review reference`,
    );
    process.exit(0);
  }

  console.log(
    forceRetranscribe
      ? `Re-transcribing all calls with ${providerName} and saving as reviewer reference...`
      : `Transcribing missing references with ${providerName} (skips calls that already have a saved review)...`,
  );

  const results = await batchApplyReferenceTranscripts({ forceRetranscribe });

  const ok = results.filter((r) => r.ok);
  const skipped = ok.filter((r) => r.skipped);
  const transcribed = ok.filter((r) => !r.skipped);
  const failed = results.filter((r) => !r.ok);

  console.log("\n=== Summary ===");
  console.log(`Total: ${results.length}`);
  console.log(`Skipped (already saved): ${skipped.length}`);
  console.log(`Newly transcribed: ${transcribed.length}`);
  console.log(`Failed: ${failed.length}`);

  if (failed.length) {
    console.log("\nFailures:");
    for (const row of failed) {
      console.log(`  ${row.originalFilename}: ${row.error}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Batch reference failed:", error);
  process.exit(1);
});
