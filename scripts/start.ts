import "dotenv/config";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.PROJECT_ROOT ??= projectRoot;

const port = process.env.PORT || "3000";
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");

console.log(`Starting Next.js on port ${port}`);
console.log(`Project root: ${process.env.PROJECT_ROOT}`);
console.log(`Upload dir: ${process.env.UPLOAD_DIR ?? path.join(projectRoot, "uploads")}`);

execFileSync(process.execPath, [nextBin, "start", "-p", port], {
  stdio: "inherit",
  env: process.env,
  cwd: projectRoot,
});
