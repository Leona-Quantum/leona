// The strand layout: the layer graph as geometry, before anything draws it.
//
// > *"i'm thinking on muscle strands, where the shape is a pinched oval and they
// > enter and exit through refined one point, and subcells and fibers hold that
// > same shape and branch off then converge back into larger shapes."*
// > — owner, session-89 inbox
//
// ## The mapping, and why it is not a metaphor
//
// The owner described a shape and it turned out to be the shape the data already
// has. A **capability** is a slot with exactly one contract — `takes` on one side,
// `returns` on the other — so it genuinely does enter and exit through one point,
// and the pinch is that contract rather than a drawing flourish. A **method** is
// one way through it, so the methods realising a capability genuinely do branch
// off at the entry and converge back at the exit. A method's `steps` are
// themselves capabilities, so a fiber genuinely is made of smaller pinched ovals
// in series. Nothing here is invented to fit the picture; every line on the
// canvas is an edge that `layers.ts` already publishes.
//
// That is also the honest limit of it. This module draws the **layer graph**, 76
// authored nodes, and it must never be pointed at the 283-record corpus: 196 of
// those records meet nothing at either edge and 120 end in a measurement, so a
// strand view of the corpus would be dust with four threads in it. The Atlas
// listing is the right surface for a set that does not compose. D90.1.
//
// ## Why the geometry lives here and not in the component
//
// Two reasons, and the second is the one that matters.
//
// 1. It is testable. `strand-layout.test.ts` asserts that children stay inside
//    their parent, that no two lanes overlap, and that the recursion terminates —
//    none of which is checkable by looking at a screenshot, and all of which
//    breaks silently when a node is added.
// 2. **It runs on the server.** The diagram is `<svg>` with real `<a href>` in it,
//    rendered in the HTML that arrives from the origin. A canvas that lays itself
//    out in an effect has no address for any node in it, is invisible to a
//    crawler and to a reader with no JS, and cannot be verified with `curl` —
//    D88.2, and the same rule that put `?open=` on the index rather than a click
//    handler. Nothing in this file may touch `window`, `document`, or a
//    measurement API.
//
// ## The four things this module must never do
//
// 1. **Never let a blank mean two things.** A fascicle with no fibers is `empty`
//    ("nothing recorded fills this slot"); a fascicle past the depth cap is
//    `closed` ("there is more, you have not opened it"). They are different
//    claims and they get different shapes. Same rule as `stepsOutlook`, which is
//    carried through unchanged: `atomic` and `undecomposed` are separate states
//    and a fiber never renders one as the other.
// 2. **Never silently truncate.** A label that does not fit is shortened *and*
//    carries its full text in a `<title>`; a bundle of bypass strands prints the
//    real count even when it draws fewer arcs. A cap the reader cannot see reads
//    as completeness.
// 3. **Never let the recursion trust the graph.** `validateLayerGraph` rejects a
//    cycle in `steps`, but this function is reached from a route and must be
//    total on any input, so the ancestor path is carried and a repeat is drawn
//    as a closed fascicle rather than followed.
// 4. **Never measure text with a DOM.** Widths are estimated from character
//    class, deliberately conservatively, because the alternative is a layout that
//    cannot run on the server.
import {
  bypassersOf,
  isCapability,
  layerNode,
  methodsRealizing,
  stepsOutlook,
  type LayerCapability,
  type LayerGraph,
  type LayerMethod,
  type StepsOutlook,
} from "./layers.ts";

