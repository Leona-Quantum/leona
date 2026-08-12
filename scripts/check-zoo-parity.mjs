#!/usr/bin/env node
// The Zoo gauge: how much of the Quantum Algorithm Zoo this repository carries.
//
// ## Why this exists
//
// `check-match-gauge.mjs` scores the *map* half of "expand the repository and the
// map until they match, and then beyond" — anchored records, revealing papers,
// undrawn steps. All three of its numbers are internal: they compare the catalog
// with the map, so a catalog that is missing an entire subject area scores a clean
// triple. The repository half needs an outside denominator, and the Quantum
// Algorithm Zoo is the closest thing the field has to one.
//
// First reading, at dev b7b507d1 before the Zoo-parity intake: **8 of 60 covered**.
// The eight were not chosen — they are what a catalog grown from circuit examples
// happens to overlap with a survey of the literature. That is the number this
// gauge exists to make impossible to not know.
//
// ## What it fails on, and what it only reports
//
// Report-only: the coverage number. A gauge that fails the build gets greened the
// cheapest way, and the cheapest way here is to declare the remainder
// not-applicable — so the number exits 0 whatever it says. People decide.
//
// Fails (exit 1): a coverage declaration that no longer refers to anything —
//   * a slug declared as covering a Zoo entry that is not in the corpus,
//   * a Zoo entry named in a declaration that is not in the pinned index.
// Those are the two ways a hand-maintained list rots without anyone seeing it, and
// unlike the number they have no honest reading.
//
// The Zoo index is pinned (scripts/zoo-parity/zoo-index.json) and refreshed by
// `node scripts/generate-zoo-index.mjs` — see that file for why the fetch is a
// human action with a diff rather than something this check does behind your back.
//
// Usage: node scripts/check-zoo-parity.mjs [--json] [--quiet] [--missing]
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
  const outDir = mkdtempSync(join(tmpdir(), "zoo-parity-"));
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

const index = JSON.parse(readFileSync(join(root, "scripts/zoo-parity/zoo-index.json"), "utf8"));
const corpusMod = await bundle("apps/web/lib/public-repository.ts", "public-repository");
const intakeMod = await bundle("apps/web/lib/repository/entries-zoo-parity.ts", "entries-zoo-parity");
const coverageMod = await bundle("apps/web/lib/repository/zoo-coverage.ts", "zoo-coverage");

const { PUBLIC_REPOSITORY_ENTRIES } = corpusMod;
const { ZOO_PARITY_COVERAGE, ZOO_SPEEDUP_PROVENANCE } = intakeMod;
const { ZOO_LEGACY_COVERAGE, ZOO_NOT_APPLICABLE } = coverageMod;

const corpusSlugs = new Set(PUBLIC_REPOSITORY_ENTRIES.map((entry) => entry.slug));
const zooNames = new Set(index.entries.map((entry) => entry.name));

// slugs claimed per Zoo entry, from both halves of the declaration
const claimed = new Map();
const claim = (zooName, slug, origin) => {
  if (!claimed.has(zooName)) claimed.set(zooName, []);
  claimed.get(zooName).push({ slug, origin });
};
for (const { zooName, slug } of ZOO_PARITY_COVERAGE) claim(zooName, slug, "intake");
for (const [zooName, slugs] of Object.entries(ZOO_LEGACY_COVERAGE)) {
  for (const slug of slugs) claim(zooName, slug, "legacy");
}

const errors = [];
for (const [zooName, claims] of claimed) {
  if (!zooNames.has(zooName)) {
    errors.push(
      `coverage declares Zoo entry "${zooName}" (${claims.map((c) => c.slug).join(", ")}),`
      + " but the pinned index has no entry with that name — the Zoo renamed or removed it,"
      + " or the declaration has a typo. Refresh the index and re-point the declaration.",
    );
  }
  for (const { slug, origin } of claims) {
    if (!corpusSlugs.has(slug)) {
      errors.push(`${origin} coverage of "${zooName}" names slug "${slug}", which is not in the corpus`);
    }
  }
}
for (const zooName of Object.keys(ZOO_NOT_APPLICABLE)) {
  if (!zooNames.has(zooName)) {
    errors.push(`notApplicable declares Zoo entry "${zooName}", which is not in the pinned index`);
  }
  if (claimed.has(zooName)) {
    errors.push(`"${zooName}" is declared both covered and not-applicable — pick one`);
  }
}

const rows = index.entries.map((entry) => ({
  name: entry.name,
  section: entry.section,
  speedup: entry.speedup,
  slugs: (claimed.get(entry.name) ?? []).map((c) => c.slug),
  notApplicable: Object.hasOwn(ZOO_NOT_APPLICABLE, entry.name),
}));
const covered = rows.filter((row) => row.slugs.length > 0);
const notApplicable = rows.filter((row) => row.notApplicable && row.slugs.length === 0);
const missing = rows.filter((row) => row.slugs.length === 0 && !row.notApplicable);

