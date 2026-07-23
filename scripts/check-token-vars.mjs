#!/usr/bin/env node
// Style gate: every `var(--token)` referenced by a UI surface must actually be
// defined somewhere. An undefined custom property makes the whole declaration
// invalid at computed-value time, so the browser silently drops it — the element
// just inherits and nobody notices. This shipped: `--fs-11` (15 sites) and
// `--fs-24` (1 site) were referenced for months but never existed in tokens.css,
// so those font-sizes never applied. Cheap to check, invisible to catch by eye.
//
// A reference with a fallback — var(--x, 12px) — is deliberate and allowed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = ["apps/web", "packages/ts/ui"];
const EXTENSIONS = new Set([".css", ".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", ".vercel", "dist"]);
// Build output under an alternate NEXT_DIST_DIR (a second local dev server).
// Same generated code as `.next`, so scanning it reports Next's own devtools
// bundle as if it were our source.
const SKIP_DIR_PREFIX = ".next-";

// next/font generates these at build time and injects them via the `variable`
// className, so no source file declares them. Keep in sync with app/layout.tsx.
const EXTERNALLY_DEFINED = new Set([
  "--font-instrument-sans",
  "--font-instrument-serif",
  "--font-jbmono",
]);

// `var(--name)` with no comma before the closing paren = no fallback.
const REFERENCE_RE = /var\(\s*(--[\w-]+)\s*\)/g;
// `--name:` in a declaration, or "--name": in a JS/TSX style object.
const DEFINITION_RE = /(?:^|[;{\s"'])(--[\w-]+)\s*"?\s*:/gm;

const files = [];
for (const root of SCAN_ROOTS) {
  // Fail closed: a missing scan root must not pass as "nothing to scan".
  if (!statSync(join(repoRoot, root), { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`check-token-vars: scan root missing: ${root}`);
    process.exit(1);
  }
  walk(join(repoRoot, root));
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full, { throwIfNoEntry: false });
    if (!stats) continue;
    if (stats.isDirectory()) {
      if (!SKIP_DIRS.has(entry) && !entry.startsWith(SKIP_DIR_PREFIX)) walk(full);
    } else if (EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
      files.push(full);
    }
  }
}

// Definitions are collected across every scanned file, not just tokens.css: a
// component may legitimately define a local custom property for its own subtree.
const defined = new Set();
const sources = new Map();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  sources.set(file, text);
  for (const [, name] of text.matchAll(DEFINITION_RE)) defined.add(name);
}

const failures = [];
for (const [file, text] of sources) {
  const rel = relative(repoRoot, file).replaceAll("\\", "/");
  for (const [lineNo, line] of text.split("\n").entries()) {
    for (const [, name] of line.matchAll(REFERENCE_RE)) {
      if (!defined.has(name) && !EXTERNALLY_DEFINED.has(name)) {
        failures.push(`${rel}:${lineNo + 1}: ${name}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Undefined CSS custom properties (define in tokens.css, or give var() a fallback):");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`check-token-vars: OK (${defined.size} tokens defined, all references resolve)`);
