export type ProviderId = "soniox" | "deepgram";

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
};

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS[id as ProviderId];
}

export function listProviders() {
  return Object.values(PROVIDERS).map((provider) => ({
    ...provider,
    configured: Boolean(process.env[provider.envKey]),
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
