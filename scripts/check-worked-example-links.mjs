#!/usr/bin/env node
// Validates apps/web/lib/repository/worked-example-links.ts — the verified
// record -> worked-example map (stage 1 of the Atlas worked-example figure;
// stage 2, a sibling branch, adds apps/web/lib/worked-examples.ts and a page
// that draws the linked example).
//
// Bundled with esbuild rather than imported by a `.test.ts`, for the same
// reason as `check-width-families.mjs` and `check-placeholder-diagram-census.mjs`:
// the corpus barrel (`apps/web/lib/public-repository.ts`) reaches its entry
// modules with extensionless specifiers, which only esbuild's resolver follows —
// `node --test`'s native TS loader cannot.
//
// Asserts, over every (slug, link) pair in the map:
//   * the slug names a record that exists in the published corpus;
//   * `evidence` is a non-empty, verbatim substring of `record[field]` — where
//     `field` may be a one-level dotted path (`"verificationDetails.caveat"`),
//     and where the resolved value is a string array (only `tags` today),
//     `evidence` must be a substring of at least one of its elements;
//   * at most 2 links per record;
//   * `relation` is `"instance"` or `"component"`;
//   * no duplicate (slug, exampleId) pair.
//
// `exampleId` existence is checked against `apps/web/lib/worked-examples.ts`'s
// `WORKED_EXAMPLES` export ONLY IF that file exists (it does, as of the Atlas
// worked-example figure lane) — its absence is reported as a skip, not a
// failure, so this script still runs on a branch that predates it. Given the
// file, an exampleId it does not carry is a WARNING, not an error: 14 of the
// 21 examples the map points at are checked in and 7
// (quantum-walk-cycle-4, shor-order-finding-15, amplitude-estimation-3,
// hidden-shift-4, superdense-coding, w-state-3, simon-2) are still being
// written on a sibling lane, so their links are expected to be unresolved
// right now. This becomes a hard error once WORKED_EXAMPLES carries all of
// them — flip the two branches below when that lands.
//
// Usage: node scripts/check-worked-example-links.mjs [--quiet]

import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");
const QUIET = process.argv.includes("--quiet");

const RELATIONS = new Set(["instance", "component"]);
const MAX_LINKS_PER_RECORD = 2;
const WORKED_EXAMPLES_PATH = join(root, "apps/web/lib/worked-examples.ts");

/** Resolve a one-level-dotted field path against a record. */
function resolveField(record, path) {
  const parts = path.split(".");
  let value = record;
  for (const part of parts) {
    if (value === null || typeof value !== "object") return undefined;
    value = value[part];
  }
  return value;
}

/** Whether `evidence` is a non-empty, verbatim substring of the record's named field. */
function evidenceHolds(record, field, evidence) {
  if (typeof evidence !== "string" || evidence.length === 0) return false;
  const value = resolveField(record, field);
  if (typeof value === "string") return value.includes(evidence);
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === "string" && item.includes(evidence));
  }
  return false;
}

async function bundleAndImport(entry, outName, outDir) {
  const outfile = join(outDir, outName);
  await esbuild.build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

const out = mkdtempSync(join(tmpdir(), "worked-example-links-"));
let corpusMod;
let linksMod;
let examplesMod = null;
try {
  corpusMod = await bundleAndImport("apps/web/lib/public-repository.ts", "corpus.mjs", out);
  linksMod = await bundleAndImport("apps/web/lib/repository/worked-example-links.ts", "links.mjs", out);
  if (existsSync(WORKED_EXAMPLES_PATH)) {
    examplesMod = await bundleAndImport("apps/web/lib/worked-examples.ts", "examples.mjs", out);
  }
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
const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));

// The map itself — read off the module's own exported function rather than a
// second, private copy of the data, so this checker validates exactly what
// `workedExampleLinks()` will actually return to a caller.
const rawMap = linksMod.WORKED_EXAMPLE_LINKS;
if (typeof linksMod.workedExampleLinks !== "function") {
  console.error("✖ worked-example-links.ts does not export workedExampleLinks()");
  process.exit(1);
}
if (!rawMap || typeof rawMap !== "object") {
  console.error("✖ worked-example-links.ts does not export a readable WORKED_EXAMPLE_LINKS map");
  process.exit(1);
}

