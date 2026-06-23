import { readFile } from "node:fs/promises";
import { prepareAudioForStt } from "../audio/normalize";
import type { TranscriptionInput, TranscriptionResult, TranscriptionProvider } from "./types";

const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

type ElevenLabsWord = {
  text: string;
  speaker_id?: string | null;
  type?: string;
};

type ElevenLabsResponse = {
  text?: string;
  words?: ElevenLabsWord[];
};

function speakerLabels(speakers: string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  if (speakers[0]) labels[speakers[0]] = "Agent";
  if (speakers[1]) labels[speakers[1]] = "Caller";
  for (const speaker of speakers.slice(2)) {
    labels[speaker] = "Other";
  }
  return labels;
}

function joinWordTokens(tokens: string[]): string {
  return tokens
    .join(" ")
    .replace(/\s+([,.!?;:'")\]}])/g, "$1")
    .replace(/([({["'])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDialogue(words: ElevenLabsWord[]): string {
  const order: string[] = [];
  for (const word of words) {
    const speaker = word.speaker_id;
    if (speaker && !order.includes(speaker)) {
      order.push(speaker);
    }
  }

  const labels = speakerLabels(order);
  const lines: string[] = [];
  let currentSpeaker: string | null = null;
  let currentText: string[] = [];

  const flush = () => {
    if (!currentText.length) return;
    const text = joinWordTokens(currentText);
    if (!text) return;
    const label = labels[currentSpeaker ?? ""] ?? currentSpeaker ?? "Unknown";
    lines.push(`${label}: ${text}`);
  };

  for (const word of words) {
    if (word.type && word.type !== "word") continue;
    const speaker = word.speaker_id ?? "unknown";
    const piece = word.text ?? "";
    if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
      currentText = [piece];
    } else {
      currentText.push(piece);
    }
  }
  flush();

  return lines.join("\n\n");
}

export class ElevenLabsTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }

    const prepared = await prepareAudioForStt(
      input.filePath,
      input.filename,
      input.options.normalize,
    );

    try {
      const audio = await readFile(prepared.filePath);
      const form = new FormData();
      form.append("model_id", input.model);
      form.append("file", new Blob([audio]), prepared.filename);
      form.append("language_code", input.options.language);
      form.append("diarize", String(input.options.speakerDiarization));
      form.append("tag_audio_events", "false");

      for (const term of input.options.keyterms.slice(0, 100)) {
        if (term) form.append("keyterms", term);
      }

      const response = await fetch(ELEVENLABS_STT_URL, {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`ElevenLabs error (${response.status}): ${body}`);
      }

      const payload = (await response.json()) as ElevenLabsResponse;
      const words = payload.words ?? [];
      const plain = (payload.text ?? joinWordTokens(words.map((w) => w.text).filter(Boolean))).trim();
      if (!plain) {
        throw new Error("ElevenLabs returned an empty transcript");
      }

      const text = input.options.speakerDiarization
        ? formatDialogue(words) || plain
        : plain;

      return { text, durationMs: null };
    } finally {
      await prepared.cleanup?.();
    }
  }
}
