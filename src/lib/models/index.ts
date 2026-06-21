import { sequelize } from "../db";
import { getSessionKeyterms } from "../keyterms";
import { AppSettings } from "./AppSettings";
import { BenchmarkRun } from "./BenchmarkRun";
import { applySchemaPatches } from "./migrations";
import { TranscriptionJob } from "./TranscriptionJob";

export { AppSettings, BenchmarkRun, TranscriptionJob };
export type { BenchmarkSlotConfig } from "./BenchmarkRun";
export type { JobOptions, JobStatus } from "./TranscriptionJob";

BenchmarkRun.hasMany(TranscriptionJob, { foreignKey: "benchmarkRunId", as: "jobs" });
TranscriptionJob.belongsTo(BenchmarkRun, { foreignKey: "benchmarkRunId", as: "benchmarkRun" });

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
    });
  } else if (!existing.keyterms?.length) {
    await existing.update({ keyterms: defaultKeyterms });
  }

  synced = true;
}
