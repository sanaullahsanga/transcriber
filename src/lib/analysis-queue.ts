import { analyzeTranscriptForSttIssues, getLlmModelName } from "@/lib/llm/analyze-stt";
import { initDb, SttAnalysis, TranscriptionJob } from "@/lib/models";

let processing = false;
let wakeScheduled = false;

export function enqueueAnalysis(analysisId: string) {
  scheduleProcessing();
  return analysisId;
}

export function enqueueAnalyses(analysisIds: string[]) {
  for (const id of analysisIds) {
    enqueueAnalysis(id);
  }
}

export function ensureAnalysisQueueRunning() {
  scheduleProcessing();
}

function scheduleProcessing() {
  if (wakeScheduled) return;
  wakeScheduled = true;
  setImmediate(() => {
    wakeScheduled = false;
    void processAnalysisQueue();
  });
}

async function processAnalysisQueue() {
  if (processing) return;
  processing = true;

  try {
    await initDb();

    while (true) {
      const analysis = await SttAnalysis.findOne({
        where: { status: "pending" },
        order: [["createdAt", "ASC"]],
      });

      if (!analysis) break;

      await analysis.update({ status: "processing", errorMessage: null, processingMs: null });
      const startedAt = Date.now();

      try {
        const job = await TranscriptionJob.findByPk(analysis.jobId);
        if (!job?.transcript?.trim()) {
          throw new Error("Transcript not available for this job");
        }

        const llmModel = await getLlmModelName();
        const result = await analyzeTranscriptForSttIssues({
          transcript: job.transcript,
          filename: job.originalFilename,
          provider: job.provider,
          model: job.model,
          keyterms: job.options?.keyterms ?? [],
        });

        await analysis.update({
          status: "completed",
          summary: result.summary,
          qualityScore: result.qualityScore,
          issues: result.issues,
          llmModel,
          processingMs: Date.now() - startedAt,
          errorMessage: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "STT analysis failed";
        await analysis.update({
          status: "failed",
          errorMessage: message,
          processingMs: Date.now() - startedAt,
        });
      }
    }
  } finally {
    processing = false;
    const pending = await SttAnalysis.count({ where: { status: "pending" } });
    if (pending > 0) {
      scheduleProcessing();
    }
  }
}

export async function resetAnalysisForRetry(analysisId: string) {
  await initDb();
  const analysis = await SttAnalysis.findByPk(analysisId);
  if (!analysis) {
    throw new Error("Analysis not found");
  }

  await analysis.update({
    status: "pending",
    summary: null,
    qualityScore: null,
    issues: [],
    errorMessage: null,
    processingMs: null,
  });

  enqueueAnalysis(analysis.id);
  ensureAnalysisQueueRunning();

  return analysis;
}
