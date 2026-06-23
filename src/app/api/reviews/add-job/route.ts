import { NextRequest, NextResponse } from "next/server";
import { addProviderJobToCall, waitForJobCompletion } from "@/lib/call-jobs";
import { getBenchmarkReview, getReviewableCalls } from "@/lib/reviews";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      benchmarkRunId?: string;
      transcriptionJobId?: string;
      provider: string;
      model?: string;
      wait?: boolean;
    };

    if (!body.benchmarkRunId && !body.transcriptionJobId) {
      return NextResponse.json(
        { error: "benchmarkRunId or transcriptionJobId is required" },
        { status: 400 },
      );
    }

    if (!body.provider) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }

    const job = await addProviderJobToCall({
      benchmarkRunId: body.benchmarkRunId,
      transcriptionJobId: body.transcriptionJobId,
      provider: body.provider,
      model: body.model,
    });

    let completedJob = job;
    if (body.wait !== false) {
      completedJob = await waitForJobCompletion(job.id);
    }

    const call = body.benchmarkRunId
      ? await getBenchmarkReview(body.benchmarkRunId)
      : (
          await getReviewableCalls()
        ).calls.find((c) => c.transcriptionJobId === body.transcriptionJobId) ?? null;

    return NextResponse.json({
      job: {
        id: completedJob.id,
        provider: completedJob.provider,
        model: completedJob.model,
        status: completedJob.status,
        transcript: completedJob.transcript,
        errorMessage: completedJob.errorMessage,
      },
      call,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add provider job";
    const status = message.includes("already has") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
