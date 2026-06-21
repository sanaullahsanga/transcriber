import { TranscriptionJob, initDb } from "./models";
import { transcribeAudio } from "./transcription";

let processing = false;
let wakeScheduled = false;

export function enqueueJob(jobId: string) {
  scheduleProcessing();
  return jobId;
}

export function enqueueJobs(jobIds: string[]) {
  for (const id of jobIds) {
    enqueueJob(id);
  }
}

function scheduleProcessing() {
  if (wakeScheduled) return;
  wakeScheduled = true;
  setImmediate(() => {
    wakeScheduled = false;
    void processQueue();
  });
}

async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    await initDb();

    while (true) {
      const job = await TranscriptionJob.findOne({
        where: { status: "pending" },
        order: [["createdAt", "ASC"]],
      });

      if (!job) break;

      await job.update({ status: "processing", errorMessage: null });

      try {
        const result = await transcribeAudio({
          filePath: job.storedPath,
          filename: job.originalFilename,
          mimeType: job.mimeType,
          provider: job.provider,
          model: job.model,
          options: job.options,
        });

        await job.update({
          status: "completed",
          transcript: result.text,
          durationMs: result.durationMs ?? null,
          completedAt: new Date(),
          errorMessage: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Transcription failed";
        await job.update({
          status: "failed",
          errorMessage: message,
          completedAt: new Date(),
        });
      }
    }
  } finally {
    processing = false;
    const pending = await TranscriptionJob.count({ where: { status: "pending" } });
    if (pending > 0) {
      scheduleProcessing();
    }
  }
}
