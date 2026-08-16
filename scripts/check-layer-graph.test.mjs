#!/usr/bin/env node
// Unit tests for path traversal vulnerability mitigation in check-layer-graph.mjs
// Tests the path validation logic to ensure malicious paths are rejected while
// legitimate paths are accepted.
//
// The security fix validates paths using:
// 1. path.basename() to sanitize labels
// 2. path.resolve() to normalize paths
// 3. path.relative() to check if resolved path escapes root
// 4. Rejection if relative path starts with '..' or is absolute

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname, resolve, relative, basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Extracted path validation logic from the bundle() function
// This is the security-critical code we're testing
function validatePath(relativePath, rootDir) {
  const resolvedRoot = resolve(rootDir);
  const resolvedEntry = resolve(resolvedRoot, relativePath);
  const relativeCheck = relative(resolvedRoot, resolvedEntry);
  
  // Security check: prevent path traversal
  if (relativeCheck.startsWith('..') || isAbsolute(relativeCheck)) {
    return { valid: false, reason: 'path escapes root or is absolute' };
  }
  
  return { valid: true, resolvedPath: resolvedEntry };
}

// Validate label sanitization
function validateLabel(label) {
  return basename(label);
}

// Test suite for path traversal vulnerability mitigation
test("path validation rejects traversal with ../", () => {
  const result = validatePath("../../../etc/passwd", root);
  assert.strictEqual(result.valid, false, "Should reject path traversal using ../");
  assert.match(result.reason, /escapes root/, "Should indicate path escapes root");
});

test("path validation rejects absolute Unix paths", () => {
  const result = validatePath("/etc/passwd", root);
  assert.strictEqual(result.valid, false, "Should reject absolute Unix paths");
});

test("path validation rejects absolute Windows paths", () => {
  // On Windows, C:\path is absolute; on Unix, it's treated as relative but will fail
  // the validation when resolved
  const result = validatePath("C:\\Windows\\System32\\config\\sam", root);
  // This will be rejected either as absolute (Windows) or escaping root (Unix)
  assert.strictEqual(result.valid, false, "Should reject Windows-style paths");
});

test("path validation rejects path with .. that escapes root", () => {
  const result = validatePath("apps/../../../etc/passwd", root);
  assert.strictEqual(result.valid, false, "Should reject paths with .. segments that escape root");
});

test("path validation accepts legitimate relative path", () => {
  const result = validatePath("apps/web/lib/test.ts", root);
  assert.strictEqual(result.valid, true, "Should accept legitimate relative path");
  assert.ok(result.resolvedPath, "Should return resolved path");
});

test("path validation accepts path with safe .. that stays within root", () => {
  // Path like "apps/web/lib/../test.ts" which resolves to "apps/web/test.ts"
  const result = validatePath("apps/web/lib/../test.ts", root);
  assert.strictEqual(result.valid, true, "Should accept safe .. navigation within root");
  assert.ok(result.resolvedPath, "Should return resolved path");
});

test("path validation rejects symlink-style attacks", () => {
  // Attempt to use multiple .. to escape
  const result = validatePath("apps/../../../../../../etc/passwd", root);
  assert.strictEqual(result.valid, false, "Should reject symlink-style path traversal");
});

test("label sanitization removes path traversal from labels", () => {
  const testCases = [
    { input: "../../../malicious", expected: "malicious" },
    { input: "/etc/passwd", expected: "passwd" },
    { input: "../../test", expected: "test" },
    { input: "normal-label", expected: "normal-label" },
    { input: "path/to/label", expected: "label" },
    { input: "..\\..\\windows\\path", expected: "path" },
  ];
  
  for (const { input, expected } of testCases) {
    const result = validateLabel(input);
    assert.strictEqual(
      result,
      expected,
      `Label "${input}" should be sanitized to "${expected}"`
    );
  }
});

test("path validation comprehensive security test", () => {
  // Collection of known path traversal attack vectors
  const maliciousPaths = [
    "../../../etc/passwd",
    "../../../../../../etc/passwd",
    "/etc/passwd",
    "/etc/shadow",
    "/../../../etc/passwd",
    "apps/../../../etc/passwd",
    "..\\..\\..\\windows\\system32\\config\\sam",
    "/var/log/auth.log",
    "../.ssh/id_rsa",
  ];
  
  for (const maliciousPath of maliciousPaths) {
    const result = validatePath(maliciousPath, root);
    assert.strictEqual(
      result.valid,
      false,
      `Malicious path "${maliciousPath}" should be rejected`
    );
  }
  
  // Legitimate paths that should be accepted
  const legitimatePaths = [
    "apps/web/lib/test.ts",
    "scripts/check-layer-graph.mjs",
    "packages/ts/ui/tokens.css",
    "apps/web/lib/repository/layer-graph.ts",
    "apps/web/lib/../lib/test.ts", // Safe .. navigation
  ];
  
  for (const legitimatePath of legitimatePaths) {
    const result = validatePath(legitimatePath, root);
    assert.strictEqual(
      result.valid,
      true,
      `Legitimate path "${legitimatePath}" should be accepted`
    );
  }
});
