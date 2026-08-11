import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAG_THRESHOLD_PX,
  IDENTITY,
  KEYBOARD_ZOOM_FACTOR,
  SELECTION_FILL,
  SELECTION_ZOOM_MAX,
  VIEWPORT_LIMITS,
  WHEEL_LINE_HEIGHT_PX,
  WHEEL_ZOOM_SENSITIVITY,
  WHEEL_ZOOM_STEP_LIMIT,
  centerOn,
  clampZoom,
  createCanvasGesture,
  easeInOutCubic,
  formatViewport,
  interpolateViewport,
  isViewportValue,
  panBy,
  parseViewport,
  transformOf,
  wheelPixels,
  wheelZoomFactor,
  zoomAbout,
} from "./repository/canvas-viewport.ts";

/**
 * `?at=x,y,z` on `/repository/layers` — the pan/zoom address for the
 * converge canvas. Same failure mode as the four `?focus=`/`?depth=` params on
 * the same route (`repository-browse-params.test.ts`'s header explains the
 * class): a param that resolves wrong still renders a page, and it renders
 * fine to whoever is looking at a hydrated browser that never hit the bad
 * value. Total-function coverage of `parseViewport` matters more here than for
 * a closed-vocabulary filter, because the failure mode is not "wrong filter"
 * but a broken CSS transform — content panned off-screen or scaled to a
 * speck — which reads as "the page is broken".
 */

test("parseViewport is total: every malformed shape falls back to IDENTITY", () => {
  const malformed = [
    "",
    "a,b,c",
    "1,2",
    "1,2,3,4",
    "1,NaN,1",
    "1,Infinity,1",
    "1,-Infinity,1",
    ",,1",
    "1,,1",
    " , , ",
  ];
  for (const raw of malformed) {
    assert.deepEqual(parseViewport(raw), IDENTITY, `raw: ${JSON.stringify(raw)}`);
  }
  assert.deepEqual(parseViewport(undefined), IDENTITY);
  assert.deepEqual(parseViewport(null), IDENTITY);
  // An array whose first element alone is not an "x,y,z" triple — the shape a
  // repeated `?at=1&at=2&at=3` param would arrive as. `first()` takes only the
  // first element (same convention as `browse-params.ts`), and "1" splits to
  // one part, not three, so this is malformed rather than silently reading
  // just the x component.
  assert.deepEqual(parseViewport(["1", "2", "3"]), IDENTITY);
  // An empty array is not a first value, same as every other param on this route.
  assert.deepEqual(parseViewport([]), IDENTITY);
});

test("parseViewport accepts a well-formed triple, and clamps z into range", () => {
  assert.deepEqual(parseViewport("12.5,-7,2"), { x: 12.5, y: -7, z: 2 });
  // z is clamped rather than rejected: a bookmark from before the limits
  // changed, or a hand-edited URL, reopens at the nearest supported zoom.
  assert.deepEqual(parseViewport("0,0,100"), { x: 0, y: 0, z: VIEWPORT_LIMITS.maxZoom });
  assert.deepEqual(parseViewport("0,0,0.0001"), { x: 0, y: 0, z: VIEWPORT_LIMITS.minZoom });
  // A repeated param takes the first, when the first is itself well-formed.
  assert.deepEqual(parseViewport(["4,5,2", "1,1,1"]), { x: 4, y: 5, z: 2 });
});

test("clampZoom holds at both ends of VIEWPORT_LIMITS and passes mid-range through", () => {
  assert.equal(clampZoom(0), VIEWPORT_LIMITS.minZoom);
  assert.equal(clampZoom(0.01), VIEWPORT_LIMITS.minZoom);
  assert.equal(clampZoom(VIEWPORT_LIMITS.minZoom), VIEWPORT_LIMITS.minZoom);
  assert.equal(clampZoom(VIEWPORT_LIMITS.maxZoom), VIEWPORT_LIMITS.maxZoom);
  assert.equal(clampZoom(100), VIEWPORT_LIMITS.maxZoom);
  assert.equal(clampZoom(-5), VIEWPORT_LIMITS.minZoom);
  assert.equal(clampZoom(1.5), 1.5);
});

