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

// ---------------------------------------------------------------------------
// The second half of this gate: a token that **resolves** but is the wrong kind
// of value for the slot it is used in.
//
// `--border-hairline` is `1px`. `--border-0` is the hairline *colour*. Twenty-one
// declarations in `styles.css` read `border: 1px solid var(--border-hairline)`,
// which puts a length where a colour goes — and CSS treats that exactly like an
// undefined property: the whole declaration is invalid at computed-value time and
// the browser drops it. Measured on the rendered page before this gate existed,
// `.mj-layers-repeat` computed `border-width: 0px`, so a badge written as a chip
// had been drawing as bare text for as long as it had existed. Eighteen selectors
// across the repository, papers, share and strand surfaces were in the same state.
//
// The first half of this file catches a name that does not resolve. This half
// catches a name that resolves to the wrong *type*, which renders identically —
// nothing — and is invisible in a diff because the line reads perfectly.
//
// Deliberately narrow. Only two positions are checked, and both are unambiguous:
// anywhere inside `color-mix()`, whose arguments are all colours, and the term
// after a border/outline style keyword, where only a colour may appear.
const LENGTH_VALUE_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|ch|vh|vw|%)$/;
// A colour slot: the term after a border/outline style keyword, and **every**
// argument of a `color-mix()`.
//
// The mix is matched as a whole call and then swept for references, rather than
// with one expression that reaches from `color-mix(` to a `var(`. That first
// version passed this file's own fixture: a lazy match stops at the *first*
// `var()` inside the call, so `color-mix(in srgb, var(--accent) 45%, var(--sp-2))`
// was checked on `--accent` and the second argument — the one that was wrong
// three times in this repository — was never looked at.
const STYLE_KEYWORD_RE =
  /(?:solid|dashed|dotted|double|groove|ridge|inset|outset)\s+var\(\s*(--[\w-]+)\s*\)/g;
const COLOUR_MIX_RE = /color-mix\([^;{}]*\)/g;

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

// Which tokens hold a bare length. Read off the declarations themselves rather
// than off a hand-kept list, so a token added as `--sp-9: 40px` is covered the
// day it is written — a list somebody has to remember to extend is silent
// exactly when it is wrong. A token whose value is itself a `var()` or a
// calculation is left unclassified: this gate only reports what it can prove.
const LENGTH_TOKENS = new Set();
for (const text of sources.values()) {
  for (const [, name, value] of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    const trimmed = value.split("/*")[0].trim();
    if (LENGTH_VALUE_RE.test(trimmed)) LENGTH_TOKENS.add(name);
  }
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

const miscast = [];
for (const [file, text] of sources) {
  const rel = relative(repoRoot, file).replaceAll("\\", "/");
  for (const [lineNo, line] of text.split("\n").entries()) {
    const named = [];
    for (const [, name] of line.matchAll(STYLE_KEYWORD_RE)) named.push(name);
    for (const [mix] of line.matchAll(COLOUR_MIX_RE)) {
      for (const [, name] of mix.matchAll(REFERENCE_RE)) named.push(name);
    }
    for (const name of named) {
      if (LENGTH_TOKENS.has(name)) miscast.push(`${rel}:${lineNo + 1}: ${name} is a length`);
    }
  }
}

if (miscast.length > 0) {
  console.error(
    "A length token is being used where a colour must go. CSS drops the whole\n" +
      "declaration, so the border or the mix silently does not draw at all:",
  );
  for (const failure of miscast) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(
  `check-token-vars: OK (${defined.size} tokens defined, all references resolve; ` +
    `${LENGTH_TOKENS.size} length tokens, none in a colour slot)`,
);
