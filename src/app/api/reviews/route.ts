import { NextRequest, NextResponse } from "next/server";
import { getReviewableCalls, getReviewDashboard, saveReview } from "@/lib/reviews";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const view = new URL(request.url).searchParams.get("view");
    if (view === "dashboard") {
      const dashboard = await getReviewDashboard();
      return NextResponse.json(dashboard);
    }

    const calls = await getReviewableCalls();
    const dashboard = await getReviewDashboard();
    return NextResponse.json({ calls, dashboard });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch reviews";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      benchmarkRunId?: string;
      transcriptionJobId?: string;
      referenceTranscript?: string;
      status?: "draft" | "finalized";
    };

    if (!body.referenceTranscript?.trim()) {
      return NextResponse.json({ error: "referenceTranscript is required" }, { status: 400 });
    }

    const result = await saveReview({
      benchmarkRunId: body.benchmarkRunId,
      transcriptionJobId: body.transcriptionJobId,
      referenceTranscript: body.referenceTranscript,
      status: body.status,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save review";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
