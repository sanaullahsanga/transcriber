import "dotenv/config";
import path from "node:path";
import { GoogleTranscriptionProvider } from "../src/lib/transcription/google";
import {
  getGoogleProjectId,
  getGoogleSttGcsBucket,
  getGoogleSttLocation,
  googleSttConfigError,
  isGoogleSttConfigured,
} from "../src/lib/google-auth";

async function main() {
  const fileArg = process.argv[2];
  const location = getGoogleSttLocation();
  const projectId = getGoogleProjectId();
  const bucket = getGoogleSttGcsBucket();

  console.log("Google STT config:");
  console.log(`  project:  ${projectId ?? "(missing)"}`);
  console.log(`  bucket:   ${bucket ?? "(missing)"}`);
  console.log(`  location: ${location}`);
  console.log(`  endpoint: ${location === "global" ? "speech.googleapis.com" : `${location}-speech.googleapis.com`}`);

  if (!isGoogleSttConfigured()) {
    console.error(`\nNot configured: ${googleSttConfigError()}`);
    process.exit(1);
  }

  if (!fileArg) {
    console.log("\nConfig OK. Pass an audio file path to run a live batch test:");
    console.log("  npm run test:google-stt -- path/to/audio.mp3");
    return;
  }

  const filePath = path.resolve(fileArg);
  const provider = new GoogleTranscriptionProvider();
  const started = Date.now();

  console.log(`\nTranscribing ${filePath} with chirp_3 in ${location}...`);
  const result = await provider.transcribe({
    filePath,
    filename: path.basename(filePath),
    provider: "google",
    model: "chirp_3",
    options: {
      language: "en",
      keyterms: [],
      speakerDiarization: true,
      isReference: true,
      normalize: true,
    },
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const preview = result.text.slice(0, 300).replace(/\n/g, " ");
  console.log(`\nDone in ${elapsed}s (${result.text.length} chars)`);
  console.log(`Preview: ${preview}${result.text.length > 300 ? "…" : ""}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
