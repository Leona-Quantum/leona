#!/usr/bin/env node
// The width families, checked against the corpus that is actually published
// (R2.6).
//
// **Why this reads the manifest, and why it reads both.** The committed
// TypeScript corpus is the *editing* surface; the serving surface in production
// is the catalog API, whose records come from
// `services/api/catalog_bootstrap/manifest.json` by way of the database
// (`docs/ui/README.md`). The manifest is generated *from* the corpus, so the two
// can drift in exactly one direction that matters here: edit a benchmark family
// in the corpus, skip `generate-catalog-bootstrap-manifest.mjs`, and every
// static-corpus assertion stays green while production keeps serving the old
// grouping. So the census is asserted against the manifest — what visitors
// actually get — and then the corpus is derived a second time and required to
// agree.
//
// Both sources carry all 120 width records. The corpus builds them with a
// template literal (`entries-literature-expansion.ts`: `CIRCUIT_FAMILIES` ×
// `WIDTHS`), so they are invisible to a grep for a quoted slug and easy to
// believe absent — the first draft of this file said they were.
//
// What it pins, all of it falsifiable and none of it derivable from the code
// under test:
//
//   * 15 families, 8 widths each, 120 member records — the measurement R2.6 is
//     sized against.
//   * Zero refusals. A refusal is the derivation declining to call a stem one
//     thing, and it is silent by construction: the browse list simply shows the
//     members separately again, exactly as it did before R2.6. A content batch
//     that changed one member's `status` would quietly restore eight cards.
//   * No orphan `-Nq` slug. A stem published at one width is not a family, and
//     it is also the shape a half-finished batch has.
//   * Every slug's declared width equals its own circuit's `qubitCount`, so the
//     suffix the fold reads is not a naming convention drifting from the
//     circuit it names.
//   * 255 browse rows. The number the roadmap promises, computed the way the
//     page computes it rather than typed in. It was 176 when R2.6 sized it
//     against 281 cards; the parity intake published 12 unfolded records and then
//     6, 6, 8, 8, 19, 4, 6, 6 and 4 more, so the number moved by exactly 79. Deliberately, which is what the error
//     message below asks for: this figure exists to make an *accidental* change
//     in the fold — a member's `status` drifting and eight cards reappearing —
//     visible, and it can only do that if intake changes are entered by hand.

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");
const QUIET = process.argv.includes("--quiet");

const MANIFEST = join(root, "services/api/catalog_bootstrap/manifest.json");

/** The curated clusters the browser folds by hand, mirrored for the row count. */
const CURATED_GROUPS = [
  ["quantum-fourier-transform", "qft-resource-screen"],
  ["quantum-phase-estimation", "iterative-phase-estimation"],
];

const errors = [];

let records;
try {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  records = manifest.items.map((item) =>
    typeof item.source_blob === "string" ? JSON.parse(item.source_blob) : item.source_blob,
  );
} catch (error) {
  console.error(`✖ failed to read ${MANIFEST}: ${error.message}`);
  process.exit(1);
}

