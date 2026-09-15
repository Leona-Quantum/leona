#!/usr/bin/env node
// Pins how many published records carry one of the three stock placeholder
// diagrams (apps/web/lib/repository/placeholder-diagrams.ts), so a batch that
// adds or removes one silently is caught here instead of by a reader noticing
// a generic "encode / transform / measure" circuit on their record.
//
// 177 = 90 (Zoo parity + Classiq parity) + 50 (operator concepts) + 37 (VQE
// methods), read off the three batches directly (see the doc comment on
// `isPlaceholderDiagram`). Bundled with esbuild rather than imported, for the
// same reason as `check-width-families.mjs`: the corpus barrel reaches its
// entry modules with extensionless specifiers, and only esbuild's resolver —
// not `node --test`'s — follows those.
//
// Usage: node scripts/check-placeholder-diagram-census.mjs [--quiet]

import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");
const QUIET = process.argv.includes("--quiet");

const EXPECTED = 177;

const out = mkdtempSync(join(tmpdir(), "placeholder-census-"));
let corpusMod;
let placeholderMod;
try {
  for (const [name, entry] of [
    ["corpus.mjs", "apps/web/lib/public-repository.ts"],
    ["placeholder-diagrams.mjs", "apps/web/lib/repository/placeholder-diagrams.ts"],
  ]) {
    await esbuild.build({
      entryPoints: [join(root, entry)],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: join(out, name),
      logLevel: "silent",
    });
  }
  corpusMod = await import(pathToFileURL(join(out, "corpus.mjs")).href);
  placeholderMod = await import(pathToFileURL(join(out, "placeholder-diagrams.mjs")).href);
} catch (error) {
  rmSync(out, { recursive: true, force: true });
  console.error(`✖ failed to bundle the derivation: ${error.message}`);
  process.exit(1);
} finally {
  rmSync(out, { recursive: true, force: true });
}

const entries = corpusMod.PUBLIC_REPOSITORY_ENTRIES;
if (!Array.isArray(entries) || entries.length === 0) {
  console.error("✖ PUBLIC_REPOSITORY_ENTRIES did not bundle to a non-empty array");
  process.exit(1);
}

const matches = entries.filter((entry) => placeholderMod.isPlaceholderDiagram(entry.visualization));
const bySlug = matches.map((entry) => entry.slug).sort();

if (matches.length !== EXPECTED) {
  console.error(
    `✖ check-placeholder-diagram-census: expected ${EXPECTED} records with a placeholder diagram, found ${matches.length}.`,
  );
  console.error("This is not necessarily wrong — a content batch may have added, replaced, or drawn one of");
  console.error("these records for real. Report the actual number and why, and update EXPECTED here on purpose;");
  console.error("do not change isPlaceholderDiagram's matching to force this count back to 177.");
  if (!QUIET) console.error(bySlug.join("\n"));
  process.exit(1);
}

console.log(`check-placeholder-diagram-census: ${matches.length} records match a placeholder diagram (expected ${EXPECTED}). ok`);
