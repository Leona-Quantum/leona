// `?paper=` — a paper's pipeline, revealed on the map (W20, NORTH-STAR stage B).
//
// The owner's spec, verbatim: "when clicking a paper, it automatically opens up
// and expands only branches needed to show the exact path of the paper, other
// branches that remain open that aren't relevant are closed."
//
// A paper knows which NODES cite it (`paper-traces.ts`); the map opens by
// ADDRESSES — positions in one figure's drawn tree, gated so a child only
// draws when its whole ancestor chain is open. This module is the bridge: from
// a paper to (which figure, which addresses to open, where the camera should
// land), derived entirely from citations. Nothing here is authored — a new
// citation moves the map without a second bookkeeping site (D-W20.1).
//
// It works through `layoutConverge`'s PUBLIC api on purpose (D-W20.4): the
// address of a lane is a fact about the drawn tree, and the only honest way to
// learn it without a second copy of the planner's rules is to draw. Each
// figure is drawn to saturation once — open everything that offers a control,
// re-draw, repeat until nothing grows (the fixed point the layout test's walk
// established) — and the result is memoized per figure for the process
// lifetime. The graph is static per build, so the walk is a startup cost, not
// a per-request one; that is what makes "one navigation, N branches" (the
// map-render recon's constraint) affordable.

import type { LayerGraph } from "./layers.ts";
import type { StateVocabulary } from "./states.ts";
import { layoutConverge, drawableSlots, CONVERGE_OPEN_MAX } from "./converge-layout.ts";
import { layerNode, isCapability, isMethod } from "./layers.ts";
import { paperTraces, traceFor, type PaperTrace } from "./paper-traces.ts";
import { paperIdFromSlug, type PaperId } from "./papers.ts";

export const PAPER_PARAM = "paper";

/** One drawn occurrence of a cited node, at its shallowest address. */
export interface RevealedNode {
  nodeId: string;
  /** The occurrence's own address — what `?sel=` can land on. */
  address: string;
}

/**
 * A cited method that draws NO lane of its own because W17 folded it into its
 * host (`sameInternalsAsParent`): the host's drawn lane IS this refinement's
 * internals, by the fold's own definition, so the host is where the paper's
 * presence honestly lands. Before this bucket existed (v2), these nodes fell
 * into `elsewhere` — and the panel's "sits elsewhere on the map" was false for
 * every one of them: a folded node sits nowhere; it sits INSIDE a drawn lane.
 */
export interface FoldedNode {
  nodeId: string;
  /** The method whose drawn lane carries this refinement's internals. */
  hostId: string;
  /** The host's revealed occurrence — what the highlight and camera can use. */
  hostAddress: string;
}

export interface PaperReveal {
  paperId: PaperId;
  /** Every node citing the paper — the highlight set, drawn or not. */
  cited: readonly string[];
  /** The figure that draws the most of the paper's cited nodes. */
  focusId: string;
  /**
   * The ancestor addresses whose opening draws every revealed occurrence —
   * the `?open=` set the paper link arrives with. Deduplicated, layout order.
   */
  open: readonly string[];
  /**
   * Where the camera lands: the first node of the paper's largest trace
   * component that this figure draws, at its shallowest occurrence. Null when
   * the figure draws the focus alone (a slot-citing point paper).
   */
  sel: string | null;
  /** Every cited node this figure draws, with its revealed occurrence. */
  drawn: readonly RevealedNode[];
  /** Cited methods folded (W17) into lanes this figure draws — see `FoldedNode`. */
  folded: readonly FoldedNode[];
  /**
   * Cited nodes drawn on some OTHER figure — themselves, or (folded) through
   * their host. The population test holds that claim per node: before v2 this
   * bucket also swallowed folded and never-drawn nodes, and the panel's "sits
   * elsewhere on the map" was false for every one of them.
   */
  elsewhere: readonly string[];
  /**
   * Cited nodes drawn on NO figure at all — the map's own coverage gap,
   * stated instead of mislabeled. The parity workstream (the 53-record
   * audit) is what closes these; the panel names the count so a reader is
   * told the truth rather than sent hunting for a lane that does not exist.
   */
  undrawn: readonly string[];
  /** Reveal addresses dropped at `CONVERGE_OPEN_MAX`. 0 on today's corpus. */
  dropped: number;
}

