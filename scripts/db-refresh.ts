import "dotenv/config";
import { sequelize } from "../src/lib/db";
import { getSessionKeyterms } from "../src/lib/keyterms";
import { AppSettings } from "../src/lib/models";

async function main() {
  console.log("Refreshing database (all data will be deleted)...");

  await sequelize.authenticate();
  await sequelize.sync({ force: true });

  console.log("Tables recreated. Seeding...");

  const keyterms = getSessionKeyterms("soniox");
  await AppSettings.create({
    id: 1,
    defaultProvider: "soniox",
    defaultModel: "stt-async-v5",
    normalizeAudio: true,
    speakerDiarization: true,
    keyterms,
    language: "en",
  });

  console.log(`Database refreshed and seeded with ${keyterms.length} keyterms.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Database refresh failed:", error);
  process.exit(1);
});
