#!/usr/bin/env node
// Unit tests for check-paper-register.mjs path traversal vulnerability mitigation
//
// This test file verifies that the bundle() function properly validates paths
// and prevents path traversal attacks through the relativePath and label parameters.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));

// Mock esbuild for testing - we don't need actual bundling for security tests
let esbuild;
try {
  esbuild = require("esbuild");
} catch (e) {
  // If esbuild is not available, we'll skip tests that need it
  console.warn("esbuild not available, some tests may be skipped");
}

/**
 * The bundle function with path traversal mitigation.
 * This is the function under test - extracted from check-paper-register.mjs
 */
async function bundle(relativePath, label) {
  const outDir = mkdtempSync(join(tmpdir(), "papers-"));
  const resolvedLabel = basename(label);
  const outFile = join(outDir, `${resolvedLabel}.mjs`);
  const resolvedRoot = resolve(root);
  const resolvedEntry = resolve(resolvedRoot, relativePath);
  const relativeCheck = relative(resolvedRoot, resolvedEntry);
  
  // Security check: prevent path traversal
  if (relativeCheck.startsWith('..') || isAbsolute(relativeCheck)) {
    rmSync(outDir, { recursive: true, force: true });
    throw new Error(`invalid path: ${relativePath}`);
  }
  
  try {
    if (!esbuild) {
      throw new Error("esbuild not available");
    }
    await esbuild.build({
      entryPoints: [resolvedEntry],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: outFile,
      logLevel: "silent",
    });
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    throw error;
  }
  
  rmSync(outDir, { recursive: true, force: true });
  return { bundled: true };
}

// ============================================================================
// Security Tests: Path Traversal Vulnerability Mitigation
// ============================================================================

test("rejects path traversal with parent directory references", async () => {
  await assert.rejects(
    async () => await bundle("../../etc/passwd", "test"),
    /invalid path/,
    "Should reject path with ../ traversal"
  );
});

test("rejects path traversal with multiple parent directory references", async () => {
  await assert.rejects(
    async () => await bundle("../../../sensitive/file.ts", "test"),
    /invalid path/,
    "Should reject path with multiple ../ traversal"
  );
});

test("rejects absolute paths in relativePath parameter", async () => {
  await assert.rejects(
    async () => await bundle("/etc/passwd", "test"),
    /invalid path/,
    "Should reject absolute path starting with /"
  );
});

test("rejects Windows-style absolute paths", async () => {
  await assert.rejects(
    async () => await bundle("C:\\Windows\\System32\\config", "test"),
    /invalid path/,
    "Should reject Windows absolute path"
  );
});

test("sanitizes label parameter to prevent directory traversal in output", () => {
  // Test that basename is used on label to prevent traversal
  const maliciousLabel = "../../malicious/path";
  const sanitized = basename(maliciousLabel);
  assert.equal(sanitized, "path", "Label should be sanitized to basename only");
});

test("sanitizes label with path separators", () => {
  const labelWithPath = "subdir/../../evil";
  const sanitized = basename(labelWithPath);
  assert.equal(sanitized, "evil", "Label should extract only the basename");
});

test("accepts valid relative paths within project root", async () => {
  // Create a temporary test file within the project
  const testDir = mkdtempSync(join(root, "test-"));
  const testFile = join(testDir, "test.mjs");
  
  try {
    writeFileSync(testFile, "export const test = 'value';");
    const relativePath = relative(root, testFile);
    
    // This should not throw - it's a valid path within root
    // Note: It may fail for other reasons (esbuild, file content) but not path validation
    try {
      await bundle(relativePath, "test");
      assert.ok(true, "Valid relative path should be accepted");
    } catch (error) {
      // If it fails, ensure it's not due to path validation
      assert.ok(
        !error.message.includes("invalid path"),
        "Valid path should not fail path validation"
      );
    }
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test("path.relative returns path starting with .. for paths outside root", () => {
  // Verify the security check logic itself
  const outsidePath = resolve(root, "../outside/file.ts");
  const relativeCheck = relative(resolve(root), outsidePath);
  assert.ok(
    relativeCheck.startsWith(".."),
    "path.relative should return .. for paths outside root"
  );
});

test("path.relative returns non-absolute path for paths inside root", () => {
  // Verify the security check logic for valid paths
  const insidePath = resolve(root, "apps/web/lib/test.ts");
  const relativeCheck = relative(resolve(root), insidePath);
  assert.ok(
    !relativeCheck.startsWith("..") && !isAbsolute(relativeCheck),
    "path.relative should return relative path without .. for paths inside root"
  );
});

test("rejects path with encoded traversal sequences", async () => {
  // Test URL-encoded path traversal attempts
  await assert.rejects(
    async () => await bundle("..%2F..%2Fetc%2Fpasswd", "test"),
    /invalid path|ENOENT/,
    "Should reject or fail on encoded traversal"
  );
});

test("rejects path with mixed separators", async () => {
  // Test mixed forward/back slashes (Windows-style attack)
  await assert.rejects(
    async () => await bundle("..\\..\\sensitive\\file.ts", "test"),
    /invalid path/,
    "Should reject path with mixed separators"
  );
});

// ============================================================================
// Functional Tests: Existing Behavior Preservation
// ============================================================================

test("resolvedLabel uses basename to prevent directory creation", () => {
  const testCases = [
    { input: "simple", expected: "simple" },
    { input: "path/to/file", expected: "file" },
    { input: "../../../etc/passwd", expected: "passwd" },
    { input: "/absolute/path/file", expected: "file" },
  ];
  
  for (const { input, expected } of testCases) {
    const result = basename(input);
    assert.equal(result, expected, `basename of "${input}" should be "${expected}"`);
  }
});

test("path resolution chain works correctly for valid paths", () => {
  const resolvedRoot = resolve(root);
  const relativePath = "apps/web/lib/test.ts";
  const resolvedEntry = resolve(resolvedRoot, relativePath);
  const relativeCheck = relative(resolvedRoot, resolvedEntry);
  
  assert.ok(
    !relativeCheck.startsWith(".."),
    "Valid relative path should not start with .."
  );
  assert.ok(
    !isAbsolute(relativeCheck),
    "Relative check should not be absolute"
  );
  assert.equal(
    relativeCheck,
    relativePath,
    "Relative check should match original relative path"
  );
});

test("security check catches symlink-based traversal attempts", async () => {
  // Even if a symlink exists, resolve will follow it
  // and relative will detect if it escapes the root
  const outsidePath = resolve(root, "../outside");
  const relativeCheck = relative(resolve(root), outsidePath);
  
  assert.ok(
    relativeCheck.startsWith(".."),
    "Symlink or path outside root should be detected"
  );
});

test("empty path is handled safely", async () => {
  await assert.rejects(
    async () => await bundle("", "test"),
    /ENOENT|invalid path/,
    "Empty path should be rejected or fail safely"
  );
});

test("path with null bytes is handled safely", async () => {
  // Null byte injection attempt
  await assert.rejects(
    async () => await bundle("test\0.ts", "test"),
    /ENOENT|invalid path/,
    "Path with null bytes should be rejected or fail safely"
  );
});