/** nodeId → every drawn occurrence address, shallowest first. */
type OccurrenceMap = ReadonlyMap<string, readonly string[]>;

const saturationCache = new WeakMap<LayerGraph, Map<string, OccurrenceMap>>();
const traceCache = new WeakMap<LayerGraph, readonly PaperTrace[]>();

function tracesOf(graph: LayerGraph): readonly PaperTrace[] {
  let traces = traceCache.get(graph);
  if (!traces) {
    traces = paperTraces(graph);
    traceCache.set(graph, traces);
  }
  return traces;
}

/**
 * Draw one figure to saturation and index every occurrence by node id.
 *
 * The walk is the layout test's fixed point: open every lane that offers an
 * `openHref`, re-draw, repeat until no address is new. Feeds carry no open
 * control, so lanes alone drive the growth; feeds are still indexed — an
 * ingredient stub is a drawn occurrence a reveal may want to land on.
 * Occurrence addresses are positions in the plan tree, so an address observed
 * at saturation is the same address in any smaller open set — the gating
 * changes what DRAWS, never where a thing sits (the verification sweep in the
 * test re-draws with only the reveal set and finds every occurrence again,
 * which is the assertion that would catch this premise going stale).
 */
function saturatedOccurrences(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  focusId: string,
): OccurrenceMap {
  let byFocus = saturationCache.get(graph);
  if (!byFocus) {
    byFocus = new Map();
    saturationCache.set(graph, byFocus);
  }
  const cached = byFocus.get(focusId);
  if (cached) return cached;

  const focus = layerNode(graph, focusId);
  if (!focus || !isCapability(focus)) {
    const empty: OccurrenceMap = new Map();
    byFocus.set(focusId, empty);
    return empty;
  }

  const open = new Set<string>();
  let diagram = layoutConverge({ graph, vocabulary, focus, locale: "en" });
  for (let round = 0; round < 16; round++) {
    let grew = false;
    for (const lane of diagram.lanes) {
      if (lane.openHref === null || open.has(lane.address)) continue;
      open.add(lane.address);
      grew = true;
    }
    if (!grew) break;
    diagram = layoutConverge({ graph, vocabulary, focus, locale: "en", open });
  }

  const occurrences = new Map<string, string[]>();
  const note = (nodeId: string | null, address: string) => {
    if (nodeId === null || nodeId === "") return;
    const list = occurrences.get(nodeId) ?? [];
    list.push(address);
    occurrences.set(nodeId, list);
  };
  // `draws`, not `nodeId`: 34 of the 63 methods are leaves with nothing
  // inside, and `planForMethod` gives their lanes `id: null` — the lane's
  // subject lives in `draws` (the node whose card it opens). Keying on
  // `nodeId` alone loses every leaf method, which was measured as 48 of 86
  // papers "revealing nowhere" before this line said `draws`.
  for (const lane of diagram.lanes) note(lane.draws ?? lane.nodeId, lane.address);
  for (const feed of diagram.feeds) note(feed.nodeId, feed.address);
  for (const list of occurrences.values()) {
    list.sort((a, b) => depthOf(a) - depthOf(b) || (a < b ? -1 : 1));
  }
  byFocus.set(focusId, occurrences);
  return occurrences;
}

/**
 * The method this node is folded into (W17), or null when it draws itself.
 *
 * `refines` is the host by the fold's own construction: `sameInternalsAsParent`
 * is only valid ON a refinement, and validation refuses the flag when the
 * chain facts differ from the parent's — so the parent's lane drawing IS this
 * node's internals drawing, which is what lets a reveal claim it honestly.
 */
