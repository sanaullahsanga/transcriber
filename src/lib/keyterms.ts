import keytermsData from "@/data/keyterms.json";

export type KeytermsFile = {
  max_keyterms: number;
  nova_max_keyterms: number;
  flux_max_keyterms: number;
  speechmatics_max_keyterms: number;
  soniox_max_keyterms: number;
  common_keyterms: string[];
  agent_keyterms: Record<string, string[]>;
};

const data = keytermsData as KeytermsFile;

export function getMaxKeyterms(provider?: string, model?: string): number {
  switch (provider) {
    case "soniox":
      return data.soniox_max_keyterms;
    case "deepgram":
      if (model?.toLowerCase().includes("flux")) {
        return data.flux_max_keyterms;
      }
      return data.nova_max_keyterms;
    case "elevenlabs":
      return data.max_keyterms;
    case "google":
      return data.max_keyterms;
    default:
      return data.max_keyterms;
  }
}

/** Session keyterms — mirrors IT_Curves_Bot `get_session_keyterms()`. */
export function getSessionKeyterms(provider?: string): string[] {
  const max = getMaxKeyterms(provider);
  return data.common_keyterms.slice(0, max);
}

export function getCommonKeyterms(): string[] {
  return [...data.common_keyterms];
}

export function getAgentKeyterms(): Record<string, string[]> {
  return { ...data.agent_keyterms };
}