test("formatViewport / parseViewport round-trip within the stated precision", () => {
  const v = { x: 12.3456, y: -7.891, z: 2.34567 };
  const formatted = formatViewport(v);
  const reparsed = parseViewport(formatted);
  // Reformatting what was reparsed must reproduce the same string — the
  // precision loss happens exactly once, at format time, not again at parse
  // time or on a second format.
  assert.equal(formatViewport(reparsed), formatted);
  assert.deepEqual(reparsed, { x: 12.35, y: -7.89, z: 2.346 });

  // Identity formats to the literal string InfiniteCanvas checks for before
  // omitting `?at=` — see canvas-viewport.ts's header on why there must be
  // exactly one writer of this string.
  assert.equal(formatViewport(IDENTITY), "0,0,1");
});

test("zoomAbout keeps the named point fixed, at several zoom levels and offsets", () => {
  // For each case: the content point under (px, py) before the zoom, computed
  // from the *input* viewport, must equal the content point under (px, py)
  // after the zoom, computed from the *output* viewport. That is the property
  // "keeps the point visually fixed" means, independent of the derivation in
  // canvas-viewport.ts — this check does not reuse that arithmetic.
  const cases: Array<{ view: { x: number; y: number; z: number }; px: number; py: number; factor: number }> = [
    { view: { x: 0, y: 0, z: 1 }, px: 100, py: 50, factor: 2 },
    { view: { x: 20, y: -10, z: 2 }, px: 150, py: 80, factor: 1.5 },
    { view: { x: -40, y: 200, z: 0.5 }, px: 0, py: 0, factor: 4 },
    { view: { x: 12.5, y: -3.25, z: 3 }, px: 400, py: 250, factor: 1 / 3 },
  ];
  for (const { view, px, py, factor } of cases) {
    const before = { x: (px - view.x) / view.z, y: (py - view.y) / view.z };
    const after = zoomAbout(view, px, py, factor);
    const contentAfter = { x: (px - after.x) / after.z, y: (py - after.y) / after.z };
    assert.ok(Math.abs(before.x - contentAfter.x) < 1e-9, JSON.stringify({ view, px, py, factor }));
    assert.ok(Math.abs(before.y - contentAfter.y) < 1e-9, JSON.stringify({ view, px, py, factor }));
  }
});

test("zoomAbout does not drift the fixed point when the clamp shrinks the requested factor", () => {
  // At max zoom, requesting a further zoom-in clamps z to exactly what it
  // already was — effectiveFactor is 1 — so x/y must be provably unchanged,
  // not merely close. Deriving the translation from the *requested* factor
  // (2, here) instead of the *effective* one (1) would move x/y as though a
  // zoom happened while the picture on screen did not change scale at all.
  const atMax = { x: 37, y: -12, z: VIEWPORT_LIMITS.maxZoom };
  assert.deepEqual(zoomAbout(atMax, 400, 300, 2), atMax);

  // Same at min zoom, zooming out further.
  const atMin = { x: 5, y: 5, z: VIEWPORT_LIMITS.minZoom };
  assert.deepEqual(zoomAbout(atMin, 50, 50, 0.5), atMin);

  // A factor that *partially* clamps: z=6 * 3 requests 18, clamps to 8, so the
  // effective factor is 8/6, not 3. Pin the exact numbers so a regression that
  // reintroduces the requested-factor bug (rather than the effective one)
  // fails here even though it would not fail the two boundary cases above,
  // where effectiveFactor happens to be a round number (1).
  const partial = zoomAbout({ x: 0, y: 0, z: 6 }, 120, 90, 3);
  const effectiveFactor = 8 / 6;
  assert.equal(partial.z, 8);
  assert.ok(Math.abs(partial.x - (120 - effectiveFactor * 120)) < 1e-9);
  assert.ok(Math.abs(partial.y - (90 - effectiveFactor * 90)) < 1e-9);
});

test("transformOf renders translate-then-scale with px units, matching CSS's application order", () => {
  assert.equal(transformOf({ x: 1.5, y: -2, z: 0.5 }), "translate(1.5px, -2px) scale(0.5)");
  assert.equal(transformOf(IDENTITY), "translate(0px, 0px) scale(1)");
});

test("panBy is a flat screen-pixel shift that does not depend on z", () => {
  // The whole reason pan arithmetic is simple is that `translate()` is the
  // outer transform in `transformOf`'s pair, so x/y are screen pixels at every
  // zoom level. The same 30px drag must move the picture 30px whether the
  // reader is at 0.5x or at 4x — a division or multiplication by z creeping in
  // here would show up as a canvas that pans in slow motion when zoomed out.
  for (const z of [VIEWPORT_LIMITS.minZoom, 0.5, 1, 4, VIEWPORT_LIMITS.maxZoom]) {
    assert.deepEqual(panBy({ x: 10, y: -5, z }, 30, -12), { x: 40, y: -17, z });
  }
  // A zero delta is the identity, and z is carried rather than recomputed.
  assert.deepEqual(panBy({ x: 3, y: 4, z: 2.5 }, 0, 0), { x: 3, y: 4, z: 2.5 });
});

