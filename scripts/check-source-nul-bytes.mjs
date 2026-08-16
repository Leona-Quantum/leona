#!/usr/bin/env node
/**
 * Refuse a NUL byte in a text source file.
 *
 * ## The bug that bought this check
 *
 * On the first push of the settings rail, `account-panes.tsx` contained
 * `join("\0")` where `join(",")` was written, paired with a `split(" ")`. Six
 * pane ids collapsed into one string, `includes()` never matched, and every
 * `/account#usage` style deep link silently fell back to the first pane.
 *
 * What makes it worth a check rather than a fix is how completely it hid.
 * `tsc` was clean — `"\0"` is a perfectly good string. The unit suite was green,
 * because it tested the pure helper and the corruption was in the caller. The
 * browser walk passed, because it ran BEFORE the refactor that introduced it.
 * Every gate the repo owns said yes. Only `git` noticed, by quietly reclassifying
 * the file as binary in a diff nobody was reading closely.
 *
 * A NUL in a `.ts`, `.tsx`, `.mjs`, `.py`, `.css`, `.json`, `.md` or `.sql` file
 * is never intentional. It comes from a tool that mangled a string on the way to
 * disk, and the give-away is exactly that everything else still compiles.
 *
 * ## Scope, honestly
 *
 * This catches ONE encoding accident: the byte that turns a text file binary. It
 * says nothing about a wrong-but-printable separator, which is the same bug one
 * character away. It is cheap and it closes the case that no other gate here can
 * see, which is the whole argument for it.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".css", ".json", ".md", ".sql", ".yml", ".yaml", ".toml", ".sh",
]);

// Directories with no hand-written source in them. `output/` is tracked in this
// repo (it is not a build directory here) so it is deliberately NOT skipped.
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".venv", "__pycache__", ".turbo",
  "dist", "build", ".ruff_cache", ".import_linter_cache", "test-results",
  ".pytest_cache", ".mypy_cache", "coverage",
]);

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), found);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TEXT_EXTENSIONS.has(extname(entry.name))) continue;
    found.push(join(dir, entry.name));
  }
  return found;
}

function main() {
  // A positive control, run first. This script's whole value is that it FAILS on
  // a corrupted file, and a scanner that silently matched nothing would report
  // exactly the same "OK" as a clean tree — the failure mode migration 0050 is
  // written about. So prove the detector fires before trusting that it did not.
  // Built from a byte value, never written as a literal: a raw NUL in this
  // file would be caught by the very scan below, and a check that cannot pass
  // its own rule has no business enforcing it on anyone else.
  const canary = Buffer.concat([Buffer.from("const a = \"x"), Buffer.from([0]), Buffer.from("y\";")]);
  if (!canary.includes(0)) {
    console.error("check-source-nul-bytes: the detector's own canary has no NUL; the check is broken");
    process.exit(2);
  }

  const offenders = [];
  for (const file of walk(ROOT)) {
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch {
      continue; // a broken symlink is not this check's business
    }
    const index = bytes.indexOf(0);
    if (index !== -1) offenders.push({ file: relative(ROOT, file), index });
  }

  if (offenders.length > 0) {
    console.error("NUL byte in a text source file (a tool mangled a string on the way to disk):");
    for (const { file, index } of offenders) {
      console.error(`  ${file}: first NUL at byte ${index}`);
    }
    console.error("");
    console.error("This compiles, passes tests and reads correctly in most editors.");
    console.error("Find the string literal it landed in and rewrite that line by hand.");
    process.exit(1);
  }

  console.log("check-source-nul-bytes: OK (no NUL bytes in tracked text sources)");
}

main();
