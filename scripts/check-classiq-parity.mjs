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
const intakeMod = await bundle("apps/web/lib/repository/entries-classiq-parity.ts", "entries-classiq-parity");

const { PUBLIC_REPOSITORY_ENTRIES } = corpusMod;
const { CLASSIQ_COVERAGE, CLASSIQ_COVERAGE_BASIS, CLASSIQ_NOT_APPLICABLE } = coverageMod;
const { CLASSIQ_PARITY_COVERAGE } = intakeMod;

// The strengths a declaration can have, in the order they are printed. Kept in
// step with `ClassiqClaimBasis` in apps/web/lib/repository/classiq-coverage.ts —
// a value there that is missing here would be silently dropped from the split,
// so the loop below refuses one it does not recognise rather than ignoring it.
const BASIS_ORDER = [
  "same-subject",
  "source-formulates-problem",
  "method-instance",
  "not-re-derived",
];

// Half derived, half declared — the same split as the Zoo gauge, and for the same
// reason: a record written for a Classiq entry states which entry from its own data
// and cannot drift, while the pre-existing records need a hand-written map, and
// that hand-written half is what the error checks below are guarding.
const coverage = new Map();
const claim = (path, slug, origin) => {
  if (!coverage.has(path)) coverage.set(path, []);
  coverage.get(path).push({ slug, origin });
};
for (const { classiqPath, slug } of CLASSIQ_PARITY_COVERAGE) claim(classiqPath, slug, "intake");
for (const [path, slugs] of Object.entries(CLASSIQ_COVERAGE)) {
  for (const slug of slugs) claim(path, slug, "declared");
}

const corpusSlugs = new Set(PUBLIC_REPOSITORY_ENTRIES.map((entry) => entry.slug));
const indexPaths = new Set(index.entries.map((entry) => entry.path));

const errors = [];
for (const [path, claims] of coverage) {
  if (!indexPaths.has(path)) {
    errors.push(
      `coverage declares "${path}" (${claims.map((c) => c.slug).join(", ")}), but the pinned index`
      + " has no such publication directory — the library moved or renamed it. Refresh the index"
      + " with `node scripts/generate-classiq-index.mjs` and re-point the declaration.",
    );
  }
  for (const { slug, origin } of claims) {
    if (!corpusSlugs.has(slug)) {
      errors.push(`${origin} coverage of "${path}" names slug "${slug}", which is not in the corpus`);
    }
  }
}
// A declaration says *that* a record covers a demonstration; it cannot say on
// what evidence. `CLASSIQ_COVERAGE_BASIS` says that, and this is what stops it
// rotting: a new declaration with no basis fails here rather than quietly joining
// the strong ones. The count never moves — every declared path is covered either
// way — so this gate has nothing to gain by being greened.
const basisCounts = new Map(BASIS_ORDER.map((basis) => [basis, 0]));
for (const path of Object.keys(CLASSIQ_COVERAGE)) {
  const basis = CLASSIQ_COVERAGE_BASIS[path];
  if (basis === undefined) {
    errors.push(
      `coverage declares "${path}" with no entry in CLASSIQ_COVERAGE_BASIS. Every declaration has to`
      + " say what kind of claim it is — whether a source read for the covering record formulates"
      + " this demonstration's problem, or whether the demonstration merely runs the method that"
      + " record documents. Add it to CLASSIQ_COVERAGE_BASIS in"
      + " apps/web/lib/repository/classiq-coverage.ts.",
    );
    continue;
  }
  if (!basisCounts.has(basis)) {
    errors.push(
      `"${path}" declares basis "${basis}", which is not one of ${BASIS_ORDER.join(", ")}.`
      + " Adding a value to ClassiqClaimBasis means adding it to BASIS_ORDER in this script too,"
      + " or it drops out of the printed split.",
    );
    continue;
  }
  basisCounts.set(basis, basisCounts.get(basis) + 1);
}
for (const path of Object.keys(CLASSIQ_COVERAGE_BASIS)) {
  if (!Object.hasOwn(CLASSIQ_COVERAGE, path)) {
    errors.push(`CLASSIQ_COVERAGE_BASIS names "${path}", which is not a declared coverage path`);
  }
}

