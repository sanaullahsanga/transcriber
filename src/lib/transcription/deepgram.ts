import { readFile } from "node:fs/promises";
import { DeepgramClient } from "@deepgram/sdk";
import { prepareAudioForStt, readLinear16Mono } from "../audio/normalize";
import { getMaxKeyterms } from "../keyterms";
import { DEEPGRAM_FLUX_MODEL, isDeepgramFluxModel } from "../providers";
import type { TranscriptionInput, TranscriptionResult, TranscriptionProvider } from "./types";

const FLUX_SAMPLE_RATE = 16_000;
const FLUX_BYTES_PER_SAMPLE = 2;
const FLUX_BYTES_PER_SECOND = FLUX_SAMPLE_RATE * FLUX_BYTES_PER_SAMPLE;
const FLUX_CHUNK_SIZE = 2560;
const FLUX_UPLOAD_CHUNK_DELAY_MS = 10;
const FLUX_COVERAGE_TOLERANCE_SEC = 2;
const FLUX_COVERAGE_POLL_MS = 500;
const FLUX_FINALIZE_DEBOUNCE_MS = 5_000;
const FLUX_MIN_TIMEOUT_MS = 120_000;
const FLUX_KEEPALIVE_INTERVAL_MS = 15_000;
/** ~20ms of silent linear16 PCM — resets Flux idle timers during wait gaps. */
const FLUX_KEEPALIVE_PCM = Buffer.alloc(640);

type FluxTurnInfo = {
  type?: string;
  event?: string;
  transcript?: string;
  turn_index?: number;
  audio_window_end?: number;
  code?: string;
  description?: string;
  message?: string;
};

type NovaTranscriptResponse = {
  metadata?: { duration?: number };
  results?: {
    utterances?: Array<{ transcript?: string; speaker?: number | string }>;
    channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
  };
};

function isNovaTranscriptResponse(value: unknown): value is NovaTranscriptResponse {
  return typeof value === "object" && value !== null && "results" in value;
}

function speakerLabels(speakers: (number | string)[]): Record<string | number, string> {
  const labels: Record<string | number, string> = {};
  if (speakers[0] !== undefined) labels[speakers[0]] = "Agent";
  if (speakers[1] !== undefined) labels[speakers[1]] = "Caller";
  for (const speaker of speakers.slice(2)) {
    labels[speaker] = "Other";
  }
  return labels;
}

