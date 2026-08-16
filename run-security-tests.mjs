#!/usr/bin/env node
// Direct test execution for path traversal tests
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

console.log("Running path traversal security tests...");
console.log("Working directory:", rootDir);
console.log("Test file: scripts/check-match-gauge.test.mjs");
console.log("=" .repeat(80));

try {
  const result = execSync("node --test scripts/check-match-gauge.test.mjs", {
    cwd: rootDir,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  console.log(result);
  console.log("=" .repeat(80));
  console.log("✓ All tests passed");
  process.exit(0);
} catch (error) {
  console.log("=" .repeat(80));
  console.error("✗ Tests failed");
  if (error.stdout) console.log("STDOUT:\n", error.stdout);
  if (error.stderr) console.error("STDERR:\n", error.stderr);
  process.exit(error.status || 1);
}