/** Every tunable in one place, because the test file asserts against them. */
export const STRAND_METRICS = {
  /**
   * Horizontal taper at each end of a fascicle, as a floor.
   *
   * The real taper is `pinchRunFor(height)` and grows with how tall the slot is,
   * which is not a cosmetic choice. A fixed 30px taper on a slot 700px tall
   * makes every fiber leave the entry pinch almost vertically, and five of them
   * doing that sweep diagonally across the whole canvas and cross everything
   * drawn inside. Long muscles have long tapers; so does this.
   */
  pinchRun: 26,
  pinchRunRatio: 0.24,
  pinchRunMax: 150,
  /** Vertical padding between the outermost lane and the lens outline. */
  outlinePad: 11,
  /** Between two sibling lanes inside one fascicle. */
  laneGap: 15,
  /** Between two sub-fascicles in series along one fiber. */
  seriesGap: 24,
  /** A fiber's own name sits in a band above its chain of sub-fascicles. */
  fiberLabelBand: 21,
  /**
   * A fascicle's own name sits above its outline rather than inside it.
   *
   * Inside was tried first and there is no room: the lens is packed with lanes
   * by construction, so a label in it either overdraws a fiber or forces a
   * minimum height that makes a two-method slot as tall as a seven-method one.
   */
  fascicleLabelBand: 17,
  /** A leaf fiber: atomic or undecomposed, nothing inside it. */
  leafHeight: 30,
  leafMinWidth: 116,
  leafMaxWidth: 250,
  /** A fascicle drawn shut because the depth cap was reached. */
  closedHeight: 42,
  closedMinWidth: 128,
  /* 340 rather than 268: at the smaller cap "Embed a nonlinear system into a
     linear one" — a slot that appears four times on the overview alone — was cut
     in every one of them. The full name is always in the `<title>`, so nothing
     is lost, but a name the reader can simply read beats one they have to hover
     for. Names longer than this still truncate, visibly. */
  closedMaxWidth: 340,
  /** A fascicle nothing realises. Deliberately not the same shape as `closed`. */
  emptyHeight: 38,
  emptyMinWidth: 128,
  /** A fascicle is never shorter than this, however few fibers it holds. */
  minFascicleHeight: 58,
  /** Room above a fascicle for the strands that route around it. */
  bypassArcBase: 13,
  bypassArcStep: 8,
  /** Font sizes the width estimate assumes. Must match the stylesheet. */
  fascicleFont: 13,
  fiberFont: 12,
  /** Slack the estimate leaves around a label inside its shape. */
  labelPadX: 22,
} as const;

/**
 * Width of a string, without a DOM.
 *
 * CJK is counted at full em and Latin at 0.53 em, which is a deliberate
 * over-estimate for Latin: the failure mode of guessing high is a shape slightly
 * wider than it needed to be, and the failure mode of guessing low is a label
 * overflowing its own outline. The Japanese surface is the one that punishes a
 * low guess, and it is the surface that has historically gone out unrendered.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let ems = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    ems += wide ? 1 : 0.53;
  }
  return ems * fontSize;
}

/**
 * Shorten to fit, and say whether it was shortened.
 *
 * The caller is required to do something with `truncated` — the renderer puts the
 * full string in a `<title>` — because a name silently cut at the ellipsis is the
 * "no silent caps" failure in its smallest form.
 */
export function fitLabel(
  text: string,
  fontSize: number,
  maxWidth: number,
): { text: string; truncated: boolean } {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return { text, truncated: false };
  const chars = [...text];
  let out = "";
  for (const char of chars) {
    if (estimateTextWidth(`${out}${char}…`, fontSize) > maxWidth) break;
    out += char;
  }
  return { text: `${out.trimEnd()}…`, truncated: true };
}

/**
 * How long this fascicle's taper is, given how tall it ended up.
 *
 * Exported because the renderer draws the lens outline with the same number: if
 * the outline tapered over one distance and the fibers flared over another, the
 * fibers would visibly leave the shape that is supposed to contain them.
 */
export function pinchRunFor(height: number): number {
  const M = STRAND_METRICS;
  return Math.min(M.pinchRunMax, Math.max(M.pinchRun, height * M.pinchRunRatio));
}

export type FascicleState = "open" | "closed" | "empty";

/** One strand that routes around a fascicle instead of through it. */
export interface StrandBypass {
  methodId: string;
  label: string;
  href: string;
  /** How far above the lens this arc rides. */
  lift: number;
}

/** A capability: the pinched oval. Enters at `entry`, exits at `exit`, one point each. */
export interface StrandFascicle {
  kind: "fascicle";
  id: string;
  label: string;
  /** Untruncated, for the `<title>`. */
  fullLabel: string;
  labelTruncated: boolean;
  summary: string;
  href: string;
  state: FascicleState;
  /** Real count, printed even when `state` is `closed` and no fiber is drawn. */
  methodCount: number;
  /** Left pinch. */
  x: number;
  /** Centre line — both pinches sit on it. */
  y: number;
  width: number;
  halfHeight: number;
  /** Taper length at each end. The renderer draws the outline with this exact number. */
  pinchRun: number;
  depth: number;
  fibers: StrandFiber[];
  bypasses: StrandBypass[];
}

