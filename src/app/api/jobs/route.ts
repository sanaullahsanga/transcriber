import { NextRequest, NextResponse } from "next/server";
import { Op } from "sequelize";
import { initDb, TranscriptionJob } from "@/lib/models";
import { buildPaginationMeta, parsePaginationParams } from "@/lib/pagination";
import { ensureQueueRunning } from "@/lib/queue";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await initDb();
    ensureQueueRunning();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const { limit, offset } = parsePaginationParams(searchParams);

    const where = {
      ...(status ? { status } : {}),
      benchmarkRunId: { [Op.is]: null },
    };

    const total = await TranscriptionJob.count({ where });

    const jobs = await TranscriptionJob.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit,
      offset,
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
        processingMs: job.processingMs,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
      })),
      pagination: buildPaginationMeta(total, limit, offset, jobs.length),
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
