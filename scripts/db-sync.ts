import "dotenv/config";
import { initDb } from "../src/lib/models";

async function main() {
  console.log("Syncing database...");
  await initDb();
  console.log("Database synced successfully.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Database sync failed:", error);
  process.exit(1);
});