/** A method: a fiber inside a fascicle, or a chain of smaller fascicles. */
export interface StrandFiber {
  kind: "fiber";
  id: string;
  label: string;
  fullLabel: string;
  labelTruncated: boolean;
  summary: string;
  href: string;
  outlook: StepsOutlook;
  /** Where this fiber leaves the entry pinch and rejoins the exit pinch. */
  entryX: number;
  exitX: number;
  pinchY: number;
  /** The lane it runs along between the two tapers. */
  laneY: number;
  laneX0: number;
  laneX1: number;
  /**
   * Baseline for the fiber's name.
   *
   * Computed here rather than in the renderer because the two cases need the
   * fiber's measured height and the renderer does not have it: a leaf fiber's
   * name sits just above its own line, a decomposed one's sits in the band at
   * the top of its lane, clear of the chain of sub-fascicles below.
   */
  labelY: number;
  steps: StrandFascicle[];
}

export interface StrandDiagram {
  width: number;
  height: number;
  roots: StrandFascicle[];
  /** Depth cap this diagram was built at, so the page can offer the next one. */
  depthCap: number;
  /** Fascicles drawn shut because of the cap — the page says how many. */
  closedCount: number;
}

/**
 * A measured box, plus the room it needs outside itself.
 *
 * The **footprint** is `liftTop + height + liftBottom`, and the lens centre sits
 * at `top + liftTop + height / 2`. Keeping the two lifts separate from `height`
 * rather than folding them in is what lets the lens outline be drawn from
 * `height` alone: a label band above and a bundle of bypass arcs below are not
 * part of the shape, they are things standing next to it.
 */
interface Measured {
  width: number;
  height: number;
  /** Above the outline: the node's own name. */
  liftTop: number;
  /** Below the outline: the strands that route around this node. */
  liftBottom: number;
}

interface LayoutOptions {
  graph: LayerGraph;
  locale: "en" | "ja";
  depthCap: number;
  /** Node ids already on the path from the root, so a cycle cannot be followed. */
  ancestors: ReadonlySet<string>;
}

function labelOf(node: LayerCapability | LayerMethod, locale: "en" | "ja"): string {
  return locale === "ja" ? node.labelJa : node.label;
}

function summaryOf(node: LayerCapability | LayerMethod, locale: "en" | "ja"): string {
  return locale === "ja" ? node.summaryJa : node.summary;
}

function capabilityById(graph: LayerGraph, id: string): LayerCapability | null {
  const node = layerNode(graph, id);
  return node && isCapability(node) ? node : null;
}

// ---------------------------------------------------------------------------
// Pass one: measure, bottom-up. Nothing is positioned yet.
// ---------------------------------------------------------------------------

function measureFascicle(id: string, depth: number, options: LayoutOptions): Measured {
  const M = STRAND_METRICS;
  const capability = capabilityById(options.graph, id);
  const bypassers = capability ? bypassersOf(options.graph, id) : [];
  const liftTop = M.fascicleLabelBand;
  const liftBottom =
    bypassers.length > 0 ? M.bypassArcBase + bypassers.length * M.bypassArcStep : 0;

  if (!capability) {
    // A step naming a node that is not a capability. `validateLayerGraph` rejects
    // it, so this is unreachable in shipped data and still must not throw.
    return { width: M.closedMinWidth, height: M.closedHeight, liftTop, liftBottom: 0 };
  }

  const labelWidth =
    estimateTextWidth(labelOf(capability, options.locale), M.fascicleFont) + M.labelPadX;
  const methods = methodsRealizing(options.graph, id);

  if (methods.length === 0) {
    return {
      width: Math.max(M.emptyMinWidth, Math.min(M.closedMaxWidth, labelWidth)),
      height: M.emptyHeight,
      liftTop,
      liftBottom,
    };
  }

  // Past the cap, or already on the path above us: draw it shut. Both are "there
  // is more here", never "there is nothing here".
  if (depth >= options.depthCap || options.ancestors.has(id)) {
    return {
      width: Math.min(M.closedMaxWidth, Math.max(M.closedMinWidth, labelWidth)),
      height: M.closedHeight,
      liftTop,
      liftBottom,
    };
  }

  const nested: LayoutOptions = { ...options, ancestors: new Set([...options.ancestors, id]) };
  let innerWidth = 0;
  let innerHeight = 0;
  methods.forEach((method, index) => {
    const fiber = measureFiber(method, depth, nested);
    innerWidth = Math.max(innerWidth, fiber.width);
    innerHeight += fiber.height;
    if (index > 0) innerHeight += M.laneGap;
  });

  // Height first, because the taper is a function of it, and only then the
  // width — which the taper is part of. The other order needs a fixed point.
  const height = Math.max(M.minFascicleHeight, innerHeight + M.outlinePad * 2);
  // The name sits above the outline, so it constrains the width but adds no
  // height — that is `liftTop`'s job.
  const width = Math.max(innerWidth + pinchRunFor(height) * 2, labelWidth);
  return { width, height, liftTop, liftBottom };
}

