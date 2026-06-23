import { copyFile } from "node:fs/promises";
import path from "node:path";
import { Op } from "sequelize";
import { resetJobForRetranscribe } from "./job-audio";
import { BenchmarkRun, TranscriptionJob, initDb } from "./models";
import type { JobOptions } from "./models/TranscriptionJob";
import { getUploadDir, resolveStoredPath } from "./paths";
import { getProvider, resolveModel, PROVIDERS } from "./providers";
import { isProviderConfigured } from "./providers-config";
import { REFERENCE_PROVIDER } from "./reference-provider";
import { enqueueJob, ensureQueueRunning } from "./queue";
import type { CallSlotConfig } from "./review-metrics";

function initialSlotsForJobs(
  jobs: TranscriptionJob[],
  benchmarkRunId?: string | null,
): CallSlotConfig[] {
  if (benchmarkRunId) {
    return [];
  }
  const primary = [...jobs].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
  if (!primary) return [];
  return [{ provider: primary.provider, model: primary.model }];
}

async function loadInitialSlots(input: {
  benchmarkRunId?: string;
  jobs: TranscriptionJob[];
}): Promise<CallSlotConfig[]> {
  if (input.benchmarkRunId) {
    const run = await BenchmarkRun.findByPk(input.benchmarkRunId);
    return run?.slots.map((slot) => ({ provider: slot.provider, model: slot.model })) ?? [];
  }
  return initialSlotsForJobs(input.jobs);
}

export function isReferenceJob(job: TranscriptionJob): boolean {
  return Boolean(job.options?.isReference);
}

export function isComparisonJob(job: TranscriptionJob): boolean {
  return !isReferenceJob(job);
}

export async function loadJobsForCall(input: {
  benchmarkRunId?: string;
  transcriptionJobId?: string;
}): Promise<TranscriptionJob[]> {
  await initDb();

  if (input.benchmarkRunId) {
    return TranscriptionJob.findAll({
      where: { benchmarkRunId: input.benchmarkRunId },
      order: [["createdAt", "ASC"]],
    });
  }

  if (!input.transcriptionJobId) {
    throw new Error("benchmarkRunId or transcriptionJobId is required");
  }

  const job = await TranscriptionJob.findByPk(input.transcriptionJobId);
  if (!job) {
    throw new Error("Job not found");
  }

  if (job.benchmarkRunId) {
    return TranscriptionJob.findAll({
      where: { benchmarkRunId: job.benchmarkRunId },
      order: [["createdAt", "ASC"]],
    });
  }

  return TranscriptionJob.findAll({
    where: {
      benchmarkRunId: { [Op.is]: null },
      storedPath: job.storedPath,
    },
    order: [["createdAt", "ASC"]],
  });
}

async function resolveAudioSource(input: {
  benchmarkRunId?: string;
  transcriptionJobId?: string;
}) {
  const jobs = await loadJobsForCall(input);
  if (!jobs.length) {
    throw new Error("No jobs found for this call");
  }

  const primary = jobs[0]!;
  let storedPath = primary.storedPath;
  let mimeType = primary.mimeType;
  let originalFilename = primary.originalFilename;
  let fileSizeBytes = primary.fileSizeBytes;
  let options = primary.options;

  if (input.benchmarkRunId) {
    const run = await BenchmarkRun.findByPk(input.benchmarkRunId);
    if (!run) throw new Error("Benchmark run not found");
    storedPath = run.storedPath;
    mimeType = run.mimeType;
    originalFilename = run.originalFilename;
    fileSizeBytes = run.fileSizeBytes;
    options = run.options;
  }

  return {
    jobs,
    storedPath,
    mimeType,
    originalFilename,
    fileSizeBytes,
    options,
    benchmarkRunId: input.benchmarkRunId ?? primary.benchmarkRunId,
  };
}

export async function createReferenceJobForBenchmark(run: BenchmarkRun): Promise<TranscriptionJob | null> {
  if (!isProviderConfigured(PROVIDERS[REFERENCE_PROVIDER])) {
    return null;
  }

  const existingJobs = await TranscriptionJob.findAll({ where: { benchmarkRunId: run.id } });
  const comparisonReference = existingJobs.find(
    (job) => job.provider === REFERENCE_PROVIDER && isComparisonJob(job),
  );
  if (comparisonReference) {
    return null;
  }

  const existingReference = existingJobs.find(
    (job) => job.provider === REFERENCE_PROVIDER && isReferenceJob(job),
  );
  if (existingReference) {
    return existingReference;
  }

  const uploadDir = getUploadDir();
  const sourcePath = resolveStoredPath(run.storedPath);
  const storedName = path.basename(run.storedPath);
  const refPath = path.join(uploadDir, `ref-${storedName}`);
  await copyFile(sourcePath, refPath);

  const referenceOptions: JobOptions = {
    ...run.options,
    isReference: true,
  };

  const job = await TranscriptionJob.create({
    originalFilename: run.originalFilename,
    storedPath: refPath,
    mimeType: run.mimeType,
    fileSizeBytes: run.fileSizeBytes,
    provider: REFERENCE_PROVIDER,
    model: resolveModel(REFERENCE_PROVIDER),
    options: referenceOptions,
    status: "pending",
    benchmarkRunId: run.id,
    slotIndex: null,
  });

  return job;
}

