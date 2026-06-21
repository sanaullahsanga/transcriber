import "dotenv/config";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = process.env.PORT || "3000";
const nextBin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "next", "dist", "bin", "next");

console.log(`Starting Next.js on port ${port}`);

execFileSync(process.execPath, [nextBin, "start", "-p", port], {
  stdio: "inherit",
  env: process.env,
});
