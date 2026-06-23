import { readFile } from "node:fs/promises";
import { SpeechClient } from "@google-cloud/speech/build/src/v2";
import type { protos } from "@google-cloud/speech";
import { prepareAudioForStt } from "../audio/normalize";
import type { TranscriptionInput, TranscriptionResult, TranscriptionProvider } from "./types";

type GoogleWord = protos.google.cloud.speech.v2.IWordInfo;
type RecognizeRequest = protos.google.cloud.speech.v2.IRecognizeRequest;

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
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT is not configured");
  }

  const credentialsJson = process.env.GOOGLE_SPEECH_CREDENTIALS_JSON;
  if (credentialsJson) {
    return new SpeechClient({
      projectId,
      credentials: JSON.parse(credentialsJson) as object,
    });
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "Google STT requires GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SPEECH_CREDENTIALS_JSON",
    );
  }

  return new SpeechClient({ projectId });
}

export class GoogleTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
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

      const request: RecognizeRequest = {
        recognizer: `projects/${projectId}/locations/global/recognizers/_`,
        config: {
          autoDecodingConfig: {},
          model: input.model,
          languageCodes: [toLanguageCode(input.options.language)],
          features: {
            enableAutomaticPunctuation: true,
            ...(input.options.speakerDiarization
              ? {
                  diarizationConfig: {
                    minSpeakerCount: 1,
                    maxSpeakerCount: 6,
                  },
                }
              : {}),
          },
          ...(keyterms.length
            ? {
                adaptation: {
                  phraseSets: [
                    {
                      inlinePhraseSet: {
                        phrases: keyterms.map((value) => ({ value })),
                      },
                    },
                  ],
                },
              }
            : {}),
        },
        content: audio,
      };

      const [response] = await client.recognize(request);
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

      const words = alternatives.flatMap((alt) => alt.words ?? []);
      const text = input.options.speakerDiarization
        ? formatDialogue(words) || plain
        : plain;

      return { text, durationMs: null };
    } finally {
      await prepared.cleanup?.();
    }
  }
}