export async function refreshReferenceTranscript(input: {
  benchmarkRunId?: string;
  transcriptionJobId?: string;
}): Promise<TranscriptionJob> {
  await initDb();

  const referenceProvider = PROVIDERS[REFERENCE_PROVIDER];
  if (!isProviderConfigured(referenceProvider)) {
    throw new Error(`${referenceProvider.name} is not configured for reference transcripts`);
  }

  const source = await resolveAudioSource(input);
  const referenceJob = source.jobs.find(
    (job) => job.provider === REFERENCE_PROVIDER && isReferenceJob(job),
  );
  const comparisonReferenceJob = source.jobs.find(
    (job) => job.provider === REFERENCE_PROVIDER && isComparisonJob(job),
  );
  const existingReferenceJob = referenceJob ?? comparisonReferenceJob;

  if (existingReferenceJob) {
    return resetJobForRetranscribe(existingReferenceJob.id);
  }

  const uploadDir = getUploadDir();
  const audioPath = resolveStoredPath(source.storedPath);
  const storedName = path.basename(source.storedPath);
  const refPath = path.join(uploadDir, `ref-${Date.now()}-${storedName}`);
  await copyFile(audioPath, refPath);

  const referenceOptions: JobOptions = {
    ...source.options,
    isReference: true,
  };

  const job = await TranscriptionJob.create({
    originalFilename: source.originalFilename,
    storedPath: refPath,
    mimeType: source.mimeType,
    fileSizeBytes: source.fileSizeBytes,
    provider: REFERENCE_PROVIDER,
    model: resolveModel(REFERENCE_PROVIDER),
    options: referenceOptions,
    status: "pending",
    benchmarkRunId: source.benchmarkRunId,
    slotIndex: null,
  });

  enqueueJob(job.id);
  ensureQueueRunning();
  return job;
}

/** @deprecated Use refreshReferenceTranscript */
export const refreshElevenLabsReference = refreshReferenceTranscript;

export async function addProviderJobToCall(input: {
  benchmarkRunId?: string;
  transcriptionJobId?: string;
  provider: string;
  model?: string;
}): Promise<TranscriptionJob> {
  await initDb();

  const provider = getProvider(input.provider);
  if (!provider) {
    throw new Error(`Unknown provider: ${input.provider}`);
  }
  if (!isProviderConfigured(provider)) {
    throw new Error(`${provider.name} is not configured`);
  }

  const model = resolveModel(input.provider, input.model);
  const source = await resolveAudioSource(input);
  const initialSlots = await loadInitialSlots({
    benchmarkRunId: source.benchmarkRunId ?? undefined,
    jobs: source.jobs,
  });

  if (initialSlots.some((slot) => slot.provider === input.provider)) {
    throw new Error(`${provider.name} was already used in the original run for this call`);
  }

  const duplicate = source.jobs.find(
    (job) => job.provider === input.provider && job.model === model,
  );
  if (duplicate) {
    throw new Error(`This call already has a ${provider.name} / ${model} transcript`);
  }

  const uploadDir = getUploadDir();
  const audioPath = resolveStoredPath(source.storedPath);
  const storedName = path.basename(source.storedPath);
  const jobPath = path.join(uploadDir, `${input.provider}-${Date.now()}-${storedName}`);
  await copyFile(audioPath, jobPath);

  const nextSlotIndex =
    input.benchmarkRunId != null
      ? Math.max(-1, ...source.jobs.map((job) => job.slotIndex ?? -1)) + 1
      : null;

  const job = await TranscriptionJob.create({
    originalFilename: source.originalFilename,
    storedPath: jobPath,
    mimeType: source.mimeType,
    fileSizeBytes: source.fileSizeBytes,
    provider: input.provider,
    model,
    options: {
      ...source.options,
      isReference: false,
    },
    status: "pending",
    benchmarkRunId: source.benchmarkRunId,
    slotIndex: nextSlotIndex,
  });

  enqueueJob(job.id);
  ensureQueueRunning();
  return job;
}

export async function waitForJobCompletion(
  jobId: string,
  timeoutMs = 600_000,
  pollMs = 1500,
): Promise<TranscriptionJob> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const job = await TranscriptionJob.findByPk(jobId);
    if (!job) {
      throw new Error("Job not found");
    }
    if (job.status === "completed") {
      return job;
    }
    if (job.status === "failed") {
      throw new Error(job.errorMessage ?? "Transcription failed");
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error("Transcription timed out");
}
