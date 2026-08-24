// Where the map's figures sit relative to each other — the second half of
// *"the whole map can be compressed"*.
//
// > *"the whole map can be compressed... unnecessarily long and tall with too
// > much space in between everywhere."*
// > — owner, complaint (a)
//
// Two cuts already landed **inside** each figure: leona 721 took 31.8% off the
// summed figure height by removing a `Math.max` floor the renderer had stopped
// drawing with, and leona 732 took another 12.5% by removing a `+ stateRadius`
// that reserved room for circles already inside the fan. A sensitivity sweep
// over all 24 layout metrics afterwards put every remaining pixel in four
// constants that each have a recorded label collision behind them, so the
// figures are done and what is left is the **arrangement**.
//
// Read on production at 1440×900 before this file existed: all eight figures
// stacked in ONE column at x = 0, the widest 749px and most 208–409px, summing
// to 1,219px against a ~705px canvas. Two screenfuls of scrolling down a strip
// that used a third of the width, with the right two thirds empty at every
// scroll position.
//
// > *"Option 1. the beauty is that these figures will eventually be all
// > connected to each other. some will be superceded, connections will be
// > found, and it will turn into end to end mathematical problem statement to
// > mathematical solution pipeline governed by quantum-classical approaches!"*
// > — owner, ai-ops issue 167
//
// So: pack them into columns.
//
// ## Why columns of figures and not rows of figures
//
// The obvious implementation is `flex-wrap: wrap` and no code at all. It was
// costed against the real figure list rather than assumed away, and it loses by
// a lot, because a wrapped **row** is as tall as its tallest member and these
// heights are 259 · 73 · 73 · 153 · 115 · 379 · 73 · 73 — one figure is five
// times another. Wrapping into rows at a 1,400px target gives three rows of
// 259 + 153 + 379 = 839px, and the 379px figure drags two 73px figures up with
// it. Packing into columns puts that figure in a column of its own and lands at
// **518px**, which is the difference between "still scrolls" and "one
// screenful". The whole justification for writing an algorithm here is that
// 321px.
//
// ## What is optimised, and what is deliberately not
//
// Minimise the **height of the tallest column**, subject to the pack fitting a
// target width. That is exactly multiprocessor scheduling and it is NP-hard in
// general, which does not matter at this size: the map draws 8 root figures, so
// `k ** n` is 6,561 assignments at three columns and the whole search is
// exhaustive and provably optimal. Above `SEARCH_CEILING` it falls back to the
// standard greedy — each figure to the shortest column so far — which is the
// 4/3-approximation and is what the map would get if it ever grew past the
// ceiling. Both are exercised by the tests; the fallback is not dead code
// waiting to be discovered wrong.
//
// **Column widths are not uniform.** A column is as wide as its own widest
// figure, so a column holding only 208px and 214px figures costs 214px rather
// than the 749px the widest figure on the canvas would impose. Uniform columns
// — which is what CSS multi-column would give — cannot fit three columns here
// at all: 3 × 749 is 2,247px.
//
// **Order is preserved in the only sense that survives packing.** Figures are
// assigned in graph order and a column keeps them in that order top to bottom.
// What is *not* promised is that figure 3 sits to the right of figure 2 — a
// packer that promised that would be a row wrapper, which is the thing measured
// above as 321px worse.
//
// ## Two packs, because the server cannot measure the reader's screen
//
// This is a server component (D90.3: pure function, no `window`, no measurement
// API), so the column count cannot depend on the viewport. Emitting one pack
// for one assumed width would either waste a wide screen or overflow a narrow
// one, and overflowing is the worse failure: below the widest pack the current
// single-column flow is *correct*, and a reader on a 1,280px laptop must not be
// handed a 1,425px canvas they have to pan sideways to finish reading.
//
// So both packs are computed here and both ship, as CSS custom properties on
// each figure. Which one applies is a media query — see `.mj-figure-pack` in
// `styles.css` — and below the narrower tier's breakpoint neither applies and
// the figures fall back to the block flow they have today. No JavaScript is
// involved at any width, `curl` gets every figure and every link either way,
// and a reader with JavaScript disabled gets the packed arrangement, not a
// degraded one.

