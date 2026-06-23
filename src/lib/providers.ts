export type ProviderId = "soniox" | "deepgram" | "elevenlabs" | "google";

export type ProviderModel = {
  id: string;
  label: string;
  description?: string;
};

export type ProviderConfig = {
  id: ProviderId;
  name: string;
  description: string;
  envKey: string;
  models: ProviderModel[];
  defaultModel: string;
};

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  soniox: {
    id: "soniox",
    name: "Soniox",
    description: "High-accuracy async STT with speaker diarization",
    envKey: "SONIOX_API_KEY",
    defaultModel: "stt-async-v5",
    models: [
      { id: "stt-async-v5", label: "STT Async v5", description: "Latest production model" },
      { id: "stt-async-v4", label: "STT Async v4", description: "Previous generation model" },
    ],
  },
  deepgram: {
    id: "deepgram",
    name: "Deepgram",
    description: "Nova models with smart formatting and diarization",
    envKey: "DEEPGRAM_API_KEY",
    defaultModel: "nova-3",
    models: [
      { id: "nova-3", label: "Nova 3", description: "Best accuracy" },
      { id: "nova-2", label: "Nova 2", description: "Fast and reliable" },
      { id: "enhanced", label: "Enhanced", description: "General purpose" },
      { id: "whisper-large", label: "Whisper Large", description: "Whisper on Deepgram" },
    ],
  },
  elevenlabs: {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Scribe models with diarization and keyterm prompting",
    envKey: "ELEVENLABS_API_KEY",
    defaultModel: "scribe_v2",
    models: [
      { id: "scribe_v2", label: "Scribe v2", description: "Latest Scribe model" },
      { id: "scribe_v1", label: "Scribe v1", description: "Previous Scribe model" },
    ],
  },
  google: {
    id: "google",
    name: "Google STT",
    description: "Cloud Speech-to-Text v2 with phrase adaptation",
    envKey: "GOOGLE_CLOUD_PROJECT",
    defaultModel: "long",
    models: [
      { id: "long", label: "Long", description: "Best for longer recordings" },
      { id: "short", label: "Short", description: "Optimized for short utterances" },
      { id: "chirp_2", label: "Chirp 2", description: "Latest Chirp model" },
      { id: "telephony", label: "Telephony", description: "Phone call audio" },
    ],
  },
};

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS[id as ProviderId];
}

export function isProviderConfigured(provider: ProviderConfig): boolean {
  if (provider.id === "google") {
    return Boolean(
      process.env.GOOGLE_CLOUD_PROJECT &&
        (process.env.GOOGLE_APPLICATION_CREDENTIALS ||
          process.env.GOOGLE_SPEECH_CREDENTIALS_JSON),
    );
  }
  return Boolean(process.env[provider.envKey]);
}

export function listProviders() {
  return Object.values(PROVIDERS).map((provider) => ({
    ...provider,
    configured: isProviderConfigured(provider),
  }));
}

export function resolveModel(providerId: string, model?: string | null): string {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  if (model && provider.models.some((m) => m.id === model)) {
    return model;
  }
  return provider.defaultModel;
}
