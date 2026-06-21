import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT,
  getSttAnalysisSystemPrompt,
  setSttAnalysisSystemPrompt,
} from "@/lib/llm/stt-prompt";

export const runtime = "nodejs";

export async function GET() {
  try {
    const prompt = await getSttAnalysisSystemPrompt();
    return NextResponse.json({
      prompt,
      defaultPrompt: DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT,
      isDefault: prompt === DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load STT prompt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { prompt?: string };
    if (!body.prompt?.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const prompt = await setSttAnalysisSystemPrompt(body.prompt);
    return NextResponse.json({ prompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save STT prompt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
