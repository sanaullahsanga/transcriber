import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TARGET_SAMPLE_RATE = 16_000;

function runFfmpeg(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      String(TARGET_SAMPLE_RATE),
      "-b:a",
      "64k",
      outputPath,
    ];

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      reject(new Error(`ffmpeg not available: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-500)}`));
    });
  });
}

function needsNormalization(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ![".wav", ".flac"].includes(ext);
}

export type PreparedAudio = {
  filePath: string;
  filename: string;
  mimeType: string;
  cleanup?: () => Promise<void>;
};

/**
 * Convert audio to 16 kHz mono WAV for provider compatibility.
 * Mirrors the Python transcriber's pydub normalization step.
 */
export async function prepareAudioForStt(
  inputPath: string,
  originalFilename: string,
  normalize: boolean,
): Promise<PreparedAudio> {
  if (!normalize && !needsNormalization(inputPath)) {
    return {
      filePath: inputPath,
      filename: originalFilename,
      mimeType: "audio/wav",
    };
  }

  if (!normalize) {
    return {
      filePath: inputPath,
      filename: originalFilename,
      mimeType: guessMimeType(originalFilename),
    };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "transcriber-audio-"));
  const outputPath = path.join(tempDir, "normalized.wav");

  await runFfmpeg(inputPath, outputPath);

  return {
    filePath: outputPath,
    filename: path.basename(originalFilename, path.extname(originalFilename)) + ".wav",
    mimeType: "audio/wav",
    cleanup: async () => {
      // Only removes ffmpeg temp dir — original upload in UPLOAD_DIR is never deleted.
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

/** Read 16 kHz mono linear16 PCM from any audio file via ffmpeg. */
export function readLinear16Mono(inputPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      inputPath,
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      String(TARGET_SAMPLE_RATE),
      "-",
    ];

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      reject(new Error(`ffmpeg not available: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-500)}`));
    });
  });
}

function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
  };
  return map[ext] ?? "application/octet-stream";
}
