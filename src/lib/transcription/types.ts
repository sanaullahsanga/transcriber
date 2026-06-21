import type { JobOptions } from "../models/TranscriptionJob";

export type TranscriptionInput = {
  filePath: string;
  filename: string;
  mimeType?: string | null;
  provider: string;
  model: string;
  options: JobOptions;
};

export type TranscriptionResult = {
  text: string;
  durationMs?: number | null;
};

export interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}
