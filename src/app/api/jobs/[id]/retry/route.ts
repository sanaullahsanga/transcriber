import { NextRequest, NextResponse } from "next/server";
import { initDb, TranscriptionJob } from "@/lib/models";
import { enqueueJob } from "@/lib/queue";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    await initDb();
    const { id } = await context.params;
    const job = await TranscriptionJob.findByPk(id);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    await job.update({
      status: "pending",
      transcript: null,
      errorMessage: null,
      completedAt: null,
    });

    enqueueJob(job.id);

    return NextResponse.json({
      id: job.id,
      status: job.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to retry job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
