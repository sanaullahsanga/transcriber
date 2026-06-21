import { FetchHttpClient, SonioxNodeClient, resolveConnectionConfig } from "@soniox/node";

const SONIOX_HTTP_TIMEOUT_MS = Number(process.env.SONIOX_HTTP_TIMEOUT_MS ?? 900_000);
const SONIOX_WAIT_TIMEOUT_MS = Number(process.env.SONIOX_WAIT_TIMEOUT_MS ?? 900_000);

export function createSonioxClient(): SonioxNodeClient {
  const apiKey = process.env.SONIOX_API_KEY;
  if (!apiKey) {
    throw new Error("SONIOX_API_KEY is not configured");
  }

  const regionDefaults = resolveConnectionConfig({
    api_key: apiKey,
    region: process.env.SONIOX_REGION as "eu" | "us" | undefined,
    base_domain: process.env.SONIOX_BASE_DOMAIN,
  });

  const baseUrl = process.env.SONIOX_API_BASE_URL ?? regionDefaults.api_domain;

  return new SonioxNodeClient({
    api_key: apiKey,
    http_client: new FetchHttpClient({
      base_url: baseUrl,
      default_headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      default_timeout_ms: SONIOX_HTTP_TIMEOUT_MS,
    }),
  });
}

export { SONIOX_WAIT_TIMEOUT_MS };
