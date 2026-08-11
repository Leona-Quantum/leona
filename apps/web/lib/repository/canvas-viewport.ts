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
  if (!isViewportValue(value)) return IDENTITY;
  const [x, y, z] = value.split(",").map(Number);
  return { x, y, z: clampZoom(z) };
}

/**
 * Whether a string is a viewport address at all — `parseViewport`'s validation,
 * exposed as a predicate.
 *
 * Needed because one caller has to tell "a viewport" apart from "not a
 * viewport" without treating IDENTITY as the answer to both: the W15 jump
 * control writes a lane *address* (e.g. `1.0.3`) into `?at=`, and the client
 * that rewrites those into `?sel=` (see `canvas-selection.ts`) must recognise
 * them. One predicate, used by `parseViewport` itself, rather than a second
 * copy of the three rules that would drift from the first.
 */
export function isViewportValue(value: string): boolean {
  const parts = value.split(",");
  if (parts.length !== 3) return false;
  if (parts.some((part) => part.trim() === "")) return false;
  return parts.every((part) => Number.isFinite(Number(part)));
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
 *
 * It stays the single writer even now that the client coalesces its updates
 * into one per animation frame: the coalescing changes *when* React is told
 * about a new `Viewport`, never who turns one into CSS. Writing the string
 * straight onto the layer node during a gesture — the obvious way to shave a
 * render — was considered and rejected for exactly that reason: it would put a
 * second writer of this string on the hot path, and the first React render to
 * land mid-gesture would overwrite it with whatever `view` state held at that
 * moment, which is a one-frame jump backwards that only shows up on a slow
 * machine.
 */
export function transformOf(v: Viewport): string {
  return `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
}

/**
 * Pan by a screen-pixel delta.
 *
 * Trivial on purpose, and the triviality is the point: because `translate()`
 * is the *outer* transform in `transformOf`'s pair, a pan is a flat addition in
 * screen pixels at any zoom level (see the note on `Viewport`). Every pan this
 * canvas performs — pointer drag, wheel, keyboard — goes through here rather
 * than each writing its own `x + dx`, so there is one place to look when the
 * question is "does a pan depend on z" and one place a division by z could ever
 * wrongly appear.
 */
export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  return { x: view.x + dx, y: view.y + dy, z: view.z };
}

/** The straight-line distance between two points in one coordinate space —
 * used for the two-finger pinch's finger separation and for the drag
 * threshold, which are the same measurement asked of different pairs. */
function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------------------
// Wheel input
// ---------------------------------------------------------------------------

/** `deltaMode` 1 ("line") events report a small integer count of lines rather
 * than pixels; 16 is a standard single-line height used to bring that count
 * into the same rough unit as `deltaMode` 0 ("pixel"). `deltaMode` 2 ("page")
 * is normalized against the canvas's own rect instead — the caller passes it in
 * as `pageSizePx` — since "a page" has no fixed pixel size. Real wheel and
 * trackpad hardware almost always reports mode 0; this exists so the other two
 * do not produce a huge, jarring jump instead of simply being rare. */
export const WHEEL_LINE_HEIGHT_PX = 16;

/**
 * One wheel delta, in CSS pixels, whatever unit the event chose to report.
 *
 * Both axes go through here. `deltaX` matters now that a plain two-finger
 * trackpad scroll pans the map surface: it is the axis a horizontal swipe
 * arrives on, and before this change the string `deltaX` did not appear
 * anywhere in `apps/web` at all.
 */
export function wheelPixels(delta: number, deltaMode: number, pageSizePx: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_HEIGHT_PX;
  if (deltaMode === 2) return delta * pageSizePx;
  return delta;
}

/** Zoom multiplier per `+`/`-` keypress, and — deliberately the same number —
 * the largest zoom step any single wheel event is allowed to take
 * (`WHEEL_ZOOM_STEP_LIMIT` below). 20%, matching the step size most browsers'
 * own Ctrl/Cmd+`+`/`-` page-zoom uses, so a keyboard user already has an
 * intuition for how far one press goes. */
export const KEYBOARD_ZOOM_FACTOR = 1.2;

/**
 * Wheel-to-zoom speed. Still a feel constant — there is nothing in this
 * codebase to derive one from — but a re-tuned one, and this comment records
 * what it was tuned against so the next change is not a blind nudge.
 *
 * Raised from 0.0015 to 0.004 on the owner's *"I want scrolling and zooming to
 * be more sensitive and quick"* (session-104 inbox). What that 2.7x buys, in
 * the units the two input devices actually report:
 *
 * - **Trackpad pinch.** A pinch is delivered as `ctrl + wheel` with many small
 *   deltas; a deliberate pinch accumulates on the order of 100px of `deltaY`
 *   over its length. At 0.0015 that whole pinch was `exp(-100 * 0.0015)` ≈
 *   0.86 — a 16% change for a full two-finger gesture, which is the sluggish
 *   feel being complained about. At 0.004 the same pinch is `exp(-0.4)` ≈ 0.67,
 *   i.e. about 1.5x per pinch, and a longer one goes further.
 * - **Mouse wheel.** One physical notch is a single ~100px event, so the same
 *   curve would make one notch a 33% jump. It does not, because of the clamp
 *   below.
 *
 * The exponential is what makes zoom-in and zoom-out exact inverses: N pixels
 * one way followed by N pixels back lands on the zoom you started from, rather
 * than drifting the way a `1 + k * delta` linear step does.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.004;

/**
 * The most one wheel event may zoom, in either direction.
 *
 * A trackpad pinch sends many tiny deltas and a mouse wheel sends few large
 * ones, so one exponential curve cannot serve both: tuned for the pinch, a
 * mouse notch is a 33% lurch with nothing between it and the next notch. The
 * clamp separates the two cases by size rather than by device — which is the
 * only thing available, since a `WheelEvent` does not say what produced it.
 *
 * At `WHEEL_ZOOM_SENSITIVITY`, the clamp engages above `ln(1.2) / 0.004` ≈ 46px
 * of delta in a single event. Trackpad pinch events are an order of magnitude
 * below that and are never clamped; a mouse notch (~100px in Chrome's default
 * pixel mode) is always clamped, and lands on exactly `KEYBOARD_ZOOM_FACTOR` —
 * one notch is one `+` press, which is why this is that constant rather than a
 * number of its own.
 */
export const WHEEL_ZOOM_STEP_LIMIT = KEYBOARD_ZOOM_FACTOR;

/**
 * The zoom multiplier for one wheel event of `pixels` normalized delta.
 *
 * Negative `pixels` (a wheel pushed away, fingers spread) zooms in. The clamp
 * is symmetric — `1 / WHEEL_ZOOM_STEP_LIMIT` out, `WHEEL_ZOOM_STEP_LIMIT` in —
 * so a clamped notch each way still round-trips to exactly 1.
 */
export function wheelZoomFactor(pixels: number): number {
  const raw = Math.exp(-pixels * WHEEL_ZOOM_SENSITIVITY);
  return Math.min(WHEEL_ZOOM_STEP_LIMIT, Math.max(1 / WHEEL_ZOOM_STEP_LIMIT, raw));
}

// ---------------------------------------------------------------------------
// Pointer gestures
// ---------------------------------------------------------------------------

/** Pixels the pointer has to travel before a press becomes a pan rather than a
 * click. Small enough that a deliberate drag registers almost immediately,
 * large enough to absorb the few pixels of jitter a real mouse or a finger
 * produces between pressing down and lifting on the same spot — the gap a
 * "0px" threshold would misread as a drag and use to eat every click. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * One pointer, as data.
 *
 * `x`/`y` are **viewport-local** — the client position minus the canvas rect's
 * top-left, the space `Viewport.x/y` and `zoomAbout`'s `(px, py)` already live
 * in. The caller converts once, from a rect it measured once for the whole
 * gesture, rather than this file ever touching a DOM node: that is what lets
 * the state machine below be tested without a browser, and it is also the fix
 * for the two forced layout flushes the old handlers took per event.
 */
export interface PointerPosition {
  id: number;
  x: number;
  y: number;
}

/** A press. `isPrimary` is only meaningful at the moment a contact goes down —
 * hence a type of its own rather than a field `move` would have to be handed a
 * value for and then ignore. */
export interface PointerSample extends PointerPosition {
  /**
   * `PointerEvent.isPrimary`. Load-bearing, not decorative — see `down` below.
   * A pointer type's *first* active contact is its primary one, so a second
   * primary press while contacts are still tracked means the tracked ones are
   * ghosts.
   */
  isPrimary: boolean;
}

/**
 * What one pointer event asks the surface to do.
 *
 * `beganDrag`/`endedDrag` are edges, not a level: the caller flips a React
 * state once per gesture instead of once per `pointermove` (the old handler
 * called `setDragging(true)` on every single move, which is a state write and a
 * bail-out check per event for a value that changes twice per drag).
 */
export interface GestureOutcome {
  /** The new viewport, or null when this event changed nothing visible. */
  view: Viewport | null;
  /** Pointer ids the caller must take pointer capture for, now. Empty for a
   * press that has not yet crossed `DRAG_THRESHOLD_PX` — capture retargets the
   * compatibility `click`, so taking it early kills every link on the canvas. */
  capture: readonly number[];
  beganDrag: boolean;
  endedDrag: boolean;
  /** The gesture that just ended moved the picture, so the `click` the browser
   * is about to synthesise from it must not navigate. */
  suppressClick: boolean;
}

const IDLE: GestureOutcome = {
  view: null,
  capture: [],
  beganDrag: false,
  endedDrag: false,
  suppressClick: false,
};

export interface CanvasGesture {
  /** A contact went down. `view` is the viewport as of this instant — the
   * tracker needs it as the anchor every subsequent move is measured from. */
  down(p: PointerSample, view: Viewport): GestureOutcome;
  move(p: PointerPosition): GestureOutcome;
  /** A contact came up, was cancelled, or lost its capture. Idempotent: a
   * second call for the same id does nothing, so the caller may safely hear
   * about one release from more than one listener. */
  end(id: number): GestureOutcome;
  /** Forget everything — the gesture is over and we will not be told how. */
  cancelAll(): GestureOutcome;
  /** Ids still tracked. The caller uses this to release captures it took. */
  ids(): number[];
}

/**
 * The pan/pinch state machine, with no DOM in it.
 *
 * Lifted out of `InfiniteCanvas` so its two silent failure modes can be pinned
 * by tests that run in `node --test` with no browser:
 *
 * 1. **A press must not become a pan, or take capture, below the threshold.**
 *    Every shape on this canvas is an `<a href>`. A pan implementation that
 *    captured or suppressed on any press makes all of them dead links, with no
 *    error and nothing in the console.
 * 2. **A contact that is never released must not poison the next gesture.**
 *    Listeners used to be element-scoped with no `window` fallback and no
 *    `lostpointercapture`, so a press that stayed under the threshold (capture
 *    therefore never taken) and released outside the window left its entry in
 *    the map forever. The next press then saw two contacts, entered pinch mode
 *    against a position from a gesture that ended minutes ago, and the first
 *    move zoomed by `distance(ghost, new) / startSpan` — a garbage factor.
 *    Pinned by "a press released outside the window does not turn the next
 *    press into a phantom pinch".
 */
export function createCanvasGesture(): CanvasGesture {
  const pointers = new Map<number, PointerPosition>();
  let drag: { id: number; startX: number; startY: number; startView: Viewport; moved: boolean } | null = null;
  let pinch: { startSpan: number; startView: Viewport } | null = null;
  // The last viewport this tracker knows about: what `down` was handed, then
  // whatever it last produced. Used as the anchor when a pinch has to be
  // re-taken mid-gesture, which is the only moment it is read.
  let view: Viewport = IDENTITY;

  function firstTwo(): [PointerPosition, PointerPosition] | null {
    const iterator = pointers.values();
    const a = iterator.next();
    const b = iterator.next();
    if (a.done || b.done) return null;
    return [a.value, b.value];
  }

  /**
   * (Re-)anchor the pinch to the two contacts currently first in insertion
   * order, at the current viewport.
   *
   * Re-anchoring rather than keeping the original anchor is what stops a third
   * finger landing or leaving from making the picture jump: the span and the
   * viewport are both re-read at the same instant, so the factor restarts at
   * exactly 1 and the next move is measured from where things actually are.
   */
  function anchorPinch(): void {
    const pair = firstTwo();
    pinch = pair ? { startSpan: distance(pair[0], pair[1]), startView: view } : null;
  }

  function down(p: PointerSample, current: Viewport): GestureOutcome {
    view = current;
    let endedDrag = false;
    if (p.isPrimary && pointers.size > 0) {
      // **The ghost-contact guard.** A primary press is the first contact of a
      // gesture: for touch, a new primary pointer only exists once every
      // previous contact has lifted; for a mouse there is only ever one
      // pointer, so every press is primary. Either way, tracked contacts at
      // this moment were never released and never will be — a release that
      // happened outside the window, or after the tab lost the pointer. Drop
      // them here rather than letting them be counted as a second finger.
      //
      // This is the last line of defence, not the only one: `InfiniteCanvas`
      // also listens for `pointerup`/`pointercancel` on `window` and for
      // `lostpointercapture`, which between them catch every release the
      // browser does tell us about. This catches the ones it does not.
      endedDrag = drag?.moved === true;
      pointers.clear();
      drag = null;
      pinch = null;
    }
    pointers.set(p.id, p);
    if (pointers.size >= 2) {
      // A second contact landed: this gesture is a pinch, not a pan. A pinch
      // needs capture from the start — there is no threshold to wait for, and
      // two fingers are never a click.
      if (drag?.moved === true) endedDrag = true;
      // Whatever single-finger drag was under way is abandoned outright rather
      // than resumed on pinch-end: resuming it would pan by the sum of both
      // fingers' movement, which is not what either finger did on its own.
      drag = null;
      anchorPinch();
      return { view: null, capture: [...pointers.keys()], beganDrag: false, endedDrag, suppressClick: false };
    }
    drag = { id: p.id, startX: p.x, startY: p.y, startView: current, moved: false };
    // **No capture here.** See `GestureOutcome.capture`.
    return endedDrag ? { ...IDLE, endedDrag: true } : IDLE;
  }

  function move(p: PointerPosition): GestureOutcome {
    if (!pointers.has(p.id)) return IDLE;
    pointers.set(p.id, p);

    if (pinch) {
      const pair = firstTwo();
      if (!pair) return IDLE;
      if (pinch.startSpan <= 0) {
        // Two contacts reported at the identical pixel. `span / 0` is Infinity,
        // which `clampZoom` would turn into an instant jump to `maxZoom`.
        // Re-anchor instead and let the next move measure a real span. No
        // larger floor than zero is invented here because there is no
        // measurement of real contact jitter to justify one.
        anchorPinch();
        return IDLE;
      }
      const mid = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
      view = zoomAbout(pinch.startView, mid.x, mid.y, distance(pair[0], pair[1]) / pinch.startSpan);
      return { ...IDLE, view };
    }

    if (!drag || p.id !== drag.id) return IDLE;
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    // This threshold check is the single most important correctness property
    // this canvas has. Below DRAG_THRESHOLD_PX the pointer has not moved far
    // enough to tell a real drag apart from the jitter of an ordinary click,
    // so nothing is repainted, no capture is taken and `moved` stays false —
    // and `moved` is exactly what decides whether the click that follows gets
    // suppressed. A pan that swallowed every click regardless of movement
    // would make every link this canvas contains permanently unclickable, and
    // that failure is silent.
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return IDLE;
    const began = !drag.moved;
    drag.moved = true;
    view = panBy(drag.startView, dx, dy);
    // Capture is taken here, at the threshold and once: it keeps the drag alive
    // if the pointer leaves the viewport, and it stays away from every press
    // that never became a drag.
    return { view, capture: began ? [p.id] : IDLE.capture, beganDrag: began, endedDrag: false, suppressClick: false };
  }

  function end(id: number): GestureOutcome {
    if (!pointers.has(id)) return IDLE;
    pointers.delete(id);
    let endedDrag = false;
    let beganDrag = false;
    let suppressClick = false;
    let capture: readonly number[] = IDLE.capture;

    if (drag && drag.id === id) {
      if (drag.moved) {
        suppressClick = true;
        endedDrag = true;
      }
      drag = null;
    }

    if (pinch) {
      if (pointers.size >= 2) {
        anchorPinch();
      } else {
        pinch = null;
        const remaining = firstOf(pointers);
        if (remaining) {
          // One finger of the pinch is still down. Hand the gesture to it as a
          // *fresh* drag anchored where that finger is now — not a resumption
          // of the drag the pinch cancelled, which is the thing that would pan
          // by both fingers' movement. Without this the surface goes dead
          // under a finger that is still on the glass, which reads as a stuck
          // canvas rather than as the end of a pinch. `moved` starts true: a
          // gesture that has already zoomed the picture is not a click, so
          // there is no threshold left to wait for.
          drag = { id: remaining.id, startX: remaining.x, startY: remaining.y, startView: view, moved: true };
          beganDrag = true;
          capture = [remaining.id];
        }
      }
    }

    return { view: null, capture, beganDrag, endedDrag, suppressClick };
  }

  function cancelAll(): GestureOutcome {
    const endedDrag = drag?.moved === true || pinch !== null;
    pointers.clear();
    drag = null;
    pinch = null;
    return { ...IDLE, endedDrag };
  }

  return { down, move, end, cancelAll, ids: () => [...pointers.keys()] };
}

/** The first value of a Map, or undefined — `Map` has no indexer and building
 * a whole array to read element zero is wasteful on a per-event path. */
function firstOf(map: Map<number, PointerPosition>): PointerPosition | undefined {
  const next = map.values().next();
  return next.done ? undefined : next.value;
}

// ---------------------------------------------------------------------------
// The Prezi move — centering the camera on a selected element (W16)
// ---------------------------------------------------------------------------

/** A measured rectangle in viewport-local screen pixels — the same space
 * `Viewport.x/y` and every pointer sample live in. The caller measures (one
 * `getBoundingClientRect` pair, outside any gesture) and subtracts the box's
 * own origin; this file never touches a DOM node, for the same testability
 * reason as `createCanvasGesture`. */
export interface MeasuredRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The most the camera may zoom IN when centering a selection.
 *
 * 2.5 puts the smallest type this canvas draws (12px, `.mj-process-name`) at
 * 30px — unmissable — while a `--fill` viewport still shows several hundred
 * content-pixels of the surrounding figure, which is the owner's actual ask:
 * *"persist showing the highlighted item with the rest of the map around it"*.
 * Like `maxZoom`'s 8, it is a judgment stop, not a measurement: it only has to
 * be past "clearly prominent" and short of "the item is the whole screen", and
 * 2.5 is both. Zooming *out* to fit a large selection has no floor of its own —
 * `VIEWPORT_LIMITS.minZoom` already bounds it.
 */
export const SELECTION_ZOOM_MAX = 2.5;

/**
 * How much of the limiting box dimension a centered selection may fill.
 *
 * 0.8 leaves a tenth of the box on each side of the selection — enough that a
 * lane's neighbours stay visible around it (the "rest of the map"), and the
 * reason this is a fill fraction rather than a fixed zoom: a state circle and
 * a 2,000px lane need opposite camera moves to satisfy the same sentence.
 */
export const SELECTION_FILL = 0.8;

/**
 * The viewport that centers `target` in `box`, zoomed so the selection is
 * prominent but never the whole picture.
 *
 * Derivation, in the same coordinate frame as `zoomAbout`: the target's centre
 * is at viewport-local `S`; the content point under it is `C = (S − t)/z`. The
 * new zoom `z'` is chosen from the target's *content-space* size (its measured
 * size divided by the current `z`, so the answer does not depend on where the
 * camera happens to be standing — pinned by test): fill `SELECTION_FILL` of the
 * limiting dimension, capped by `SELECTION_ZOOM_MAX` and the global limits.
 * The translation then places `C` at the box centre: `t' = box/2 − z'·C`.
 *
 * Total: a degenerate measurement (a hidden element reports 0×0) is clamped to
 * one content pixel rather than dividing by zero into an `Infinity` zoom.
 */
export function centerOn(
  view: Viewport,
  target: MeasuredRect,
  box: { width: number; height: number },
  /**
   * `"fit"` frames the target — the W16 move, for when the reader picked a new
   * thing to look at. `"keep"` holds the reader's own zoom and moves only the
   * camera's position.
   *
   * **The owner's ask, verbatim (`e6585b`): *"do not zoom in when clicking to
   * expand/contract. just recenter."*** Opening a line is not choosing a new
   * subject: the reader is already looking at this lane, at a magnification
   * they chose, and re-fitting throws that away — the figure jumps to a new
   * scale on every toggle, which is what he was reading as "zooming in".
   *
   * One function with a mode rather than two functions, because the centring
   * arithmetic below is the part that must not be written twice: the two
   * differ in `z` alone, and a second copy is how one of them ends up centring
   * on a stale `view.z` after the other is fixed.
   */
  zoom: "fit" | "keep" = "fit",
): Viewport {
  const cw = Math.max(1, target.width / view.z);
  const ch = Math.max(1, target.height / view.z);
  const cx = (target.left + target.width / 2 - view.x) / view.z;
  const cy = (target.top + target.height / 2 - view.y) / view.z;
  const fit = Math.min((SELECTION_FILL * box.width) / cw, (SELECTION_FILL * box.height) / ch);
  const z = zoom === "keep" ? view.z : clampZoom(Math.min(SELECTION_ZOOM_MAX, fit));
  return { x: box.width / 2 - z * cx, y: box.height / 2 - z * cy, z };
}

/** How long the camera takes to fly to a selection. Inside the ≤320ms bound
 * `docs/ui/components.md` sets for continuity transitions on this canvas. */
export const FLY_DURATION_MS = 320;

/**
 * The camera's position `t` of the way from `from` to `to`, `t` in [0, 1].
 *
 * `x`/`y` interpolate linearly; `z` interpolates in **log space**, because zoom
 * is multiplicative — the linear midpoint of 0.5× and 2× is 1.25×, which reads
 * as "zoomed in, then in some more", where the geometric midpoint 1× is the
 * halfway a reader's eye expects. Endpoints are exact by construction (`t=0`
 * returns `from`'s values, `t=1` returns `to`'s — pinned by test), so the tween
 * cannot land next to its target and leave the URL writeback a hair off.
 */
export function interpolateViewport(from: Viewport, to: Viewport, t: number): Viewport {
  if (t <= 0) return from;
  if (t >= 1) return to;
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z * Math.exp(Math.log(to.z / from.z) * t),
  };
}

/** The standard symmetric ease — starts and ends at rest. The camera is the
 * one moving thing on screen during a fly, so an abrupt start reads as a cut
 * rather than a move; cubic matches `--ease-converge`'s weight closely enough
 * that the two never run side by side looking like different systems. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
