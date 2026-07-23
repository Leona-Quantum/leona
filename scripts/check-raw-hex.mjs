#!/usr/bin/env node
// Style gate (plans/roadmap/04-ui-specifications.md §5.1): raw hex colors are allowed
// ONLY in packages/ts/ui/tokens.css. Everything else must use token variables.
// Scans UI surfaces (apps/web, packages/ts/ui) for hex colors in source/styles.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = ["apps/web", "packages/ts/ui"];
const ALLOWED = new Set(["packages/ts/ui/tokens.css"]);
const EXTENSIONS = new Set([".css", ".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", ".vercel", "dist"]);
// Build output under an alternate NEXT_DIST_DIR (a second local dev server).
const SKIP_DIR_PREFIX = ".next-";
// 3/4/6/8-digit CSS hex colors; word boundary keeps ids/hashes out.
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

const failures = [];
for (const root of SCAN_ROOTS) {
  // Fail closed: a missing scan root (typo, rename, partial checkout) must not
  // silently pass as "nothing to scan".
  if (!statSync(join(repoRoot, root), { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`check-raw-hex: scan root missing: ${root}`);
    process.exit(1);
  }
  walk(join(repoRoot, root));
}

function walk(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    // posix separators so ALLOWED matches on Windows too
    const rel = relative(repoRoot, full).replaceAll("\\", "/");
    const stats = statSync(full, { throwIfNoEntry: false });
    if (!stats) continue;
    if (stats.isDirectory()) {
      if (!SKIP_DIRS.has(entry) && !entry.startsWith(SKIP_DIR_PREFIX)) walk(full);
    } else if (EXTENSIONS.has(entry.slice(entry.lastIndexOf("."))) && !ALLOWED.has(rel)) {
      const text = readFileSync(full, "utf8");
      for (const [lineNo, line] of text.split("\n").entries()) {
        const match = line.match(HEX_RE);
        if (match) failures.push(`${rel}:${lineNo + 1}: ${match.join(", ")}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Raw hex colors outside packages/ts/ui/tokens.css (use token variables):");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("check-raw-hex: OK (no raw hex outside tokens.css)");
