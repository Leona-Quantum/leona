#!/usr/bin/env node
// The match-gauge: the three numbers that together answer "have the repository
// and the map matched yet?" — printed as one reading, from one command.
//
// ## Why this exists, and why one command rather than three
//
// `plans/atlas-revamp/C-corpus-scale-out.md` defines how "expand the repository
// and the map until they match, and then beyond" is scored, and it is explicit
// that the three numbers must be **quoted together**, because *each alone can
// improve while the truth worsens*:
//
//   1. anchor more records and (2) can fall, because a record anchored to a
//      node whose figure does not draw it adds a claim no reader can check;
//   2. read more papers and (3) can rise, because a paper that reveals more
//      cited steps also reveals more steps no figure draws;
//   3. drive (3) to zero by deleting the citations that were hard to draw, and
//      (1) and (2) never move at all.
//
// So the honest report is a triple. Before this script the triple could not be
// obtained in one place: (1) came from `check-layer-graph.mjs --unanchored`,
// while (2) and (3) existed only as intermediate variables inside
// `apps/web/lib/repository-paper-reveal.test.ts` — a test that asserts on them
// and prints nothing. Numbers you must read a test's source to learn are
// numbers nobody quotes, and the plan doc's own figures ("85/86", "7") were
// authored by hand from a session that had them in scope.
//
// That failure has already happened once in this repository, one file over:
// `check-layer-graph.mjs` says of its own `--unanchored` flag that the audit
// "has always computed unanchored ... but nothing ever printed it, so the only
// way to read it was to edit this file", which is how its doc comment came to
// quote "61 of the 70" long after the real figure had moved to 53 of 62. This
// script is that lesson applied before the drift, rather than after it.
//
// ## What this is NOT
//
// Not a gate on the NUMBERS. It exits 0 whatever the triple says. A gauge that
// fails the build invites the cheapest way to green it, and every one of the
// three has a cheap way to move that makes the atlas worse. It reports; people
// decide.
//
// It does exit non-zero if it cannot BUILD the triple — an import that stopped
// resolving, a renamed export — because that is the script rotting, not the
// atlas regressing. `lint` runs it `--quiet` for exactly that reason: a
// reporting script nothing executes is one that breaks silently and is
// discovered months later by whoever next needed the number.
//
// Usage: node scripts/check-match-gauge.mjs [--quiet] [--json]

import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

const AS_JSON = process.argv.includes("--json");
const QUIET = process.argv.includes("--quiet");

// A near-copy of check-layer-graph.mjs's loader. Deliberately not extracted
// into a shared module yet: that checker is edited by several lanes at once and
// a refactor of it would collide for no gain here. Worth folding together when
// a third script needs it.
async function bundle(relativePath, label) {
  const outDir = mkdtempSync(join(tmpdir(), "match-gauge-"));
  const resolvedLabel = path.resolve(outDir, label);
  const relativeCheck = path.relative(outDir, resolvedLabel);
  if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
    console.error(`✖ failed to bundle ${relativePath}: invalid label`);
    process.exit(1);
  }
  const outFile = join(outDir, `${label}.mjs`);
  const resolvedPath = path.resolve(root, relativePath);
  const relativePathCheck = path.relative(root, resolvedPath);
  if (relativePathCheck.startsWith('..') || path.isAbsolute(relativePathCheck)) {
    console.error(`✖ failed to bundle ${relativePath}: invalid path`);
    process.exit(1);
  }
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

const graphMod = await bundle("apps/web/lib/repository/layer-graph.ts", "layer-graph");
const corpusMod = await bundle("apps/web/lib/public-repository.ts", "public-repository");
const statesMod = await bundle("apps/web/lib/repository/state-vocabulary.ts", "state-vocabulary");
const topicsMod = await bundle("apps/web/lib/repository/topics.ts", "topics");
const eligibilityMod = await bundle("apps/web/lib/repository/map-eligibility.ts", "map-eligibility");
const tracesMod = await bundle("apps/web/lib/repository/paper-traces.ts", "paper-traces");
const revealMod = await bundle("apps/web/lib/repository/paper-reveal.ts", "paper-reveal");
const papersMod = await bundle("apps/web/lib/repository/papers.ts", "papers");