// --- wheel input ------------------------------------------------------------

test("wheelPixels brings all three deltaModes into CSS pixels", () => {
  // Mode 0 is what real wheel and trackpad hardware reports; it passes through.
  assert.equal(wheelPixels(120, 0, 500), 120);
  assert.equal(wheelPixels(-3.5, 0, 500), -3.5);
  // Mode 1 counts lines.
  assert.equal(wheelPixels(3, 1, 500), 3 * WHEEL_LINE_HEIGHT_PX);
  // Mode 2 counts pages, which only means something relative to the surface
  // the event landed on — hence the caller-supplied size.
  assert.equal(wheelPixels(2, 2, 500), 1000);
  assert.equal(wheelPixels(2, 2, 320), 640);
  // An unknown mode is treated as pixels rather than dropped: a delta of the
  // wrong scale is a bad zoom step, a dropped delta is a dead control.
  assert.equal(wheelPixels(9, 7, 500), 9);
});

test("wheelZoomFactor: a mouse notch clamps to exactly one keyboard step, a pinch event does not clamp", () => {
  // One physical mouse notch is a single ~100px event in Chrome's default
  // pixel mode. Negative delta (wheel pushed away, fingers spread) zooms in.
  assert.equal(wheelZoomFactor(-100), KEYBOARD_ZOOM_FACTOR);
  assert.equal(wheelZoomFactor(100), 1 / KEYBOARD_ZOOM_FACTOR);
  assert.equal(WHEEL_ZOOM_STEP_LIMIT, KEYBOARD_ZOOM_FACTOR);

  // The boundary the constant's comment claims: ln(1.2) / 0.004 ≈ 45.6px. Pin
  // both sides of it, so a change to either the sensitivity or the limit that
  // moves the boundary has to move this comment with it.
  const boundary = Math.log(WHEEL_ZOOM_STEP_LIMIT) / WHEEL_ZOOM_SENSITIVITY;
  assert.ok(boundary > 45 && boundary < 46, `boundary: ${boundary}`);
  assert.ok(wheelZoomFactor(-40) < WHEEL_ZOOM_STEP_LIMIT);
  assert.equal(wheelZoomFactor(-50), WHEEL_ZOOM_STEP_LIMIT);

  // A trackpad pinch sends deltas an order of magnitude smaller than a notch,
  // and those must ride the raw exponential — clamping them is what made the
  // old sensitivity feel sluggish.
  assert.ok(Math.abs(wheelZoomFactor(-5) - Math.exp(5 * WHEEL_ZOOM_SENSITIVITY)) < 1e-12);
  assert.ok(Math.abs(wheelZoomFactor(5) - Math.exp(-5 * WHEEL_ZOOM_SENSITIVITY)) < 1e-12);

  // Exact inverses in both regimes: N pixels one way and N back lands where it
  // started. That is the property the exponential is chosen for, and it has to
  // survive the clamp — which is why the clamp is symmetric.
  for (const pixels of [3, 20, 45, 100, 4000]) {
    assert.ok(Math.abs(wheelZoomFactor(pixels) * wheelZoomFactor(-pixels) - 1) < 1e-12, `pixels: ${pixels}`);
  }

  // A very large delta (a "page" mode event, a flung wheel) is still one
  // bounded step rather than a jump straight to a limit.
  assert.equal(wheelZoomFactor(100000), 1 / WHEEL_ZOOM_STEP_LIMIT);
});

// --- pointer gestures -------------------------------------------------------
//
// `createCanvasGesture` is the pan/pinch state machine lifted out of
// `InfiniteCanvas` so it can be exercised with no DOM. Both of the failures it
// guards against are silent in a browser: a canvas that eats every click looks
// like a set of broken links, and a contact that is tracked forever looks like
// a canvas that randomly zooms itself on the next press.

