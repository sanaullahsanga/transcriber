import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { initDb, TranscriptionJob } from "@/lib/models";
import { resolveModel } from "@/lib/providers";
import { enqueueJobs } from "@/lib/queue";
import type { JobOptions } from "@/lib/models/TranscriptionJob";

export const runtime = "nodejs";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "uploads";

export async function POST(request: NextRequest) {
  try {
    await initDb();
    await mkdir(UPLOAD_DIR, { recursive: true });

    const formData = await request.formData();
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "No audio files provided" }, { status: 400 });
    }

    const provider = String(formData.get("provider") ?? "soniox");
    const model = resolveModel(provider, formData.get("model")?.toString());
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

    const jobs = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storedName = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      const storedPath = path.join(UPLOAD_DIR, storedName);

      await writeFile(storedPath, buffer);

      const job = await TranscriptionJob.create({
        originalFilename: file.name,
        storedPath,
        mimeType: file.type || null,
        fileSizeBytes: buffer.length,
        provider,
        model,
        options,
        status: "pending",
      });

      jobs.push(job);
    }

    enqueueJobs(jobs.map((j) => j.id));

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        originalFilename: job.originalFilename,
        status: job.status,
        provider: job.provider,
        model: job.model,
        createdAt: job.createdAt,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