/** A figure's own drawn size. `ConvergeDiagram` satisfies this structurally. */
export interface FigureSize {
  readonly width: number;
  readonly height: number;
}

/** Where one figure ends up, in the pack's own pixel coordinates. */
export interface FigurePlace {
  readonly x: number;
  readonly y: number;
  /** 0-based column index. Carried for the tests and for debugging, not drawn. */
  readonly column: number;
}

export interface FigurePack {
  /**
   * Columns the figures actually landed in — NOT the column count the search
   * ran at. The search deliberately permits an assignment to leave a column
   * empty (see `measure`), so a three-column search can return the two-column
   * answer, and reporting 3 there would be a claim about the arrangement that
   * the pixels do not support. 1 means no packing happened.
   */
  readonly columns: number;
  /** Total extent, gaps included. */
  readonly width: number;
  readonly height: number;
  /** Parallel to the input array. */
  readonly places: readonly FigurePlace[];
}

/**
 * Gap between packed figures, both axes.
 *
 * Not derived from `CONVERGE_METRICS.margin` even though it looks like it
 * should be. That margin is drawn *inside* each figure's own SVG box, so two
 * adjacent figures already have 2 × 18 = 36px of drawn whitespace between them
 * before this gap is added. 24 keeps a visible seam between neighbouring
 * figures without restating the margin a third time; below about 16 the fans of
 * two figures in adjacent columns start reading as one drawing.
 */
export const FIGURE_GAP = 24;

/**
 * The two widths a pack is fitted to, narrow first.
 *
 * Each is paired with a breakpoint in `styles.css` that is comfortably wider
 * than it, because the map is full-bleed (`100dvh`, edge to edge) and the pack
 * must fit the *viewport*, not a content column. The slack absorbs a scrollbar
 * and the viewport's own padding without a second measurement.
 *
 *   1200 → applies at min-width 1240px
 *   1440 → applies at min-width 1480px
 *
 * 1440 is the width complaint (a) was measured at. 1200 is the narrowest width
 * at which two columns still beat one on the current figure list; below it the
 * single-column flow is kept, which is why there is no third tier.
 */
export const PACK_TARGETS = [1200, 1440] as const;

/**
 * Above this many candidate assignments the exhaustive search is abandoned for
 * the greedy one. `3 ** 8 = 6,561` and `4 ** 8 = 65,536`, so the map's current
 * eight figures are nowhere near it; twelve figures at four columns
 * (`16,777,216`) are well past it. Chosen so the whole search stays inside a
 * single server render's budget rather than as a round number.
 */
export const SEARCH_CEILING = 300_000;

/** The most columns worth trying. Beyond four, a column is one narrow figure. */
export const MAX_COLUMNS = 4;

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Height of a column holding `heights`, gaps included. Empty is 0 rather than
 * `-FIGURE_GAP`, which is the off-by-one an inline `sum + n * gap` would make.
 */
function columnExtent(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total + FIGURE_GAP * (values.length - 1);
}

/** Column-index-per-figure → the pack's total width and tallest column. */
function measure(
  sizes: readonly FigureSize[],
  assignment: readonly number[],
  columns: number,
): { width: number; height: number } {
  const heights: number[][] = Array.from({ length: columns }, () => []);
  const widths = new Array<number>(columns).fill(0);
  for (let i = 0; i < sizes.length; i += 1) {
    const c = assignment[i]!;
    heights[c]!.push(sizes[i]!.height);
    widths[c] = Math.max(widths[c]!, sizes[i]!.width);
  }
  let height = 0;
  for (const column of heights) height = Math.max(height, columnExtent(column));
  // A column nothing landed in contributes neither width nor a gap. The search
  // does produce them — an assignment that leaves column 2 empty is a legal
  // point in a 3-column search space — and charging it 24px would make the
  // 3-column search unable to represent the 2-column answer, which is how a
  // wider search comes back with a *worse* result than a narrower one.
  const used = widths.filter((w) => w > 0);
  const width = used.reduce((a, b) => a + b, 0) + FIGURE_GAP * Math.max(0, used.length - 1);
  return { width, height };
}

