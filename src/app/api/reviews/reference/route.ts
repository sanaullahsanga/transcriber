import { NextRequest, NextResponse } from "next/server";
import { refreshElevenLabsReference, waitForJobCompletion } from "@/lib/call-jobs";
import {
  getBenchmarkReview,
  getReviewableCalls,
  persistReferenceTranscript,
} from "@/lib/reviews";
import { REFERENCE_PROVIDER } from "@/lib/reference-provider";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      benchmarkRunId?: string;
      transcriptionJobId?: string;
      wait?: boolean;
    };

    if (!body.benchmarkRunId && !body.transcriptionJobId) {
      return NextResponse.json(
        { error: "benchmarkRunId or transcriptionJobId is required" },
        { status: 400 },
      );
    }

    const job = await refreshElevenLabsReference({
      benchmarkRunId: body.benchmarkRunId,
      transcriptionJobId: body.transcriptionJobId,
    });

    let completedJob = job;
    if (body.wait !== false) {
      completedJob = await waitForJobCompletion(job.id);
    }

    const referenceTranscript = completedJob.transcript?.trim() ?? "";

    if (referenceTranscript) {
      await persistReferenceTranscript({
        benchmarkRunId: body.benchmarkRunId,
        transcriptionJobId: body.transcriptionJobId,
        referenceTranscript,
        referenceSourceJobId: completedJob.id,
      });
    }

    const call = body.benchmarkRunId
      ? await getBenchmarkReview(body.benchmarkRunId)
      : (
          await getReviewableCalls()
        ).calls.find((c) => c.transcriptionJobId === body.transcriptionJobId) ?? null;

    return NextResponse.json({
      jobId: completedJob.id,
      status: completedJob.status,
      referenceTranscript,
      referenceSourceProvider: REFERENCE_PROVIDER,
      call,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh reference";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
