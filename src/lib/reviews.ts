import { Op } from "sequelize";
import {
  isComparisonJob,
  loadJobsForCall,
  refreshElevenLabsReference,
  waitForJobCompletion,
} from "./call-jobs";
import {
  aggregateProviderStats,
  buildJobMetrics,
  findReferenceJob,
  type CallReviewMetrics,
  type CallSlotConfig,
} from "./review-metrics";
import { REFERENCE_PROVIDER } from "./reference-provider";
import { BenchmarkRun, CallReview, initDb, TranscriptionJob } from "./models";
import { buildPaginationMeta } from "./pagination";
import { ensureQueueRunning } from "./queue";

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

  return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function initialSlotsForTranscribeJob(jobs: TranscriptionJob[]): CallSlotConfig[] {
  const primary = [...jobs].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
  if (!primary) return [];
  return [{ provider: primary.provider, model: primary.model }];
}

async function backfillEmptyFinalizedReferences() {
  const reviews = await CallReview.findAll({
    where: { status: "finalized", referenceTranscript: "" },
  });
  if (!reviews.length) return;

  for (const review of reviews) {
    let jobs: TranscriptionJob[] = [];
    if (review.benchmarkRunId) {
      jobs = await loadJobsForCall({ benchmarkRunId: review.benchmarkRunId });
    } else if (review.transcriptionJobId) {
      jobs = await loadJobsForCall({ transcriptionJobId: review.transcriptionJobId });
    }

    const referenceJob = findReferenceJob(jobs);
    const fallback = referenceJob?.transcript?.trim();
    if (!fallback) continue;

    await review.update({
      referenceTranscript: fallback,
      referenceSourceJobId: referenceJob?.id ?? review.referenceSourceJobId,
      referenceSourceProvider: referenceJob ? REFERENCE_PROVIDER : review.referenceSourceProvider,
    });
  }
}

export async function getReviewableCalls(options?: { limit?: number; offset?: number }) {
  await initDb();
  const entries = await listReviewableEntries();
  const limit = options?.limit ?? entries.length;
  const offset = options?.offset ?? 0;
  const page = entries.slice(offset, offset + limit);

  const reviews = await CallReview.findAll();
  const reviewByBenchmark = new Map(
    reviews.filter((r) => r.benchmarkRunId).map((r) => [r.benchmarkRunId!, r]),
  );

  const benchmarkRunIds = page
    .map((entry) => entry.benchmarkRunId)
    .filter((id): id is string => Boolean(id));
  const benchmarkJobs =
    benchmarkRunIds.length > 0
      ? await TranscriptionJob.findAll({
          where: { benchmarkRunId: { [Op.in]: benchmarkRunIds } },
        })
      : [];
  const benchmarkRuns =
    benchmarkRunIds.length > 0
      ? await BenchmarkRun.findAll({ where: { id: { [Op.in]: benchmarkRunIds } } })
      : [];
  const slotsByBenchmark = new Map(
    benchmarkRuns.map((run) => [
      run.id,
      run.slots.map((slot) => ({ provider: slot.provider, model: slot.model })),
    ]),
  );
  const jobsByBenchmark = new Map<string, TranscriptionJob[]>();
  for (const job of benchmarkJobs) {
    if (!job.benchmarkRunId) continue;
    const list = jobsByBenchmark.get(job.benchmarkRunId) ?? [];
    list.push(job);
    jobsByBenchmark.set(job.benchmarkRunId, list);
  }

  const calls: CallReviewMetrics[] = [];

  for (const entry of page) {
    if (!entry.benchmarkRunId) continue;

    const jobs = jobsByBenchmark.get(entry.benchmarkRunId) ?? [];
    const review = reviewByBenchmark.get(entry.benchmarkRunId) ?? null;
    calls.push(
      buildCallMetrics(review, jobs, {
        benchmarkRunId: entry.benchmarkRunId,
        originalFilename: entry.originalFilename,
        createdAt: entry.createdAt,
        initialSlots: slotsByBenchmark.get(entry.benchmarkRunId) ?? [],
      }),
    );
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
    initialSlots: CallSlotConfig[];
  },
): CallReviewMetrics {
  const referenceJob = findReferenceJob(jobs);
  const savedReference = review?.referenceTranscript?.trim() ?? "";
  const referenceFromJob = referenceJob?.transcript?.trim() ?? "";
  const savedFromReferenceProvider =
    Boolean(savedReference) && review?.referenceSourceProvider === REFERENCE_PROVIDER;
  const displayReference = savedFromReferenceProvider
    ? savedReference
    : referenceFromJob || savedReference;
  // Finalized reviews must contribute to dashboard WER even when reference was
  // only visible as UI prefill and not persisted historically.
  const referenceForWer =
    displayReference || (review?.status === "finalized" ? referenceFromJob : "");

  return {
    reviewId: review?.id ?? null,
    benchmarkRunId: meta.benchmarkRunId ?? null,
    transcriptionJobId: meta.transcriptionJobId ?? null,
    originalFilename: meta.originalFilename,
    reviewStatus: review?.status ?? null,
    referenceTranscript: displayReference,
    referenceSourceProvider:
      review?.referenceSourceProvider ??
      (referenceFromJob ? REFERENCE_PROVIDER : null),
    audioJobId:
      jobs.find((j) => isComparisonJob(j))?.id ?? jobs[0]?.id ?? null,
    initialSlots: meta.initialSlots,
    runSlots: jobs
      .filter(isComparisonJob)
      .map((job) => ({ provider: job.provider, model: job.model })),
    jobs: buildJobMetrics(jobs, referenceForWer),
    createdAt: meta.createdAt.toISOString(),
  };
}

