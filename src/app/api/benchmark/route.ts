import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { BenchmarkRun, TranscriptionJob, initDb } from "@/lib/models";
import type { BenchmarkSlotConfig } from "@/lib/models/BenchmarkRun";
import type { JobOptions } from "@/lib/models/TranscriptionJob";
import { getUploadDir } from "@/lib/paths";
import { getProvider, resolveModel } from "@/lib/providers";
import { enqueueJobs, ensureQueueRunning } from "@/lib/queue";

export const runtime = "nodejs";

function serializeRun(run: BenchmarkRun, jobs: TranscriptionJob[]) {
  return {
    id: run.id,
    originalFilename: run.originalFilename,
    fileSizeBytes: run.fileSizeBytes,
    options: run.options,
    slots: run.slots,
    createdAt: run.createdAt,
    jobs: jobs
      .sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0))
      .map((job) => ({
        id: job.id,
        slotIndex: job.slotIndex,
        provider: job.provider,
        model: job.model,
        status: job.status,
        transcript: job.transcript,
        errorMessage: job.errorMessage,
        durationMs: job.durationMs,
        processingMs: job.processingMs,
        completedAt: job.completedAt,
      })),
  };
}

export async function GET() {
  try {
    await initDb();
    ensureQueueRunning();
    const runs = await BenchmarkRun.findAll({
      order: [["createdAt", "DESC"]],
      limit: 30,
    });

    const result = [];
    for (const run of runs) {
      const jobs = await TranscriptionJob.findAll({ where: { benchmarkRunId: run.id } });
      result.push(serializeRun(run, jobs));
    }

    return NextResponse.json({ runs: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch benchmarks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await initDb();
    const uploadDir = getUploadDir();
    await mkdir(uploadDir, { recursive: true });

    const formData = await request.formData();
    const files = [
      ...formData.getAll("files").filter((f): f is File => f instanceof File),
      ...(formData.get("file") instanceof File ? [formData.get("file") as File] : []),
    ];

    if (!files.length) {
      return NextResponse.json({ error: "No audio files provided" }, { status: 400 });
    }

    const slotsRaw = formData.get("slots")?.toString();
    if (!slotsRaw) {
      return NextResponse.json({ error: "No benchmark slots provided" }, { status: 400 });
    }

    let slots: BenchmarkSlotConfig[];
    try {
      slots = JSON.parse(slotsRaw) as BenchmarkSlotConfig[];
    } catch {
      return NextResponse.json({ error: "Invalid slots JSON" }, { status: 400 });
    }

    if (!slots.length || slots.length > 3) {
      return NextResponse.json({ error: "Provide 1 to 3 provider slots" }, { status: 400 });
    }

    for (const slot of slots) {
      const provider = getProvider(slot.provider);
      if (!provider) {
        return NextResponse.json({ error: `Unknown provider: ${slot.provider}` }, { status: 400 });
      }
      if (!process.env[provider.envKey]) {
        return NextResponse.json(
          { error: `${provider.name} API key is not configured` },
          { status: 400 },
        );
      }
      slot.model = resolveModel(slot.provider, slot.model);
    }

    const normalize = formData.get("normalize") !== "false";
    const speakerDiarization = formData.get("speakerDiarization") !== "false";
    const language = String(formData.get("language") ?? "en");
    const keytermsRaw = formData.get("keyterms")?.toString() ?? "";
    const keyterms = keytermsRaw
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);

    const options: JobOptions = {
      normalize,
      speakerDiarization,
      keyterms,
      language,
    };

    const createdRuns = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storedName = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      const sharedPath = path.join(uploadDir, storedName);
      await writeFile(sharedPath, buffer);

      const run = await BenchmarkRun.create({
        originalFilename: file.name,
        storedPath: sharedPath,
        mimeType: file.type || null,
        fileSizeBytes: buffer.length,
        options,
        slots,
      });

      const jobs = [];
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const jobStoredPath =
          i === 0 ? sharedPath : path.join(uploadDir, `slot${i}-${storedName}`);
        if (i > 0) {
          await copyFile(sharedPath, jobStoredPath);
        }

        const job = await TranscriptionJob.create({
          originalFilename: file.name,
          storedPath: jobStoredPath,
          mimeType: file.type || null,
          fileSizeBytes: buffer.length,
          provider: slot.provider,
          model: slot.model,
          options,
          status: "pending",
          benchmarkRunId: run.id,
          slotIndex: i,
        });
        jobs.push(job);
      }

      enqueueJobs(jobs.map((j) => j.id));
      createdRuns.push(serializeRun(run, jobs));
    }

    ensureQueueRunning();

    return NextResponse.json(
      createdRuns.length === 1 ? createdRuns[0] : { runs: createdRuns },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Benchmark failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
