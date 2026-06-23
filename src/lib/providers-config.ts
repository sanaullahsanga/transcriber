import { isGoogleSttConfigured } from "./google-auth";
import { PROVIDERS, type ProviderConfig } from "./providers";

export function isProviderConfigured(provider: ProviderConfig): boolean {
  if (provider.id === "google") {
    return isGoogleSttConfigured();
  }
  return Boolean(process.env[provider.envKey]);
}

export function listProviders() {
  return Object.values(PROVIDERS).map((provider) => ({
    ...provider,
    configured: isProviderConfigured(provider),
  }));
}
