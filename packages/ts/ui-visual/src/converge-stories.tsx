// Atlas convergence figures, rendered from the **real** `apps/web` source the same way
// the component stories are — no Next, no server, no auth. Imported by relative path
// rather than through a package name on purpose: `@majorana/web` is a Next app, and
// depending on it here would pull Next into a harness whose whole point is not having it.
// `ConvergeCanvas` has no `"use client"` and imports nothing but types and its own layout,
// so esbuild bundles it as a plain function of its props.
//
// **Why these exist at all.** The layout half of the map is guarded heavily in
// `repository-converge-layout.test.ts`, and that file cannot see the renderer: it measures
// numbers, and `.mj-converge-name-plate` is a `<rect>` whose job is to be *at least as big
// as text it does not compute*. Delete the plate, or shrink it, and every layout test stays
// green while every opened name goes illegible. That is the hole `tests/converge-plate.spec.ts`
// closes, and it needs a browser because only a browser knows how wide the text drew.
import { ConvergeCanvas } from "../../../../apps/web/components/repository-converge-map";
import {
  drawableSlots,
  layoutConverge,
  type ConvergeDiagram,
} from "../../../../apps/web/lib/repository/converge-layout";
import { LAYER_GRAPH } from "../../../../apps/web/lib/repository/layer-graph";
import { STATE_VOCABULARY } from "../../../../apps/web/lib/repository/state-vocabulary";
import { isCapability, layerNode } from "../../../../apps/web/lib/repository/layers";
import type { PublicLocale } from "../../../../apps/web/lib/public-locale";
import type { Story } from "./stories";

/**
 * Everything the figure offers to open, opened.
 *
 * Saturated rather than sampled: a plate is only drawn for a lane that is
 * `bone` — an opened fan — so a figure with nothing open draws **no plates at
 * all** and a spec run against it would pass while asserting nothing. That is
 * the vacuous-guard shape this repository has shipped before, so the spec
 * counts what it checked and the count is pinned.
 *
 * Fixed-point rather than one pass: opening a line reveals lines inside it, and
 * those are the deep cases where the plate has the least room.
 */
function saturate(focusId: string, locale: PublicLocale): ConvergeDiagram | null {
  const focus = layerNode(LAYER_GRAPH, focusId);
  if (!focus || !isCapability(focus)) return null;
  // `lane.address` **and `feed.address`** — the same accumulation
  // `openableAddresses` does in the layout test file, deliberately, so the two
  // guards cover the same figures. Reading `?open=` back out of `lane.openHref`
  // was the first version and it opened a third as many lanes, because an href is
  // a whole new address list rather than the one thing that lane adds.
  //
  // **`diagram.feeds` was missing, and the sentence above was false because of
  // it.** #328 made an ingredient's stub a control — the fan of methods that
  // opens beneath it is drawn by `place` like any other strand — and added
  // `feed.address` to the layout test's walk. This one kept walking lanes only,
  // so every figure rendered here has had **no opened ingredient in it at all**
  // since that shipped: `mj-converge-feed--open` appears 144 times across the
  // stories and every one of them is in the inlined stylesheet. A whole feature's
  // render-level surface, uncovered, while the two walks were documented as one.
  const open = new Set<string>();
  for (let round = 0; round < 12; round += 1) {
    const diagram = layoutConverge({
      graph: LAYER_GRAPH,
      vocabulary: STATE_VOCABULARY,
      focus,
      locale,
      open,
    });
    let grew = false;
    for (const openable of [...diagram.lanes, ...diagram.feeds]) {
      if (openable.openHref === null || open.has(openable.address)) continue;
      open.add(openable.address);
      grew = true;
    }
    if (!grew) break;
  }
  return layoutConverge({
    graph: LAYER_GRAPH,
    vocabulary: STATE_VOCABULARY,
    focus,
    locale,
    open,
  });
}

/**
 * Every figure the Atlas can draw, in both locales.
 *
 * Swept rather than sampled for the same reason the layout tests sweep: which
 * lanes come out `bone` — the only ones that get a plate — depends on the route
 * walk, and a hand-picked list would report "the plate is fine" when what
 * actually happened is that the case was never drawn. Three subjects produced 18
 * plates; the sweep produces enough that the spec's floor is a real floor.
 *
 * Both locales, because the plate's height was set from a *Japanese*
 * measurement — a 12px Japanese name draws 15.2px tall and a 14px plate left
 * 1.2px of it uncovered, which is exactly the row of pixels a dotted line runs
 * through. A guard that only rendered English would not have caught that and
 * would not catch it coming back.
 */
const SUBJECTS: readonly string[] = drawableSlots(LAYER_GRAPH, STATE_VOCABULARY).map(
  (slot) => slot.id,
);

export const CONVERGE_STORIES: Story[] = SUBJECTS.flatMap((id) =>
  (["en", "ja"] as const).flatMap((locale) => {
    const diagram = saturate(id, locale);
    if (!diagram || diagram.empty) return [];
    const node = layerNode(LAYER_GRAPH, id);
    return [
      {
        name: `converge-${id}-${locale}`,
        title: `Converge map: ${id} (${locale}), fully opened`,
        lang: locale,
        wide: true,
        node: (
          <ConvergeCanvas
            diagram={diagram}
            locale={locale}
            title={node ? (locale === "ja" ? node.labelJa : node.label) : id}
            subjectId={id}
          />
        ),
      } satisfies Story,
    ];
  }),
);