/**
 * A fiber never carries a lift of its own: it **absorbs** its children's.
 *
 * A decomposed fiber's height is its label band plus the tallest child
 * *footprint*, lifts included, so the fascicle stacking lanes above only ever
 * has to add heights. Getting this wrong is how a bypass bundle ends up drawn
 * over the lane below it.
 */
function measureFiber(method: LayerMethod, depth: number, options: LayoutOptions): Measured {
  const M = STRAND_METRICS;
  const outlook = stepsOutlook(method);
  const labelWidth = estimateTextWidth(labelOf(method, options.locale), M.fiberFont) + M.labelPadX;

  if (outlook !== "decomposed") {
    return {
      width: Math.min(M.leafMaxWidth, Math.max(M.leafMinWidth, labelWidth)),
      height: M.leafHeight,
      liftTop: 0,
      liftBottom: 0,
    };
  }

  let width = 0;
  let footprint = 0;
  method.steps.forEach((stepId, index) => {
    const step = measureFascicle(stepId, depth + 1, options);
    width += step.width;
    if (index > 0) width += M.seriesGap;
    footprint = Math.max(footprint, step.liftTop + step.height + step.liftBottom);
  });

  return {
    // A chain narrower than the method's own name would clip the label band.
    width: Math.max(width, Math.min(M.leafMaxWidth, labelWidth)),
    height: footprint + M.fiberLabelBand,
    liftTop: 0,
    liftBottom: 0,
  };
}

// ---------------------------------------------------------------------------
// Pass two: place, top-down, into the box pass one measured.
// ---------------------------------------------------------------------------

function placeFascicle(
  id: string,
  x: number,
  y: number,
  measured: Measured,
  depth: number,
  options: LayoutOptions,
  closedTally: { count: number },
): StrandFascicle {
  const M = STRAND_METRICS;
  const capability = capabilityById(options.graph, id);
  const methods = capability ? methodsRealizing(options.graph, id) : [];
  // **Ovals navigate, fibers read**, and the surface says so in one line.
  //
  // A capability is a slot, so the useful thing to do with one is stand in it and
  // look around — clicking re-centres the canvas on it. A method is a piece of
  // work somebody wrote up, so clicking one opens the write-up. Giving both the
  // same destination was the first draft and it made the diagram a slower
  // version of the list it was supposed to replace.
  const href = `/repository/layers?view=strands&focus=${encodeURIComponent(id)}`;

  const rawLabel = capability ? labelOf(capability, options.locale) : id;
  const fitted = fitLabel(rawLabel, M.fascicleFont, measured.width - M.labelPadX);

  // Drawn **below** the lens, because the name is above it. Each arc rides one
  // step lower than the last so a slot five routes skip reads as a bundle rather
  // than as one thick line.
  const bypassMethods = capability ? bypassersOf(options.graph, id) : [];
  const bypasses: StrandBypass[] = bypassMethods.map((method, index) => ({
    methodId: method.id,
    label: labelOf(method, options.locale),
    href: `/repository/layers/${method.id}`,
    lift: measured.height / 2 + M.bypassArcBase + index * M.bypassArcStep,
  }));

  const base: StrandFascicle = {
    kind: "fascicle",
    id,
    label: fitted.text,
    fullLabel: rawLabel,
    labelTruncated: fitted.truncated,
    summary: capability ? summaryOf(capability, options.locale) : "",
    href,
    state: "open",
    methodCount: methods.length,
    x,
    y,
    width: measured.width,
    halfHeight: measured.height / 2,
    pinchRun: pinchRunFor(measured.height),
    depth,
    fibers: [],
    bypasses,
  };

  if (!capability || methods.length === 0) return { ...base, state: "empty" };
  if (depth >= options.depthCap || options.ancestors.has(id)) {
    closedTally.count += 1;
    return { ...base, state: "closed" };
  }

  const nested: LayoutOptions = { ...options, ancestors: new Set([...options.ancestors, id]) };
  const pinch = pinchRunFor(measured.height);
  const innerX0 = x + pinch;
  const innerX1 = x + measured.width - pinch;

  // `measureFiber` absorbs every child lift into its own height, so the lanes
  // stack on heights alone and nothing can be drawn into the lane below it.
  const fiberSizes = methods.map((method) => measureFiber(method, depth, nested));
  const stackHeight = fiberSizes.reduce(
    (total, size, index) => total + size.height + (index > 0 ? M.laneGap : 0),
    0,
  );

  let cursor = y - stackHeight / 2;
  const fibers = methods.map((method, index) => {
    const size = fiberSizes[index]!;
    const laneY = cursor + size.height / 2;
    cursor += size.height + M.laneGap;
    return placeFiber(
      method,
      innerX0,
      innerX1,
      laneY,
      x,
      x + measured.width,
      y,
      size,
      depth,
      nested,
      closedTally,
    );
  });

  return { ...base, fibers };
}