// A decline is the one declaration that makes this gauge look better, so it is the
// one that has to name someone outside this repository. Without the ruling the
// cheapest way to close the remaining gap is to write a sentence.
for (const [path, decline] of Object.entries(CLASSIQ_NOT_APPLICABLE)) {
  if (!indexPaths.has(path)) {
    errors.push(`notApplicable declares "${path}", which is not in the pinned index`);
  }
  if (coverage.has(path)) {
    errors.push(`"${path}" is declared both covered and not-applicable — pick one`);
  }
  if (!decline?.reason?.trim()) {
    errors.push(`"${path}" is declined with no reason — a reader cannot disagree with it`);
  }
  if (!/^https?:\/\//.test(decline?.ruling ?? "")) {
    errors.push(
      `"${path}" is declined without a ruling url. A decline removes a row from the denominator,`
      + " so it must point at where the owner decided — an agent's sentence and an owner's ruling"
      + " read identically once they are both comments.",
    );
  }
}

const rows = index.entries.map((entry) => ({
  path: entry.path,
  category: entry.category,
  group: entry.group,
  slugs: (coverage.get(entry.path) ?? []).map((c) => c.slug),
  notApplicable: Object.hasOwn(CLASSIQ_NOT_APPLICABLE, entry.path),
}));
const covered = rows.filter((row) => row.slugs.length > 0);
const declined = rows.filter((row) => row.notApplicable && row.slugs.length === 0);
const missing = rows.filter((row) => row.slugs.length === 0 && !row.notApplicable);

const byCategory = {};
for (const row of rows) {
  byCategory[row.category] ??= { total: 0, covered: 0, declined: 0 };
  byCategory[row.category].total += 1;
  if (row.slugs.length > 0) byCategory[row.category].covered += 1;
  else if (row.notApplicable) byCategory[row.category].declined += 1;
}

const report = {
  source: index.source,
  commit: index.commit,
  indexFetchedAt: index.fetchedAt,
  classiqEntries: rows.length,
  covered: covered.length,
  declined: declined.length,
  declinedPaths: declined.map((row) => ({ path: row.path, ...CLASSIQ_NOT_APPLICABLE[row.path] })),
  missing: missing.length,
  byCategory,
  declaredByBasis: Object.fromEntries(basisCounts),
  missingPaths: missing.map((row) => row.path),
  errors,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 1));
} else if (!QUIET || errors.length > 0) {
  console.log(
    `Classiq parity: ${covered.length}/${rows.length} covered`
    + `${declined.length > 0 ? `, ${declined.length} declined by owner ruling` : ""}`
    + `, ${missing.length} missing  (index at ${String(index.commit).slice(0, 8)},`
    + ` fetched ${index.fetchedAt})`,
  );
  if (!QUIET) {
    for (const [category, counts] of Object.entries(byCategory)) {
      // "60/61, 1 declined" and "60/61" are different sentences: the first says the
      // category is finished and the second says it is one short.
      console.log(
        `  ${counts.covered}/${counts.total}  ${category}`
        + `${counts.declined > 0 ? `  (${counts.total - counts.covered - counts.declined} outstanding;` : ""}`
        + `${counts.declined > 0 ? ` ${counts.declined} declined, so this category is closed)` : ""}`,
      );
    }
    for (const row of declined) {
      console.log(`  declined: ${row.path}`);
      console.log(`    ruled at ${CLASSIQ_NOT_APPLICABLE[row.path].ruling}`);
    }
    // The split the headline cannot show. `source-formulates-problem` is a
    // stronger claim than `method-instance`, and after ai-ops#42 the two are
    // indistinguishable from the count alone.
    const declared = [...basisCounts.values()].reduce((sum, count) => sum + count, 0);
    console.log(`  of ${declared} declared (the rest are records written for their own entry):`);
    for (const basis of BASIS_ORDER) {
      const count = basisCounts.get(basis);
      if (count > 0) console.log(`    ${String(count).padStart(3)}  ${basis}`);
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