function foldHostOf(graph: LayerGraph, nodeId: string): string | null {
  const node = layerNode(graph, nodeId);
  if (!node || !isMethod(node) || node.sameInternalsAsParent !== true) return null;
  return node.refines ?? null;
}

/** How many segments below the root pair — `s:0.1` is 0, `s:0.1.2` is 1. */
function depthOf(address: string): number {
  const cut = address.indexOf(":");
  return address.slice(cut + 1).split(".").length - 2;
}

/**
 * The proper ancestors whose opening lets `address` draw: every prefix down to
 * the two-segment root. The occurrence itself is NOT in the chain — a lane
 * draws shut the moment its parents are open, and shut is drawn.
 *
 * The full chain over-opens — measured, not assumed: a ROOT lane draws open
 * the moment any deeper value under it is in the set, while a depth-1-or-lower
 * lane opens only on its exact address (`open={s:1.1.1.1.1}` drew `s:1.1`
 * open, `s:1.1.1` shut, deeper absent). Rather than encode that rule here — a
 * second copy of the planner's matching, exactly what this module refuses to
 * hold — the chains go in whole and `prune` asks the layout itself what is
 * dead weight.
 */
function ancestorsOf(address: string): string[] {
  const cut = address.indexOf(":");
  const subject = address.slice(0, cut);
  const segments = address.slice(cut + 1).split(".");
  const chain: string[] = [];
  for (let length = 2; length < segments.length; length++) {
    chain.push(`${subject}:${segments.slice(0, length).join(".")}`);
  }
  return chain;
}

/** Every drawn address under this focus and open set — the layout's own answer. */
function drawnUnder(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  focusId: string,
  open: readonly string[],
): Set<string> {
  const focus = layerNode(graph, focusId);
  const addresses = new Set<string>();
  if (!focus || !isCapability(focus)) return addresses;
  const diagram = layoutConverge({ graph, vocabulary, focus, locale: "en", open: new Set(open) });
  for (const lane of diagram.lanes) addresses.add(lane.address);
  for (const feed of diagram.feeds) addresses.add(feed.address);
  return addresses;
}

/**
 * Drop every address whose removal leaves all targets drawn — shallowest
 * first, so an implicitly-opening root goes before the chain that implies it.
 * One re-draw per candidate; the layout is milliseconds and the reveal is a
 * handful of addresses, which is why asking beats modelling.
 */
function prune(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  focusId: string,
  open: readonly string[],
  targets: readonly string[],
): string[] {
  let current = [...open].sort((a, b) => depthOf(a) - depthOf(b) || (a < b ? -1 : 1));
  for (const candidate of [...current]) {
    const without = current.filter((address) => address !== candidate);
    const drawn = drawnUnder(graph, vocabulary, focusId, without);
    if (targets.every((target) => drawn.has(target))) current = without;
  }
  return current;
}

/**
 * The reveal for one paper, or null when the register does not know the slug /
 * id, or no figure draws any of its citing nodes.
 *
 * The figure is chosen by coverage: the drawable slot whose saturated figure
 * draws the most of the paper's cited nodes, first-listed winning a tie so the
 * choice is deterministic. A cited node that IS the chosen focus counts as
 * drawn — the whole figure is its occurrence — but contributes no address.
 */
