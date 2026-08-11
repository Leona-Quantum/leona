#!/usr/bin/env node
// Pins the Quantum Algorithm Zoo's entry list to scripts/zoo-parity/zoo-index.json.
//
// ## Why a pinned snapshot rather than a live fetch
//
// `check-zoo-parity.mjs` runs in lint, and a checker that reaches the network is a
// checker that fails when a third-party site is slow. It is also a checker whose
// denominator moves without a commit: the Zoo is edited, an entry appears, and the
// parity number changes with nobody having decided anything. Pinning makes the
// denominator a reviewable diff — "the Zoo added Double-bracket quantum algorithms"
// shows up in a PR, not in a number that quietly got worse.
//
// This is the same argument ./check-paper-register.mjs's register makes for being
// authored rather than regenerated, one step weaker: here the upstream really is
// the authority, so a regenerate step is right — but the regeneration is a human
// action with a diff, not something a check does behind your back.
//
// Run: node scripts/generate-zoo-index.mjs
//   --url <u>   override the source (default https://quantumalgorithmzoo.org/)
//   --stdout    print the JSON instead of writing it
//
// The parse is deliberately structural (the page's own `<b>Algorithm:</b>` blocks
// and `<dt id=...>` reference list), so a layout change fails loudly rather than
// silently returning fewer entries: the script refuses to write a snapshot with
// fewer than MIN_ENTRIES entries or zero references.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "scripts/zoo-parity/zoo-index.json");
const MIN_ENTRIES = 40;

const args = process.argv.slice(2);
const argValue = (flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? null : args[at + 1];
};
const SOURCE = argValue("--url") ?? "https://quantumalgorithmzoo.org/";

const strip = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const response = await fetch(SOURCE);
if (!response.ok) {
  console.error(`✖ ${SOURCE} returned HTTP ${response.status}`);
  process.exit(1);
}
const html = await response.text();

const sections = [...html.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/gs)].map((match) => ({
  at: match.index ?? 0,
  id: match[1],
  title: strip(match[2]),
}));
const sectionAt = (position) => {
  let current = null;
  for (const section of sections) {
    if (section.at <= position) current = section;
    else break;
  }
  return current;
};

const references = new Map();
for (const match of html.matchAll(/<dt id="([^"]+)">(\d+)<\/dt>\s*<dd>(.*?)<\/dd>/gs)) {
  const urls = [...match[3].matchAll(/href="([^"]+)"/g)].map((href) => href[1]);
  references.set(match[1], {
    number: Number(match[2]),
    text: strip(match[3]).slice(0, 400),
    links: urls.filter((url) => url.includes("arxiv.org") || url.includes("doi.org")).slice(0, 3),
  });
}

const entries = [];
for (const match of html.matchAll(/<b>Algorithm:<\/b>(.*?)(?=<b>Algorithm:<\/b>|<h2 )/gs)) {
  const block = match[1];
  const name = strip((block.match(/^(.*?)<br>/s) ?? [])[1] ?? "");
  const speedup = strip((block.match(/<b>Speedup:<\/b>(.*?)<br>/s) ?? [])[1] ?? "");
  const description = (block.match(/<b>Description:<\/b>(.*)/s) ?? [])[1] ?? "";
  const refKeys = [...new Set([...description.matchAll(/href="#([^"]+)"/g)].map((r) => r[1]))];
  const section = sectionAt(match.index ?? 0);
  entries.push({
    name,
    section: section?.title ?? null,
    sectionId: section?.id ?? null,
    speedup,
    refs: refKeys.slice(0, 8).map((key) => ({ key, ...(references.get(key) ?? {}) })),
  });
}

if (entries.length < MIN_ENTRIES || references.size === 0) {
  console.error(
    `✖ parsed ${entries.length} entries and ${references.size} references from ${SOURCE} —`
    + ` below the floor (${MIN_ENTRIES} entries, 1 reference). The page's markup probably changed;`
    + " fix the parse rather than lowering the floor, or the parity denominator silently shrinks.",
  );
  process.exit(1);
}

const snapshot = {
  source: SOURCE,
  fetchedAt: new Date().toISOString().slice(0, 10),
  pageBytes: html.length,
  entryCount: entries.length,
  referenceCount: references.size,
  sections: sections.slice(0, 6).map((section) => section.title),
  entries,
};

if (args.includes("--stdout")) {
  console.log(JSON.stringify(snapshot, null, 1));
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`✓ wrote ${OUT} — ${entries.length} entries, ${references.size} references`);
}
