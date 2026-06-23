import { readFile } from "node:fs/promises";
import { SpeechClient } from "@google-cloud/speech/build/src/v2";
import type { protos } from "@google-cloud/speech";
import {
  getGoogleProjectId,
  googleSttConfigError,
  loadGoogleCredentials,
} from "../google-auth";
import { prepareAudioForStt } from "../audio/normalize";
import type { TranscriptionInput, TranscriptionResult, TranscriptionProvider } from "./types";

type GoogleWord = protos.google.cloud.speech.v2.IWordInfo;
type RecognizeRequest = protos.google.cloud.speech.v2.IRecognizeRequest;

/** Models that support speaker diarization in Speech-to-Text v2 Recognize. */
const DIARIZATION_MODELS = new Set(["chirp_2", "telephony", "chirp"]);

function modelSupportsDiarization(model: string): boolean {
  return DIARIZATION_MODELS.has(model);
}

function resolveGoogleModel(model: string, wantDiarization: boolean): string {
  if (wantDiarization && !modelSupportsDiarization(model)) {
    return "telephony";
  }
  return model;
}

function isDiarizationUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /diarization/i.test(message) && /not support|unsupported|invalid_argument/i.test(message);
}

function buildRecognizeRequest(input: {
  projectId: string;
  model: string;
  language: string;
  keyterms: string[];
  speakerDiarization: boolean;
  audio: Buffer;
}): RecognizeRequest {
  const useDiarization = input.speakerDiarization && modelSupportsDiarization(input.model);

  return {
    recognizer: `projects/${input.projectId}/locations/global/recognizers/_`,
    config: {
      autoDecodingConfig: {},
      model: input.model,
      languageCodes: [toLanguageCode(input.language)],
      features: {
        enableAutomaticPunctuation: true,
        ...(useDiarization
          ? {
              diarizationConfig: {
                minSpeakerCount: 1,
                maxSpeakerCount: 6,
              },
            }
          : {}),
      },
      ...(input.keyterms.length
        ? {
            adaptation: {
              phraseSets: [
                {
                  inlinePhraseSet: {
                    phrases: input.keyterms.map((value) => ({ value })),
                  },
                },
              ],
            },
          }
        : {}),
    },
    content: input.audio,
  };
}

function transcriptFromResponse(
  response: protos.google.cloud.speech.v2.IRecognizeResponse,
  speakerDiarization: boolean,
): string {
  const results = response.results ?? [];
  const alternatives = results.flatMap((result) => result.alternatives ?? []);
  const plain = alternatives
    .map((alt) => alt.transcript?.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!plain) {
    throw new Error("Google STT returned an empty transcript");
  }

  if (!speakerDiarization) {
    return plain;
  }

  const words = alternatives.flatMap((alt) => alt.words ?? []);
  return formatDialogue(words) || plain;
}

async function recognizeWithGoogle(
  client: SpeechClient,
  request: RecognizeRequest,
  speakerDiarization: boolean,
): Promise<string> {
  try {
    const [response] = await client.recognize(request);
    return transcriptFromResponse(response, speakerDiarization);
  } catch (error) {
    const hasDiarization = Boolean(request.config?.features?.diarizationConfig);
    if (hasDiarization && isDiarizationUnsupportedError(error)) {
      const [response] = await client.recognize({
        ...request,
        config: {
          ...request.config,
          features: {
            ...request.config?.features,
            diarizationConfig: undefined,
          },
        },
      });
      return transcriptFromResponse(response, false);
    }
    throw error;
  }
}

function toLanguageCode(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized.includes("-")) return normalized;
  const map: Record<string, string> = {
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    it: "it-IT",
    pt: "pt-BR",
    ja: "ja-JP",
    ko: "ko-KR",
    zh: "zh-CN",
  };
  return map[normalized] ?? `${normalized}-${normalized.toUpperCase()}`;
}

function speakerLabels(speakers: string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  if (speakers[0]) labels[speakers[0]] = "Agent";
  if (speakers[1]) labels[speakers[1]] = "Caller";
  for (const speaker of speakers.slice(2)) {
    labels[speaker] = "Other";
  }
  return labels;
}

function formatDialogue(words: GoogleWord[]): string {
  const order: string[] = [];
  for (const word of words) {
    const speaker = word.speakerLabel ?? undefined;
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
    const text = currentText.join(" ").trim();
    if (!text) return;
    const label = labels[currentSpeaker ?? ""] ?? currentSpeaker ?? "Unknown";
    lines.push(`${label}: ${text}`);
  };

  for (const word of words) {
    const speaker = word.speakerLabel ?? "unknown";
    const piece = word.word ?? "";
    if (!piece) continue;
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

function createSpeechClient(): SpeechClient {
  const projectId = getGoogleProjectId();
  if (!projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT is not configured");
  }

  const credentials = loadGoogleCredentials();
  if (!credentials) {
    throw new Error(googleSttConfigError());
  }

  return new SpeechClient({ projectId, credentials });
}

export class GoogleTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const projectId = getGoogleProjectId();
    if (!projectId) {
      throw new Error("GOOGLE_CLOUD_PROJECT is not configured");
    }

    const prepared = await prepareAudioForStt(
      input.filePath,
      input.filename,
      input.options.normalize,
    );

    try {
      const audio = await readFile(prepared.filePath);
      const client = createSpeechClient();
      const keyterms = input.options.keyterms.filter(Boolean).slice(0, 500);
      const wantDiarization = input.options.speakerDiarization;
      const model = resolveGoogleModel(input.model, wantDiarization);
      const request = buildRecognizeRequest({
        projectId,
        model,
        language: input.options.language,
        keyterms,
        speakerDiarization: wantDiarization,
        audio,
      });

      const text = await recognizeWithGoogle(client, request, wantDiarization);

      return { text, durationMs: null };
    } finally {
      await prepared.cleanup?.();
    }
  }
}