function formatDialogue(payload: NovaTranscriptResponse): string {
  const utterances = payload.results?.utterances ?? [];
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

function plainText(payload: NovaTranscriptResponse): string {
  return String(payload.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
}

function resolveFluxModel(model: string): string {
  if (isDeepgramFluxModel(model)) {
    return DEEPGRAM_FLUX_MODEL;
  }
  return model;
}

function normalizeApiKey(apiKey: string): string {
  return apiKey.replace(/^"|"$/g, "");
}

function getDeepgramClient(apiKey: string): DeepgramClient {
  return new DeepgramClient({ apiKey: normalizeApiKey(apiKey) });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fluxTimeoutMs(audioBytes: number): number {
  const audioSeconds = audioBytes / FLUX_BYTES_PER_SECOND;
  // Upload is fast, but Flux must decode the full timeline before CloseStream.
  return Math.max(FLUX_MIN_TIMEOUT_MS, Math.ceil(audioSeconds) * 3_000 + 120_000);
}

function fluxExpectedDurationSec(audioBytes: number): number {
  return audioBytes / FLUX_BYTES_PER_SECOND;
}

/** Default wait timeout for long benchmark jobs (supports 8+ minute calls on Flux). */
export function deepgramJobTimeoutMs(model?: string): number {
  if (model && isDeepgramFluxModel(model)) {
    return 1_800_000;
  }
  return 900_000;
}

function buildFluxTranscript(
  committedTurns: Map<number, string>,
  provisionalTurns: Map<number, string>,
): string {
  const turnIndexes = new Set([...committedTurns.keys(), ...provisionalTurns.keys()]);
  return [...turnIndexes]
    .sort((a, b) => a - b)
    .map((index) => committedTurns.get(index) ?? provisionalTurns.get(index))
    .filter((text): text is string => Boolean(text?.trim()))
    .join("\n\n");
}

function recordFluxTurn(
  message: FluxTurnInfo,
  committedTurns: Map<number, string>,
  provisionalTurns: Map<number, string>,
) {
  const transcript = String(message.transcript ?? "").trim();
  if (!transcript) return;

  const turnIndex = typeof message.turn_index === "number" ? message.turn_index : 0;

  if (message.event === "EndOfTurn") {
    committedTurns.set(turnIndex, transcript);
    provisionalTurns.delete(turnIndex);
    return;
  }

  if (message.event === "Update") {
    provisionalTurns.set(turnIndex, transcript);
  }
}

function fluxErrorMessage(message: { code?: string; description?: string; message?: string }): string {
  return [message.code, message.description, message.message].filter(Boolean).join(": ") || "Deepgram Flux error";
}

async function waitForFluxCoverage(input: {
  sendKeepalive: () => void;
  getMaxAudioWindowEnd: () => number;
  expectedDurationSec: number;
  deadlineMs: number;
}) {
  while (
    input.getMaxAudioWindowEnd() < input.expectedDurationSec - FLUX_COVERAGE_TOLERANCE_SEC &&
    Date.now() < input.deadlineMs
  ) {
    input.sendKeepalive();
    await sleep(FLUX_COVERAGE_POLL_MS);
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
    const pcm = await readLinear16Mono(prepared.filePath);
    const client = getDeepgramClient(apiKey);
    const token = normalizeApiKey(apiKey);
    const maxKeyterms = getMaxKeyterms("deepgram", model);

    const connection = await client.listen.v2.connect({
      model: model as "flux-general-en",
      encoding: "linear16",
      sample_rate: 16000,
      keyterm: input.options.keyterms.slice(0, maxKeyterms),
      Authorization: `Token ${token}`,
    });

    const committedTurns = new Map<number, string>();
    const provisionalTurns = new Map<number, string>();
    let durationMs: number | null = null;
    let maxAudioWindowEnd = 0;
    let closeStreamSent = false;
    let settled = false;
    let finalizeTimer: ReturnType<typeof setTimeout> | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    const expectedDurationSec = fluxExpectedDurationSec(pcm.length);
    const deadlineMs = Date.now() + fluxTimeoutMs(pcm.length);

    return await new Promise<TranscriptionResult>((resolve, reject) => {
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (finalizeTimer) clearTimeout(finalizeTimer);
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        try {
          connection.close();
        } catch {
          // Ignore close errors after completion.
        }
        fn();
      };

      const finalize = () => {
        const text = buildFluxTranscript(committedTurns, provisionalTurns);
        finish(() => {
          if (!text) {
            reject(new Error("Deepgram Flux returned no transcript"));
            return;
          }
          resolve({ text, durationMs });
        });
      };

      const scheduleFinalize = () => {
        if (finalizeTimer) clearTimeout(finalizeTimer);
        finalizeTimer = setTimeout(finalize, FLUX_FINALIZE_DEBOUNCE_MS);
      };

      const sendKeepalive = () => {
        if (connection.readyState !== 1 || closeStreamSent) return;
        connection.sendMedia(FLUX_KEEPALIVE_PCM);
      };

      const timeout = setTimeout(() => {
        finish(() => {
          const text = buildFluxTranscript(committedTurns, provisionalTurns);
          if (text) {
            resolve({ text, durationMs });
            return;
          }
          reject(new Error("Deepgram Flux timed out waiting for transcript"));
        });
      }, fluxTimeoutMs(pcm.length));

      connection.on("message", (message) => {
        if (message.type === "Error") {
          finish(() => {
            reject(new Error(fluxErrorMessage(message)));
          });
          return;
        }

        if (message.type !== "TurnInfo") {
          return;
        }

        recordFluxTurn(message as FluxTurnInfo, committedTurns, provisionalTurns);

        if (typeof message.audio_window_end === "number") {
          maxAudioWindowEnd = Math.max(maxAudioWindowEnd, message.audio_window_end);
          durationMs = Math.round(message.audio_window_end * 1000);
        }

        if (closeStreamSent) {
          scheduleFinalize();
        }
      });

      connection.on("error", (error) => {
        finish(() => {
          reject(error instanceof Error ? error : new Error("Deepgram Flux WebSocket error"));
        });
      });

      connection.connect();

      void connection.waitForOpen().then(async () => {
        keepaliveTimer = setInterval(sendKeepalive, FLUX_KEEPALIVE_INTERVAL_MS);

        try {
          for (let i = 0; i < pcm.length; i += FLUX_CHUNK_SIZE) {
            connection.sendMedia(pcm.subarray(i, i + FLUX_CHUNK_SIZE));
            if (FLUX_UPLOAD_CHUNK_DELAY_MS > 0) {
              await sleep(FLUX_UPLOAD_CHUNK_DELAY_MS);
            }
          }

          await waitForFluxCoverage({
            sendKeepalive,
            getMaxAudioWindowEnd: () => maxAudioWindowEnd,
            expectedDurationSec,
            deadlineMs,
          });

          if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
          }

          closeStreamSent = true;
          connection.sendCloseStream({ type: "CloseStream" });
          scheduleFinalize();
        } catch (error) {
          finish(() => {
            reject(error instanceof Error ? error : new Error("Deepgram Flux stream failed"));
          });
        }
      }).catch((error) => {
        finish(() => {
          reject(error instanceof Error ? error : new Error("Deepgram Flux connection failed"));
        });
      });
    });
  } finally {
    await prepared.cleanup?.();
  }
}

async function transcribeNova(
  input: TranscriptionInput,
  apiKey: string,
): Promise<TranscriptionResult> {
  const prepared = await prepareAudioForStt(
    input.filePath,
    input.filename,
    input.options.normalize,
  );

  try {
    const audio = await readFile(prepared.filePath);
    const client = getDeepgramClient(apiKey);
    const maxKeyterms = getMaxKeyterms("deepgram", input.model);

    const response = await client.listen.v1.media.transcribeFile(audio, {
      model: input.model,
      language: input.options.language,
      smart_format: true,
      diarize: input.options.speakerDiarization || undefined,
      utterances: input.options.speakerDiarization || undefined,
      keyterm: input.options.keyterms.slice(0, maxKeyterms),
    });

    if (!isNovaTranscriptResponse(response)) {
      throw new Error("Deepgram Nova returned an async callback response; expected immediate transcript");
    }

    const duration = response.metadata?.duration;

    return {
      text: input.options.speakerDiarization ? formatDialogue(response) : plainText(response),
      durationMs: duration ? Math.round(duration * 1000) : null,
    };
  } finally {
    await prepared.cleanup?.();
  }
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
