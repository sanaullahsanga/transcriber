import type { ProviderId } from "../providers";
import { DeepgramTranscriptionProvider } from "./deepgram";
import { SonioxTranscriptionProvider } from "./soniox";
import type { TranscriptionInput, TranscriptionResult, TranscriptionProvider } from "./types";

const providers: Record<ProviderId, TranscriptionProvider> = {
  soniox: new SonioxTranscriptionProvider(),
  deepgram: new DeepgramTranscriptionProvider(),
};

export async function transcribeAudio(input: TranscriptionInput): Promise<TranscriptionResult> {
  const provider = providers[input.provider as ProviderId];
  if (!provider) {
    throw new Error(`Unsupported provider: ${input.provider}`);
  }
  return provider.transcribe(input);
}

export type { TranscriptionInput, TranscriptionResult };
