#!/usr/bin/env node
// Wrapper to run the path traversal tests and capture output
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

try {
  const output = execSync("node --test scripts/check-match-gauge.test.mjs", {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  console.log(output);
  process.exit(0);
} catch (error) {
  console.error("STDOUT:", error.stdout);
  console.error("STDERR:", error.stderr);
  process.exit(error.status || 1);
}