let exampleIds = null;
if (examplesMod) {
  if (!Array.isArray(examplesMod.WORKED_EXAMPLES)) {
    console.error("✖ apps/web/lib/worked-examples.ts exists but does not export a WORKED_EXAMPLES array");
    process.exit(1);
  }
  exampleIds = new Set(examplesMod.WORKED_EXAMPLES.map((example) => example.id));
}

const errors = [];
let totalLinks = 0;
const seenPairs = new Set();
/** exampleId -> number of links waiting on it (not yet in WORKED_EXAMPLES). */
const unresolvedExampleIds = new Map();

for (const [slug, links] of Object.entries(rawMap)) {
  if (!Array.isArray(links)) {
    errors.push(`${slug}: links value is not an array`);
    continue;
  }
  const record = bySlug.get(slug);
  if (!record) {
    errors.push(`${slug}: no such record in the published corpus`);
    continue;
  }
  if (links.length > MAX_LINKS_PER_RECORD) {
    errors.push(`${slug}: ${links.length} links, more than the ${MAX_LINKS_PER_RECORD} allowed`);
  }
  for (const link of links) {
    totalLinks += 1;
    const where = `${slug} -> ${link?.exampleId ?? "<missing exampleId>"}`;

    if (!RELATIONS.has(link?.relation)) {
      errors.push(`${where}: relation must be "instance" or "component", got ${JSON.stringify(link?.relation)}`);
    }

    if (typeof link?.exampleId !== "string" || link.exampleId.length === 0) {
      errors.push(`${where}: exampleId is missing or empty`);
    } else {
      const pairKey = `${slug}::${link.exampleId}`;
      if (seenPairs.has(pairKey)) errors.push(`${where}: duplicate (slug, exampleId) pair`);
      seenPairs.add(pairKey);
      // A WARNING, not an error: the checker distinguishes an id that will
      // never resolve from one whose example just has not landed yet, only by
      // this comment and by re-reading it after WORKED_EXAMPLES grows — there
      // is no third state on the wire. See the module doc comment.
      if (exampleIds && !exampleIds.has(link.exampleId)) {
        unresolvedExampleIds.set(link.exampleId, (unresolvedExampleIds.get(link.exampleId) ?? 0) + 1);
      }
    }

    if (typeof link?.field !== "string" || link.field.length === 0) {
      errors.push(`${where}: field is missing or empty`);
    } else if (!evidenceHolds(record, link.field, link?.evidence)) {
      errors.push(
        `${where}: evidence ${JSON.stringify(link?.evidence)} is not a verbatim substring of ${slug}.${link.field}`,
      );
    }
  }
}

if (!QUIET) {
  console.log(`worked-example links: ${Object.keys(rawMap).length} records, ${totalLinks} links`);
  console.log(
    exampleIds
      ? `exampleId cross-check: enabled (${exampleIds.size} ids in WORKED_EXAMPLES)`
      : "exampleId cross-check: SKIPPED — apps/web/lib/worked-examples.ts does not exist yet (stage 2). " +
          "This becomes a hard check once it lands.",
  );
}

if (unresolvedExampleIds.size > 0) {
  const waitingLinks = [...unresolvedExampleIds.values()].reduce((sum, count) => sum + count, 0);
  console.warn(
    `⚠ ${unresolvedExampleIds.size} exampleId(s) not yet in WORKED_EXAMPLES, ${waitingLinks} link(s) waiting on ` +
      "them (becomes an error once the remaining examples land):",
  );
  for (const [id, count] of [...unresolvedExampleIds.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.warn(`  ${id}: ${count} link(s)`);
  }
}

if (errors.length) {
  console.error(`\n✖ ${errors.length} worked-example-link errors:`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`✓ worked-example links valid (${Object.keys(rawMap).length} records, ${totalLinks} links)`);
