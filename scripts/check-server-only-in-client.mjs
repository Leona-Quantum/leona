#!/usr/bin/env node
// No server-only dependency reaches a browser-served chunk.
//
// ## Why this exists
//
// `apps/web/lib/sanitize-math.ts` imports `isomorphic-dompurify`, which resolves
// to jsdom on the server and to plain DOMPurify in a browser. That split is the
// whole reason the package exists, and it does the right thing today — measured on
// a real build: jsdom appears in NO client chunk, DOMPurify in exactly one.
//
// But `MathText` is imported by `map-card-panel.tsx`, a client component, so the
// sanitizer IS in the client dependency graph, and nothing was checking that the
// browser condition keeps resolving. Raised by Aikido on PR 690: the finding did
// not reproduce, but the risk class is real — a bundler upgrade, a
// `next.config.ts` change, or an import of `dompurify/dist/purify.cjs` would pull
// jsdom into the browser bundle.
//
// **The failure is silent in the direction that matters.** The build still
// succeeds and the page still renders. What changes is that every visitor
// downloads a Node DOM implementation, and hydration can break in ways that read
// as an unrelated React error. A one-off verification does not survive the next
// dependency bump. This does.
//
// ## What it does NOT claim
//
// A string scan over emitted chunks, not module-graph analysis. It proves a marker
// is absent from browser-served output — exactly the property that would break —
// and cannot prove a package is absent from the graph if every identifying string
// were tree-shaken out of it.
//
// Usage: node scripts/check-server-only-in-client.mjs --dist apps/web/.next
//        node scripts/check-server-only-in-client.mjs --self-test

import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Markers that must never appear in a browser-served chunk, with why.
 *
 * A marker is a string the package cannot plausibly ship without — not the
 * specifier as written in an import, because bundlers rewrite those and matching
 * them would be a check that passes by looking at the wrong text.
 */
const FORBIDDEN = [
  {
    marker: "jsdom",
    why:
      "jsdom is a Node DOM implementation reached through isomorphic-dompurify. In a " +
      "browser chunk it means the server export condition resolved for the client " +
      "build: megabytes shipped to every visitor, and hydration can break. See " +
      "apps/web/lib/sanitize-math.ts.",
  },
];

/** What a browser actually downloads. Server chunks are not this check's business. */
const CLIENT_DIRS = [join("static", "chunks"), join("static", "css")];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    if (error?.code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|css)$/.test(entry)) out.push(full);
  }
  return out;
}

export function scan(dist) {
  const files = CLIENT_DIRS.flatMap((sub) => walk(join(dist, sub)));
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const { marker, why } of FORBIDDEN) {
      if (text.includes(marker)) hits.push({ file, marker, why });
    }
  }
  return { files, hits };
}

function fail(message) {
  console.error(`✖ self-test: ${message}`);
  process.exit(1);
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "server-only-check-"));
  try {
    const chunks = join(dir, "static", "chunks");
    mkdirSync(chunks, { recursive: true });

    // A clean bundle must pass, and the scanner must actually have read it.
    writeFileSync(join(chunks, "clean.js"), "export const a=1;// DOMPurify is fine here\n");
    let result = scan(dir);
    if (result.hits.length !== 0) fail("a clean bundle was reported as dirty");
    if (result.files.length !== 1) fail(`expected to read 1 file, read ${result.files.length}`);

    // A planted marker must be caught. Without this half, a scanner that reads
    // nothing reports a clean bundle — which is how a gate becomes decoration.
    writeFileSync(join(chunks, "dirty.js"), 'import x from "jsdom";\n');
    result = scan(dir);
    if (result.hits.length !== 1 || result.hits[0].marker !== "jsdom") {
      fail("a planted jsdom marker was NOT caught");
    }

    // And a marker in SERVER output must be ignored — server chunks legitimately
    // contain jsdom, so a check that flagged them would be deleted within a week.
    rmSync(join(chunks, "dirty.js"));
    mkdirSync(join(dir, "server"), { recursive: true });
    writeFileSync(join(dir, "server", "app.js"), 'require("jsdom");\n');
    result = scan(dir);
    if (result.hits.length !== 0) fail("a server chunk was wrongly reported; only client output counts");

    console.log("check-server-only-in-client: self-test passed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const at = argv.indexOf("--dist");
const dist = resolve(ROOT, at >= 0 && argv[at + 1] ? argv[at + 1] : join("apps", "web", ".next"));
const { files, hits } = scan(dist);

if (files.length === 0) {
  console.error(`✖ no browser-served files found under ${dist}`);
  console.error("  Run `pnpm --filter @majorana/web build` first — a scan of nothing is not a pass.");
  process.exit(1);
}

if (hits.length > 0) {
  console.error(`✖ server-only code reached ${hits.length} browser-served file(s):`);
  for (const { file, marker, why } of hits) {
    console.error(`  ${file}`);
    console.error(`    marker: ${marker}`);
    console.error(`    ${why}`);
  }
  process.exit(1);
}

console.log(`check-server-only-in-client: clean (${files.length} browser-served files scanned)`);
