import { readFile } from "node:fs/promises";
import path from "node:path";
import { prepareAudioForStt } from "../audio/normalize";
import { getMaxKeyterms } from "../keyterms";
import { DEEPGRAM_FLUX_MODEL, isDeepgramFluxModel } from "../providers";
import type { TranscriptionInput, TranscriptionResult, TranscriptionProvider } from "./types";

const DEEPGRAM_V1_LISTEN_URL = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_V2_LISTEN_URL = "wss://api.deepgram.com/v2/listen";
const FLUX_CHUNK_SIZE = 2560;
const FLUX_TIMEOUT_MS = 120_000;

type FluxTurnInfo = {
  type?: string;
  event?: string;
  transcript?: string;
  audio_window_end?: number;
};

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

function resolveFluxModel(model: string): string {
  if (isDeepgramFluxModel(model)) {
    return DEEPGRAM_FLUX_MODEL;
  }
  return model;
}

function appendKeyterms(params: URLSearchParams, keyterms: string[], model: string) {
  const max = getMaxKeyterms("deepgram", model);
  for (const term of keyterms.slice(0, max)) {
    if (term) params.append("keyterm", term);
  }
}

async function transcribeFlux(
  input: TranscriptionInput,
  apiKey: string,
): Promise<TranscriptionResult> {
  const model = resolveFluxModel(input.model);
  const prepared = await prepareAudioForStt(
    input.filePath,
    input.filename,
    input.options.normalize,
  );

  try {
    const params = new URLSearchParams({ model });
    appendKeyterms(params, input.options.keyterms, model);

    const audio = await readFile(prepared.filePath);
    return await transcribeFluxWebSocket(`${DEEPGRAM_V2_LISTEN_URL}?${params}`, apiKey, audio);
  } finally {
    await prepared.cleanup?.();
  }
}

function openFluxSocket(url: string, apiKey: string): WebSocket {
  return new WebSocket(url, {
    headers: {
      Authorization: `Token ${apiKey}`,
    },
  } as unknown as string[]);
}

async function transcribeFluxWebSocket(
  url: string,
  apiKey: string,
  audio: Buffer,
): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    const ws = openFluxSocket(url, apiKey);

    const turns: string[] = [];
    let durationMs: number | null = null;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const timeout = setTimeout(() => {
      ws.close();
      finish(() => {
        if (turns.length) {
          resolve({ text: turns.join("\n\n"), durationMs });
          return;
        }
        reject(new Error("Deepgram Flux timed out waiting for transcript"));
      });
    }, FLUX_TIMEOUT_MS);

    ws.addEventListener("open", () => {
      void (async () => {
        try {
          for (let i = 0; i < audio.length; i += FLUX_CHUNK_SIZE) {
            ws.send(audio.subarray(i, i + FLUX_CHUNK_SIZE));
          }
          ws.send(JSON.stringify({ type: "CloseStream" }));
        } catch (error) {
          ws.close();
          finish(() => {
            reject(error instanceof Error ? error : new Error("Deepgram Flux stream failed"));
          });
        }
      })();
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;

      try {
        const message = JSON.parse(event.data) as FluxTurnInfo & { type?: string; message?: string };
        if (message.type === "Error") {
          ws.close();
          finish(() => {
            reject(new Error(message.message ?? "Deepgram Flux error"));
          });
          return;
        }

        if (message.type !== "TurnInfo" || message.event !== "EndOfTurn") {
          return;
        }

        const transcript = String(message.transcript ?? "").trim();
        if (transcript) {
          turns.push(transcript);
        }

        if (typeof message.audio_window_end === "number") {
          durationMs = Math.round(message.audio_window_end * 1000);
        }
      } catch {
        // Ignore malformed websocket payloads.
      }
    });

    ws.addEventListener("close", () => {
      finish(() => {
        if (turns.length) {
          resolve({ text: turns.join("\n\n"), durationMs });
          return;
        }
        reject(new Error("Deepgram Flux returned no transcript"));
      });
    });

    ws.addEventListener("error", () => {
      finish(() => {
        reject(new Error("Deepgram Flux WebSocket error"));
      });
    });
  });
}

async function transcribeNova(
  input: TranscriptionInput,
  apiKey: string,
): Promise<TranscriptionResult> {
  const params = new URLSearchParams({
    model: input.model,
    language: input.options.language,
    smart_format: "true",
  });

  if (input.options.speakerDiarization) {
    params.set("diarize", "true");
    params.set("utterances", "true");
  }

  appendKeyterms(params, input.options.keyterms, input.model);

  const audio = await readFile(input.filePath);
  const response = await fetch(`${DEEPGRAM_V1_LISTEN_URL}?${params}`, {
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

export class DeepgramTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }

    if (isDeepgramFluxModel(input.model)) {
      return transcribeFlux(input, apiKey);
    }

    return transcribeNova(input, apiKey);
  }
}
