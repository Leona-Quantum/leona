#!/usr/bin/env node
// Simple test runner for check-match-gauge.test.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testFile = join(__dirname, "check-match-gauge.test.mjs");

const proc = spawn("node", ["--test", testFile], {
  stdio: "inherit",
  cwd: join(__dirname, ".."),
});

proc.on("exit", (code) => {
  process.exit(code);
});
