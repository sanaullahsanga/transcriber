import { DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT } from "./default-stt-prompt";
import { AppSettings, initDb } from "@/lib/models";

export async function getSttAnalysisSystemPrompt(): Promise<string> {
  await initDb();
  const settings = await AppSettings.findByPk(1);
  const prompt = settings?.sttAnalysisSystemPrompt?.trim();
  return prompt || DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT;
}

export async function setSttAnalysisSystemPrompt(prompt: string): Promise<string> {
  await initDb();
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("Prompt cannot be empty");
  }

  const existing = await AppSettings.findByPk(1);
  if (!existing) {
    throw new Error("App settings not initialized");
  }

  await existing.update({ sttAnalysisSystemPrompt: trimmed });
  return trimmed;
}

export { DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT };
