import { NextRequest, NextResponse } from "next/server";
import { BenchmarkRun, TranscriptionJob, initDb } from "@/lib/models";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await initDb();
    const { id } = await context.params;
    const run = await BenchmarkRun.findByPk(id);
    if (!run) {
      return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
    }

    const jobs = await TranscriptionJob.findAll({ where: { benchmarkRunId: id } });

    return NextResponse.json({
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch benchmark";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await initDb();
    const { id } = await context.params;
    await TranscriptionJob.destroy({ where: { benchmarkRunId: id } });
    const deleted = await BenchmarkRun.destroy({ where: { id } });
    if (!deleted) {
      return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete benchmark";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
