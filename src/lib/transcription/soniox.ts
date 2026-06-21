import { readFile } from "node:fs/promises";
import { SonioxNodeClient } from "@soniox/node";
import { prepareAudioForStt } from "../audio/normalize";
import { buildSonioxContext } from "./soniox-context";
import type { TranscriptionInput, TranscriptionResult, TranscriptionProvider } from "./types";

function speakerLabels(speakers: string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  if (speakers[0]) labels[speakers[0]] = "Agent";
  if (speakers[1]) labels[speakers[1]] = "Caller";
  for (const speaker of speakers.slice(2)) {
    labels[speaker] = "Other";
  }
  return labels;
}

function formatDialogue(tokens: Array<{ text: string; speaker?: string | null }>): string {
  const order: string[] = [];
  for (const token of tokens) {
    if (token.speaker && !order.includes(token.speaker)) {
      order.push(token.speaker);
    }
  }

  const labels = speakerLabels(order);
  const lines: string[] = [];
  let currentSpeaker: string | null = null;
  let currentText: string[] = [];

  const flush = () => {
    if (!currentText.length) return;
    const text = currentText.join("").trim();
    if (!text) return;
    const label = labels[currentSpeaker ?? ""] ?? currentSpeaker ?? "Unknown";
    lines.push(`${label}: ${text}`);
  };

  for (const token of tokens) {
    const speaker = token.speaker ?? "unknown";
    if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
      currentText = [token.text];
    } else {
      currentText.push(token.text);
    }
  }
  flush();

  return lines.join("\n\n");
}

export class SonioxTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const apiKey = process.env.SONIOX_API_KEY;
    if (!apiKey) {
      throw new Error("SONIOX_API_KEY is not configured");
    }

    const prepared = await prepareAudioForStt(
      input.filePath,
      input.filename,
      input.options.normalize,
    );

    try {
      const client = new SonioxNodeClient({ api_key: apiKey });
      const file = await readFile(prepared.filePath);

      const transcription = await client.stt.transcribe({
        model: input.model,
        file,
        filename: prepared.filename,
        wait: true,
        cleanup: ["file"],
        timeout_ms: 600_000,
        wait_options: { timeout_ms: 600_000 },
        language_hints: [input.options.language],
        language_hints_strict: true,
        enable_language_identification: false,
        enable_speaker_diarization: input.options.speakerDiarization,
        context: buildSonioxContext(input.options.keyterms),
      });

      if (transcription.status === "error") {
        throw new Error(
          `Soniox transcription error (${transcription.error_type ?? "unknown"}): ${transcription.error_message ?? "transcription failed"}`,
        );
      }

      const transcript = transcription.transcript ?? (await transcription.getTranscript());
      if (!transcript?.text?.trim()) {
        throw new Error("Soniox returned an empty transcript");
      }

      const text = input.options.speakerDiarization
        ? formatDialogue(transcript.tokens ?? []) || transcript.text
        : transcript.text;

      return {
        text: text.trim(),
        durationMs: transcription.audio_duration_ms ?? null,
      };
    } finally {
      await prepared.cleanup?.();
    }
  }
}
