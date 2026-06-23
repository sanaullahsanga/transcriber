import { NextRequest, NextResponse } from "next/server";
import { batchApplyReferenceTranscripts } from "@/lib/reviews";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
    };

    const results = await batchApplyReferenceTranscripts({
      forceRetranscribe: body.force === true,
    });

    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    return NextResponse.json({
      total: results.length,
      saved: ok.filter((r) => r.skipped).length,
      transcribed: ok.filter((r) => !r.skipped).length,
      failed: failed.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Batch reference failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
