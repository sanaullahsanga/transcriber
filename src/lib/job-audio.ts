import { access, copyFile } from "node:fs/promises";
import { BenchmarkRun, TranscriptionJob, initDb } from "@/lib/models";
import { getUploadDir, resolveStoredPath } from "@/lib/paths";
import { enqueueJob, ensureQueueRunning } from "@/lib/queue";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the job's audio file exists on disk. For benchmark slots, restore from
 * the parent run's shared file if the slot copy was lost.
 */
export async function ensureJobAudioFile(job: TranscriptionJob): Promise<string> {
  const resolved = resolveStoredPath(job.storedPath);
  if (await fileExists(resolved)) {
    return resolved;
  }

  if (job.benchmarkRunId) {
    const run = await BenchmarkRun.findByPk(job.benchmarkRunId);
    if (run) {
      const source = resolveStoredPath(run.storedPath);
      if (await fileExists(source)) {
        await copyFile(source, resolved);
        return resolved;
      }
    }
  }

  throw new Error(
    `Audio file not found at ${resolved}. Upload directory: ${getUploadDir()}`,
  );
}

export async function resetJobForRetranscribe(jobId: string) {
  await initDb();
  const job = await TranscriptionJob.findByPk(jobId);
  if (!job) {
    throw new Error("Job not found");
  }

  await ensureJobAudioFile(job);

  await job.update({
    status: "pending",
    transcript: null,
    errorMessage: null,
    processingMs: null,
    completedAt: null,
  });

  enqueueJob(job.id);
  ensureQueueRunning();

  return job;
}