test("a press that does not cross the drag threshold neither pans nor takes capture", () => {
  // Every shape on this canvas is an `<a href>`, and pointer capture retargets
  // the compatibility `click` at the capturing element. Taking capture on a
  // press — or reporting a pan from one — is how every link on the canvas
  // becomes silently dead.
  const gesture = createCanvasGesture();
  const pressed = gesture.down({ id: 1, x: 100, y: 100, isPrimary: true }, IDENTITY);
  assert.deepEqual([...pressed.capture], []);
  assert.equal(pressed.view, null);
  assert.equal(pressed.beganDrag, false);

  // Jitter, just inside the threshold on the diagonal.
  const jitter = gesture.move({ id: 1, x: 102, y: 102 });
  assert.ok(Math.hypot(2, 2) < DRAG_THRESHOLD_PX);
  assert.equal(jitter.view, null);
  assert.deepEqual([...jitter.capture], []);

  // Releasing must leave the following click alone.
  const released = gesture.end(1);
  assert.equal(released.suppressClick, false);
  assert.equal(released.endedDrag, false);
  assert.deepEqual(gesture.ids(), []);
});

test("crossing the threshold pans from the press anchor, captures once, and suppresses the click once", () => {
  const gesture = createCanvasGesture();
  const start = { x: 10, y: 20, z: 2 };
  gesture.down({ id: 7, x: 100, y: 100, isPrimary: true }, start);
  assert.equal(gesture.move({ id: 7, x: 102, y: 102 }).view, null);

  const crossed = gesture.move({ id: 7, x: 106, y: 100 });
  // Measured from the press, not from the last move: a drag that accumulated
  // per-move deltas would drop the 2px of jitter the threshold swallowed and
  // the content would lag the pointer by that much for the rest of the gesture.
  assert.deepEqual(crossed.view, { x: 16, y: 20, z: 2 });
  assert.deepEqual([...crossed.capture], [7]);
  assert.equal(crossed.beganDrag, true);

  const further = gesture.move({ id: 7, x: 130, y: 110 });
  assert.deepEqual(further.view, { x: 40, y: 30, z: 2 });
  // Capture and the "began" edge are reported exactly once, not on every move:
  // the caller turns `beganDrag` into a React state write, and the old handler
  // did that on every single pointermove.
  assert.deepEqual([...further.capture], []);
  assert.equal(further.beganDrag, false);

  const released = gesture.end(7);
  assert.equal(released.suppressClick, true);
  assert.equal(released.endedDrag, true);
  // Idempotent: the same release may be heard from the window listener and
  // again from `lostpointercapture`, and the second one must not re-raise it.
  assert.deepEqual(gesture.end(7), {
    view: null,
    capture: [],
    beganDrag: false,
    endedDrag: false,
    suppressClick: false,
  });
});

test("a press released outside the window does not turn the next press into a phantom pinch", () => {
  // The defect this pins, as it happened: listeners were element-scoped, so a
  // press that stayed under the threshold (capture therefore never taken) and
  // released somewhere else never produced an `end` at all. Its entry stayed in
  // the pointer map forever. The next, unrelated press then made the map size
  // two, the surface entered pinch mode anchored on a position from a gesture
  // that was over, and the first move zoomed by
  // `distance(ghost, live) / startSpan` — a garbage factor, in this case a
  // near-instant jump to a limit.
  const gesture = createCanvasGesture();
  gesture.down({ id: 1, x: 100, y: 100, isPrimary: true }, IDENTITY);
  gesture.move({ id: 1, x: 102, y: 101 });
  // No end(). This is the state the browser leaves behind.
  assert.deepEqual(gesture.ids(), [1]);

  // A new gesture's first contact is its primary one — for touch, a new primary
  // pointer only exists once every previous contact has lifted; for a mouse
  // there is only ever one. So a primary press while contacts are tracked
  // proves those contacts are ghosts.
  const second = gesture.down({ id: 2, x: 400, y: 300, isPrimary: true }, IDENTITY);
  assert.deepEqual(gesture.ids(), [2]);
  // Not a pinch: no capture taken, nothing zoomed.
  assert.deepEqual([...second.capture], []);
  assert.equal(second.view, null);
  // And it behaves as an ordinary fresh press: threshold first, then a pan.
  assert.equal(gesture.move({ id: 2, x: 402, y: 301 }).view, null);
  assert.deepEqual(gesture.move({ id: 2, x: 420, y: 300 }).view, { x: 20, y: 0, z: 1 });
});