function placeFiber(
  method: LayerMethod,
  innerX0: number,
  innerX1: number,
  laneY: number,
  entryX: number,
  exitX: number,
  pinchY: number,
  measured: Measured,
  depth: number,
  options: LayoutOptions,
  closedTally: { count: number },
): StrandFiber {
  const M = STRAND_METRICS;
  const outlook = stepsOutlook(method);
  const rawLabel = labelOf(method, options.locale);
  const available = Math.max(measured.width, M.leafMinWidth) - M.labelPadX * 0.5;
  const fitted = fitLabel(rawLabel, M.fiberFont, available);

  // A fiber narrower than its lane is centred in it, so a two-step chain does not
  // hug the left taper while a four-step sibling fills the width.
  const laneWidth = innerX1 - innerX0;
  const laneX0 = innerX0 + Math.max(0, (laneWidth - measured.width) / 2);
  const laneX1 = laneX0 + Math.min(measured.width, laneWidth);

  const fiber: StrandFiber = {
    kind: "fiber",
    id: method.id,
    label: fitted.text,
    fullLabel: rawLabel,
    labelTruncated: fitted.truncated,
    summary: summaryOf(method, options.locale),
    href: `/repository/layers/${method.id}`,
    outlook,
    entryX,
    exitX,
    pinchY,
    laneY,
    laneX0,
    laneX1,
    labelY:
      outlook === "decomposed" ? laneY - measured.height / 2 + M.fiberLabelBand - 7 : laneY - 6,
    steps: [],
  };

  if (outlook !== "decomposed") return fiber;

  // The chain starts below the label band, and each child's lens centre is
  // offset by that child's own `liftTop` so its name has room above it.
  const chainTop = laneY - measured.height / 2 + M.fiberLabelBand;
  let cursor = laneX0;
  const steps = method.steps.map((stepId) => {
    const size = measureFascicle(stepId, depth + 1, options);
    const placed = placeFascicle(
      stepId,
      cursor,
      chainTop + size.liftTop + size.height / 2,
      size,
      depth + 1,
      options,
      closedTally,
    );
    cursor += size.width + M.seriesGap;
    return placed;
  });

  return { ...fiber, steps };
}

// ---------------------------------------------------------------------------
// The two entry points the routes use.
// ---------------------------------------------------------------------------

/**
 * One capability, opened `depthCap` levels deep.
 *
 * `depthCap` counts fascicles, not edges: 1 shows the focused slot and the
 * methods in it, 2 opens each of those methods' steps, and so on. The full graph
 * runs six deep off `nonlinear-ode-solve`, and opening all of it at once is
 * thousands of pixels wide — which is why the cap is a parameter with an address
 * rather than a constant.
 */
