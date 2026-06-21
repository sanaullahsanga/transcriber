import { NextRequest, NextResponse } from "next/server";
import { resetAnalysisForRetry } from "@/lib/analysis-queue";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const analysis = await resetAnalysisForRetry(id);

    return NextResponse.json({
      id: analysis.id,
      status: analysis.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to retry analysis";
    const status = message === "Analysis not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
