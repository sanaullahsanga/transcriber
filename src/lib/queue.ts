import { TranscriptionJob, initDb } from "./models";
import { assertAudioFileExists } from "./paths";
import { transcribeAudio } from "./transcription";

let processing = false;
let wakeScheduled = false;
let queueBootstrapped = false;

export function ensureQueueRunning() {
  if (queueBootstrapped) {
    scheduleProcessing();
    return;
  }
  queueBootstrapped = true;
  scheduleProcessing();
}

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

      await job.update({ status: "processing", errorMessage: null, processingMs: null });
      const startedAt = Date.now();

      try {
        const filePath = await assertAudioFileExists(job.storedPath);
        const result = await transcribeAudio({
          filePath,
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
          processingMs: Date.now() - startedAt,
          completedAt: new Date(),
          errorMessage: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Transcription failed";
        await job.update({
          status: "failed",
          errorMessage: message,
          processingMs: Date.now() - startedAt,
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
