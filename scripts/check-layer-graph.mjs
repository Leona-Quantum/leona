#!/usr/bin/env node
// Validates the authored layer graph (apps/web/lib/repository/layer-graph.ts)
// against the real 283-record corpus.
//
// ## Why this is a lint script and not only a unit test
//
// The one rule that cannot be checked by `node --test` is the one most likely to
// break: **every slug a node cross-links must be a record that exists.**
// `public-repository.ts` reaches its entry modules with extensionless specifiers
// and `node --test` resolves paths literally, so a web test cannot import the
// corpus at all — the same reason `repository-interface.test.ts` and
// `repository-topics.test.ts` both build their own fixtures. esbuild has no such
// problem, and this is the same bundle-then-import trick
// `check-repository-data.mjs` uses.
//
// So the split is: `repository-layers.test.ts` pins every rule internal to the
// graph, this pins the two that need the corpus, and **both call the same
// `validateLayerGraph`** — the rules live in one place and cannot drift.
//
// Usage: node scripts/check-layer-graph.mjs [--quiet]

import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

const QUIET = process.argv.includes("--quiet");

async function bundle(relativePath, label) {
  const outDir = mkdtempSync(join(tmpdir(), "layer-graph-"));
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
const layersMod = await bundle("apps/web/lib/repository/layers.ts", "layers");
const corpusMod = await bundle("apps/web/lib/public-repository.ts", "public-repository");
const statesMod = await bundle("apps/web/lib/repository/state-vocabulary.ts", "state-vocabulary");

const { LAYER_GRAPH } = graphMod;
const {
  validateLayerGraph,
  layerCensus,
  layerDepths,
  isCapability,
  isMethod,
  stepsOutlook,
  routeOf,
} = layersMod;
const { PUBLIC_REPOSITORY_ENTRIES } = corpusMod;
const { STATE_VOCABULARY } = statesMod;

const corpus = new Set(PUBLIC_REPOSITORY_ENTRIES.map((entry) => entry.slug));
const errors = validateLayerGraph(LAYER_GRAPH, corpus, STATE_VOCABULARY);

// A state id that is also a corpus slug has the same problem as a node id that
// is: two different things answering to one name. Only checkable here, for the
// same reason — it needs both sides.
for (const state of STATE_VOCABULARY.states) {
  if (corpus.has(state.id)) {
    errors.push(`${state.id}: a state id collides with a corpus slug of the same name`);
  }
}

// A layer id that is also a corpus slug makes two different things answer to one
// name — in prose, in search, and in anything a reader pastes into a message.
// Cheap to check, silent when wrong, and only checkable here because it needs
// both sides.
for (const node of LAYER_GRAPH.nodes) {
  if (corpus.has(node.id)) {
    errors.push(`${node.id}: a layer id collides with a corpus slug of the same name`);
  }
}

// The route `/repository/layers/...` shadows `/repository/[slug]` for the static
// segment. A record whose slug is that segment would 200 with the wrong page.
for (const segment of layersMod.RESERVED_REPOSITORY_SEGMENTS) {
  if (corpus.has(segment)) {
    errors.push(
      `a corpus record uses the slug "${segment}", which the /repository/${segment} route shadows`,
    );
  }
}

if (errors.length > 0) {
  console.error(`✖ layer graph invalid (${errors.length} ${errors.length === 1 ? "error" : "errors"})`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

if (!QUIET) {
  const census = layerCensus(LAYER_GRAPH, corpus, STATE_VOCABULARY);
  const depths = layerDepths(LAYER_GRAPH);
  const byDepth = new Map();
  for (const [id, depth] of depths) {
    byDepth.set(depth, (byDepth.get(depth) ?? 0) + 1);
  }
  console.log("layer graph");
  console.log(
    `  ${census.nodes} nodes — ${census.capabilities} capabilities, ${census.methods} methods`,
  );
  console.log(
    `  ${census.anchored} carry a corpus record (${census.distinctEntries} distinct records referenced of ${corpus.size})`,
  );
  console.log(
    `  ${census.openCapabilities} capabilities nothing realises yet · ${census.undecomposedMethods} methods nobody has decomposed`,
  );
  console.log(
    `  depth histogram: ${[...byDepth.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([depth, count]) => `${depth}:${count}`)
      .join(" ")}`,
  );
  // Where the ladder does not join up. A gap is a conversion no recorded step
  // names, and it is content rather than a defect — but it is invisible unless
  // something prints it, and it is the R3.5 reading list in the most concrete
  // form this repository has.
  console.log(
    `  ${census.states} states · routes: ${census.routesDelegated} all delegated, ${census.routesPartlyOwn} close the last stretch themselves, ${census.routesAllOwn} are one undivided act`,
  );
  console.log(
    `  ${census.feedSteps} steps supply an ingredient rather than advancing a route`,
  );
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node) || node.steps.length === 0) continue;
    const route = routeOf(LAYER_GRAPH, STATE_VOCABULARY, node);
    if (route.coverage !== "all-own") continue;
    console.log(`  ${node.id} delegates nothing in sequence — every step is an ingredient`);
  }
  // The bypass edges are the reason this surface exists, so they are printed
  // rather than merely counted — a route that silently stops skipping a layer is
  // a content regression nothing else would show.
  for (const node of LAYER_GRAPH.nodes) {
    if (isMethod(node) && (node.bypasses ?? []).length > 0) {
      console.log(`  ${node.id} skips ${node.bypasses.join(", ")}`);
    }
  }
  const undecomposed = LAYER_GRAPH.nodes.filter(
    (node) => isMethod(node) && stepsOutlook(node) === "undecomposed",
  );
  if (undecomposed.length > 0) {
    console.log(`  not yet decomposed: ${undecomposed.map((node) => node.id).join(", ")}`);
  }
  const open = LAYER_GRAPH.nodes.filter(
    (node) => isCapability(node) && !LAYER_GRAPH.nodes.some((m) => isMethod(m) && m.realizes === node.id),
  );
  if (open.length > 0) {
    console.log(`  no method recorded: ${open.map((node) => node.id).join(", ")}`);
  }
}

console.log(`✓ layer graph valid (${LAYER_GRAPH.nodes.length} nodes)`);
