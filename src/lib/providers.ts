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
    description: "Cloud Speech-to-Text v2 via batch API (2–10 min calls, LiveKit-compatible models)",
    envKey: "GOOGLE_CLOUD_PROJECT",
    defaultModel: "chirp_3",
    models: [
      {
        id: "chirp_3",
        label: "Chirp 3",
        description: "Default — batch + LiveKit streaming, best for long calls",
      },
      {
        id: "telephony",
        label: "Telephony",
        description: "Phone call audio — batch + LiveKit v2",
      },
    ],
  },
};

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS[id as ProviderId];
}

export function providerConfigError(provider: { id: string; name: string }): string {
  if (provider.id === "google") {
    return (
      "Google STT is not configured. Set GOOGLE_CLOUD_PROJECT and " +
      "GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON), then restart the server."
    );
  }
  return `${provider.name} API key is not configured in environment`;
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
