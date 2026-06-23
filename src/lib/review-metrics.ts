import { computeWordErrorRate, type WerBreakdown } from "./wer";
import { isComparisonJob, isReferenceJob } from "./call-jobs";
import { REFERENCE_PROVIDER } from "./reference-provider";
import type { TranscriptionJob } from "./models/TranscriptionJob";

export type JobWerMetric = {
  jobId: string;
  provider: string;
  model: string;
  status: string;
  transcript: string | null;
  metrics: WerBreakdown | null;
};

export type CallSlotConfig = {
  provider: string;
  model: string;
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
  initialSlots: CallSlotConfig[];
  /** All provider/model jobs on this call, including reference-only runs. */
  runSlots: CallSlotConfig[];
  jobs: JobWerMetric[];
  createdAt: string | null;
};

type ReviewStatus = "draft" | "finalized";

export function findReferenceJob(jobs: TranscriptionJob[]): TranscriptionJob | undefined {
  const dedicated = jobs.find(
    (j) =>
      j.provider === REFERENCE_PROVIDER &&
      isReferenceJob(j) &&
      j.status === "completed" &&
      j.transcript?.trim(),
  );
  if (dedicated) return dedicated;

  return jobs.find(
    (j) =>
      j.provider === REFERENCE_PROVIDER &&
      j.status === "completed" &&
      j.transcript?.trim(),
  );
}

/** @deprecated Use findReferenceJob — kept for legacy scripts comparing Deepgram. */
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
    .filter(isComparisonJob)
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
    const countedForCall = new Set<string>();
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
      if (!countedForCall.has(key)) {
        existing.callCount++;
        countedForCall.add(key);
        if (!existing.scoredFilenames.includes(call.originalFilename)) {
          existing.scoredFilenames.push(call.originalFilename);
        }
      }
      existing.totalErrors += job.metrics.errorCount;
      existing.totalRefWords += job.metrics.refWordCount;
      existing.werSum += job.metrics.wer;
      stats.set(key, existing);
    }
  }

  return [...stats.values()]
    .map((s) => ({
      provider: s.provider,
      model: s.model,
      callCount: s.callCount,
      finalizedReviewCount,
      missingReviewCount: Math.max(0, finalizedReviewCount - s.scoredFilenames.length),
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