/**
 * Each figure to the shortest column that does not push the pack past `target`;
 * ties to the leftmost.
 *
 * The width clause is not decoration. The textbook greedy — shortest column,
 * full stop — is height-blind to width, so on a map wide enough to reach
 * `SEARCH_CEILING` it will happily open a column for one wide figure, overflow
 * the target, and be rejected wholesale by `bestAssignment`. The pack then
 * degrades to a single column even though an assignment that fits plainly
 * exists. Caught in review by Sourcery on PR 734 rather than by a test, because
 * every test here runs at the map's current eight figures, which is far below
 * the ceiling and never reaches this path.
 *
 * When no column can take a figure without overflowing, the least-overflowing
 * one is used and `bestAssignment` rejects the result — a pack that does not
 * fit is not offered at any column count, and the fallback to one column is
 * then the honest answer rather than an avoidable one.
 */
function greedy(sizes: readonly FigureSize[], columns: number, target: number): number[] {
  const filled = new Array<number>(columns).fill(0);
  const counts = new Array<number>(columns).fill(0);
  const widths = new Array<number>(columns).fill(0);
  const assignment: number[] = [];

  const widthWith = (column: number, figureWidth: number): number => {
    const before = widths[column]!;
    widths[column] = Math.max(before, figureWidth);
    const used = widths.filter((w) => w > 0);
    const total = used.reduce((a, b) => a + b, 0) + FIGURE_GAP * Math.max(0, used.length - 1);
    widths[column] = before;
    return total;
  };

  for (const size of sizes) {
    let fitting = -1;
    let fittingHeight = Infinity;
    let narrowest = 0;
    let narrowestWidth = Infinity;
    let narrowestHeight = Infinity;
    for (let c = 0; c < columns; c += 1) {
      const height = filled[c]! + size.height + (counts[c]! > 0 ? FIGURE_GAP : 0);
      const width = widthWith(c, size.width);
      if (width <= target && height < fittingHeight) {
        fitting = c;
        fittingHeight = height;
      }
      if (width < narrowestWidth || (width === narrowestWidth && height < narrowestHeight)) {
        narrowest = c;
        narrowestWidth = width;
        narrowestHeight = height;
      }
    }
    const best = fitting >= 0 ? fitting : narrowest;
    assignment.push(best);
    filled[best] = filled[best]! + size.height + (counts[best]! > 0 ? FIGURE_GAP : 0);
    counts[best] = counts[best]! + 1;
    widths[best] = Math.max(widths[best]!, size.width);
  }
  return assignment;
}

/**
 * The tallest-column-minimising assignment into exactly `columns` columns,
 * subject to `width <= target`. Exhaustive below `SEARCH_CEILING`, greedy above
 * it. Returns null when nothing at this column count fits the target — which is
 * the normal answer for three columns at 1200px, not an error.
 */
function bestAssignment(
  sizes: readonly FigureSize[],
  columns: number,
  target: number,
): number[] | null {
  const candidates = columns ** sizes.length;
  if (!Number.isFinite(candidates) || candidates > SEARCH_CEILING) {
    const g = greedy(sizes, columns, target);
    return measure(sizes, g, columns).width <= target ? g : null;
  }
  let best: number[] | null = null;
  let bestHeight = Infinity;
  let bestWidth = Infinity;
  const assignment = new Array<number>(sizes.length).fill(0);
  const walk = (i: number): void => {
    if (i === sizes.length) {
      const { width, height } = measure(sizes, assignment, columns);
      if (width > target) return;
      // Height first, then width: two arrangements the reader scrolls the same
      // amount for are not equally good, and the narrower one leaves the wider
      // screen the reader is on with somewhere to grow.
      if (height < bestHeight || (height === bestHeight && width < bestWidth)) {
        bestHeight = height;
        bestWidth = width;
        best = assignment.slice();
      }
      return;
    }
    // Symmetry break: figure `i` may not open a column past the first unused
    // one. Without it every assignment is counted `columns!` times over — the
    // same pack with the column labels permuted — and the search does 6,561
    // measurements where 1,094 are distinct.
    let ceiling = 0;
    for (let j = 0; j < i; j += 1) ceiling = Math.max(ceiling, assignment[j]! + 1);
    for (let c = 0; c <= Math.min(ceiling, columns - 1); c += 1) {
      assignment[i] = c;
      walk(i + 1);
    }
  };
  walk(0);
  return best;
}

