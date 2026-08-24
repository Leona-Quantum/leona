// Dump one payload JSON per method with an unauthored hop in the named region —
// the drafting worklist for a `record-a-corpus-batch` run.
//
// **Read off `regionClosure` and `routeOf`, never hand-listed.** The gauge already
// knows which stretches are unauthored; a second list assembled by hand is the
// thing that goes stale first, and a batch drafted against a stale worklist writes
// notes for hops that are already closed and misses the ones that are not.
//
// Each payload carries what a drafter must NOT repeat as well as what it needs: the
// slot's own `whyALayer`, the method's already-shipped own-stretch note, its summary,
// conditions and cost. Every one of those is on the page above the note being written.
//
//   node scripts/dump-hop-payloads.mjs <slot,slot,...> <out-dir>
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

async function bundle(rel, label) {
  const outDir = mkdtempSync(join(tmpdir(), "lg-"));
  const outFile = join(outDir, `${label}.mjs`);
  await esbuild.build({ entryPoints: [join(root, rel)], bundle: true, format: "esm", platform: "neutral", outfile: outFile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outFile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const graphMod = await bundle("apps/web/lib/repository/layer-graph.ts", "layer-graph");
const layersMod = await bundle("apps/web/lib/repository/layers.ts", "layers");
const statesMod = await bundle("apps/web/lib/repository/state-vocabulary.ts", "state-vocabulary");
const { LAYER_GRAPH } = graphMod;
const { STATE_VOCABULARY } = statesMod;
const { routeOf, isCapability, isMethod, regionClosure } = layersMod;

const SLOTS = process.argv[2].split(",");
const OUT = process.argv[3];
mkdirSync(OUT, { recursive: true });

const node = (id) => LAYER_GRAPH.nodes.find((n) => n.id === id);
const region = regionClosure(LAYER_GRAPH, STATE_VOCABULARY, SLOTS, new Map());

const byMethod = new Map();
for (const hop of region.unauthoredHops) {
  if (!byMethod.has(hop.method)) byMethod.set(hop.method, []);
  byMethod.get(hop.method).push(hop.key);
}

const stateLabel = (id) => STATE_VOCABULARY.states.find((s) => s.id === id)?.label ?? id;

for (const [methodId, keys] of byMethod) {
  const m = node(methodId);
  const route = routeOf(LAYER_GRAPH, STATE_VOCABULARY, m);
  // walk the route to get each segment's from/to
  const stretchInfo = [];
  for (let i = 0; i < route.segments.length; i += 1) {
    const seg = route.segments[i];
    const key = seg.capabilityId ?? seg.methodId;
    const from = route.states[i];
    const to = route.states[i + 1];
    stretchInfo.push({ key, from, to, own: seg.capabilityId === null });
  }
  const payload = {
    id: m.id,
    label: m.label,
    shortLabel: m.shortLabel ?? null,
    realizes: m.realizes ?? null,
    summary: m.summary ?? null,
    conditions: m.conditions ?? null,
    cost: m.cost ?? null,
    steps: m.steps ?? [],
    repeats: m.repeats ?? null,
    authoredHops: Object.entries(m.hops ?? {}).map(([k, v]) => ({ key: k, name: v.name ?? null, theory: v.theory ?? null })),
    routeShape: {
      states: route.states,
      segments: route.segments.map((s) => ({ key: s.capabilityId ?? s.methodId, own: s.capabilityId === null })),
      feeds: route.feeds,
      coverage: route.coverage,
    },
    unauthoredStretches: keys.map((key) => {
      const info = stretchInfo.find((s) => s.key === key);
      const slot = key === m.id ? null : node(key);
      const isFeed = route.feeds.includes(key);
      return {
        stepId: key,
        own: key === m.id,
        kind: key === m.id ? "own" : isFeed ? "ingredient" : "chain-hop",
        rendersOn: key === m.id ? "the route's own stretch" : isFeed ? "the card's Requires list and the method page's Requires section (CardIngredient.theory)" : "the route chain",
        repetition: (m.repeats ?? {})[key] ?? null,
        slotLabel: slot?.label ?? "(this method's own stretch)",
        from: info?.from ?? null,
        to: info?.to ?? null,
        fromLabel: info ? stateLabel(info.from) : null,
        toLabel: info ? stateLabel(info.to) : null,
        whyALayer: slot && isCapability(slot) ? (slot.whyALayer ?? null) : null,
        slotSummary: slot?.summary ?? null,
        otherMethodsInSlot: slot ? LAYER_GRAPH.nodes.filter((n) => isMethod(n) && n.realizes === key).map((n) => n.id) : [],
      };
    }),
    citations: m.citations ?? [],
    record: m.record ?? null,
  };
  writeFileSync(join(OUT, `${m.id}.json`), JSON.stringify(payload, null, 1) + "\n");
}
console.log(`wrote ${byMethod.size} payloads (${region.unauthoredHops.length} stretches)`);
for (const [k, v] of byMethod) console.log(`  ${k}: ${v.join(", ")}`);
