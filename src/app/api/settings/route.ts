import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT } from "@/lib/llm/default-stt-prompt";
import { AppSettings, initDb } from "@/lib/models";
import { getProvider, resolveModel } from "@/lib/providers";

export const runtime = "nodejs";

export async function GET() {
  try {
    await initDb();
    const settings = await AppSettings.findByPk(1);
    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await initDb();
    const body = await request.json();

    const provider = String(body.defaultProvider ?? "soniox");
    const providerConfig = getProvider(provider);
    if (!providerConfig) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    const model = resolveModel(provider, body.defaultModel);
    const keyterms = Array.isArray(body.keyterms)
      ? body.keyterms.map(String).filter(Boolean)
      : String(body.keyterms ?? "")
          .split(/[,\n]/)
          .map((t: string) => t.trim())
          .filter(Boolean);

    const existing = await AppSettings.findByPk(1);

    const [, settings] = await AppSettings.upsert({
      id: 1,
      defaultProvider: provider,
      defaultModel: model,
      normalizeAudio: body.normalizeAudio !== false,
      speakerDiarization: body.speakerDiarization !== false,
      keyterms,
      language: String(body.language ?? "en"),
      sttAnalysisSystemPrompt:
        existing?.sttAnalysisSystemPrompt?.trim() || DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT,
    });

    const saved = settings ?? (await AppSettings.findByPk(1));
    return NextResponse.json({ settings: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
