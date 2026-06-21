import "dotenv/config";
import { AppSettings, initDb } from "../src/lib/models";
import { DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT } from "../src/lib/llm/default-stt-prompt";
import { getSessionKeyterms } from "../src/lib/keyterms";

async function main() {
  console.log("Seeding database...");
  await initDb();

  const keyterms = getSessionKeyterms("soniox");
  const [settings] = await AppSettings.upsert({
    id: 1,
    defaultProvider: "soniox",
    defaultModel: "stt-async-v5",
    normalizeAudio: true,
    speakerDiarization: true,
    keyterms,
    language: "en",
    sttAnalysisSystemPrompt: DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT,
  });

  console.log(`Seeded app_settings with ${settings.keyterms.length} keyterms from IT_Curves_Bot`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Database seed failed:", error);
  process.exit(1);
});