test("a second, non-primary contact is a real pinch: capture from the start, zoom about the midpoint", () => {
  // The other side of the guard above — a genuine two-finger gesture must not
  // be mistaken for a ghost and thrown away.
  const gesture = createCanvasGesture();
  gesture.down({ id: 1, x: 100, y: 100, isPrimary: true }, IDENTITY);
  const second = gesture.down({ id: 2, x: 200, y: 100, isPrimary: false }, IDENTITY);
  assert.deepEqual(gesture.ids(), [1, 2]);
  // A pinch needs capture immediately: there is no threshold to wait for and
  // two fingers are never a click.
  assert.deepEqual([...second.capture].sort(), [1, 2]);
  assert.equal(second.view, null);

  // Spread to twice the span. Midpoint is now (200, 100), factor 2.
  assert.deepEqual(gesture.move({ id: 2, x: 300, y: 100 }).view, { x: -200, y: -100, z: 2 });
  // Anchored on the pinch start, not accumulated per move: bringing the fingers
  // back to where they began must return to where the view began, exactly.
  assert.deepEqual(gesture.move({ id: 2, x: 200, y: 100 }).view, IDENTITY);
});

test("when one finger of a pinch lifts, the gesture is handed to the finger still down", () => {
  // Without the handover the surface goes dead under a finger that is still on
  // the glass, which reads as a stuck canvas. The handover is a *fresh* drag
  // anchored where that finger is now — not a resumption of the drag the pinch
  // cancelled, which would pan by both fingers' movement.
  const gesture = createCanvasGesture();
  gesture.down({ id: 1, x: 100, y: 100, isPrimary: true }, IDENTITY);
  gesture.down({ id: 2, x: 200, y: 100, isPrimary: false }, IDENTITY);
  assert.deepEqual(gesture.move({ id: 2, x: 300, y: 100 }).view, { x: -200, y: -100, z: 2 });

  const lifted = gesture.end(2);
  assert.equal(lifted.beganDrag, true);
  assert.deepEqual([...lifted.capture], [1]);
  assert.equal(lifted.view, null);

  // Finger 1 has not moved since it landed, so its drag anchor is (100, 100)
  // and the zoom the pinch produced is carried, not reset.
  assert.deepEqual(gesture.move({ id: 1, x: 140, y: 130 }).view, { x: -160, y: -70, z: 2 });
  // The gesture moved the picture, so the click it may synthesize must not
  // navigate — even though the drag that reports it began as a pinch.
  assert.equal(gesture.end(1).suppressClick, true);
  assert.deepEqual(gesture.ids(), []);
});

test("cancelAll forgets every contact, and a move for an untracked contact is inert", () => {
  // What `InfiniteCanvas` calls when the window loses focus: the pointer left
  // the window and was released somewhere we will never be told about.
  const gesture = createCanvasGesture();
  gesture.down({ id: 1, x: 100, y: 100, isPrimary: true }, IDENTITY);
  assert.deepEqual(gesture.move({ id: 1, x: 140, y: 100 }).view, { x: 40, y: 0, z: 1 });

  const cancelled = gesture.cancelAll();
  assert.equal(cancelled.endedDrag, true);
  assert.equal(cancelled.suppressClick, false);
  assert.deepEqual(gesture.ids(), []);

  // A late move for a contact nobody is tracking changes nothing — it must not
  // re-register the contact, which would be the ghost bug rebuilt by a
  // different route.
  assert.equal(gesture.move({ id: 1, x: 900, y: 900 }).view, null);
  assert.deepEqual(gesture.ids(), []);
});

// ---------------------------------------------------------------------------
// The Prezi move (W16): centering math, tween interpolation, the `at` predicate
// ---------------------------------------------------------------------------

test("isViewportValue tells a viewport from a W15 lane address, with parseViewport's exact rules", () => {
  for (const good of ["1,2,3", "0,0,1", "-5.5,3,0.5", " 1 , 2 , 3 "]) {
    assert.equal(isViewportValue(good), true, good);
  }
  // "linear-ode-solve:0.0.1.1.0" is the load-bearing rejection, in the exact
  // shape the demoted-lane jump control writes into `?at=` (verified against a
  // real saturated figure): `carrySelection` rewrites it into `?sel=` only
  // because this predicate refuses it.
  for (const bad of [
    "",
    "linear-ode-solve:0.0.1.1.0",
    "1.0.3",
    "1,2",
    "1,2,3,4",
    "a,b,c",
    ",,1",
    "1,NaN,2",
    "1,2,Infinity",
  ]) {
    assert.equal(isViewportValue(bad), false, bad);
  }
});

