import { NextRequest, NextResponse } from "next/server";
import { resetJobForRetranscribe } from "@/lib/job-audio";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const job = await resetJobForRetranscribe(id);

    return NextResponse.json({
      id: job.id,
      status: job.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to retry job";
    const status = message === "Job not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
