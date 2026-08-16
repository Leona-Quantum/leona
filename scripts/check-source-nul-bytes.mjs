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
 * ## Widened once already, and why
 *
 * The first version rejected only byte 0x00. Aikido's review made the fair point
 * that this same commit left OTHER raw control characters in
 * `apps/web/lib/account-profile.ts`, so the gate could report success on a file
 * that was still unreviewable in exactly the way it was written to prevent.
 *
 * One correction to that finding, since it matters for what the rule should be:
 * only NUL makes git classify a file as binary, so the other control characters
 * do not literally produce a binary diff. The reason to reject them anyway is the
 * one that made the original bug expensive - a control character is INVISIBLE in
 * a diff, an editor and a review, and every one of them has an escape sequence
 * that is not. `\x1f` and `\x7f` read correctly to a human; the raw bytes read
 * as nothing at all.
 *
 * ## Scope, honestly
 *
 * Tab, newline and carriage return are allowed - they are structure, not content.
 * Everything else in C0, DEL, and C1 is rejected, and the fix is always the same:
 * write the escape sequence instead.
 *
 * It still says nothing about a wrong-but-printable separator, which is the same
 * bug one character away and is what actually broke the deep links. This closes
 * the invisible half, which is the half no other gate here can see.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Tab (0x09), newline (0x0a) and carriage return (0x0d) are structure and are
// allowed. Everything else in C0 plus DEL is rejected; C1 (U+0080-U+009F) is
// handled separately below because it is two bytes in UTF-8.
const FORBIDDEN_C0 = new Set([
  ...Array.from({ length: 32 }, (_, i) => i).filter((b) => b !== 0x09 && b !== 0x0a && b !== 0x0d),
  0x7f,
]);

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

/**
 * The detector itself, as one function.
 *
 * Extracted so the canary below can run THIS rather than a paraphrase of it. The
 * first version asserted `canary.includes(0)`, which tested Buffer.includes and
 * nothing else: had the scan loop been broken or deleted, that control would
 * still have passed and the check would still have printed OK. Raised in review,
 * and it is the same failure this script exists to talk about — a control that
 * cannot fail is indistinguishable from one that passed.
 *
 * Returns `null` for a clean buffer, or the position and a human name for the
 * first offending character.
 */
function firstControlCharacter(bytes) {
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (FORBIDDEN_C0.has(byte)) {
      const what = byte === 0 ? "NUL (0x00)" : `control character 0x${byte.toString(16).padStart(2, "0")}`;
      return { index: i, what };
    }
    // C1 controls are `0xC2 0x80`-`0xC2 0x9F` in UTF-8. Checked as a pair rather
    // than by decoding the whole file, so this stays a byte scan.
    if (byte === 0xc2 && i + 1 < bytes.length && bytes[i + 1] >= 0x80 && bytes[i + 1] <= 0x9f) {
      return { index: i, what: `C1 control U+00${bytes[i + 1].toString(16).toUpperCase()}` };
    }
  }
  return null;
}

function main() {
  // A positive control, run first, through the real detector.
  //
  // Both buffers are built from byte values rather than written as literals: a
  // raw control character in this file would be caught by the very scan below,
  // and a check that cannot pass its own rule has no business enforcing it.
  const dirty = Buffer.concat([Buffer.from('const a = "x'), Buffer.from([0]), Buffer.from('y";')]);
  const clean = Buffer.from('const a = "x\ty";\r\n');
  if (firstControlCharacter(dirty) === null) {
    console.error("check-source-nul-bytes: the detector did not fire on a planted control character.");
    console.error("The check is broken and its OK means nothing. Fix this before trusting a clean run.");
    process.exit(2);
  }
  if (firstControlCharacter(clean) !== null) {
    // The other direction. Without it, a detector that flagged EVERYTHING would
    // pass the test above and then fail the whole repository.
    console.error("check-source-nul-bytes: the detector fired on tab/CRLF, which are allowed.");
    process.exit(2);
  }

  const offenders = [];
  for (const file of walk(ROOT)) {
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch (error) {
      // Fail closed. "Could not read it" is not evidence that a file is clean,
      // and skipping silently would let an unreadable file — a broken symlink, a
      // permission problem, a half-written checkout — read as a pass. Raised in
      // review, and it is the same principle as the canary above.
      console.error(`check-source-nul-bytes: cannot read ${relative(ROOT, file)}: ${error.message}`);
      console.error("Refusing to report OK on a tree this check could not fully scan.");
      process.exit(2);
    }
    const hit = firstControlCharacter(bytes);
    if (hit !== null) offenders.push({ file: relative(ROOT, file), ...hit });
  }

  if (offenders.length > 0) {
    console.error("Raw control character in a text source file:");
    for (const { file, index, what } of offenders) {
      console.error(`  ${file}: ${what} at byte ${index}`);
    }
    console.error("");
    console.error("These compile, pass tests, and are INVISIBLE in a diff and in review.");
    console.error("If the character is intended, write its escape sequence instead");
    console.error('(\\x00, \\x1f, \\u009f); if it is not, a tool mangled the string.');
    process.exit(1);
  }

  console.log("check-source-nul-bytes: OK (no raw control characters in tracked text sources)");
}

main();