test("centerOn puts the target's content centre at the box centre — verified independently", () => {
  const view = { x: 37, y: -12, z: 1.4 };
  const target = { left: 400, top: 250, width: 140, height: 60 };
  const box = { width: 1200, height: 800 };
  const landed = centerOn(view, target, box);
  // The content point under the target's measured centre, computed here from
  // the transform's definition rather than through centerOn's own arithmetic.
  const contentX = (target.left + target.width / 2 - view.x) / view.z;
  const contentY = (target.top + target.height / 2 - view.y) / view.z;
  assert.ok(Math.abs(landed.x + landed.z * contentX - box.width / 2) < 1e-9);
  assert.ok(Math.abs(landed.y + landed.z * contentY - box.height / 2) < 1e-9);
});

test("centerOn does not depend on where the camera is standing", () => {
  // One content-space rectangle, measured under two different viewports: the
  // landing viewport must be identical, or a shared `?sel=` link would frame
  // differently depending on the pan the reader happened to arrive with.
  const content = { left: 300, top: 180, width: 200, height: 40 };
  const box = { width: 1000, height: 700 };
  const measuredUnder = (v: { x: number; y: number; z: number }) => ({
    left: v.x + v.z * content.left,
    top: v.y + v.z * content.top,
    width: v.z * content.width,
    height: v.z * content.height,
  });
  const a = centerOn({ x: 0, y: 0, z: 1 }, measuredUnder({ x: 0, y: 0, z: 1 }), box);
  const b = centerOn({ x: -250, y: 90, z: 2.2 }, measuredUnder({ x: -250, y: 90, z: 2.2 }), box);
  assert.ok(Math.abs(a.x - b.x) < 1e-9);
  assert.ok(Math.abs(a.y - b.y) < 1e-9);
  assert.ok(Math.abs(a.z - b.z) < 1e-9);
});

test("centerOn caps a small target at SELECTION_ZOOM_MAX and zooms out to fit a large one", () => {
  const box = { width: 1200, height: 800 };
  // A state circle: ~26 content px. Filling 80% of the box would be z ≈ 24; the
  // camera stops at the prominence cap instead — the owner's "with the rest of
  // the map around it".
  const small = centerOn(IDENTITY, { left: 500, top: 300, width: 26, height: 26 }, box);
  assert.equal(small.z, SELECTION_ZOOM_MAX);
  // A 4000px lane: the camera zooms OUT so the whole selection fits inside
  // SELECTION_FILL of the box.
  const large = centerOn(IDENTITY, { left: 0, top: 300, width: 4000, height: 40 }, box);
  assert.ok(Math.abs(large.z - (SELECTION_FILL * box.width) / 4000) < 1e-9);
  assert.ok(large.z * 4000 <= box.width);
});

test("centerOn is total at the edges: a zero-size measurement and an absurd one both stay finite", () => {
  const box = { width: 1200, height: 800 };
  // A hidden element reports 0×0; the divide-by-zero would otherwise be an
  // Infinity zoom written straight into the URL.
  const degenerate = centerOn(IDENTITY, { left: 10, top: 10, width: 0, height: 0 }, box);
  assert.ok(Number.isFinite(degenerate.x) && Number.isFinite(degenerate.y));
  assert.equal(degenerate.z, SELECTION_ZOOM_MAX);
  // A million content pixels wide: the fit factor falls below minZoom and the
  // shared clamp holds, same clamp as every other zoom writer.
  const absurd = centerOn(IDENTITY, { left: 0, top: 0, width: 1e6, height: 40 }, box);
  assert.equal(absurd.z, VIEWPORT_LIMITS.minZoom);
});

test("interpolateViewport: exact endpoints, linear x/y, geometric z", () => {
  const from = { x: 0, y: 100, z: 0.5 };
  const to = { x: 200, y: -60, z: 2 };
  assert.deepEqual(interpolateViewport(from, to, 0), from);
  assert.deepEqual(interpolateViewport(from, to, 1), to);
  const mid = interpolateViewport(from, to, 0.5);
  assert.equal(mid.x, 100);
  assert.equal(mid.y, 20);
  // The geometric midpoint of 0.5x and 2x is 1x — the halfway a reader's eye
  // expects from a zoom, where the linear midpoint 1.25x reads as overshoot.
  assert.ok(Math.abs(mid.z - 1) < 1e-9);
});

test("easeInOutCubic is a symmetric ease with exact endpoints and no backtracking", () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
  let previous = 0;
  for (let i = 1; i <= 100; i++) {
    const value = easeInOutCubic(i / 100);
    assert.ok(value >= previous, `not monotone at ${i / 100}`);
    previous = value;
  }
});