// Bundled rather than imported: these are TypeScript modules, and the audit must
// exercise the same derivation the page runs — a second implementation here
// would be a copy that agrees with itself.
const out = mkdtempSync(join(tmpdir(), "width-families-"));
let families;
let interfaceMod;
let corpusMod;
try {
  for (const [name, entry] of [
    ["families.mjs", "apps/web/lib/repository/families.ts"],
    ["interface.mjs", "apps/web/lib/repository/interface.ts"],
    ["corpus.mjs", "apps/web/lib/public-repository.ts"],
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
  families = await import(pathToFileURL(join(out, "families.mjs")).href);
  interfaceMod = await import(pathToFileURL(join(out, "interface.mjs")).href);
  corpusMod = await import(pathToFileURL(join(out, "corpus.mjs")).href);
} catch (error) {
  rmSync(out, { recursive: true, force: true });
  console.error(`✖ failed to bundle the derivation: ${error.message}`);
  process.exit(1);
} finally {
  // In `finally` so a throw between the build and the import does not leave the
  // directory behind — the leak CodeRabbit found on #266, fixed in both copies.
  rmSync(out, { recursive: true, force: true });
}

const stanceOf = (entry) =>
  interfaceMod.deriveInterface({
    slug: entry.slug,
    topics: entry.topics ?? [],
    category: entry.category,
    wireCount: entry.visualization?.wires?.length ?? 0,
    portableCircuit: entry.portableCircuit,
  }).stance;

const { families: derived, refused } = families.deriveWidthFamilies(records, stanceOf);

for (const refusal of refused) {
  errors.push(
    `${refusal.key}: ${refusal.slugs.length} records share a width stem but do not fold ` +
      `(${refusal.reason}). The browse list is showing them as ${refusal.slugs.length} separate ` +
      `cards again. Distinct values:\n      ${refusal.detail.join("\n      ")}`,
  );
}

if (derived.length !== 15) {
  errors.push(
    `${derived.length} width families, expected 15. The corpus publishes 15 benchmark circuits at ` +
      "eight widths each; if that changed on purpose, this number and the roadmap's R2.6 row both " +
      "need rewriting.",
  );
}

const memberSlugs = new Set();
for (const family of derived) {
  for (const member of family.members) memberSlugs.add(member.slug);
  if (family.members.length !== 8) {
    errors.push(
      `${family.key}: ${family.members.length} widths, expected 8 ` +
        `(${family.members.map((member) => member.width).join(", ")})`,
    );
  }
}

if (memberSlugs.size !== 120) {
  errors.push(`${memberSlugs.size} records fold into a family, expected 120`);
}

// An orphan is a stem published at a single width. It is not a family — and it
// is also what a batch looks like when it stopped halfway.
//
// Stems that were *refused* are excluded: they are already reported above, with
// the reason, and calling them orphans would state the opposite of what
// happened — that nothing else publishes the stem, when eight records do.
const refusedStems = new Set(refused.map((refusal) => refusal.key));
for (const record of records) {
  const parsed = families.parseWidthSlug(record.slug);
  if (!parsed || memberSlugs.has(record.slug) || refusedStems.has(parsed.stem)) continue;
  errors.push(
    `${record.slug} declares a width but belongs to no family: nothing else publishes ` +
      `\`${parsed.stem}\` at another width.`,
  );
}

// The suffix the fold reads against the circuit it claims to describe.
//
// A missing count is an error, not a skip. A `-Nq` slug asserts "this is the
// N-qubit member of a family", and a record that publishes no circuit width
// cannot substantiate it — while a `continue` here would let exactly that
// record pass the one check that ties the suffix to the circuit, which is the
// shape where an absent value reads as agreement.
for (const record of records) {
  const parsed = families.parseWidthSlug(record.slug);
  if (!parsed) continue;
  const declared = record.portableCircuit?.qubitCount;
  if (declared === undefined) {
    errors.push(
      `${record.slug}: slug declares ${parsed.width} qubits but the record publishes no ` +
        "circuit width, so nothing ties the suffix the fold reads to a circuit",
    );
  } else if (declared !== parsed.width) {
    errors.push(
      `${record.slug}: slug declares ${parsed.width} qubits, its circuit carries ${declared}`,
    );
  }
}

// The row count, computed the way the page computes it: fold, then count.
const groupIndex = new Map();
for (const family of derived) {
  const group = families.widthFamilyGroup(family, "en");
  for (const slug of group.slugs) groupIndex.set(slug, group);
}
for (const [index, slugs] of CURATED_GROUPS.entries()) {
  const present = slugs.filter((slug) => records.some((record) => record.slug === slug));
  if (present.length !== slugs.length) {
    errors.push(
      `curated group ${index} names ${slugs.length} slugs but the corpus publishes ${present.length}: ` +
        `${slugs.join(", ")}. The browser folds these by hand; a missing member changes the row count.`,
    );
  }
  const group = { key: `curated-${index}`, label: "", labelJa: "", slugs };
  for (const slug of slugs) groupIndex.set(slug, group);
}

const rows = families.foldRows(records, (slug) => groupIndex.get(slug));
// 176 at R2.6 (281 records), then +12, +6, +6, +8, +8, +19, +4, +6, +6 and +4 as
// the Zoo- and Classiq-parity intake batches added records that belong to no
// width family and therefore fold to nothing: 188, 194, 200, 208, 216, 235, 239,
// 245, 251, 255. See the header. The last three are the W22 Zoo-parity pass —
// matrix powers, string rewriting, zeta functions, Gauss sums, exponential
// congruences and subset finding; then semiring matrix products, weight
// enumerators, Viterbi decoding, lattice filtering, double-bracket diagonalization
// and primality proving; then Pell's equation, the principal ideal problem, the
// unit group and the class group. Sixteen literature records in no width family,
// so sixteen new rows.
//
// Note for whoever changes it next: this count is computed from the **manifest**,
// not from the corpus module — so a corpus change that has not regenerated
// `services/api/catalog_bootstrap/manifest.json` yet will report the OLD number
// and look like it did not move the fold at all.
const EXPECTED_BROWSE_ROWS = 255;
if (rows.length !== EXPECTED_BROWSE_ROWS) {
  errors.push(
    `${records.length} records fold to ${rows.length} browse rows, expected ${EXPECTED_BROWSE_ROWS}. `
      + "R2.6 promised 281 cards down to about 176 and each later intake moves it by the number of "
      + "unfolded records it published; if the corpus changed, change this number deliberately.",
  );
}

// The editing surface against the serving surface.
//
// A census, not a diff of the records: the corpus and the manifest legitimately
// differ in shape (the manifest wraps each record in an upstream identity), and
// the only question this asks is whether they still describe the same families.
// A mismatch here means the manifest was not regenerated after a corpus edit —
// production would keep serving the previous grouping with every other check
// green.
const censusOf = (list) =>
  families
    .deriveWidthFamilies(list, stanceOf)
    .families.map((family) => `${family.key}:${family.members.map((m) => m.width).join(",")}`)
    .sort();

const corpusEntries = corpusMod.PUBLIC_REPOSITORY_ENTRIES ?? [];
if (!corpusEntries.length) {
  errors.push(
    "the static corpus exported no entries, so the corpus/manifest cross-check compared nothing",
  );
} else {
  const fromCorpus = censusOf(corpusEntries);
  const fromManifest = censusOf(records);
  const onlyCorpus = fromCorpus.filter((row) => !fromManifest.includes(row));
  const onlyManifest = fromManifest.filter((row) => !fromCorpus.includes(row));
  if (onlyCorpus.length || onlyManifest.length) {
    errors.push(
      "the committed corpus and the published manifest describe different width families — " +
        "regenerate the manifest (scripts/generate-catalog-bootstrap-manifest.mjs).\n" +
        `      corpus only:   ${onlyCorpus.join(" | ") || "(none)"}\n` +
        `      manifest only: ${onlyManifest.join(" | ") || "(none)"}`,
    );
  }
}

if (!QUIET) {
  console.log(`width families: ${derived.length}  ·  member records: ${memberSlugs.size}`);
  for (const family of derived) {
    console.log(
      `  ${family.members.map((member) => member.width).join(",").padEnd(24)} ${family.label}`,
    );
  }
  console.log(`\n${records.length} records → ${rows.length} browse rows`);
}

if (errors.length) {
  console.error(`\n✖ ${errors.length} width-family errors:`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`\n✓ width families valid (${derived.length} families, ${memberSlugs.size} records)`);