export async function persistReferenceTranscript(input: {
  benchmarkRunId?: string;
  transcriptionJobId?: string;
  referenceTranscript: string;
  referenceSourceJobId: string;
}) {
  await initDb();

  if (!input.benchmarkRunId && !input.transcriptionJobId) {
    throw new Error("benchmarkRunId or transcriptionJobId is required");
  }

  let originalFilename = "";
  if (input.benchmarkRunId) {
    const run = await BenchmarkRun.findByPk(input.benchmarkRunId);
    if (!run) throw new Error("Benchmark run not found");
    originalFilename = run.originalFilename;
  } else {
    const job = await TranscriptionJob.findByPk(input.transcriptionJobId!);
    if (!job) throw new Error("Job not found");
    originalFilename = job.originalFilename;
  }

  const where = input.benchmarkRunId
    ? { benchmarkRunId: input.benchmarkRunId }
    : { transcriptionJobId: input.transcriptionJobId! };

  const existing = await CallReview.findOne({ where });
  const referenceTranscript = input.referenceTranscript.trim();

  if (existing) {
    await existing.update({
      referenceTranscript,
      referenceSourceJobId: input.referenceSourceJobId,
      referenceSourceProvider: REFERENCE_PROVIDER,
    });
    return existing;
  }

  return CallReview.create({
    ...where,
    originalFilename,
    referenceTranscript,
    referenceSourceJobId: input.referenceSourceJobId,
    referenceSourceProvider: REFERENCE_PROVIDER,
    status: "draft",
  });
}

export type BatchReferenceResult = {
  benchmarkRunId: string;
  originalFilename: string;
  ok: boolean;
  skipped?: boolean;
  jobId?: string;
  wordCount?: number;
  error?: string;
};

