import { SpeechClient } from "@google-cloud/speech/build/src/v2";
import type { protos } from "@google-cloud/speech";
import { prepareAudioForStt } from "../audio/normalize";
import { deleteGcsObject, uploadAudioToGcs } from "../google-gcs";
import type { TranscriptionInput, TranscriptionResult, TranscriptionProvider } from "./types";
import {
  getGoogleProjectId,
  googleSttConfigError,
  isGoogleSttConfigured,
  loadGoogleCredentials,
} from "../google-auth";

type GoogleWord = protos.google.cloud.speech.v2.IWordInfo;
type RecognitionConfig = protos.google.cloud.speech.v2.IRecognitionConfig;

/** LiveKit Google STT v2 models — also support BatchRecognize for 2–10 min calls. */
export const GOOGLE_STT_MODELS = ["chirp_3", "telephony"] as const;
export type GoogleSttModel = (typeof GOOGLE_STT_MODELS)[number];
export const DEFAULT_GOOGLE_STT_MODEL: GoogleSttModel = "chirp_3";

const BATCH_TIMEOUT_MS = 900_000;

function resolveGoogleModel(model: string): GoogleSttModel {
  if (model === "telephony") return "telephony";
  return DEFAULT_GOOGLE_STT_MODEL;
}

function isRetryableConfigError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /invalid_argument/i.test(message) &&
    /unsupported|not support|diarization|does not exist in the location/i.test(message)
  );
}

type GoogleRecognizeConfig = {
  projectId: string;
  model: GoogleSttModel;
  language: string;
  keyterms: string[];
  speakerDiarization: boolean;
};

function buildRecognitionConfig(
  input: GoogleRecognizeConfig & { includeAdaptation?: boolean },
): RecognitionConfig {
  const useDiarization = input.speakerDiarization && input.model === "chirp_3";
  const includeAdaptation = input.includeAdaptation !== false && input.keyterms.length > 0;

  return {
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
    ...(includeAdaptation
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
  };
}

function transcriptFromBatchResults(
  results: protos.google.cloud.speech.v2.ISpeechRecognitionResult[],
  speakerDiarization: boolean,
): string {
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

async function batchRecognizeFromGcs(
  client: SpeechClient,
  config: GoogleRecognizeConfig,
  gcsUri: string,
): Promise<string> {
  const attempts: Array<{ speakerDiarization: boolean; includeAdaptation: boolean }> = [
    { speakerDiarization: config.speakerDiarization, includeAdaptation: true },
    { speakerDiarization: false, includeAdaptation: true },
    { speakerDiarization: false, includeAdaptation: false },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const [operation] = await client.batchRecognize({
        recognizer: `projects/${config.projectId}/locations/global/recognizers/_`,
        config: buildRecognitionConfig({
          ...config,
          speakerDiarization: attempt.speakerDiarization,
          includeAdaptation: attempt.includeAdaptation,
        }),
        files: [{ uri: gcsUri }],
        recognitionOutputConfig: {
          inlineResponseConfig: {},
        },
      });

      const [response] = await Promise.race([
        operation.promise(),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error("Google batch transcription timed out")),
            BATCH_TIMEOUT_MS,
          );
        }),
      ]);

      const inline = response.results?.[gcsUri]?.transcript?.results ?? [];
      return transcriptFromBatchResults(inline, attempt.speakerDiarization);
    } catch (error) {
      lastError = error;
      if (!isRetryableConfigError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
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
    if (!isGoogleSttConfigured()) {
      throw new Error(googleSttConfigError());
    }

    const projectId = getGoogleProjectId()!;
    const prepared = await prepareAudioForStt(
      input.filePath,
      input.filename,
      input.options.normalize,
    );

    try {
      const client = createSpeechClient();
      const keyterms = input.options.keyterms.filter(Boolean).slice(0, 500);
      const isReference = Boolean(input.options.isReference);
      const model = resolveGoogleModel(input.model);
      const speakerDiarization =
        Boolean(input.options.speakerDiarization) &&
        !isReference &&
        model === "chirp_3";

      const uploaded = await uploadAudioToGcs(prepared.filePath, prepared.filename);
      try {
        const text = await batchRecognizeFromGcs(
          client,
          {
            projectId,
            model,
            language: input.options.language,
            keyterms,
            speakerDiarization,
          },
          uploaded.gcsUri,
        );
        return { text, durationMs: null };
      } finally {
        await deleteGcsObject(uploaded.bucket, uploaded.objectName).catch(() => undefined);
      }
    } finally {
      await prepared.cleanup?.();
    }
  }
}
