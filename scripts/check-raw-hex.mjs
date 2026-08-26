#!/usr/bin/env node
// Style gate (docs/ui/tokens.md): raw hex colors are allowed
// ONLY in packages/ts/ui/tokens.css. Everything else must use token variables.
// Scans UI surfaces (apps/web, packages/ts/ui) for hex colors in source/styles.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = ["apps/web", "packages/ts/ui"];
const ALLOWED = new Set([
  "packages/ts/ui/tokens.css",
  // The Open Graph card. `next/og` renders through Satori, which resolves no
  // CSS custom properties and loads no stylesheet — it takes a small inline
  // style subset only — so `var(--bg-0)` there produces a transparent box
  // rather than a colour. The literals are therefore structural, not a
  // shortcut, which is the same reason `app/icon.svg` carries them (that file
  // is exempt only because .svg is not a scanned extension).
  //
  // The exemption does not mean unchecked: `apps/web/lib/opengraph-tokens.test.ts`
  // parses the dark theme out of tokens.css and asserts every literal in this
  // file still matches it, so a palette change fails there instead of silently
  // shipping an off-brand card.
  "apps/web/app/opengraph-image.tsx",
  // The stylesheet for the in-segment 404 (ai-ops issue 188). Same shape of
  // exemption as the card above, and for the same kind of reason: the page it
  // styles is rendered by Next into a synthesised `<html id="__next_error__">`
  // whose `<head>` is empty, so the compiled `globals.css` — and therefore
  // `tokens.css`, and therefore every `--bg-0` this gate exists to enforce — is
  // not loaded. `var(--bg-0)` there resolves to nothing, not to a colour.
  //
  // Checked instead by `apps/web/lib/not-found-standalone-tokens.test.ts`, which
  // parses BOTH themes out of tokens.css and asserts every literal below still
  // agrees with it. The exemption buys the file the right to spell the colour;
  // it does not buy it the right to disagree about which colour.
  "apps/web/public/not-found.css",
]);
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
