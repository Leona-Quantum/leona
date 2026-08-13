#!/usr/bin/env node
// Where the map's regions hand work to each other, and where they cannot.
//
// ## Why this is a lint script and not only a unit test
//
// Two of the three things it measures need `routeOf`, which reaches the state
// vocabulary and the whole layer graph; `node --test` resolves specifiers
// literally and cannot import the graph's module tree, which is the same reason
// `check-layer-graph.mjs` exists beside `repository-layers.test.ts`. The rules
// live in `apps/web/lib/repository/region-joins.ts` and both callers use them,
// so nothing here can drift from what the tests pin.
//
// ## What it refuses, and what it only prints
//
// It refuses three things and all three are about a **declaration going out of
// date**, never about a number being too large:
//
//   1. a slot whose entry state no process produces and which no row explains;
//   2. a row for a slot that has since gained a supplier — the fix is to delete
//      the row, not to write another;
//   3. a row whose recorded supply no longer matches the graph. **This is the
//      one that catches a join being made or broken by accident**, because the
//      commonest way to connect two regions is one `specializes` line in
//      `state-vocabulary.ts`, which re-types every contract naming the parent.
//
// Everything else is printed. There is no honest threshold on the size of the
// join surface — a map that grows correctly grows it — and pinning today's
// figure here would block the work rather than watch it. The figure is pinned
// once, in `repository-region-joins.test.ts`, where moving it is a deliberate
// edit somebody reviews.
//
// Usage: node scripts/check-region-joins.mjs [--quiet] [--worklist]
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

const QUIET = process.argv.includes("--quiet");
const WORKLIST = process.argv.includes("--worklist");

async function bundle(relativePath, label) {
  const outDir = mkdtempSync(join(tmpdir(), "region-joins-"));
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

const graphMod = await bundle("apps/web/lib/repository/layer-graph.ts", "layer-graph");
const statesMod = await bundle("apps/web/lib/repository/state-vocabulary.ts", "state-vocabulary");
const joinsMod = await bundle("apps/web/lib/repository/region-joins.ts", "region-joins");

const { LAYER_GRAPH } = graphMod;
const { STATE_VOCABULARY } = statesMod;
const {
  regionsOf,
  slotEntries,
  joinSurface,
  auditSlotEntries,
  joinWorklist,
  DECLARED_SLOT_ENTRIES,
} = joinsMod;

const regions = regionsOf(LAYER_GRAPH);
const entries = slotEntries(LAYER_GRAPH, STATE_VOCABULARY);
const surface = joinSurface(LAYER_GRAPH, STATE_VOCABULARY);
const audit = auditSlotEntries(entries, DECLARED_SLOT_ENTRIES);
const worklist = joinWorklist(entries, DECLARED_SLOT_ENTRIES);

const errors = [];

for (const entry of audit.undeclared) {
  errors.push(
    `${entry.slot}: consumes ${entry.from}, which no process produces, and no row explains it — ` +
      `add one to DECLARED_SLOT_ENTRIES saying whether this is a front door the reader enters ` +
      `through, an ingredient they supply, or a join nobody has recorded yet (supply: ${entry.supply})`,
  );
}
for (const slot of audit.stale) {
  errors.push(
    `DECLARED_SLOT_ENTRIES carries ${slot}, whose entry state a process now produces — ` +
      `delete the row rather than leave an explanation nobody re-judged`,
  );
}
for (const row of audit.misclassified) {
  errors.push(
    `${row.slot}: DECLARED_SLOT_ENTRIES records it as "${row.declared}" and the graph now says ` +
      `"${row.actual}" — a region was joined or cut. Re-read the row before updating it: the ` +
      `commonest cause is a specializes line added in state-vocabulary.ts, which re-types every ` +
      `contract naming the parent`,
  );
}

if (!QUIET) {
  console.log(`region joins`);
  console.log(
    `  ${LAYER_GRAPH.nodes.length} nodes in ${regions.length} regions: ${regions
      .map((region) => `${region.nodes.length} nodes / ${region.capabilities.length} slots`)
      .join(" · ")}`,
  );

  // The product, not the edge. A shared state name asserts every arrival
  // against every departure, and the split says how much of that leaves a
  // region — which is the whole of what "connect the map" is worth today.
  const asserted = surface.within + surface.crosses;
  console.log(
    `  ${asserted} method-to-method compositions on the join surface — ` +
      `${surface.within} within a region, ${surface.crosses} across one`,
  );
  const crossing = surface.states.filter((state) => state.crosses > 0);
  console.log(
    `  ${crossing.length} of ${surface.states.length} states carry a crossing:` +
      (crossing.length === 0 ? " none" : ""),
  );
  for (const state of crossing) {
    console.log(
      `    ${state.state.padEnd(26)} ${String(state.arrivals).padStart(3)} in × ` +
        `${String(state.departures).padStart(3)} out = ${String(state.asserted).padStart(4)} · ` +
        `${state.crosses} cross`,
    );
  }

  // The supply census. Ten of twenty-three slots consume something no process
  // produces, and that is the normal condition of a map grown by regions — the
  // finding is which of them the map means to leave that way.
  const open = entries.filter((entry) => entry.supply !== "joined");
  const bySupply = new Map();
  for (const entry of open) bySupply.set(entry.supply, (bySupply.get(entry.supply) ?? 0) + 1);
  console.log(
    `  ${open.length} of ${entries.length} slots consume a state no process produces — ` +
      [...bySupply.entries()].map(([supply, count]) => `${count} ${supply}`).join(", "),
  );
  for (const entry of open) {
    const intent = DECLARED_SLOT_ENTRIES[entry.slot]?.intent ?? "undeclared";
    console.log(
      `    ${entry.slot.padEnd(28)} r${entry.region} ${entry.supply.padEnd(14)} ` +
        `needs ${entry.from.padEnd(24)} spine ${entry.onSpine} feed ${entry.asFeed}` +
        (intent === "join-wanted" ? "  ← join wanted" : ""),
    );
  }
}

// Printed whether or not `--quiet`, the same rule the coined-composite-name
// warning obeys: this is the standing worklist for ai-ops#64 and a figure that
// only appears when somebody remembers to look is a figure nobody reads.
if (worklist.length > 0) {
  console.log(
    `  ⚠ ${worklist.length} slots want a join nobody has recorded — a worklist, not a failure; ` +
      `this script exits 0 with rows here: ${worklist.map((entry) => entry.slot).join(", ")}`,
  );
}
if (WORKLIST) {
  for (const entry of worklist) {
    console.log(`\n  ${entry.slot} — needs ${entry.from}`);
    console.log(`    ${DECLARED_SLOT_ENTRIES[entry.slot].reason}`);
  }
}

if (errors.length > 0) {
  console.error(`✖ region joins invalid (${errors.length} ${errors.length === 1 ? "error" : "errors"})`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `✓ region joins valid (${regions.length} regions, ${surface.crosses} cross-region compositions)`,
);
