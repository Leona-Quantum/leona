// The layers canvas's pan/zoom state, as data rather than as component state.
//
// `?at=x,y,z` is the address of what a reader is looking at, the same way
// `?focus=` and `?depth=` already are on this route (see `browse-params.ts`
// and `app/repository/layers/page.tsx`). That means the state has to be
// resolvable on the server with no DOM and no React: a shared link has to
// render the same viewport a client-side pan would have produced, and the
// server-rendered `transform` has to be byte-identical to what the client
// writes on the next frame, or the page visibly jumps the instant hydration
// finishes. One function (`transformOf`) writes that string for both call
// sites, because this repo has been bitten repeatedly by two writers of one
// value (see `AGENTS.md`'s tally-computed-in-five-places class of bug).

/**
 * A CSS `translate()` + `scale()` pair — `translate(x, y) scale(z)`, see
 * `transformOf`. Because `translate()` is the outer transform in that pair, x
 * and y are added AFTER the content is scaled (CSS composes a transform list
 * right-to-left): they are a flat shift in viewport-local screen pixels, the
 * same space a pointer or wheel event reports coordinates in, and are NOT
 * divided or multiplied by z. That is what makes panning simple — a drag of
 * `(dx, dy)` screen pixels is `x += dx, y += dy` at any zoom level — and it is
 * exactly the fact `zoomAbout`'s derivation above depends on (`x`/`px` live in
 * one coordinate space, not two).
 */
export interface Viewport {
  x: number;
  y: number;
  z: number;
}

/**
 * How far a reader can pan the zoom, and why these two numbers and not others.
 *
 * `minZoom: 0.1` — one tenth is the point a reader can pull back far enough to
 * see a wide converge map (2257px wide, per the comment on `.mj-process-canvas`
 * in styles.css) whole inside a normal viewport without the canvas needing its
 * own separate "fit to screen" affordance. Below that the content is a speck
 * and there is nothing left to see by going further.
 *
 * `maxZoom: 8` — past 8x, a 12px label (the smallest type this canvas draws,
 * per `.mj-process-name`) renders at 96 CSS px, well past legible; the limit
 * is a stop so the zoom control has a defined end, not a level anyone would
 * deliberately reach. There is no measurement behind 8 the way there is behind
 * 0.1 — it only has to be past the point where zooming further stops being
 * useful, and 8x already is.
 */
export const VIEWPORT_LIMITS = { minZoom: 0.1, maxZoom: 8 } as const;

/** No pan, no zoom — what a bare `/repository/layers` (no `?at=`) renders. */
export const IDENTITY: Viewport = { x: 0, y: 0, z: 1 };

/** Clamp a raw zoom factor into `VIEWPORT_LIMITS`. Exported on its own because
 * both `parseViewport` and `zoomAbout` need exactly this clamp, and it must be
 * the same clamp in both places — `zoomAbout`'s drift fix below depends on it. */
export function clampZoom(z: number): number {
  return Math.min(VIEWPORT_LIMITS.maxZoom, Math.max(VIEWPORT_LIMITS.minZoom, z));
}

/** The first value, when a param was repeated — same helper and same reason as
 * `browse-params.ts`'s `first()`: `?at=a&at=b` is almost always a link built by
 * concatenation, and rejecting the whole thing outright would be one more way
 * a malformed URL gets a broken page instead of a decent fallback. */
function first(value: string | string[] | undefined | null): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

/**
 * Parse `?at=x,y,z`. Total: there is no input this throws on or that produces
 * a broken transform — every malformed shape resolves to `IDENTITY`, the same
 * "an unrecognised value means the default, never an empty page" rule
 * `browse-params.ts` states for the four Atlas deep links. That rule matters
 * more here than there: a bad `?focus=` still renders the four-root overview,
 * but a broken *transform string* would render the canvas panned off-screen or
 * scaled to nothing, which reads as "the page is broken" rather than "this
 * link named something we don't recognise".
 *
 * Rejects: wrong part count (not exactly 3 comma-separated fields), any part
 * that is not a finite number (`NaN`, `Infinity`, letters, empty), and any
 * part that is empty after trimming — `",,1"` parses two of its three parts to
 * `0` under plain `Number()`, which is a valid-looking but silently wrong
 * translation rather than the "no pan" a blank field should mean. z is the one
 * field allowed to differ from its raw value: it is clamped into
 * `VIEWPORT_LIMITS` rather than rejected, because a bookmark saved before the
 * limits changed (or a hand-edited URL) should reopen at the nearest zoom this
 * build supports, not fall back to no zoom at all.
 */
