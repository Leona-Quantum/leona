import assert from "node:assert/strict";
import test from "node:test";
import {
  IDENTITY,
  VIEWPORT_LIMITS,
  clampZoom,
  formatViewport,
  parseViewport,
  transformOf,
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