export function layoutFocus(
  graph: LayerGraph,
  rootId: string,
  locale: "en" | "ja",
  depthCap: number,
): StrandDiagram {
  const options: LayoutOptions = { graph, locale, depthCap, ancestors: new Set() };
  const measured = measureFascicle(rootId, 0, options);
  const closedTally = { count: 0 };
  const margin = 26;
  const root = placeFascicle(
    rootId,
    margin,
    margin + measured.liftTop + measured.height / 2,
    measured,
    0,
    options,
    closedTally,
  );
  return {
    width: measured.width + margin * 2,
    height: measured.liftTop + measured.height + measured.liftBottom + margin * 2,
    roots: [root],
    depthCap,
    closedCount: closedTally.count,
  };
}

/**
 * Every root capability, stacked — the whole repository in one reading.
 *
 * A root is a slot nothing else needs, so this is the set of problems somebody
 * arrives with rather than a set of steps. There are four, and printing them
 * together is the closest thing the surface has to "here is the shape of it".
 */
export function layoutOverview(
  graph: LayerGraph,
  roots: readonly LayerCapability[],
  locale: "en" | "ja",
  depthCap: number,
): StrandDiagram {
  const margin = 26;
  const stackGap = 34;
  const closedTally = { count: 0 };
  let cursor = margin;
  let width = 0;

  const placed = roots.map((root) => {
    const options: LayoutOptions = { graph, locale, depthCap, ancestors: new Set() };
    const measured = measureFascicle(root.id, 0, options);
    const node = placeFascicle(
      root.id,
      margin,
      cursor + measured.liftTop + measured.height / 2,
      measured,
      0,
      options,
      closedTally,
    );
    cursor += measured.liftTop + measured.height + measured.liftBottom + stackGap;
    width = Math.max(width, measured.width);
    return node;
  });

  return {
    width: width + margin * 2,
    height: cursor - stackGap + margin,
    roots: placed,
    depthCap,
    closedCount: closedTally.count,
  };
}

// ---------------------------------------------------------------------------
// Path helpers the side rail uses: where you are, and what is beside you.
// ---------------------------------------------------------------------------

/**
 * The chain of capabilities from a root down to `id`, shortest first.
 *
 * Shortest rather than any path, for the reason `layerDepths` gives: a
 * capability reachable both as a direct step and as something four levels down
 * is *first* met at the shallower one, and the rail should say where the reader
 * most plausibly came from. Returns an empty array for an id that resolves to
 * nothing, never a partial path.
 */
export function ancestorPath(graph: LayerGraph, id: string): LayerCapability[] {
  const target = capabilityById(graph, id);
  if (!target) return [];

  const containers = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!isCapability(node)) continue;
    for (const method of methodsRealizing(graph, node.id)) {
      for (const step of method.steps) {
        const list = containers.get(step) ?? [];
        list.push(node.id);
        containers.set(step, list);
      }
    }
  }

  // Breadth-first upward, so the first root reached is the nearest one.
  const seen = new Set<string>([id]);
  const queue: Array<{ id: string; path: string[] }> = [{ id, path: [id] }];
  for (let head = 0; head < queue.length; head += 1) {
    const item = queue[head]!;
    const parents = containers.get(item.id) ?? [];
    if (parents.length === 0) {
      return item.path
        .map((step) => capabilityById(graph, step))
        .filter((node): node is LayerCapability => node !== null);
    }
    for (const parent of parents) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      queue.push({ id: parent, path: [parent, ...item.path] });
    }
  }
  return [target];
}

/**
 * The other capabilities filling the same position — what is around you.
 *
 * Defined as the sibling steps of every method that contains this one, deduped.
 * A capability nothing contains is a root and has no siblings in this sense,
 * which is a fact about it rather than an empty list to apologise for.
 */
export function siblingCapabilities(graph: LayerGraph, id: string): LayerCapability[] {
  const out = new Map<string, LayerCapability>();
  for (const node of graph.nodes) {
    if (isCapability(node)) continue;
    const method = node as LayerMethod;
    if (!method.steps.includes(id)) continue;
    for (const step of method.steps) {
      if (step === id) continue;
      const capability = capabilityById(graph, step);
      if (capability) out.set(capability.id, capability);
    }
  }
  return [...out.values()];
}