/** Turn a column assignment into pixel origins, in graph order down each column. */
function place(
  sizes: readonly FigureSize[],
  assignment: readonly number[],
  columns: number,
): FigurePack {
  const widths = new Array<number>(columns).fill(0);
  for (let i = 0; i < sizes.length; i += 1) {
    const c = assignment[i]!;
    widths[c] = Math.max(widths[c]!, sizes[i]!.width);
  }
  // Empty columns take no width and no gap — see `measure`.
  const originOf = new Array<number>(columns).fill(0);
  let x = 0;
  for (let c = 0; c < columns; c += 1) {
    originOf[c] = x;
    if (widths[c]! > 0) x += widths[c]! + FIGURE_GAP;
  }
  const width = Math.max(0, x - FIGURE_GAP);

  const cursor = new Array<number>(columns).fill(0);
  const used = new Array<boolean>(columns).fill(false);
  const places: FigurePlace[] = [];
  for (let i = 0; i < sizes.length; i += 1) {
    const c = assignment[i]!;
    if (used[c]) cursor[c] = cursor[c]! + FIGURE_GAP;
    used[c] = true;
    places.push({ x: round(originOf[c]!), y: round(cursor[c]!), column: c });
    cursor[c] = cursor[c]! + sizes[i]!.height;
  }
  let height = 0;
  for (const c of cursor) height = Math.max(height, c);
  // The columns figures landed in, not the count the search ran at — see
  // `FigurePack.columns`.
  return {
    columns: used.filter(Boolean).length,
    width: round(width),
    height: round(height),
    places,
  };
}

/**
 * Pack `sizes` into columns no wider than `target`.
 *
 * Always returns a pack. With nothing to pack, or one figure, or a figure wider
 * than the target on its own, that pack is the single column the map draws
 * today — which is the honest answer rather than a failure, and is what the CSS
 * falls back to below the narrowest breakpoint anyway.
 */
export function packFigures(sizes: readonly FigureSize[], target: number): FigurePack {
  if (sizes.length === 0) return { columns: 1, width: 0, height: 0, places: [] };
  const single = place(sizes, new Array<number>(sizes.length).fill(0), 1);
  if (sizes.length === 1) return single;

  let best = single;
  for (let columns = 2; columns <= Math.min(MAX_COLUMNS, sizes.length); columns += 1) {
    const assignment = bestAssignment(sizes, columns, target);
    if (!assignment) continue;
    const packed = place(sizes, assignment, columns);
    // `place` and `measure` must agree; if they ever do not, trust the one that
    // produced the pixels a reader gets.
    if (packed.width > target) continue;
    if (packed.height < best.height || (packed.height === best.height && packed.width < best.width)) {
      best = packed;
    }
  }
  return best;
}

/** Every tier, narrow first. Parallel to `PACK_TARGETS`. */
export function packTiers(sizes: readonly FigureSize[]): readonly FigurePack[] {
  return PACK_TARGETS.map((target) => packFigures(sizes, target));
}

/**
 * The custom properties one figure carries, one `--fx`/`--fy` pair per tier.
 *
 * Written as a style attribute rather than a stylesheet rule because the values
 * are per-figure and computed: a `<style>` element would need a CSP nonce, and
 * this surface's CSP is one of the things the test suite pins.
 */
export function packVarsFor(
  packs: readonly FigurePack[],
  index: number,
): Record<string, string> {
  const vars: Record<string, string> = {};
  packs.forEach((pack, tier) => {
    const at = pack.places[index];
    if (!at) return;
    vars[`--fx${tier}`] = `${at.x}px`;
    vars[`--fy${tier}`] = `${at.y}px`;
  });
  return vars;
}

/** The pack container's own size per tier, as custom properties. */
export function packBoxVars(packs: readonly FigurePack[]): Record<string, string> {
  const vars: Record<string, string> = {};
  packs.forEach((pack, tier) => {
    vars[`--pw${tier}`] = `${pack.width}px`;
    vars[`--ph${tier}`] = `${pack.height}px`;
  });
  return vars;
}
