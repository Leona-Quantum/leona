#!/usr/bin/env node
// The Classiq gauge: how much of the Classiq library's published work this
// repository carries the algorithms for.
//
// The sibling of ./check-zoo-parity.mjs, and the second half of the owner's
// "at least everything the Quantum Algorithm Zoo and the Classiq library have,
// where they apply". Read that file's header for the two rules both obey:
//
//   * the coverage NUMBER never fails the build — a gauge that gates gets greened
//     the cheapest way, and here the cheapest way is declaring the remainder
//     not-applicable;
//   * a BROKEN DECLARATION always fails — a slug not in the corpus, or an index
//     path that no longer exists upstream. Those are how a hand-written list rots
//     silently, and neither has an honest reading.
//
// What differs is the denominator's meaning. Classiq publishes *demonstrations*,
// not algorithm entries, so "covered" is `this catalog carries the algorithm this
// demo demonstrates` — see the header of apps/web/lib/repository/classiq-coverage.ts,
// which is where that judgement is written down and where each mapping is argued.
//
// First reading, pinned commit ac61dccb: **26 of 103**, and the split is the
// finding rather than the total — 24 of 42 under `algorithms/`, 2 of 61 under
// `applications/`. This catalog is deep on algorithms and near-empty on applied
// work: finance, logistics, chemistry at scale, CFD, telecom, cybersecurity.
// Reading the totals alone would say "a quarter covered"; reading the split says
// the repository has one half of this library and essentially none of the other.
//
// Usage: node scripts/check-classiq-parity.mjs [--json] [--quiet] [--missing]
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

const AS_JSON = process.argv.includes("--json");
const QUIET = process.argv.includes("--quiet");
const SHOW_MISSING = process.argv.includes("--missing");

async function bundle(relativePath, label) {
  const outDir = mkdtempSync(join(tmpdir(), "classiq-parity-"));
  const outFile = join(outDir, `${label}.mjs`);
  try {
    await esbuild.build({
      entryPoints: [join(root, relativePath)],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: outFile,
      logLevel: "silent",
    });
  } catch (error) {
    console.error(`✖ failed to bundle ${relativePath}:`, error.message);
    process.exit(1);
  }
  const mod = await import(pathToFileURL(outFile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const index = JSON.parse(readFileSync(join(root, "scripts/classiq-parity/classiq-index.json"), "utf8"));
const corpusMod = await bundle("apps/web/lib/public-repository.ts", "public-repository");
const coverageMod = await bundle("apps/web/lib/repository/classiq-coverage.ts", "classiq-coverage");

const { PUBLIC_REPOSITORY_ENTRIES } = corpusMod;
const { CLASSIQ_COVERAGE, CLASSIQ_NOT_APPLICABLE } = coverageMod;

const corpusSlugs = new Set(PUBLIC_REPOSITORY_ENTRIES.map((entry) => entry.slug));
const indexPaths = new Set(index.entries.map((entry) => entry.path));

const errors = [];
for (const [path, slugs] of Object.entries(CLASSIQ_COVERAGE)) {
  if (!indexPaths.has(path)) {
    errors.push(
      `coverage declares "${path}" (${slugs.join(", ")}), but the pinned index has no such`
      + " publication directory — the library moved or renamed it. Refresh the index with"
      + " `node scripts/generate-classiq-index.mjs` and re-point the declaration.",
    );
  }
  for (const slug of slugs) {
    if (!corpusSlugs.has(slug)) {
      errors.push(`coverage of "${path}" names slug "${slug}", which is not in the corpus`);
    }
  }
}
for (const path of Object.keys(CLASSIQ_NOT_APPLICABLE)) {
  if (!indexPaths.has(path)) {
    errors.push(`notApplicable declares "${path}", which is not in the pinned index`);
  }
  if (Object.hasOwn(CLASSIQ_COVERAGE, path)) {
    errors.push(`"${path}" is declared both covered and not-applicable — pick one`);
  }
}

const rows = index.entries.map((entry) => ({
  path: entry.path,
  category: entry.category,
  group: entry.group,
  slugs: CLASSIQ_COVERAGE[entry.path] ?? [],
  notApplicable: Object.hasOwn(CLASSIQ_NOT_APPLICABLE, entry.path),
}));
const covered = rows.filter((row) => row.slugs.length > 0);
const notApplicable = rows.filter((row) => row.notApplicable && row.slugs.length === 0);
const missing = rows.filter((row) => row.slugs.length === 0 && !row.notApplicable);

const byCategory = {};
for (const row of rows) {
  byCategory[row.category] ??= { total: 0, covered: 0 };
  byCategory[row.category].total += 1;
  if (row.slugs.length > 0) byCategory[row.category].covered += 1;
}

const report = {
  source: index.source,
  commit: index.commit,
  indexFetchedAt: index.fetchedAt,
  classiqEntries: rows.length,
  covered: covered.length,
  notApplicable: notApplicable.length,
  missing: missing.length,
  byCategory,
  missingPaths: missing.map((row) => row.path),
  errors,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 1));
} else if (!QUIET || errors.length > 0) {
  console.log(
    `Classiq parity: ${covered.length}/${rows.length} covered`
    + `${notApplicable.length > 0 ? `, ${notApplicable.length} declared not-applicable` : ""}`
    + `, ${missing.length} missing  (index at ${String(index.commit).slice(0, 8)},`
    + ` fetched ${index.fetchedAt})`,
  );
  if (!QUIET) {
    for (const [category, counts] of Object.entries(byCategory)) {
      console.log(`  ${counts.covered}/${counts.total}  ${category}`);
    }
  }
  if (SHOW_MISSING) {
    for (const row of missing) console.log(`  missing: ${row.path}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`✖ ${error}`);
  process.exit(1);
}
