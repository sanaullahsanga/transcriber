import { NextRequest, NextResponse } from "next/server";
import { initDb, TranscriptionJob } from "@/lib/models";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 100);

    const where = status ? { status } : undefined;

    const jobs = await TranscriptionJob.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit,
    });

    return NextResponse.json({
      jobs: jobs.map((job) => ({
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
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch jobs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await initDb();
    await TranscriptionJob.destroy({ where: {}, truncate: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear jobs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