export function parseViewport(raw: string | string[] | undefined | null): Viewport {
  const value = first(raw);
  if (!value) return IDENTITY;
  const parts = value.split(",");
  if (parts.length !== 3) return IDENTITY;
  if (parts.some((part) => part.trim() === "")) return IDENTITY;
  const [x, y, z] = parts.map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return IDENTITY;
  return { x, y, z: clampZoom(z) };
}

/** Round to 2 decimal places. x/y are CSS pixels — sub-hundredth-of-a-pixel
 * precision is not visible and is not worth carrying into a shareable URL. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Round to 4 significant figures. z ranges 0.1–8 (`VIEWPORT_LIMITS`), so 4
 * significant figures is at least 3 decimal places everywhere in range —
 * enough that no visible zoom step is lost, and short enough that the URL
 * does not carry float noise like `1.0000000000000002`. */
function round4sig(n: number): number {
  return n === 0 ? 0 : Number(n.toPrecision(4));
}

/**
 * The inverse of `parseViewport`.
 *
 * Rounded before formatting (2dp for x/y, 4 significant figures for z) rather
 * than passing the raw floats through `String()`, so that
 * `parseViewport(formatViewport(v))` round-trips within that same precision —
 * tested in `repository-canvas-viewport.test.ts` — and so a URL produced by a
 * drag or a wheel step never carries a `translate(...)` computed from
 * something like `241.20000000000005`.
 */
export function formatViewport(v: Viewport): string {
  return `${round2(v.x)},${round2(v.y)},${round4sig(v.z)}`;
}

/**
 * Zoom by `factor`, keeping the content under viewport-local point `(px, py)`
 * visually fixed — the standard "zoom toward the cursor" behaviour.
 *
 * ## Derivation
 *
 * `transformOf` renders `translate(x, y) scale(z)`, transform-origin `0 0`, so
 * a content-space point `C` lands at viewport-local screen point `S`:
 *
 *   S = translation + z * C            i.e.  Sx = x + z·Cx,  Sy = y + z·Cy
 *
 * The content point currently sitting under the pointer `(px, py)` is found by
 * inverting that:
 *
 *   C = (P - translation) / z          i.e.  Cx = (px - x)/z,  Cy = (py - y)/z
 *
 * Zooming changes z to `z' = z·factor`. To keep that same content point `C`
 * under the same screen point `(px, py)` after the change, solve for the new
 * translation `x'` such that `px = x' + z'·Cx`:
 *
 *   x' = px - z'·Cx = px - z'·(px - x)/z = px - factor·(px - x)     [z'/z = factor]
 *
 * and symmetrically for y'. That is the formula below, with one substitution:
 * `factor` is replaced by `effectiveFactor`.
 *
 * ## Why: the clamp has to be applied before the arithmetic, not after
 *
 * `clampZoom` can shrink the actual zoom change below what was requested — at
 * `z = 8` (`VIEWPORT_LIMITS.maxZoom`), a further zoom-in `factor` of `1.2`
 * requests `z' = 9.6`, clamps to `8`, and the zoom that actually happened has
 * factor `1`, not `1.2`. Deriving `x'`/`y'` from the *requested* factor while
 * the *effective* zoom step was smaller would move the translation as though
 * the zoom had happened, while the picture on screen did not change scale at
 * all — the content visibly drifts out from under a cursor that is holding
 * still and scrolling at the limit. `effectiveFactor` is computed from the
 * clamped `nextZ`, so at the limits it is exactly `1` and `x`/`y` are provably
 * unchanged (pinned by the "does NOT drift at the clamp boundary" test).
 */
export function zoomAbout(view: Viewport, px: number, py: number, factor: number): Viewport {
  const nextZ = clampZoom(view.z * factor);
  const effectiveFactor = nextZ / view.z;
  return {
    x: px - effectiveFactor * (px - view.x),
    y: py - effectiveFactor * (py - view.y),
    z: nextZ,
  };
}

/**
 * The one CSS transform string for a `Viewport`. Both the server-rendered
 * initial paint (`InfiniteCanvas` reads `initial` into its first render, no
 * effect involved) and every client-side update after it call this same
 * function, so there is exactly one place that decides what a `Viewport`
 * looks like as CSS — see this file's header for why that matters here.
 */
export function transformOf(v: Viewport): string {
  return `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
}