export function paperRevealFor(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  slugOrId: string,
): PaperReveal | null {
  const paperId = paperIdFromSlug(slugOrId) ?? (slugOrId.includes(":") ? (slugOrId as PaperId) : null);
  if (paperId === null) return null;
  const trace = traceFor(tracesOf(graph), paperId);
  if (trace === null) return null;

  let bestFocus: string | null = null;
  let bestDrawnCount = 0;
  for (const slot of drawableSlots(graph, vocabulary)) {
    const occurrences = saturatedOccurrences(graph, vocabulary, slot.id);
    let count = 0;
    for (const nodeId of trace.nodes) {
      if (nodeId === slot.id || occurrences.has(nodeId)) {
        count += 1;
        continue;
      }
      // A folded method counts where its HOST draws (v2): before this line,
      // a paper cited only by folded methods scored 0 on every figure and
      // revealed nowhere — the 387 residual.
      const host = foldHostOf(graph, nodeId);
      if (host !== null && occurrences.has(host)) count += 1;
    }
    if (count > bestDrawnCount) {
      bestDrawnCount = count;
      bestFocus = slot.id;
    }
  }
  if (bestFocus === null) return null;

  const occurrences = saturatedOccurrences(graph, vocabulary, bestFocus);

  // Does this node draw a lane on ANY figure? Every slot's saturation is
  // already memoized by the focus choice above, so this is a lookup, not a
  // walk. A drawable slot IS drawn — as its own figure.
  const drawsAnywhere = (nodeId: string): boolean => {
    for (const slot of drawableSlots(graph, vocabulary)) {
      if (slot.id === nodeId) return true;
      if (saturatedOccurrences(graph, vocabulary, slot.id).has(nodeId)) return true;
    }
    return false;
  };

  const drawn: RevealedNode[] = [];
  const folded: FoldedNode[] = [];
  const elsewhere: string[] = [];
  const undrawn: string[] = [];
  for (const nodeId of trace.nodes) {
    const list = occurrences.get(nodeId);
    if (list && list.length > 0) {
      drawn.push({ nodeId, address: list[0]! });
      continue;
    }
    if (nodeId === bestFocus) continue;
    const host = foldHostOf(graph, nodeId);
    const hostList = host !== null ? occurrences.get(host) : undefined;
    if (host !== null && hostList && hostList.length > 0) {
      folded.push({ nodeId, hostId: host, hostAddress: hostList[0]! });
    } else if (drawsAnywhere(nodeId) || (host !== null && drawsAnywhere(host))) {
      elsewhere.push(nodeId);
    } else {
      undrawn.push(nodeId);
    }
  }

  // Host occurrences are reveal targets exactly like drawn ones: the fold's
  // presence is the host lane, so the open set must make the host draw.
  const anchors = [...drawn.map((node) => node.address), ...folded.map((node) => node.hostAddress)];
  const chains = new Set<string>();
  for (const address of anchors) for (const ancestor of ancestorsOf(address)) chains.add(ancestor);
  const open = prune(graph, vocabulary, bestFocus, [...chains], anchors);

  // The cap guard. Unreachable on today's corpus — the population sweep pins
  // every reveal at ≤ a handful — but the parameter this feeds is capped, and
  // a reveal that silently exceeded it would open an arbitrary prefix of
  // itself. Deepest-first drop: losing a deep ancestor hides one leaf; losing
  // a shallow one hides a whole branch.
  let dropped = 0;
  while (open.length > CONVERGE_OPEN_MAX) {
    open.pop();
    dropped += 1;
  }

  // The camera's landing: the largest component's first drawn member. Largest
  // by membership among the DRAWN nodes — a component this figure draws none
  // of cannot host the entry, however large it is elsewhere.
  let sel: string | null = null;
  const drawnIds = new Map(drawn.map((node) => [node.nodeId, node.address]));
  let bestComponent: readonly string[] | null = null;
  let bestMembers = 0;
  for (const component of trace.components) {
    const members = component.filter((nodeId) => drawnIds.has(nodeId)).length;
    if (members > bestMembers) {
      bestMembers = members;
      bestComponent = component;
    }
  }
  if (bestComponent) {
    const entry = bestComponent.find((nodeId) => drawnIds.has(nodeId));
    if (entry !== undefined) sel = drawnIds.get(entry)!;
  }
  // A paper whose figure presence is all fold hosts still needs a landing:
  // the first host occurrence is where the camera can honestly point.
  if (sel === null && folded.length > 0) sel = folded[0]!.hostAddress;

  return {
    paperId,
    cited: trace.nodes,
    focusId: bestFocus,
    open: [...open],
    sel,
    drawn,
    folded,
    elsewhere,
    undrawn,
    dropped,
  };
}
