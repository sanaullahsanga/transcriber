import { Op } from "sequelize";
import {
  aggregateProviderStats,
  buildJobMetrics,
  findDeepgramJob,
  type CallReviewMetrics,
} from "./review-metrics";
import { BenchmarkRun, CallReview, initDb, TranscriptionJob } from "./models";
import { buildPaginationMeta } from "./pagination";

type ReviewableEntry = {
  benchmarkRunId?: string;
  transcriptionJobId?: string;
  originalFilename: string;
  createdAt: Date;
};

async function listReviewableEntries(): Promise<ReviewableEntry[]> {
  await initDb();

  const benchmarkRuns = await BenchmarkRun.findAll({
    order: [["createdAt", "DESC"]],
    attributes: ["id", "originalFilename", "createdAt"],
  });

  const entries: ReviewableEntry[] = [];

  for (const run of benchmarkRuns) {
    const jobs = await TranscriptionJob.findAll({
      where: { benchmarkRunId: run.id },
      attributes: ["status", "transcript"],
    });
    const hasCompleted = jobs.some((j) => j.status === "completed" && j.transcript?.trim());
    if (!hasCompleted) continue;

    entries.push({
      benchmarkRunId: run.id,
      originalFilename: run.originalFilename,
      createdAt: run.createdAt,
    });
  }

  const singleJobs = await TranscriptionJob.findAll({
    where: {
      benchmarkRunId: { [Op.is]: null },
      status: "completed",
      transcript: { [Op.ne]: null },
    },
    order: [["createdAt", "DESC"]],
    attributes: ["id", "originalFilename", "createdAt", "transcript"],
  });

  for (const job of singleJobs) {
    if (!job.transcript?.trim()) continue;
    entries.push({
      transcriptionJobId: job.id,
      originalFilename: job.originalFilename,
      createdAt: job.createdAt,
    });
  }

  return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getReviewableCalls(options?: { limit?: number; offset?: number }) {
  const entries = await listReviewableEntries();
  const limit = options?.limit ?? entries.length;
  const offset = options?.offset ?? 0;
  const page = entries.slice(offset, offset + limit);

  const reviews = await CallReview.findAll();
  const reviewByBenchmark = new Map(
    reviews.filter((r) => r.benchmarkRunId).map((r) => [r.benchmarkRunId!, r]),
  );
  const reviewByJob = new Map(
    reviews.filter((r) => r.transcriptionJobId).map((r) => [r.transcriptionJobId!, r]),
  );

  const calls: CallReviewMetrics[] = [];

  for (const entry of page) {
    if (entry.benchmarkRunId) {
      const jobs = await TranscriptionJob.findAll({ where: { benchmarkRunId: entry.benchmarkRunId } });
      const review = reviewByBenchmark.get(entry.benchmarkRunId) ?? null;
      calls.push(
        buildCallMetrics(review, jobs, {
          benchmarkRunId: entry.benchmarkRunId,
          originalFilename: entry.originalFilename,
          createdAt: entry.createdAt,
        }),
      );
      continue;
    }

    if (entry.transcriptionJobId) {
      const job = await TranscriptionJob.findByPk(entry.transcriptionJobId);
      if (!job) continue;
      const review = reviewByJob.get(job.id) ?? null;
      calls.push(
        buildCallMetrics(review, [job], {
          transcriptionJobId: job.id,
          originalFilename: entry.originalFilename,
          createdAt: entry.createdAt,
        }),
      );
    }
  }

  return {
    calls,
    pagination: buildPaginationMeta(entries.length, limit, offset, page.length),
  };
}

function buildCallMetrics(
  review: CallReview | null,
  jobs: TranscriptionJob[],
  meta: {
    benchmarkRunId?: string;
    transcriptionJobId?: string;
    originalFilename: string;
    createdAt: Date;
  },
): CallReviewMetrics {
  const deepgram = findDeepgramJob(jobs);
  const referenceForWer = review?.referenceTranscript?.trim() ?? "";
  const displayReference =
    referenceForWer || deepgram?.transcript?.trim() || jobs.find((j) => j.transcript?.trim())?.transcript || "";

  return {
    reviewId: review?.id ?? null,
    benchmarkRunId: meta.benchmarkRunId ?? null,
    transcriptionJobId: meta.transcriptionJobId ?? null,
    originalFilename: meta.originalFilename,
    reviewStatus: review?.status ?? null,
    referenceTranscript: displayReference,
    referenceSourceProvider:
      review?.referenceSourceProvider ?? (deepgram ? "deepgram" : null),
    audioJobId: jobs[0]?.id ?? null,
    jobs: buildJobMetrics(jobs, referenceForWer),
    createdAt: meta.createdAt.toISOString(),
  };
}

export async function getBenchmarkReview(runId: string) {
  await initDb();
  const run = await BenchmarkRun.findByPk(runId);
  if (!run) return null;

  const jobs = await TranscriptionJob.findAll({ where: { benchmarkRunId: runId } });
  const review = await CallReview.findOne({ where: { benchmarkRunId: runId } });

  return buildCallMetrics(review, jobs, {
    benchmarkRunId: run.id,
    originalFilename: run.originalFilename,
    createdAt: run.createdAt,
  });
}

export async function saveReview(input: {
  benchmarkRunId?: string;
  transcriptionJobId?: string;
  referenceTranscript: string;
  status?: "draft" | "finalized";
}) {
  await initDb();

  let jobs: TranscriptionJob[] = [];
  let originalFilename = "";
  let deepgram = undefined as TranscriptionJob | undefined;

  if (input.benchmarkRunId) {
    const run = await BenchmarkRun.findByPk(input.benchmarkRunId);
    if (!run) throw new Error("Benchmark run not found");
    originalFilename = run.originalFilename;
    jobs = await TranscriptionJob.findAll({ where: { benchmarkRunId: run.id } });
    deepgram = findDeepgramJob(jobs);
  } else if (input.transcriptionJobId) {
    const job = await TranscriptionJob.findByPk(input.transcriptionJobId);
    if (!job) throw new Error("Job not found");
    originalFilename = job.originalFilename;
    jobs = [job];
    deepgram = job.provider === "deepgram" ? job : undefined;
  } else {
    throw new Error("benchmarkRunId or transcriptionJobId is required");
  }

  const where = input.benchmarkRunId
    ? { benchmarkRunId: input.benchmarkRunId }
    : { transcriptionJobId: input.transcriptionJobId! };

  const [review] = await CallReview.upsert({
    ...where,
    originalFilename,
    referenceTranscript: input.referenceTranscript,
    referenceSourceJobId: deepgram?.id ?? null,
    referenceSourceProvider: deepgram ? "deepgram" : null,
    status: input.status ?? "draft",
  });

  return buildCallMetrics(review, jobs, {
    benchmarkRunId: input.benchmarkRunId,
    transcriptionJobId: input.transcriptionJobId,
    originalFilename,
    createdAt: review.createdAt,
  });
}

export async function getReviewDashboard() {
  const { calls } = await getReviewableCalls();
  const finalized = calls.filter((c) => c.reviewStatus === "finalized");
  const drafts = calls.filter((c) => c.reviewStatus === "draft");

  const providerStats = aggregateProviderStats(
    calls.map((call) => ({
      jobs: call.jobs,
      reviewStatus: call.reviewStatus,
      originalFilename: call.originalFilename,
    })),
    true,
  );
  const allProviderStats = aggregateProviderStats(
    calls
      .filter((c) => c.reviewStatus)
      .map((call) => ({
        jobs: call.jobs,
        reviewStatus: call.reviewStatus,
        originalFilename: call.originalFilename,
      })),
    false,
  );

  const avgFinalizedWer =
    finalized.length > 0
      ? Math.round(
          (finalized.reduce((sum, call) => {
            const jobWers = call.jobs
              .map((j) => j.metrics?.wer ?? null)
              .filter((w): w is number => w !== null);
            if (!jobWers.length) return sum;
            return sum + jobWers.reduce((a, b) => a + b, 0) / jobWers.length;
          }, 0) /
            finalized.length) *
            1000,
        ) / 10
      : 0;

  return {
    totalCalls: calls.length,
    finalizedCount: finalized.length,
    draftCount: drafts.length,
    pendingCount: calls.filter((c) => !c.reviewStatus).length,
    avgFinalizedWerPercent: avgFinalizedWer,
    providerStats,
    allProviderStats,
    recentCalls: calls.slice(0, 20),
  };
}