const bySection = {};
for (const row of rows) {
  const key = row.section ?? "(unsectioned)";
  bySection[key] ??= { total: 0, covered: 0 };
  bySection[key].total += 1;
  if (row.slugs.length > 0) bySection[key].covered += 1;
}

const report = {
  source: index.source,
  indexFetchedAt: index.fetchedAt,
  zooEntries: rows.length,
  covered: covered.length,
  notApplicable: notApplicable.length,
  missing: missing.length,
  bySection,
  missingNames: missing.map((row) => row.name),
  errors,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 1));
} else if (!QUIET || errors.length > 0) {
  console.log(
    `Zoo parity: ${covered.length}/${rows.length} covered`
    + `${notApplicable.length > 0 ? `, ${notApplicable.length} declared not-applicable` : ""}`
    + `, ${missing.length} missing  (index fetched ${index.fetchedAt})`,
  );
  if (!QUIET) {
    for (const [section, counts] of Object.entries(bySection)) {
      console.log(`  ${counts.covered}/${counts.total}  ${section}`);
    }
  }
  if (SHOW_MISSING) {
    for (const row of missing) console.log(`  missing: ${row.name}  [${row.section}]`);
  }
}

// --- whose claim is the speedup class? -----------------------------------------
//
// Every `speedup` on an intake record is a quotation from the Quantum Algorithm Zoo,
// and on at least one of them it is a quotation about a whole SECTION rather than
// about the paper. The owner ruled that such a class may stay, provided the record
// says whether its own primary source backs it, and that "which claims are from
// secondary sources" stays countable (EshMis/ai-ops#18, 2026-08-12).
//
// **An exact census, and a fall fails too** — the same shape, and for the same
// reason, as the per-slot hollow-twin census in `repository-layers.test.ts` that the
// owner settled on the same day (#21). A ceiling on `unknown` would let the number
// drift down as primary sources get read and then quietly absorb a new unchecked
// record without a word; an exact count makes reading a paper an edit to this line,
// which is the diff that records the win.
const SPEEDUP_PROVENANCE_CENSUS = {
  // Nobody has yet found a primary paper stating a comparable speedup in its own
  // words. Zero is a real value here, not an unfinished one.
  reported: 0,
  // gibbs-state-sampling. Poulin and Wocjan's abstract was read in full and makes
  // no comparison to a classical algorithm; the Zoo's "Superpolynomial" is the
  // section heading's. This is the record the owner's ruling was about.
  absent: 1,
  // The worklist. The intake checked the problem statement, the class against the
  // Zoo, the reference metadata and the complexity claim — it never asked whether
  // the paper supports the class. `unknown` says that, rather than pretending.
  unknown: 31,
};

const seen = { reported: 0, absent: 0, unknown: 0 };
for (const { slug, primary } of ZOO_SPEEDUP_PROVENANCE) {
  if (!(primary?.states in seen)) {
    errors.push(`${slug}: speedupPrimary.states is "${primary?.states}", which is not one of reported/absent/unknown`);
    continue;
  }
  seen[primary.states] += 1;
  // A state with no evidence behind it is exactly what this field was added to
  // stop, and an empty string type-checks perfectly well.
  if (primary.states === "reported" && !primary.quote?.trim()) {
    errors.push(`${slug}: speedupPrimary is "reported" with no quote — a claim with nothing behind it`);
  }
  if (primary.states === "absent" && !primary.read?.trim()) {
    errors.push(
      `${slug}: speedupPrimary is "absent" with nothing named in \`read\` — "the paper does not say it" `
      + "is only as wide as the text somebody actually read",
    );
  }
}
for (const [state, pinned] of Object.entries(SPEEDUP_PROVENANCE_CENSUS)) {
  if (seen[state] === pinned) continue;
  errors.push(
    seen[state] > pinned
      ? `speedup provenance: ${seen[state]} records are "${state}", was ${pinned}. If a primary source was read, `
        + `record the win: ${state}: ${seen[state]}. If a record was added without checking one, that is the `
        + "worklist growing and it should be deliberate."
      : `speedup provenance: ${seen[state]} records are "${state}", down from ${pinned}. Update the census: `
        + `${state}: ${seen[state]}. A stale-high number is silent room for an unchecked claim to hide in.`,
  );
}
if (!QUIET && !AS_JSON) {
  console.log(
    `  speedup class vs primary source: ${seen.reported} reported, ${seen.absent} absent, ${seen.unknown} unchecked`
    + ` (of ${ZOO_SPEEDUP_PROVENANCE.length})`,
  );
}

if (errors.length > 0) {
  for (const error of errors) console.error(`✖ ${error}`);
  process.exit(1);
}
