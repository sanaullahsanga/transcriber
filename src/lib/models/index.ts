import { sequelize } from "../db";
import { DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT } from "../llm/default-stt-prompt";
import { getSessionKeyterms } from "../keyterms";
import { AppSettings } from "./AppSettings";
import { BenchmarkRun } from "./BenchmarkRun";
import { CallReview } from "./CallReview";
import { applySchemaPatches } from "./migrations";
import { SttAnalysis } from "./SttAnalysis";
import { TranscriptionJob } from "./TranscriptionJob";

export { AppSettings, BenchmarkRun, CallReview, SttAnalysis, TranscriptionJob };
export type { BenchmarkSlotConfig } from "./BenchmarkRun";
export type { JobOptions, JobStatus } from "./TranscriptionJob";
export type {
  AnalysisStatus,
  SttIssue,
  SttIssueCategory,
  SttIssueSeverity,
} from "./SttAnalysis";

export type { ReviewStatus } from "./CallReview";

BenchmarkRun.hasMany(TranscriptionJob, { foreignKey: "benchmarkRunId", as: "jobs" });
TranscriptionJob.belongsTo(BenchmarkRun, { foreignKey: "benchmarkRunId", as: "benchmarkRun" });
TranscriptionJob.hasOne(SttAnalysis, { foreignKey: "jobId", as: "sttAnalysis" });
SttAnalysis.belongsTo(TranscriptionJob, { foreignKey: "jobId", as: "job" });

let synced = false;

type InitDbOptions = {
  forceAlter?: boolean;
};

export async function initDb(options?: InitDbOptions) {
  if (synced) return;

  await sequelize.authenticate();
  await applySchemaPatches();
  const shouldAlter = options?.forceAlter ?? process.env.NODE_ENV === "development";
  await sequelize.sync({ alter: shouldAlter });

  const existing = await AppSettings.findByPk(1);
  const defaultKeyterms = getSessionKeyterms("soniox");

  if (!existing) {
    await AppSettings.create({
      id: 1,
      defaultProvider: "soniox",
      defaultModel: "stt-async-v5",
      normalizeAudio: true,
      speakerDiarization: true,
      keyterms: defaultKeyterms,
      language: "en",
      sttAnalysisSystemPrompt: DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT,
    });
  } else {
    if (!existing.keyterms?.length) {
      await existing.update({ keyterms: defaultKeyterms });
    }
    if (!existing.sttAnalysisSystemPrompt?.trim()) {
      await existing.update({ sttAnalysisSystemPrompt: DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT });
    }
  }

  synced = true;
}
