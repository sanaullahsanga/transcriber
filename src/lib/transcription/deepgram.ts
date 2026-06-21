import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TranscriptionInput, TranscriptionResult, TranscriptionProvider } from "./types";

const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";

function speakerLabels(speakers: (number | string)[]): Record<string | number, string> {
  const labels: Record<string | number, string> = {};
  if (speakers[0] !== undefined) labels[speakers[0]] = "Agent";
  if (speakers[1] !== undefined) labels[speakers[1]] = "Caller";
  for (const speaker of speakers.slice(2)) {
    labels[speaker] = "Other";
  }
  return labels;
}

function formatDialogue(payload: Record<string, unknown>): string {
  const results = payload.results as Record<string, unknown> | undefined;
  const utterances = (results?.utterances as Array<Record<string, unknown>>) ?? [];
  const speakers = [
    ...new Set(
      utterances
        .map((u) => u.speaker)
        .filter((s): s is string | number => s !== undefined && s !== null),
    ),
  ];
  const labels = speakerLabels(speakers);

  const lines: string[] = [];
  for (const utterance of utterances) {
    const text = String(utterance.transcript ?? "").trim();
    if (!text) continue;
    const speaker = utterance.speaker;
    const label = labels[speaker as number] ?? `Speaker ${speaker}`;
    lines.push(`${label}: ${text}`);
  }
  return lines.join("\n\n");
}

function plainText(payload: Record<string, unknown>): string {
  const results = payload.results as Record<string, unknown> | undefined;
  const channels = (results?.channels as Array<Record<string, unknown>>) ?? [];
  const alternatives = (channels[0]?.alternatives as Array<Record<string, unknown>>) ?? [];
  return String(alternatives[0]?.transcript ?? "").trim();
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
  };
  return map[ext] ?? "application/octet-stream";
}

export class DeepgramTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }

    let model = input.model;
    if (model.toLowerCase().includes("flux")) {
      model = "nova-3";
    }

    const params = new URLSearchParams({
      model,
      language: input.options.language,
      smart_format: "true",
    });

    if (input.options.speakerDiarization) {
      params.set("diarize", "true");
      params.set("utterances", "true");
    }

    for (const term of input.options.keyterms.slice(0, 100)) {
      if (term) params.append("keyterm", term);
    }

    const audio = await readFile(input.filePath);
    const response = await fetch(`${DEEPGRAM_LISTEN_URL}?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": input.mimeType ?? contentType(input.filePath),
      },
      body: audio,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Deepgram error (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const metadata = payload.metadata as Record<string, unknown> | undefined;
    const duration = metadata?.duration as number | undefined;

    return {
      text: input.options.speakerDiarization ? formatDialogue(payload) : plainText(payload),
      durationMs: duration ? Math.round(duration * 1000) : null,
    };
  }
}
