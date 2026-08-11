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
// Usage: node scripts/check-layer-graph.mjs [--quiet] [--unanchored]
//
// `--unanchored` prints the reading list itself rather than its length. The
// audit has always computed `unanchored` and `map-eligibility.ts` has always
// called it "the most concrete statement this repository can make about what
// the map does not yet cover" — but nothing ever printed it, so the only way to
// read it was to edit this file. A list you have to patch the checker to see is
// one nobody consults, which is how its own doc comment came to be quoting
// "61 of the 70" long after the real figure had moved to 53 of 62.

import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

const QUIET = process.argv.includes("--quiet");
const SHOW_UNANCHORED = process.argv.includes("--unanchored");

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
const corpusTitles = new Map(PUBLIC_REPOSITORY_ENTRIES.map((entry) => [entry.slug, entry.title]));
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
// It has never fired — every anchor is an `algorithm-reference` — and that is
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
    sourceKind: entry.source?.kind ?? null,
    sourceUrl: entry.source?.url ?? null,
  })),
);
for (const { nodeId, slug, role } of anchorAudit.ineligible) {
  errors.push(
    `${nodeId}: entries names ${slug}, whose role is ${role ?? "none"} — only ${eligibilityMod.MAP_ELIGIBLE_ROLES.join(", ")} records may be anchored to a layer`,
  );
}
// The second half of the same question, and the reason it is separate: role says
// what a record IS, provenance says what stands behind what it says. A layer
// anchor renders as "the Atlas documents this layer", so a record sourced to our
// own evaluation run would have the Atlas cite us. Fires on nothing today — all
// nine anchors are `curated_reference` — and `qaoa-maxcut-ring` is map-eligible,
// unanchored and sourced to this repository, which is one helpful cross-link
// away from being the first hit.
for (const { nodeId, slug, sourceKind } of anchorAudit.uncitable) {
  errors.push(
    `${nodeId}: entries names ${slug}, whose source is ${sourceKind ?? "unrecorded"} — a layer may only be anchored to a record whose provenance is ${eligibilityMod.MAP_CITABLE_SOURCE_KINDS.join(", ")}`,
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
//     because the plan records this number as 0: *do the method's own work, with
//     a prepared state as the ingredient* — printed as `«own» + needs
//     state-preparation` — is shared by five methods across three slots. It was
//     already non-zero when the rule was written. The wording of that line
//     changed in session 107 when the key stopped being a list of `steps` and
//     became what the canvas draws; the five methods and three slots did not.
//
// ## The key is the drawing, and it must not become a second model of it
//
// **This is the half that was broken, and the way it was broken is the lesson.**
// Until session 107 the key was built from `steps` **plus `via`**, by hand, in
// this file. The canvas built its picture from `routeOf` **minus `via`** —
// `chainInside` labelled every hop with the *slot*, and nothing anywhere read a
// pin. So the two sides disagreed in both directions at once: the gate saw two
// groups where the canvas drew one, reported nothing, and ran green in `lint` on
// every build while three groups of methods drew one picture each. A pin was
// enough to leave this list without being enough to change the drawing.
//
// So the key is now derived from **the same traversal `chainInside` walks**:
// `routeOf` for the hops, `via` for the ones this route has pinned, and the
// feeds `routeOf` files as ingredients rather than stages. `routeOf` is imported
// from `layers.ts` above, so the walk itself is shared code and cannot drift;
// what is written out here is only the *labelling* rule, and it is three lines
// so that a reader can hold it beside `chainInside` and see they agree.
//
// **If `chainInside` changes what a hop is named, this changes with it.** The
// two must not diverge again. In particular:
//
//   - a delegated hop draws the pinned method when `via` names one that fills
//     it, and the slot otherwise — the same fallback and the same resolution
//     check the canvas uses, because a pin the canvas would not honour must not
//     split a group here;
//   - the hop a method performs itself is `«own»` and is deliberately
//     **anonymous**. It carries no name on the canvas: `PlanStrand.nameless` is
//     true for it and `place` draws no text, because the name would be the
//     parent lane's own and that is already on the page. Keying it by the
//     method's id instead would make every route with an own-work tail unique by
//     construction and this check would stop finding anything — the readouts,
//     the two Euler-family quadratures and the two adiabatic solvers all end in
//     one, and all three groups are real;
//   - the ingredients are in the key because the canvas draws them, as named
//     stubs off the belly. They are load-bearing here: `qsvt-transform` and
//     `lcu-chebyshev-transform` walk the identical hops and are told apart only
//     by qsvt needing a phase sequence.
//
// **This is still a model of the drawing, not the drawing.** The assertion that
// measures the real thing is *"no two routes through one slot draw the same
// interior unless something says why"* in `repository-converge-layout.test.ts`,
// which reads lane labels off a rendered `layoutConverge` result. The two are
// not redundant and neither subsumes the other: that one cannot see the four
// fillers of `nonlinear-ode-solve`, because a root's figure is the state chain
// over its dominators and those four routes are aggregated into slot lanes and
// drawn as lanes nowhere — and this one, working from the authored graph, sees
// them. Keep both, and keep them agreeing.
const nodesById = new Map(LAYER_GRAPH.nodes.map((node) => [node.id, node]));

const drawnHops = (method) => {
  const route = routeOf(LAYER_GRAPH, STATE_VOCABULARY, method);
  const hops = route.segments.map((segment) => {
    if (segment.capabilityId === null) return "«own»";
    const pinned = method.via?.[segment.capabilityId];
    const filler = pinned === undefined ? null : nodesById.get(pinned);
    const honoured = filler && isMethod(filler) && filler.realizes === segment.capabilityId;
    return honoured ? pinned : segment.capabilityId;
  });
  return { hops, feeds: route.feeds, holds: route.segments.length >= 2 || route.feeds.length > 0 };
};

const chainOf = (method) => {
  const { hops, feeds } = drawnHops(method);
  return `${hops.join(" → ")}${feeds.length > 0 ? ` + needs ${feeds.join(", ")}` : ""}`;
};

// **Only the methods a reader can actually open**, which is `planForMethod`'s
// own `holds`: two hops or at least one ingredient. The predecessor of this test
// skipped `steps.length === 0` for the same purpose and got it slightly wrong in
// both directions — `backward-euler` named one step that was an ingredient rather
// than a stage and was compared as though it drew a chain (session 118 removed
// that step; `hhl-qpe-inversion`, with three of them, is the live witness now),
// while a method whose every step is an ingredient is genuinely
// openable and was too. What a leaf draws inside is nothing, and two nothings are
// not a duplicate picture; that is why the four atomic phase-factor methods do
// not show up here as one group of four.
const opensIntoSomething = (method) => drawnHops(method).holds;

// A group is **declared** when its members form one refinement chain: exactly one
// member refines nothing inside the group, and every other member names a
// distinct member as what it refines. Two siblings both refining the same parent
// is deliberately *not* enough — they say nothing about each other, which is the
// thing being asked for. **That clause has no witness in the graph today**, so it
// is asserted rather than exercised; it is written the strict way round because
// an unexercised clause that is too permissive is a wrong-reason pass waiting,
// and one that is too strict is an error somebody has to answer.
//
// This is the remedy the error message below has always offered — *"declare one a
// `refines` of another"* — and, until session 106, never honoured: the message
// named a fix that left the error in place, so the only route out was a
// KNOWN_TWINS row for a pair that had already said why. `validateLayerGraph`
// guarantees a `refines` target realizes the same capability, so a chain found
// here cannot silently cross slots.
const refinementChain = (ids) => {
  const members = new Set(ids);
  const parents = ids
    .map((id) => nodesById.get(id)?.refines)
    .filter((parent) => parent !== undefined && members.has(parent));
  if (parents.length !== ids.length - 1) return false;
  return new Set(parents).size === parents.length;
};

// **Re-derived in session 107 against the drawing, not carried forward.** The
// row that used to sit at the top of this list — `krovi-linear-ode` with
// `dyson-all-at-once` under `linear-ode-solve` — is gone, because the two no
// longer draw one picture: `truncated-dyson-series` is authored and
// `dyson-all-at-once` pins its first hop to it, so that hop reads *"Truncated
// Dyson series of the propagator"* where Krovi's still reads *"Discretize time
// or the propagator"*. Krovi keeps its own node by the owner's session-106
// ruling and keeps its unpinned hop, which is the honest drawing: that paper
// re-analyses the construction rather than choosing a different one.
//
// A row is deleted rather than left to lapse. The loop below already errors on a
// row nothing exercises, and that error is the reason this list is worth having
// — a stale exemption is where the next real collision hides.
const KNOWN_TWINS = [
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

// A group carries its slot and its chain as **fields**. The version this
// replaces built one string, `slot + sep + chain`, and took it apart again with
// `key.split(sep)` — and the separator it used for that was a **literal NUL
// byte**, typed into the source, because every other candidate appears inside a
// chain. It worked. It is still worth removing: a NUL renders as a space in
// every viewer that does not go looking for it, so the line read as
// `key.split(" ")` — which would have truncated every chain at its first hop —
// and this session was handed exactly that misreading as a fact to fix. A value
// that has to be split back out of a key was never in the key, and no separator
// has to be chosen at all when nothing is ever taken apart.
const chainGroups = new Map();
for (const node of LAYER_GRAPH.nodes) {
  if (!isMethod(node) || !opensIntoSomething(node)) continue;
  const chain = chainOf(node);
  // The map key still joins the two and still needs a separator no chain can
  // contain — a newline, which no kebab-case id holds and neither joiner above
  // introduces. But nothing reads it back any more, so choosing it wrong can
  // only merge two groups that would have been reported together anyway; it can
  // no longer mislabel one, which is the failure the NUL was defending against.
  const group = chainGroups.get(`${node.realizes}\n${chain}`) ?? {
    slot: node.realizes,
    chain,
    ids: [],
  };
  group.ids.push(node.id);
  chainGroups.set(`${node.realizes}\n${chain}`, group);
}
const matchedTwins = new Set();
for (const { slot, chain, ids } of chainGroups.values()) {
  if (ids.length < 2) continue;
  if (refinementChain(ids)) continue;
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
//
// The same `chainOf` and the same `opensIntoSomething` as the failable half, so
// the printed line and the error describe one drawing. Holders carry their slot
// beside them rather than joined into a string, for the reason the group above
// stopped joining: nothing then has to know a separator to read it back.
{
  const acrossSlots = new Map();
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node) || !opensIntoSomething(node)) continue;
    const chain = chainOf(node);
    acrossSlots.set(chain, [
      ...(acrossSlots.get(chain) ?? []),
      { slot: node.realizes, id: node.id },
    ]);
  }
  for (const [chain, held] of acrossSlots) {
    const slots = new Set(held.map((holder) => holder.slot));
    const holders = held.map((holder) => `${holder.slot}/${holder.id}`);
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
  if (SHOW_UNANCHORED) {
    // The role census, because `eligible` above is a denominator and a
    // denominator with no breakdown cannot be checked. `map-eligibility.ts`
    // carries this same table in prose and it had drifted by eight records
    // before anything printed it.
    const byRole = new Map();
    for (const entry of PUBLIC_REPOSITORY_ENTRIES) {
      const role = topicsMod.roleOf(entry.topics ?? []) ?? "(none)";
      byRole.set(role, (byRole.get(role) ?? 0) + 1);
    }
    console.log(
      `    roles: ${[...byRole.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([role, count]) => `${role} ${count}`)
        .join(" · ")}`,
    );
    // What the list would cost, before anyone starts working it. Both lines are
    // caveats on the reading list rather than errors: the first says one of
    // these records cannot be anchored as it stands whatever a session decides
    // about the map, the second says how many of them lean on one document —
    // which is the difference between "write 53 cross-links" and "find 25
    // primary papers first".
    if (anchorAudit.unanchorableProvenance.length > 0) {
      console.log(
        `    not anchorable as they stand (provenance): ${anchorAudit.unanchorableProvenance.join(", ")}`,
      );
    }
    for (const { url, slugs } of anchorAudit.sharedSources) {
      console.log(`    ${slugs.length} of the ${anchorAudit.unanchored.length} share one source: ${url}`);
    }
    // Printed one per line with its title, because a bare slug does not tell you
    // whether the record is a method the map is missing or a survey that no node
    // could honestly anchor — and that judgement is the whole of the work.
    for (const slug of anchorAudit.unanchored) {
      console.log(`    ${slug}\t${corpusTitles.get(slug) ?? "(no title)"}`);
    }
  }
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
