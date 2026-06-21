import { sequelize } from "../db";
import { getSessionKeyterms } from "../keyterms";
import { AppSettings } from "./AppSettings";
import { TranscriptionJob } from "./TranscriptionJob";

export { AppSettings, TranscriptionJob };
export type { JobOptions, JobStatus } from "./TranscriptionJob";

let synced = false;

export async function initDb() {
  if (synced) return;

  await sequelize.authenticate();
  await sequelize.sync({ alter: process.env.NODE_ENV === "development" });

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
