import { computeWordErrorRate, type WerBreakdown } from "./wer";
import type { TranscriptionJob } from "./models/TranscriptionJob";

export type JobWerMetric = {
  jobId: string;
  provider: string;
  model: string;
  status: string;
  transcript: string | null;
  metrics: WerBreakdown | null;
};

export type CallReviewMetrics = {
  reviewId: string | null;
  benchmarkRunId: string | null;
  transcriptionJobId: string | null;
  originalFilename: string;
  reviewStatus: ReviewStatus | null;
  referenceTranscript: string;
  referenceSourceProvider: string | null;
  audioJobId: string | null;
  jobs: JobWerMetric[];
  createdAt: string | null;
};

type ReviewStatus = "draft" | "finalized";

export function findDeepgramJob(jobs: TranscriptionJob[]): TranscriptionJob | undefined {
  return jobs.find(
    (j) => j.provider === "deepgram" && j.status === "completed" && j.transcript?.trim(),
  );
}

export function buildJobMetrics(
  jobs: TranscriptionJob[],
  referenceTranscript: string,
): JobWerMetric[] {
  const reference = referenceTranscript.trim();
  return [...jobs]
    .sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0))
    .map((job) => ({
      jobId: job.id,
      provider: job.provider,
      model: job.model,
      status: job.status,
      transcript: job.transcript,
      metrics:
        job.status === "completed" && reference && job.transcript?.trim()
          ? computeWordErrorRate(reference, job.transcript)
          : null,
    }));
}

export function aggregateProviderStats(
  calls: Array<{
    jobs: JobWerMetric[];
    reviewStatus: ReviewStatus | null;
    originalFilename: string;
  }>,
  finalizedOnly = true,
) {
  const finalizedCalls = calls.filter((call) =>
    finalizedOnly ? call.reviewStatus === "finalized" : Boolean(call.reviewStatus),
  );
  const finalizedReviewCount = finalizedCalls.length;

  const stats = new Map<
    string,
    {
      provider: string;
      model: string;
      callCount: number;
      totalErrors: number;
      totalRefWords: number;
      werSum: number;
      scoredFilenames: string[];
    }
  >();

  for (const call of finalizedCalls) {
    for (const job of call.jobs) {
      if (!job.metrics) continue;
      const key = `${job.provider}::${job.model}`;
      const existing = stats.get(key) ?? {
        provider: job.provider,
        model: job.model,
        callCount: 0,
        totalErrors: 0,
        totalRefWords: 0,
        werSum: 0,
        scoredFilenames: [],
      };
      existing.callCount++;
      existing.totalErrors += job.metrics.errorCount;
      existing.totalRefWords += job.metrics.refWordCount;
      existing.werSum += job.metrics.wer;
      if (!existing.scoredFilenames.includes(call.originalFilename)) {
        existing.scoredFilenames.push(call.originalFilename);
      }
      stats.set(key, existing);
    }
  }

  return [...stats.values()]
    .map((s) => ({
      provider: s.provider,
      model: s.model,
      callCount: s.callCount,
      finalizedReviewCount,
      missingReviewCount: Math.max(0, finalizedReviewCount - s.callCount),
      scoredFilenames: s.scoredFilenames,
      avgWerPercent:
        s.callCount > 0 ? Math.round((s.werSum / s.callCount) * 1000) / 10 : 0,
      cumulativeWerPercent:
        s.totalRefWords > 0
          ? Math.round((s.totalErrors / s.totalRefWords) * 1000) / 10
          : 0,
      totalErrors: s.totalErrors,
      totalRefWords: s.totalRefWords,
    }))
    .sort((a, b) => a.cumulativeWerPercent - b.cumulativeWerPercent);
}
