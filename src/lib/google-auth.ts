import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_GOOGLE_CREDENTIALS_FILE = "google-service-account.json";
/** chirp_3 and telephony (v2) are not available in `global` — use `us` or `eu`. */
export const DEFAULT_GOOGLE_STT_LOCATION = "us";

export function getGoogleSttLocation(): string {
  const location = process.env.GOOGLE_STT_LOCATION?.trim();
  return location || DEFAULT_GOOGLE_STT_LOCATION;
}

export function getGoogleSttGcsBucket(): string | undefined {
  const bucket = process.env.GOOGLE_STT_GCS_BUCKET?.trim();
  return bucket || undefined;
}

export function getGoogleProjectId(): string | undefined {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  return projectId || undefined;
}

function resolveCredentialsPath(): string | null {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (explicit) {
    const resolved = path.isAbsolute(explicit)
      ? explicit
      : path.join(process.cwd(), explicit);
    if (existsSync(resolved)) return resolved;
  }

  const defaultPath = path.join(process.cwd(), DEFAULT_GOOGLE_CREDENTIALS_FILE);
  if (existsSync(defaultPath)) return defaultPath;

  return null;
}

function parseCredentialsJson(raw: string): object | null {
  try {
    return JSON.parse(raw) as object;
  } catch {
    return null;
  }
}

export function loadGoogleCredentials(): object | null {
  const inline = process.env.GOOGLE_SPEECH_CREDENTIALS_JSON?.trim();
  if (inline) {
    const parsed = parseCredentialsJson(inline);
    if (parsed) return parsed;
  }

  const credPath = resolveCredentialsPath();
  if (!credPath) return null;

  return parseCredentialsJson(readFileSync(credPath, "utf8"));
}

export function isGoogleSttConfigured(): boolean {
  if (!getGoogleProjectId()) return false;
  if (!getGoogleSttGcsBucket()) return false;
  return loadGoogleCredentials() !== null;
}

export function googleSttConfigError(): string {
  return (
    "Google STT is not configured. Set GOOGLE_CLOUD_PROJECT, GOOGLE_STT_GCS_BUCKET " +
    "(Cloud Storage bucket for batch transcription of 2–10 min calls), and either " +
    "GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SPEECH_CREDENTIALS_JSON. " +
    "Optional: GOOGLE_STT_LOCATION (default us — required for chirp_3). Then restart."
  );
}
