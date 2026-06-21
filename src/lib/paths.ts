import { access } from "node:fs/promises";
import path from "node:path";

/**
 * Stable app root — do not rely on process.cwd() alone (Next.js can vary cwd per worker).
 * Set PROJECT_ROOT in production systemd/.env (e.g. /var/www/transcriber).
 */
export function getProjectRoot(): string {
  if (process.env.PROJECT_ROOT) {
    return process.env.PROJECT_ROOT;
  }
  return process.cwd();
}

export function getUploadDir(): string {
  const dir = process.env.UPLOAD_DIR ?? "uploads";
  if (path.isAbsolute(dir)) {
    return dir;
  }
  return path.join(getProjectRoot(), dir);
}

export function resolveStoredPath(storedPath: string): string {
  if (path.isAbsolute(storedPath)) {
    return storedPath;
  }

  // Legacy rows store "uploads/<filename>" — always resolve by filename inside upload dir.
  return path.join(getUploadDir(), path.basename(storedPath));
}

export async function assertAudioFileExists(storedPath: string): Promise<string> {
  const resolved = resolveStoredPath(storedPath);
  try {
    await access(resolved);
  } catch {
    throw new Error(
      `Audio file not found at ${resolved}. Upload directory: ${getUploadDir()}`,
    );
  }
  return resolved;
}
