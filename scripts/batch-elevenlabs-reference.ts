import "dotenv/config";
import { batchApplyElevenLabsReferences } from "../src/lib/reviews";

async function main() {
  const forceRetranscribe = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    const { initDb, BenchmarkRun, TranscriptionJob } = await import("../src/lib/models");
    await initDb();
    const runs = await BenchmarkRun.findAll({ attributes: ["id", "originalFilename"] });
    let count = 0;
    for (const run of runs) {
      const jobs = await TranscriptionJob.findAll({
        where: { benchmarkRunId: run.id },
        attributes: ["status", "transcript"],
      });
      if (jobs.some((j) => j.status === "completed" && j.transcript?.trim())) {
        count++;
        console.log(`  ${run.originalFilename}`);
      }
    }
    console.log(`\n${count} reviewable benchmark call(s) would be processed.`);
    console.log(forceRetranscribe ? "Mode: re-transcribe all with ElevenLabs" : "Mode: save existing ElevenLabs or transcribe if missing");
    process.exit(0);
  }

  console.log(
    forceRetranscribe
      ? "Re-transcribing all calls with ElevenLabs and saving as reviewer reference..."
      : "Saving ElevenLabs reference for all calls (transcribe only when missing)...",
  );
  console.log(
    "Note: audio files must be on this machine. Run on production (transcriber.sangahub.com) or set PROJECT_ROOT + UPLOAD_DIR to match stored paths.\n",
  );

  const results = await batchApplyElevenLabsReferences({ forceRetranscribe });

  const ok = results.filter((r) => r.ok);
  const skipped = ok.filter((r) => r.skipped);
  const transcribed = ok.filter((r) => !r.skipped);
  const failed = results.filter((r) => !r.ok);

  console.log("\n=== Summary ===");
  console.log(`Total: ${results.length}`);
  console.log(`Saved existing: ${skipped.length}`);
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
