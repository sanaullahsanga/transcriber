import "dotenv/config";
import { sequelize } from "../src/lib/db";
import { CallReview, initDb } from "../src/lib/models";

async function main() {
  await initDb();

  const count = await CallReview.count();
  if (count === 0) {
    console.log("No review records to delete.");
    process.exit(0);
  }

  await CallReview.destroy({ where: {}, truncate: true });
  console.log(`Deleted ${count} call review record(s). WER scores and saved references are cleared.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Failed to clear reviews:", error);
  process.exit(1);
});
