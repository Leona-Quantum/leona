// Every figure-locale's saturated size, tallest first, against the ceiling.
//
// **Why this exists beside the `saturated:` line the layout test already prints.**
// That line reports the corpus-wide widest and tallest, which answers "has the
// corpus outgrown the shape?" but not "will THIS node fit?" — and those come
// apart. Measured 2026-08-12: the tallest figure was `excited-state-energy` at
// 4,402px with 1,098px of headroom, while adding one method to
// `parameter-optimization` took *that* figure to 5,552px and over the ceiling.
// A lane reading only the corpus-wide line would have called the node clear by
// 1,098px when it was short by 52px. The figure a node lands in is the one to
// measure, so this prints all of them.
//
//   node --experimental-strip-types scripts/measure-figure-sizes.mts
//   node --experimental-strip-types scripts/measure-figure-sizes.mts parameter-optimization
//
// With no arguments it sweeps every drawable slot; with slot ids it measures only
// those. The ceiling it prints against is `SIZE_CEILING` in
// `apps/web/lib/repository-converge-layout.test.ts`, which is the gate that
// actually fails — this script reports, it does not enforce, and a number from it
// is a measurement rather than a licence to move that constant.
import { layoutConverge, drawableSlots, type ConvergeDiagram } from "../apps/web/lib/repository/converge-layout.ts";
import { isCapability, layerNode } from "../apps/web/lib/repository/layers.ts";
import { LAYER_GRAPH } from "../apps/web/lib/repository/layer-graph.ts";
import { STATE_VOCABULARY } from "../apps/web/lib/repository/state-vocabulary.ts";
import type { PublicLocale } from "../apps/web/lib/public-locale.ts";

function openableAddresses(id: string): string[] {
  const seen = new Set<string>();
  const walk = (open: ReadonlySet<string>) => {
    const node = layerNode(LAYER_GRAPH, id);
    if (!node || !isCapability(node)) throw new Error(`${id} is not a capability`);
    const diagram = layoutConverge({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, focus: node, locale: "en", open });
    let grew = false;
    // **`feeds` exists before #16 and not after, and this script has to run on both.**
    // An ingredient used to hang off the strand as a `ConvergeFeed`; #16 moved
    // ingredients into the card's Requires section and `ConvergeDiagram.feeds` went
    // with them. Reading it unguarded threw `diagram.feeds is not iterable` the first
    // time this was pointed at that branch. Optional rather than removed, because the
    // script's job is to compare a tree before a change against the same tree after.
    const feeds = (diagram as { feeds?: readonly { openHref: string | null; address: string }[] }).feeds ?? [];
    for (const openable of [...diagram.lanes, ...feeds]) {
      if (openable.openHref === null) continue;
      if (seen.has(openable.address)) continue;
      seen.add(openable.address);
      grew = true;
    }
    if (grew) walk(new Set(seen));
  };
  walk(new Set());
  return [...seen];
}

function openDiagram(id: string, open: Iterable<string>, locale: PublicLocale): ConvergeDiagram {
  const node = layerNode(LAYER_GRAPH, id);
  if (!node || !isCapability(node)) throw new Error(`${id} is not a capability`);
  return layoutConverge({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, focus: node, locale, open: new Set(open) });
}

const only = process.argv.slice(2);
const rows: Array<{ id: string; locale: PublicLocale; width: number; height: number }> = [];
for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
  if (only.length > 0 && !only.includes(focus.id)) continue;
  const addresses = openableAddresses(focus.id);
  for (const locale of ["en", "ja"] as PublicLocale[]) {
    const saturated = openDiagram(focus.id, addresses, locale);
    rows.push({ id: focus.id, locale, width: saturated.width, height: saturated.height });
  }
}

// **A copy, and labelled as one.** `SIZE_CEILING` lives in the layout test and is
// not exported, so these two numbers are hand-mirrored. The output says so rather
// than presenting them as authoritative: if this script and the test ever disagree,
// the test is right and this line is stale.
// Updated 5,500/7,000 → 3,000/3,000 when issue 16 took ingredients off the canvas
// and the ceiling was re-derived from the smaller drawing. The mirror going stale
// is the predicted failure of keeping a copy, so it is worth saying that it did:
// the script kept running and quietly reported 3,554px of headroom against a bar
// that had moved to 1,054px. Same direction as the defect this script exists to
// catch — a number that is right about a tree nobody is on.
const CEILING_MIRROR = { height: 3_000, width: 3_000 } as const;

rows.sort((a, b) => b.height - a.height);
for (const row of rows) {
  const over = row.height > CEILING_MIRROR.height || row.width > CEILING_MIRROR.width;
  console.log(
    `${over ? "OVER " : "     "}${row.height.toFixed(2).padStart(10)}px tall  `
      + `${row.width.toFixed(2).padStart(10)}px wide  ${row.id} (${row.locale})`,
  );
}
const tallest = rows[0];
if (tallest === undefined) {
  console.log("\nno figures measured — check the slot ids passed on the command line");
} else {
  const headroom = CEILING_MIRROR.height - tallest.height;
  console.log(
    `\n${rows.length} figure-locales, against a mirrored ceiling of `
      + `${CEILING_MIRROR.height}px tall / ${CEILING_MIRROR.width}px wide `
      + "(authoritative copy: SIZE_CEILING in apps/web/lib/repository-converge-layout.test.ts).",
  );
  console.log(
    `tallest ${tallest.height.toFixed(2)}px (${tallest.id} ${tallest.locale}) — `
      + `${headroom >= 0 ? `${headroom.toFixed(2)}px of headroom` : `${(-headroom).toFixed(2)}px OVER`}`,
  );
}
