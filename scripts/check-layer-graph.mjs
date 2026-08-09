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
const topicsMod = await bundle("apps/web/lib/repository/topics.ts", "topics");
const eligibilityMod = await bundle("apps/web/lib/repository/map-eligibility.ts", "map-eligibility");
const tracesMod = await bundle("apps/web/lib/repository/paper-traces.ts", "paper-traces");
const stateGraphMod = await bundle("apps/web/lib/repository/state-graph.ts", "state-graph");

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
const errors = validateLayerGraph(
  LAYER_GRAPH,
  corpus,
  STATE_VOCABULARY,
  layersMod.COMPOSITE_NAME_DISPOSITIONS,
);

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

// Which records may be cross-linked from a node at all. Only checkable here, for
// the same reason the slug-resolution rule is: it needs the corpus, and the
// corpus carries the `role` facet the rule reads.
//
// It has never fired — all 9 anchors are `algorithm-reference` — and that is
// precisely why it exists. A convention nobody has broken yet is one helpful
// cross-link away from being broken, and a gate record hanging off
// `quantum-linear-solve` renders as "the Atlas documents this layer".
const anchorAudit = eligibilityMod.auditAnchors(
  LAYER_GRAPH.nodes.flatMap((node) =>
    (node.entries ?? []).map((slug) => ({ nodeId: node.id, slug })),
  ),
  PUBLIC_REPOSITORY_ENTRIES.map((entry) => ({
    slug: entry.slug,
    role: topicsMod.roleOf(entry.topics ?? []),
  })),
);
for (const { nodeId, slug, role } of anchorAudit.ineligible) {
  errors.push(
    `${nodeId}: entries names ${slug}, whose role is ${role ?? "none"} — only ${eligibilityMod.MAP_ELIGIBLE_ROLES.join(", ")} records may be anchored to a layer`,
  );
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

// Every method-to-method composition the graph asserts, judged by the same
// `pathStanding` the converge surface draws its marks from.
//
// Assembled here rather than in `layers.ts` because `state-graph.ts` imports
// `layers.ts` and the reverse would be a cycle — so the census enumerates and
// the judge is passed in. Both sides of `pathStanding`'s edge-key convention have
// to agree for this to mean anything, which is what the `recorded` reachability
// check below is actually testing.
const compositions = layersMod.stateCompositionCensus(
  LAYER_GRAPH,
  STATE_VOCABULARY,
  (arrival, departure) =>
    stateGraphMod.pathStanding(LAYER_GRAPH, STATE_VOCABULARY, [
      { edgeKey: arrival.edgeKey, filler: arrival.method },
      { edgeKey: departure.edgeKey, filler: departure.method },
    ]),
);

// **This does not fail on the size of the number, and there is no honest way to
// make it.** A composition count is `arrivals × departures` per state, so any
// correct new method multiplies it; a threshold would only say "somebody added
// content", and pinning today's 226 would block tomorrow's correct work for the
// reason the state-scoped-test note gives. So the number is printed, every run,
// and that is the whole of the guarantee.
//
// What *is* failable without inventing a threshold is that the judgement still
// has three values. `pathStanding` is three-valued on purpose — `unpinned` is the
// middle that stops a discovery being printed on every second line — and a
// standing nothing can produce is a check that passes because it stopped asking.
// One `recorded` also happens to be the only end-to-end evidence that the edge
// keys this script builds match the ones `pathStanding` walks: get them wrong and
// every composition reads `unpublished`, which looks exactly like an empty record.
for (const [standing, count] of [
  ["recorded", compositions.recorded],
  ["unpinned", compositions.unpinned],
  ["unpublished", compositions.unpublished],
]) {
  if (count === 0) {
    errors.push(
      `no composition anywhere in the graph is "${standing}" — pathStanding has stopped being three-valued, so the mark it draws no longer distinguishes anything`,
    );
  }
}

// --- R13: a repeated chain is a duplicate only inside one state pair ---------
//
// Two methods that draw the same picture are a defect **only when they realize
// the same slot**. The same chain under a *different* slot is a recurrence, and
// recurrence is what a reusable ladder looks like when it is working — R13
// quotes the owner's own statement, and it is about the hardware-implementation
// papers that have not arrived yet: an implementation of HHL and one of QSVT
// will both draw prepare → block-encode → read out, and those are two different
// pairs of states, not one duplicate.
//
// So this groups by slot before comparing, and never across. What it does with
// each answer differs, and the difference is the rule:
//
//   - **Within a slot: failable**, against the named groups below. Not a bare
//     count. A count goes green when one pair is fixed and a *different* pair
//     collides, which is the shape of wrong-reason pass the census notes above
//     are written to avoid. The list is the assertion; a group that is not on it
//     is an error even if the total fell.
//   - **Across slots: printed, never barred.** Barring it would bar the
//     recurrence R13 exists to permit. There is one today, worth saying plainly
//     because the plan records this number as 0: `state-preparation` alone is a
//     whole chain, shared by five methods across three slots. It was already
//     non-zero when the rule was written.
//
// The comparison includes each step's `via` pin, because a pin is exactly how
// two methods sharing a step stop drawing the same picture — `taylor-all-at-once`
// left this list by pinning `time-discretization` to the propagator node whose
// name it was already carrying.
const chainOf = (method) =>
  method.steps
    .map((step) => `${step}${method.via?.[step] ? ` via ${method.via[step]}` : ""}`)
    .join(" + ");

const KNOWN_TWINS = [
  {
    slot: "linear-ode-solve",
    methods: ["krovi-linear-ode", "dyson-all-at-once"],
    why: "krovi-linear-ode re-analyses the all-at-once construction it already `refines`, and whether it survives as its own node is an owner ruling (OWNER_TODO §4a). dyson-all-at-once wants a `truncated-dyson-series` node under `time-discretization` that nobody has authored — that needs the paper and a citation (R1, R10), so it is content work, not a pin.",
  },
  {
    slot: "linear-ode-solve",
    methods: ["lchs-route", "lchs-improved-kernel", "schrodingerisation"],
    why: "lchs-improved-kernel already `refines: lchs-route`, so that pair is declared. lchs-route and schrodingerisation must NOT collapse — genuinely different mathematics, one requiring a positive-semidefinite Hermitian part throughout and the other requiring nothing of the kind. What is missing is an intermediate slot between them, which needs R2's two-method contest and a state-vocabulary entry (OWNER_TODO §4b).",
  },
  {
    slot: "time-discretization",
    methods: ["backward-euler", "trapezoidal-rule"],
    why: "Two quadratures reaching the same solver. What differs is the discretization itself, which IS this slot, so there is no lower step to pin them apart with.",
  },
  {
    slot: "quantum-linear-solve",
    methods: ["discrete-adiabatic-inversion", "eigenstate-filtering-inversion"],
    why: "Both walk block-encode → prepare → apply a matrix function. The difference is which function and how its phases are found, which lives inside `matrix-function` — a pin waiting on that slot being decomposed.",
  },
  {
    slot: "observable-estimation",
    methods: ["direct-sampling-readout", "amplitude-estimation-readout", "classical-shadow-readout"],
    why: "Three readouts that each consume a prepared state and nothing else. The chain is one step long, so there is no second step to tell them apart by; what tells them apart is their own cost, which is on the method.",
  },
];

const chainGroups = new Map();
for (const node of LAYER_GRAPH.nodes) {
  if (!isMethod(node) || node.steps.length === 0) continue;
  const key = `${node.realizes} ${chainOf(node)}`;
  chainGroups.set(key, [...(chainGroups.get(key) ?? []), node.id]);
}
const matchedTwins = new Set();
for (const [key, ids] of chainGroups) {
  if (ids.length < 2) continue;
  const [slot, chain] = key.split(" ");
  const known = KNOWN_TWINS.find(
    (row) =>
      row.slot === slot &&
      row.methods.length === ids.length &&
      row.methods.every((id) => ids.includes(id)),
  );
  if (known) {
    matchedTwins.add(known);
    continue;
  }
  errors.push(
    `${slot}: ${ids.join(", ")} all draw "${chain}" and nothing says why. Pin a step with \`via\`, ` +
      `declare one a \`refines\` of another, collapse them, or add the group to KNOWN_TWINS in this ` +
      `script with the reason it survives (R13).`,
  );
}
for (const row of KNOWN_TWINS) {
  if (matchedTwins.has(row)) continue;
  errors.push(
    `${row.slot}: KNOWN_TWINS records ${row.methods.join(", ")} as drawing one chain, and they no ` +
      `longer do. Delete the row — a standing exception nothing exercises is a licence nobody watches.`,
  );
}

if (errors.length > 0) {
  console.error(`✖ layer graph invalid (${errors.length} ${errors.length === 1 ? "error" : "errors"})`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

// Recurrence across slots — reported, never barred. R13 above says why the two
// directions are treated differently.
{
  const acrossSlots = new Map();
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node) || node.steps.length === 0) continue;
    const chain = chainOf(node);
    acrossSlots.set(chain, [...(acrossSlots.get(chain) ?? []), `${node.realizes}/${node.id}`]);
  }
  for (const [chain, holders] of acrossSlots) {
    const slots = new Set(holders.map((holder) => holder.split("/")[0]));
    if (slots.size < 2) continue;
    console.log(
      `  ↻ "${chain}" recurs across ${slots.size} slots — ${holders.join(", ")} (R13: a recurrence, not a duplicate)`,
    );
  }
}

