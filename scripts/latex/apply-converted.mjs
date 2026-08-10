#!/usr/bin/env node
// Apply verified LaTeX conversions to layer-graph.ts, line by line, refusing to
// touch a line whose current value is not the one that was verified against.
//
//   node scripts/latex/apply-converted.mjs <field,fieldJa> original.json converted.json [more.json ...]
//
// The method this script is one third of (with CONVERSION-RULES.md and
// roundtrip.mjs, both beside it) is the one proven on `cost` (session 117),
// `conditions` (session 118) and `summary` (session 119): dump the field at
// HEAD with `git show` — never from the working tree — classify, convert in
// batches, round-trip every changed value character-for-character with
// roundtrip.mjs, then apply here. Matching is on CONTENT, never on position,
// so a corpus that moved under the conversion refuses loudly instead of
// writing a verified value onto the wrong line.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const GRAPH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "apps/web/lib/repository/layer-graph.ts",
);

const fields = process.argv[2]?.split(",") ?? [];
if (fields.length === 0 || !process.argv[3] || !process.argv[4]) {
  console.error("usage: apply-converted.mjs <field,fieldJa> original.json converted.json [...]");
  process.exit(2);
}
const original = JSON.parse(readFileSync(process.argv[3], "utf8"));
const converted = {};
for (const path of process.argv.slice(4)) {
  Object.assign(converted, JSON.parse(readFileSync(path, "utf8")));
}

// original value -> converted value, keyed by the exact string, so a line is
// matched on its content and never on its position.
const byValue = new Map();
for (const [id, values] of Object.entries(converted)) {
  for (const [field, value] of Object.entries(values)) {
    if (!fields.includes(field)) continue;
    const before = original[id]?.[field];
    if (typeof before !== "string") throw new Error(`${id}.${field}: no original`);
    if (before === value) continue; // no mathematics: left alone on purpose
    byValue.set(before, value);
  }
}

const fieldPattern = new RegExp(`^(\\s*)(${fields.join("|")}): (".*"),$`, "u");
const lines = readFileSync(GRAPH, "utf8").split("\n");
let applied = 0;
const out = lines.map((line) => {
  const match = fieldPattern.exec(line);
  if (!match) return line;
  const [, indent, field, literal] = match;
  let current;
  try {
    current = JSON.parse(literal);
  } catch {
    return line;
  }
  const next = byValue.get(current);
  if (next === undefined) return line;
  applied += 1;
  return `${indent}${field}: ${JSON.stringify(next)},`;
});

writeFileSync(GRAPH, out.join("\n"));
console.log(`applied ${applied} of ${byValue.size} conversions`);
if (applied !== byValue.size) {
  console.error("✖ some conversions did not find their line — nothing was skipped silently");
  process.exit(1);
}
