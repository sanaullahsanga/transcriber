import "dotenv/config";
import { SonioxTranscriptionProvider } from "../src/lib/transcription/soniox";

const filePath =
  process.argv[2] ??
  "uploads/1782031397674-88e480f9-9ee1-4dc9-a3d2-6010bcaf41fd-CALLIN-1781886984.21737-5123256128.mp3";
const model = process.argv[3] ?? "stt-async-v5";

async function main() {
  const provider = new SonioxTranscriptionProvider();
  const result = await provider.transcribe({
    filePath,
    filename: filePath.split("/").pop()!,
    provider: "soniox",
    model,
    options: {
      normalize: true,
      speakerDiarization: true,
      keyterms: [],
      language: "en",
    },
  });

  console.log("durationMs:", result.durationMs);
  console.log("text preview:", result.text.slice(0, 400));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
