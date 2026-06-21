import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ensureJobAudioFile } from "@/lib/job-audio";
import { initDb, TranscriptionJob } from "@/lib/models";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function mimeFromFilename(filename: string, mimeType: string | null): string {
  if (mimeType) return mimeType;
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".aac": "audio/aac",
  };
  return map[ext] ?? "application/octet-stream";
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await initDb();
    const { id } = await context.params;
    const job = await TranscriptionJob.findByPk(id);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const filePath = await ensureJobAudioFile(job);
    const buffer = await readFile(filePath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeFromFilename(job.originalFilename, job.mimeType),
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audio not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