export async function batchApplyElevenLabsReferences(options?: {
  /** Re-run ElevenLabs even when a completed reference transcript already exists. */
  forceRetranscribe?: boolean;
  /** Per-call timeout while waiting for transcription (ms). */
  timeoutMs?: number;
}): Promise<BatchReferenceResult[]> {
  await initDb();
  ensureQueueRunning();

  const entries = await listReviewableEntries();
  const results: BatchReferenceResult[] = [];

  for (const [index, entry] of entries.entries()) {
    if (!entry.benchmarkRunId) continue;

    const benchmarkRunId = entry.benchmarkRunId;
    const label = `[${index + 1}/${entries.length}] ${entry.originalFilename}`;

    try {
      if (!options?.forceRetranscribe) {
        const jobs = await loadJobsForCall({ benchmarkRunId });
        const referenceJob = findReferenceJob(jobs);
        const transcript = referenceJob?.transcript?.trim();
        if (transcript && referenceJob) {
          await persistReferenceTranscript({
            benchmarkRunId,
            referenceTranscript: transcript,
            referenceSourceJobId: referenceJob.id,
          });
          results.push({
            benchmarkRunId,
            originalFilename: entry.originalFilename,
            ok: true,
            skipped: true,
            jobId: referenceJob.id,
            wordCount: transcript.split(/\s+/).filter(Boolean).length,
          });
          console.log(`${label} — saved existing ElevenLabs reference`);
          continue;
        }
      }

      const job = await refreshElevenLabsReference({ benchmarkRunId });
      const completed = await waitForJobCompletion(
        job.id,
        options?.timeoutMs ?? 600_000,
      );
      const referenceTranscript = completed.transcript?.trim() ?? "";
      if (!referenceTranscript) {
        throw new Error("ElevenLabs returned an empty transcript");
      }

      await persistReferenceTranscript({
        benchmarkRunId,
        referenceTranscript,
        referenceSourceJobId: completed.id,
      });

      results.push({
        benchmarkRunId,
        originalFilename: entry.originalFilename,
        ok: true,
        jobId: completed.id,
        wordCount: referenceTranscript.split(/\s+/).filter(Boolean).length,
      });
      console.log(`${label} — transcribed and saved (${results.at(-1)!.wordCount} words)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      results.push({
        benchmarkRunId,
        originalFilename: entry.originalFilename,
        ok: false,
        error: message,
      });
      console.error(`${label} — failed: ${message}`);
    }
  }

  return results;
}

export async function getBenchmarkReview(runId: string) {
  await initDb();
  const run = await BenchmarkRun.findByPk(runId);
  if (!run) return null;

  const jobs = await loadJobsForCall({
    benchmarkRunId: runId,
  });
  const review = await CallReview.findOne({ where: { benchmarkRunId: runId } });

  return buildCallMetrics(review, jobs, {
    benchmarkRunId: run.id,
    originalFilename: run.originalFilename,
    createdAt: run.createdAt,
    initialSlots: run.slots.map((slot) => ({ provider: slot.provider, model: slot.model })),
  });
}

export async function saveReview(input: {
  benchmarkRunId?: string;
  transcriptionJobId?: string;
  referenceTranscript: string;
  status?: "draft" | "finalized";
}) {
  await initDb();

  const jobs = await loadJobsForCall({
    benchmarkRunId: input.benchmarkRunId,
    transcriptionJobId: input.transcriptionJobId,
  });
  let originalFilename = "";
  let referenceJob = findReferenceJob(jobs);
  let initialSlots: CallSlotConfig[] = [];

  if (input.benchmarkRunId) {
    const run = await BenchmarkRun.findByPk(input.benchmarkRunId);
    if (!run) throw new Error("Benchmark run not found");
    originalFilename = run.originalFilename;
    initialSlots = run.slots.map((slot) => ({ provider: slot.provider, model: slot.model }));
  } else if (input.transcriptionJobId) {
    const job = await TranscriptionJob.findByPk(input.transcriptionJobId);
    if (!job) throw new Error("Job not found");
    originalFilename = job.originalFilename;
    initialSlots = initialSlotsForTranscribeJob(jobs);
  } else {
    throw new Error("benchmarkRunId or transcriptionJobId is required");
  }

  const where = input.benchmarkRunId
    ? { benchmarkRunId: input.benchmarkRunId }
    : { transcriptionJobId: input.transcriptionJobId! };

  const [review] = await CallReview.upsert({
    ...where,
    originalFilename,
    referenceTranscript: input.referenceTranscript.trim(),
    referenceSourceJobId: referenceJob?.id ?? null,
    referenceSourceProvider: referenceJob ? REFERENCE_PROVIDER : null,
    status: input.status ?? "draft",
  });

  if (
    review.status === "finalized" &&
    !review.referenceTranscript.trim() &&
    referenceJob?.transcript?.trim()
  ) {
    await review.update({
      referenceTranscript: referenceJob.transcript.trim(),
      referenceSourceJobId: referenceJob.id,
      referenceSourceProvider: REFERENCE_PROVIDER,
    });
  }

  return buildCallMetrics(review, jobs, {
    benchmarkRunId: input.benchmarkRunId,
    transcriptionJobId: input.transcriptionJobId,
    originalFilename,
    createdAt: review.createdAt,
    initialSlots,
  });
}

export async function getReviewDashboard() {
  await initDb();
  await backfillEmptyFinalizedReferences();
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
