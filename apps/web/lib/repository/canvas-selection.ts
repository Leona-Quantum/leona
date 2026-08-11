// `?sel=` — which drawn thing the reader is ON, as URL state (W16, the Prezi
// move: "zoom onto, center, and persist showing the highlighted item with the
// rest of the map around it" — owner, s121 inbox).
//
// Two halves, mirroring `canvas-viewport.ts`'s server/client split:
//
// - `resolveSelection` runs on the server: given the drawn figures, it names at
//   most ONE element to highlight, so `?sel=` is honest SSR state — a shared
//   link highlights with JavaScript off, exactly like `?at=` pans without it.
// - `carrySelection` runs in the client interceptor (`canvas-continuity.tsx`):
//   it derives the next `sel` purely from how the URL is about to change, so
//   the rules are testable with no DOM and the no-JS behaviour is untouched (a
//   full navigation simply doesn't gain a selection, the same enhancement
//   contract CanvasContinuity itself has).
//
// The camera move that follows a selection lives in `infinite-canvas.tsx` and
// the math in `canvas-viewport.ts` (`centerOn`); this file never computes a
// viewport. `sel` is selection *identity*; `at` stays the camera. The two are
// deliberately separate parameters: a reader who pans away from their selection
// has not deselected it.

import { isViewportValue } from "./canvas-viewport.ts";
import type { ConvergeDiagram } from "./converge-layout.ts";

export const SEL_PARAM = "sel";

/**
 * The one drawn element `?sel=` names, or null.
 *
 * `sel` accepts what `?open=` holds — a lane address (`"1.0.3"`) or a node id —
 * plus a state id, because selections come from clicks on all three. Matching
 * order is specificity: an address names one drawn occurrence outright; a state
 * id names its circle; a node id can be drawn several times since W15 (one host
 * plus demoted references), so it falls to the first lane or feed drawing it.
 * First figure wins on the unfocused overview — an address is only unambiguous
 * within one figure, and the focused view (where selection actually happens)
 * draws exactly one.
 */
export function resolveSelection(
  sel: string | null,
  diagrams: readonly ConvergeDiagram[],
): { figure: number; laneAddress: string | null; stateKey: string | null; feedKey: string | null } | null {
  if (!sel) return null;
  for (const [figure, diagram] of diagrams.entries()) {
    const byAddress = diagram.lanes.find((lane) => lane.address === sel);
    if (byAddress) return { figure, laneAddress: byAddress.address, stateKey: null, feedKey: null };
    // An ingredient's control lives on its stub, so opening one puts a FEED
    // address into `?open=` — the address pass has to look there too, or a
    // selected ingredient would only ever match by node id.
    const byFeedAddress = diagram.feeds.find((feed) => feed.address === sel);
    if (byFeedAddress) return { figure, laneAddress: null, stateKey: null, feedKey: byFeedAddress.key };
  }
  for (const [figure, diagram] of diagrams.entries()) {
    const byStateId = diagram.states.find((state) => state.stateId === sel);
    if (byStateId) return { figure, laneAddress: null, stateKey: byStateId.key, feedKey: null };
  }
  for (const [figure, diagram] of diagrams.entries()) {
    const byNodeId = diagram.lanes.find((lane) => lane.nodeId === sel);
    if (byNodeId) return { figure, laneAddress: byNodeId.address, stateKey: null, feedKey: null };
    const byFeed = diagram.feeds.find((feed) => feed.nodeId === sel);
    if (byFeed) return { figure, laneAddress: null, stateKey: null, feedKey: byFeed.key };
  }
  return null;
}

/**
 * Write the next URL's `sel`, given how the click is changing the query.
 *
 * Called by the interceptor after its `at` substitution, with `current` = the
 * live `window.location` params and `next` = the params about to be pushed.
 * Mutates `next`, the same contract the substitution has. The rules, in
 * precedence order — each one is a statement about what the click *meant*:
 *
 * 1. **A W15 jump.** The demoted-lane control writes the host's lane address
 *    into `?at=`, where `parseViewport` rejects it into IDENTITY — "jump to the
 *    host" shipped as "reset the camera and look for it yourself". Here it
 *    becomes what it meant: the address moves to `sel` (the camera then flies
 *    to it), and the live viewport is carried so the ground does not shift
 *    under the fly's start.
 * 2. **Opening a card is selecting its node — unless the href already said
 *    WHERE.** The map's own card links carry the clicked occurrence's address
 *    in `?sel=` (`withCard`'s third argument), and that address is the click's
 *    meaning: deriving from the card id instead would fall to the first drawn
 *    occurrence of the node, which is what flew the owner's "quantum linear
 *    solve" click to the same-named process elsewhere on the map. A card href
 *    with no `sel` of its own (the panel's internal links) still selects the
 *    carded node by id, as before. Closing a card keeps the selection — the
 *    reader finished reading, they did not leave the thing.
 * 3. **Opening a lane is selecting it.** A value added to `?open=` becomes the
 *    selection (a click adds at most one).
 * 4. **Shutting the selected lane deselects it.** A value removed from
 *    `?open=` clears `sel` only if `sel` named it — shutting some *other* lane
 *    is not a statement about the selection.
 * 5. Otherwise the selection rides along unchanged.
 */
export function carrySelection(current: URLSearchParams, next: URLSearchParams): void {
  const at = next.get("at");
  if (at !== null && !isViewportValue(at)) {
    next.delete("at");
    const live = current.get("at");
    if (live !== null && isViewportValue(live)) next.set("at", live);
    next.set(SEL_PARAM, at);
    return;
  }

  const card = next.get("card");
  if (card !== null && card !== current.get("card")) {
    if (!next.has(SEL_PARAM)) next.set(SEL_PARAM, card);
    return;
  }

  const currentOpen = new Set(current.getAll("open"));
  const nextOpen = new Set(next.getAll("open"));
  const added = [...nextOpen].find((value) => !currentOpen.has(value));
  if (added !== undefined) {
    next.set(SEL_PARAM, added);
    return;
  }

  const sel = current.get(SEL_PARAM);
  if (sel === null) return;
  const removed = [...currentOpen].some((value) => !nextOpen.has(value) && value === sel);
  if (removed) return;
  next.set(SEL_PARAM, sel);
}

/**
 * Write the next URL's `paper` — the W20 paper surface's identity, carried the
 * way `sel` is, and for the same reason: the map's own links cannot name it
 * (`figureHref` builds them without one), so without this rule the paper's
 * highlight and panel would vanish on the reader's first click, exactly the
 * exploration the owner asked the surface to survive ("person can isolate the
 * path and explore it deeper").
 *
 * Two rules, in order:
 *
 * 1. **An href that mentions `paper` at all is a statement about it.** A
 *    non-empty value opens that paper's surface; the EMPTY value is the close
 *    control's tombstone — the server reads it as "no paper", and writing it
 *    (rather than omitting the key) is the only way a close can survive this
 *    very rule. Either way the href's word stands.
 * 2. **Silence carries.** No `paper` key in the href and a non-empty one live
 *    means the click was about something else; the surface rides along.
 *
 * No-JS keeps the degraded contract every enhancement here has: a full
 * navigation lands on the href as written — opens persist (they are concrete
 * values in every link), the highlight and panel end.
 */
export const PAPER_PARAM = "paper";

export function carryPaper(current: URLSearchParams, next: URLSearchParams): void {
  if (next.has(PAPER_PARAM)) return;
  const live = current.get(PAPER_PARAM);
  if (live !== null && live !== "") next.set(PAPER_PARAM, live);
}
