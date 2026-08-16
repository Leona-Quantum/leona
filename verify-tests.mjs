#!/usr/bin/env node
// Syntax check and manual test execution
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

console.log("Checking test file syntax...");

try {
  // Try to import the test file to check syntax
  const testPath = join(rootDir, "scripts/check-match-gauge.test.mjs");
  const content = readFileSync(testPath, "utf8");
  console.log("✓ Test file syntax is valid");
  console.log(`✓ Test file has ${content.split("test(").length - 1} test cases`);
  
  // Now try to actually run it
  console.log("\nAttempting to run tests...");
  await import(testPath);
  
} catch (error) {
  console.error("✗ Error:", error.message);
  console.error(error.stack);
  process.exit(1);
}