// Printed whether or not `--quiet`, like the paper register's warnings and for
// the same reason: a name the owner has not ruled on is a decision waiting, not
// a passing check, and a queue that only shows in verbose output is a queue
// nobody empties.
for (const row of layersMod.COMPOSITE_NAME_DISPOSITIONS) {
  if (row.disposition !== "awaiting-owner-rename") continue;
  const node = LAYER_GRAPH.nodes.find((candidate) => candidate.id === row.node);
  console.log(`  ⚠ ${row.node} — coined composite name "${node?.label ?? "?"}", owner decision pending`);
  console.log(`      ${row.reason}`);
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
  // The separation the owner asked for, as two numbers. `corpus.size` is the
  // wrong denominator for "how much of the Atlas is on the map" and always has
  // been: 213 of the 283 are benchmark circuits, operators, gates and states,
  // none of which a layer node could honestly anchor. Against the eligible set
  // the coverage is a real fraction and the shortfall is a reading list.
  console.log(
    `  ${anchorAudit.anchored} of ${anchorAudit.eligible} map-eligible records anchored — ${anchorAudit.unanchored.length} algorithm records no node reaches`,
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
  // Iteration. Printed rather than merely counted for the same reason the bypass
  // edges are: a route that stops declaring its loop looks exactly like a route
  // that never had one, and the loop is where the dominant cost term lives.
  console.log(
    `  ${census.iteratedSteps} of ${census.stepInstances} hops declare a multiplicity — ${census.coherentLoops} coherent, ${census.measuredLoops} closing through a measurement · ${census.contrastedSlots} slots draw the contrast: one route repeats, another records nothing`,
  );
  // The compositions the graph asserts by putting two contracts on one state
  // name, and how few of them anybody has written down. The owner's session-91
  // rule — an arrival that cannot use every exit means the state has to split —
  // is a *restriction* relation and `specializes` only ever widens, so this
  // cannot be checked; see the block above `RouteSegment` in `layers.ts`. It can
  // be counted, and counting it here is the point: the alternative is a figure in
  // a session note that is right on the day it is written.
  console.log(
    `  ${compositions.asserted} method-to-method compositions asserted at ${compositions.statesWithSeveralArrivals} of ${census.states} states that more than one method arrives at`,
  );
  console.log(
    `    ${compositions.recorded} a source records · ${compositions.unpinned} a route walks without naming who fills it · ${compositions.unpublished} nothing walks at all`,
  );
  // The per-state table, because the total hides where the exposure is: a state
  // with one arrival and seventeen exits is a different problem from a state with
  // four arrivals that fan into eleven, and only the second is a place where a
  // shared name is doing the joining.
  for (const state of compositions.states) {
    if (state.asserted === 0) continue;
    console.log(
      `    ${state.state.padEnd(28)} ${String(state.arrivals.length).padStart(2)} in × ${String(state.departures.length).padStart(2)} out = ${String(state.asserted).padStart(3)} — ${state.recorded} recorded, ${state.unpinned} unpinned, ${state.unpublished} unpublished`,
    );
  }
  // Papers as traces, measured rather than assumed. A citation attaches to one
  // node and a trace is a path, so "a paper is a line on the map" is a claim
  // about the graph that has to be counted before anything is built on it. The
  // shape of the answer is the design: most papers are cited once and have no
  // line to draw at all, and printing that is what stops a surface promising 84
  // traces and rendering two.
  const traces = tracesMod.paperTraces(LAYER_GRAPH);
  const traceCensus = tracesMod.traceCensus(traces);
  console.log(
    `  ${traceCensus.papers} papers cited — ${traceCensus.point} at a single node, ${traceCensus.contiguous} contiguous, ${traceCensus.joinable} joinable through uncited nodes, ${traceCensus.scattered} with no path at all (widest: ${traceCensus.widest} nodes)`,
  );
  for (const trace of traces) {
    if (trace.shape === "point") continue;
    const bridge = trace.bridgeUpperBound ?? [];
    console.log(
      `  ${trace.paper} spans ${trace.nodes.length} nodes in ${trace.components.length} ${trace.components.length === 1 ? "piece" : "pieces"}` +
        (bridge.length > 0 ? ` — joined through ≤${bridge.length} uncited (${bridge.join(", ")})` : ""),
    );
  }
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node)) continue;
    for (const { stepId, repetition } of layersMod.repeatedSteps(node)) {
      console.log(`  ${node.id} runs ${stepId} ${repetition.count} (${repetition.closure})`);
    }
  }
  for (const node of LAYER_GRAPH.nodes) {
    if (!isCapability(node)) continue;
    const { unpinned, repeated } = layersMod.foldedAgainst(LAYER_GRAPH, node.id);
    if (repeated.length === 0 || unpinned.length === 0) continue;
    console.log(
      `  ${node.id}: ${repeated.map((r) => r.method.id).join(", ")} repeat it; ${unpinned
        .map((m) => m.id)
        .join(", ")} declare no multiplicity`,
    );
  }
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