const { LAYER_GRAPH } = graphMod;
const { STATE_VOCABULARY } = statesMod;
const { PUBLIC_REPOSITORY_ENTRIES } = corpusMod;
const { auditAnchors } = eligibilityMod;
const { paperTraces } = tracesMod;
const { paperRevealFor } = revealMod;
const { paperSlug } = papersMod;
const { roleOf } = topicsMod;

// ---------------------------------------------------------------- gauge 1 ---
// Anchored / map-eligible records. Computed by the SAME `auditAnchors` the
// layer-graph checker calls, with the same arguments, so the two commands can
// never disagree about this number — a second implementation here would be a
// third place for it to drift.
const anchorAudit = auditAnchors(
  LAYER_GRAPH.nodes.flatMap((node) =>
    (node.entries ?? []).map((slug) => ({ nodeId: node.id, slug })),
  ),
  PUBLIC_REPOSITORY_ENTRIES.map((entry) => ({
    slug: entry.slug,
    role: roleOf(entry.topics ?? []),
    sourceKind: entry.source?.kind ?? null,
    sourceUrl: entry.source?.url ?? null,
  })),
);

// --------------------------------------------------------- gauges 2 and 3 ---
// Papers that reveal, over papers the map cites; and the sum of `undrawn` over
// every reveal. `paperRevealFor` returning null is the honest "this paper's
// cited nodes draw nowhere" — it is a real state, not an error, and it is the
// numerator's complement rather than something to skip.
const traces = paperTraces(LAYER_GRAPH, STATE_VOCABULARY);
const unrevealed = [];
let revealing = 0;
let undrawnTotal = 0;
let foldedTotal = 0;
const undrawnByPaper = [];

for (const trace of traces) {
  const reveal = paperRevealFor(LAYER_GRAPH, STATE_VOCABULARY, paperSlug(trace.paper));
  if (reveal === null) {
    unrevealed.push(trace.paper);
    continue;
  }
  revealing += 1;
  foldedTotal += reveal.folded.length;
  if (reveal.undrawn.length > 0) {
    undrawnTotal += reveal.undrawn.length;
    undrawnByPaper.push({ paper: trace.paper, undrawn: [...reveal.undrawn] });
  }
}

const gauge = {
  anchored: anchorAudit.anchored,
  mapEligible: anchorAudit.eligible,
  unanchored: anchorAudit.unanchored.length,
  revealing,
  mapCitingPapers: traces.length,
  unrevealed,
  undrawnTotal,
  foldedTotal,
  undrawnByPaper,
};

if (AS_JSON) {
  console.log(JSON.stringify(gauge, null, 2));
  process.exit(0);
}

const pct = (n, d) => (d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`);

if (QUIET) {
  // One line, all three numbers, because the whole point is that they travel
  // together. Even in the terse mode nothing is dropped.
  console.log(
    `match-gauge: ${gauge.anchored}/${gauge.mapEligible} anchored · ${gauge.revealing}/${gauge.mapCitingPapers} papers reveal · ${gauge.undrawnTotal} undrawn`,
  );
  process.exit(0);
}

console.log("match-gauge — quote all three, never one");
console.log(
  `  1. ${gauge.anchored} of ${gauge.mapEligible} map-eligible records anchored (${pct(
    gauge.anchored,
    gauge.mapEligible,
  )}) — ${gauge.unanchored} no node reaches`,
);
console.log(
  `  2. ${gauge.revealing} of ${gauge.mapCitingPapers} map-citing papers reveal a pipeline (${pct(
    gauge.revealing,
    gauge.mapCitingPapers,
  )})`,
);
console.log(
  `  3. ${gauge.undrawnTotal} cited steps no figure draws, summed over every reveal (${gauge.foldedTotal} more are folded into a drawn lane, which is drawn, not missing)`,
);

if (gauge.unrevealed.length > 0) {
  console.log(`  papers revealing nothing: ${gauge.unrevealed.join(", ")}`);
}
if (undrawnByPaper.length > 0) {
  console.log("  where (3) lives:");
  for (const row of undrawnByPaper) {
    console.log(`    ${row.paper}: ${row.undrawn.join(", ")}`);
  }
}

console.log(
  "  reading: (1) and (3) toward their edges by structural additions and honest anchors;",
);
console.log(
  "  (2) holding while intake grows is 'beyond'. Deleting records or weakening eligibility",
);
console.log("  moves these numbers the wrong way while looking like progress.");
