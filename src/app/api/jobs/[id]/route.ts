import { NextRequest, NextResponse } from "next/server";
import { initDb, TranscriptionJob } from "@/lib/models";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await initDb();
    const { id } = await context.params;
    const job = await TranscriptionJob.findByPk(id);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: job.id,
      originalFilename: job.originalFilename,
      fileSizeBytes: job.fileSizeBytes,
      provider: job.provider,
      model: job.model,
      status: job.status,
      transcript: job.transcript,
      errorMessage: job.errorMessage,
      options: job.options,
      durationMs: job.durationMs,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await initDb();
    const { id } = await context.params;
    const job = await TranscriptionJob.findByPk(id);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    await job.destroy();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
