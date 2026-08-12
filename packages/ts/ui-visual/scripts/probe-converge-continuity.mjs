// Does opening a line actually *move* the drawing rather than replace the page?
//
// Three things have to be true at once and none can be read off the source:
//   1. the click is intercepted, so the document is never replaced;
//   2. React keeps the lane elements, so their `d` changes on the same nodes;
//   3. the CSS transitions therefore fire.
//
// Since W16 it also asks whether the click *selects*, and whether the camera
// flies to what it selected — see the W16 section below. Since W20 it also
// reads the paper surface back: one click on a paper page opens the paper's
// pipeline on the map — the last section of this file.
//
// Playwright rather than the agent browser pane, for the same reason as the SVG
// view-transition probe: an agent tab is hidden, and a hidden document behaves
// differently enough that "did not run" and "does not work" look identical.
// The W16 section sharpens that warning with a measurement: a tab can report
// `visibilityState: "visible"` and still be served **zero** requestAnimation-
// Frame callbacks, which makes every rAF-driven feature look broken rather than
// merely unobserved. Every camera verdict below therefore carries `rafTicks`.
//
// Serve first:  NEXT_DIST_DIR=.next-prod-agent pnpm --filter @majorana/web start --port 3457
// Then:         node scripts/probe-converge-continuity.mjs [url]
//
// `[url]` may equally be a deployed origin — `node scripts/probe-converge-
// continuity.mjs https://leonaqt.com` reads production back, which is how the
// W16 cases below were first verified.
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://127.0.0.1:3457";
const browser = await chromium.launch();
let page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const out = {};

await page.goto(`${BASE}/repository/layers?focus=nonlinear-ode-solve`, { waitUntil: "networkidle" });

// Tag the document so we can tell a same-document update from a fresh one.
await page.evaluate(() => {
  window.__stayed = true;
  document.addEventListener("visibilitychange", () => {});
});

out.startUrl = page.url();

/**
 * A viewport point that is genuinely **on** a lane's stroke.
 *
 * Not the element's bounding-box centre, which is what a plain `.click()` aims
 * at: a lane is a bowed curve, so the centre of its box is usually empty space
 * and the click lands on the `<svg>` behind it. That failure reports as
 * "intercepts pointer events" and reads exactly like a broken control.
 */
async function pointOnLane(selector) {
  return page.evaluate((sel) => {
    const path = document.querySelector(sel);
    if (!path) return null;
    const local = path.getPointAtLength(path.getTotalLength() / 2);
    const ctm = path.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(local.x, local.y).matrixTransform(ctm);
    return { x: p.x, y: p.y };
  }, selector);
}

const openLink = page.locator("svg.mj-converge-canvas a[href*='open=']").first();
out.openHref = await openLink.getAttribute("href");
// Mark the hit path inside that specific anchor so the click is aimed at it.
await page.evaluate(() => {
  const a = document.querySelector("svg.mj-converge-canvas a[href*='open=']");
  const hit = a?.querySelector(".mj-converge-strand-hit");
  if (hit) hit.setAttribute("data-aim", "here");
});

// Identify one lane path and watch whether the same DOM node survives the click.
await page.evaluate(() => {
  const path = document.querySelector("svg.mj-converge-canvas .mj-converge-strand-body");
  if (path) path.setAttribute("data-probe", "watched");
});
const before = await page.evaluate(() => {
  const p = document.querySelector('[data-probe="watched"]');
  return p ? { d: p.getAttribute("d"), transition: getComputedStyle(p).transitionProperty } : null;
});
out.beforeSample = before;
out.laneCountBefore = await page.locator("svg.mj-converge-canvas .mj-converge-lane").count();

// Click, then immediately sample the running animations — a CSS transition on `d`
// only exists between the change and the end of the duration.
const aim = await pointOnLane('[data-aim="here"]');
out.clickedAt = aim;
if (!aim) throw new Error("no point found on the lane's hit stroke");
// Confirm the click will actually land on the anchor before spending it — a
// synthetic click that misses is indistinguishable from a feature that is broken.
out.topmostAtAim = await page.evaluate(
  ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("class") ?? null,
  aim,
);
await page.mouse.click(aim.x, aim.y);
await page.waitForFunction(() => window.location.search.includes("open="), null, { timeout: 5000 });

const during = await page.evaluate(() => {
  const running = document.getAnimations().map((a) => ({
    type: a.constructor.name,
    prop: a.transitionProperty ?? a.animationName ?? null,
    cls: a.effect?.target?.getAttribute?.("class") ?? null,
  }));
  return {
    stayed: window.__stayed === true,
    probeSurvived: document.querySelector('[data-probe="watched"]') !== null,
    transitions: running.filter((a) => a.type === "CSSTransition").length,
    animations: running.filter((a) => a.type === "CSSAnimation").length,
    transitionProps: [...new Set(running.filter((a) => a.type === "CSSTransition").map((a) => a.prop))],
    animationNames: [...new Set(running.filter((a) => a.type === "CSSAnimation").map((a) => a.prop))],
    sample: running.slice(0, 6),
  };
});
out.duringClick = during;
out.urlAfter = page.url();
out.laneCountAfter = await page.locator("svg.mj-converge-canvas .mj-converge-lane").count();

// A control: with JavaScript off the same anchor must still navigate.
const noJs = await browser.newContext({ javaScriptEnabled: false });
const plain = await noJs.newPage();
await plain.goto(`${BASE}${out.openHref}`, { waitUntil: "domcontentloaded" });
out.withoutJavaScript = {
  url: plain.url(),
  lanes: await plain.locator("svg.mj-converge-canvas .mj-converge-lane").count(),
  anchors: await plain.locator("svg.mj-converge-canvas a").count(),
};
// Close it, and put the scripted page back in front. Leaving a second context
// open was a real bug in this probe: the newer page takes the foreground, the
// original is backgrounded, and a backgrounded page's `requestAnimationFrame`
// is starved — so the W16 camera fly below never advanced a single frame and
// reported as a broken feature. Exactly the hazard in this file's header,
// arriving from inside the probe rather than from the agent pane.
await noJs.close();
await page.bringToFront();

// After a pan, the pushed URL must say where the reader actually is — the anchors
// still carry the `?at=` the server rendered with, and `InfiniteCanvas` writes the
// live one in with a debounced replaceState.
await page.goto(`${BASE}/repository/layers?focus=nonlinear-ode-solve`, { waitUntil: "networkidle" });
const canvas = page.locator(".mj-canvas-viewport, .mj-converge-scroll").first();
const box = await canvas.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 140, box.y + box.height / 2 - 60, { steps: 12 });
  await page.mouse.up();
}
await page.waitForFunction(() => window.location.search.includes("at="), null, { timeout: 5000 })
  .catch(() => {});
const panned = new URL(page.url()).searchParams.get("at");
const anchorAt = await page.evaluate(() => {
  const a = document.querySelector("svg.mj-converge-canvas a[href*='open=']");
  return a ? new URL(a.getAttribute("href"), location.href).searchParams.get("at") : null;
});
await page.evaluate(() => {
  const a = document.querySelector("svg.mj-converge-canvas a[href*='open=']");
  const hit = a?.querySelector(".mj-converge-strand-hit");
  if (hit) hit.setAttribute("data-aim", "here");
});
const aim2 = await pointOnLane('[data-aim="here"]');
if (aim2) await page.mouse.click(aim2.x, aim2.y);
await page.waitForFunction(() => window.location.search.includes("open="), null, { timeout: 5000 })
  .catch(() => {});
out.afterPan = {
  urlAtWhilePanned: panned,
  atStampedOnTheAnchor: anchorAt,
  atInThePushedUrl: new URL(page.url()).searchParams.get("at"),
  // The interesting case only exists if the pan actually moved the URL away from
  // what the anchors carry; say so rather than reporting a vacuous pass.
  driftExisted: panned !== null && panned !== anchorAt,
};

// And a cross-page link must NOT be intercepted — it keeps the cross-document zoom.
await page.goto(`${BASE}/repository/layers?focus=nonlinear-ode-solve`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  window.__stayed = true;
});
const nameLink = page.locator("svg.mj-converge-canvas a[href^='/repository/layers/']").first();
out.nameHref = await nameLink.getAttribute("href");
await nameLink.click({ force: true });
await page.waitForLoadState("domcontentloaded");
out.crossPage = { url: page.url(), stayed: await page.evaluate(() => window.__stayed === true) };

// ---------------------------------------------------------------------------
// W16, the Prezi move: a click *selects*, and the camera flies to what it picked
// ---------------------------------------------------------------------------
//
// The rules themselves are pinned in unit tests and are not re-checked here:
// `carrySelection` (repository-canvas-selection.test.ts) decides what a click
// means for `?sel=`, and `centerOn` (repository-canvas-viewport.test.ts) does
// the framing arithmetic against an independently computed answer. What no
// unit can see is the part that only exists in a browser:
//
//   1. the click reaches the anchor at all — a lane is a bowed curve, so a
//      bounding-box click lands on the `<svg>` behind it (see `pointOnLane`);
//   2. the pushed URL really carries `sel=`, and `--selected` really lands on
//      the drawn element once React has re-rendered it;
//   3. the camera actually *moves*, and stops with that element centred.
//
// Each case reports whether it was non-vacuous, because both have a way of
// passing while proving nothing: a selection that was already centred needs no
// fly, and a figure with no demoted lane has no jump to click. Those report as
// `caseExisted: false` rather than as a pass.

/** The canvas box the fly centres into — `rootRef` in `infinite-canvas.tsx`. */
const CANVAS_BOX = ".mj-canvas-viewport";
const SELECTED = ".mj-converge-lane--selected, .mj-converge-hub--selected";

/**
 * How far the selected element sits from the centre of the canvas box, in CSS
 * pixels. Measured off the rendered boxes, which is the only reading that can
 * contradict the arithmetic — recomputing `centerOn`'s answer here would just
 * be the implementation agreeing with itself.
 */
async function selectionOffset() {
  return page.evaluate(
    ([boxSel, selSel]) => {
      const root = document.querySelector(boxSel);
      const target = document.querySelector(selSel);
      const layer = document.querySelector(".mj-canvas-layer");
      // The camera's own state, sampled alongside the geometry. Carried because
      // "the element did not move" and "the camera did not move" are different
      // failures with the same reading, and separating them is what turned a
      // false alarm about the fly into a bug in this probe.
      const camera = layer ? getComputedStyle(layer).transform : null;
      if (!root || !target) return { root: root !== null, target: target !== null, camera };
      const box = root.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      return {
        root: true,
        target: true,
        camera,
        targets: document.querySelectorAll(selSel).length,
        dx: rect.left + rect.width / 2 - (box.left + box.width / 2),
        dy: rect.top + rect.height / 2 - (box.top + box.height / 2),
        boxWidth: box.width,
        boxHeight: box.height,
        targetClass: target.getAttribute("class"),
      };
    },
    [CANVAS_BOX, SELECTED],
  );
}

/**
 * Wait for the fly to stop, by watching the drawing rather than by sleeping for
 * exactly `FLY_SETTLE_MS + FLY_DURATION_MS`. A hard-coded sleep has to be
 * re-tuned every time those constants move.
 *
 * `minMs` is the part that is NOT optional, and the first version of this probe
 * got it wrong: the fly does nothing at all for `FLY_SETTLE_MS` (320ms — it is
 * waiting out the geometry morph before it measures), so a stability rule that
 * starts counting immediately declares "settled" inside that quiet window and
 * reports a fly that had not begun as a camera that never moved. It reads as a
 * product bug and is a probe bug. Stability alone is not evidence here; the
 * floor is `FLY_SETTLE_MS + FLY_DURATION_MS` plus slack, and the trace records
 * the samples so an early return stays visible rather than becoming a verdict.
 */
async function settle({ minMs = 1200, timeoutMs = 9000 } = {}) {
  const started = Date.now();
  const trace = [];
  let last = null;
  let stable = 0;
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    latest = await selectionOffset();
    const key = latest && latest.target ? `${Math.round(latest.dx)},${Math.round(latest.dy)}` : null;
    trace.push({ t: Date.now() - started, at: key, camera: latest?.camera });
    stable = key !== null && key === last ? stable + 1 : 0;
    last = key;
    if (stable >= 3 && Date.now() - started >= minMs) break;
    await page.waitForTimeout(120);
  }
  return { ...latest, trace, elapsed: Date.now() - started };
}

/**
 * Does this `?at=` value look like a viewport rather than a W15 lane address?
 *
 * Restated here rather than imported, deliberately: `isViewportValue` is the
 * thing under test, so importing it would let a broken predicate agree with
 * itself. One copy in this file, though — the in-page check below runs inside
 * `page.evaluate`, where this closure cannot reach, and is the only reason the
 * rule appears twice at all.
 */
const looksLikeViewport = (v) => {
  const parts = v.split(",");
  return parts.length === 3 && parts.every((p) => p.trim() !== "" && Number.isFinite(Number(p)));
};

/**
 * Mark the hit shape inside one anchor and return a point genuinely on it.
 *
 * Either hit shape: a lane's controls hang off `.mj-converge-strand-hit`, but a
 * collapse shell's hang off `.mj-converge-frame-hit`, and looking only for the
 * first would silently skip every frame-only anchor — reporting "no aim point"
 * for a control that is perfectly clickable.
 */
async function aimInsideAnchor(anchorSelector, nth = 0) {
  const marked = await page.evaluate(
    ([sel, index]) => {
      document.querySelectorAll("[data-aim]").forEach((el) => el.removeAttribute("data-aim"));
      const a = document.querySelectorAll(sel)[index];
      const hit = a?.querySelector(".mj-converge-strand-hit, .mj-converge-frame-hit");
      if (!hit) return null;
      hit.setAttribute("data-aim", "here");
      return a.getAttribute("href");
    },
    [anchorSelector, nth],
  );
  if (marked === null) return { href: null, point: null };
  return { href: marked, point: await pointOnLane('[data-aim="here"]') };
}

const W16 = {};

// **A fresh page, and this is load-bearing.** Both cases below measure a camera
// tween driven by `requestAnimationFrame`, and this tab's rAF is dead by now:
// after the cross-document link click above, headless Chromium stops servicing
// rAF on this tab entirely — measured at **0 ticks in 1500ms** while
// `document.visibilityState` still reads `"visible"`.
//
// That combination is the trap. The product code treats `visibilityState ===
// "hidden"` as its "nobody is watching" signal and lands the camera instantly
// there; a *visible* page with starved rAF matches neither branch, so the tween
// is scheduled and never advances. Read from outside, the URL updates, the
// `--selected` class lands, and the camera sits at identity — which is a
// pixel-perfect impression of a broken feature. It cost this probe several runs
// and one false "the Prezi move is broken on production" before the starved rAF
// was measured rather than assumed.
//
// So: a new page (rAF alive), and `rafTicks` recorded next to every verdict, so
// a future starved run reports "could not observe" instead of "does not work".
const stale = page;
page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await stale.close();

/** Is this tab actually being rendered? Bounded — a starved rAF must report. */
async function rafTicks() {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const step = () => {
          n += 1;
          if (performance.now() - t0 < 400) requestAnimationFrame(step);
          else resolve(n);
        };
        requestAnimationFrame(step);
        setTimeout(() => resolve(n), 1200);
      }),
  );
}

// --- Case 1: opening a lane selects it, and the camera flies to it ----------
await page.goto(`${BASE}/repository/layers?focus=nonlinear-ode-solve`, { waitUntil: "networkidle" });
const selectable = await aimInsideAnchor("svg.mj-converge-canvas a[href*='open=']");
// `caseExisted` is set on BOTH branches. An unset field reads as "not measured"
// exactly like a field nobody wrote, so a case that never ran has to say it did
// not run rather than simply be missing from the output.
W16.laneClick = { href: selectable.href, clickedAt: selectable.point, caseExisted: false };
if (selectable.point) {
  W16.laneClick.topmostAtAim = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("class") ?? null,
    selectable.point,
  );
  const alreadyOpen = new URL(page.url()).searchParams.getAll("open");
  const addedAddress = new URL(selectable.href, BASE).searchParams
    .getAll("open")
    .find((value) => !alreadyOpen.includes(value));
  W16.laneClick.addressTheAnchorOpens = addedAddress ?? null;

  await page.mouse.click(selectable.point.x, selectable.point.y);
  // Whether the wait completed is itself a result: a swallowed timeout and a
  // prompt push produce the same `sel` read a line later, and only one of them
  // means the interceptor worked.
  W16.laneClick.selArrived = await page
    .waitForFunction(() => window.location.search.includes("sel="), null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  const pushed = new URL(page.url());
  W16.laneClick.sel = pushed.searchParams.get("sel");
  // Rule 3 of `carrySelection`, seen from the outside: the value that entered
  // `?open=` is the value that became the selection.
  W16.laneClick.selIsTheOpenedAddress = W16.laneClick.sel === (addedAddress ?? null);

  // The class has to land on the drawing, not merely in the URL.
  const beforeFly = await selectionOffset();
  W16.laneClick.rafTicks = await rafTicks();
  W16.laneClick.selectedClassLanded = beforeFly?.target === true;
  W16.laneClick.selectedClass = beforeFly?.targetClass ?? null;
  // Was there anywhere to fly? If the element already sat within a pixel of the
  // centre, a still camera is correct and this case proves nothing about flying.
  const offBefore = beforeFly?.target ? Math.hypot(beforeFly.dx, beforeFly.dy) : null;
  const afterFly = await settle();
  const offAfter = afterFly?.target ? Math.hypot(afterFly.dx, afterFly.dy) : null;
  W16.laneClick.offsetBefore = offBefore;
  W16.laneClick.offsetAfter = offAfter;
  // Nothing below is evidence about the camera unless the tab was rendering.
  W16.laneClick.cameraObservable = W16.laneClick.rafTicks > 0;
  W16.laneClick.caseExisted = offBefore !== null && offBefore > 2;
  W16.laneClick.cameraMoved = offBefore !== null && offAfter !== null && Math.abs(offAfter - offBefore) > 2;
  W16.laneClick.centred = offAfter !== null && offAfter <= 2;
  W16.laneClick.flyTrace = afterFly.trace;
  // Read AFTER the fly: `?at=` is written back on a debounce, so a read taken
  // at click time reports the URL of a camera that has not moved yet.
  W16.laneClick.atAfter = new URL(page.url()).searchParams.get("at");
}

// --- Case 2: the W15 jump — `?at=<address>` becomes `?sel=`, host centred ---
//
// Only a *demoted* occurrence carries the jump, so the figure has to be opened
// far enough to produce one. Walking outward until a jump appears, rather than
// hard-coding an open set that happens to produce one today: which depth first
// demotes a shared interior is the layout's business, and a pinned set is the
// fixture drifting from the figure (the same reason the unit test walks).
const jumpUrl = new URL(`${BASE}/repository/layers`);
jumpUrl.searchParams.set("focus", "linear-ode-solve");
let rounds = 0;
let jumpHref = null;
const appended = new Set();
for (; rounds < 8; rounds++) {
  await page.goto(jumpUrl.toString(), { waitUntil: "networkidle" });
  // A jump anchor is one whose `at` is NOT a viewport — the demoted control
  // writes the host's lane address into that slot. The predicate is restated
  // here on purpose: `isViewportValue` is the thing under test, so importing it
  // would let a broken predicate agree with itself.
  jumpHref = await page.evaluate(() => {
    const isViewport = (v) => {
      const parts = v.split(",");
      return parts.length === 3 && parts.every((p) => p.trim() !== "" && Number.isFinite(Number(p)));
    };
    for (const a of document.querySelectorAll("svg.mj-converge-canvas a[href*='at=']")) {
      const at = new URL(a.getAttribute("href"), location.href).searchParams.get("at");
      if (at !== null && !isViewport(at)) return a.getAttribute("href");
    }
    return null;
  });
  if (jumpHref) break;
  const grew = await page.evaluate(() => {
    const open = new Set(new URLSearchParams(location.search).getAll("open"));
    const found = [];
    for (const a of document.querySelectorAll("svg.mj-converge-canvas a[href*='open=']")) {
      for (const value of new URL(a.getAttribute("href"), location.href).searchParams.getAll("open")) {
        if (!open.has(value)) found.push(value);
      }
    }
    return [...new Set(found)];
  });
  // Only values this walk has never appended. Filtering on what the *page*
  // reports as open is not enough: the server may drop an address (a depth cap
  // does exactly that), and it then comes back as "new" every round, so the open
  // set grows with duplicates and the walk can spend all 8 rounds re-adding one
  // rejected value instead of reaching a demotion.
  const fresh = grew.filter((value) => !appended.has(value));
  if (fresh.length === 0) break;
  for (const value of fresh) {
    appended.add(value);
    jumpUrl.searchParams.append("open", value);
  }
}
W16.jump = { walkRounds: rounds, openSetSize: jumpUrl.searchParams.getAll("open").length, href: jumpHref };
W16.jump.caseExisted = jumpHref !== null;

if (jumpHref) {
  const hostAddress = new URL(jumpHref, BASE).searchParams.get("at");
  W16.jump.hostAddressInAt = hostAddress;
  const index = await page.evaluate((href) => {
    const all = [...document.querySelectorAll("svg.mj-converge-canvas a[href*='at=']")];
    return all.findIndex((a) => a.getAttribute("href") === href);
  }, jumpHref);
  // `findIndex` answers -1 when nothing matched. Passing that on would index
  // with -1, come back `{point: null}`, and be indistinguishable from an anchor
  // that was found but carried no hit shape — two different failures.
  W16.jump.anchorIndex = index;
  const aimed =
    index < 0
      ? { href: null, point: null }
      : await aimInsideAnchor("svg.mj-converge-canvas a[href*='at=']", index);
  W16.jump.clickedAt = aimed.point;
  if (aimed.point) {
    W16.jump.topmostAtAim = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("class") ?? null,
      aimed.point,
    );
    await page.mouse.click(aimed.point.x, aimed.point.y);
    W16.jump.selArrived = await page
      .waitForFunction(() => window.location.search.includes("sel="), null, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    const after = new URL(page.url());
    W16.jump.selAfter = after.searchParams.get("sel");
    W16.jump.atAfter = after.searchParams.get("at");
    // The whole point of rule 1: the address moved out of `at` and into `sel`,
    // and whatever is left in `at` is a viewport again — before W16 this value
    // reached `parseViewport`, was rejected into IDENTITY, and the "jump"
    // shipped as a camera reset.
    W16.jump.addressMovedToSel = W16.jump.selAfter === hostAddress;
    W16.jump.atIsAViewportAgain = W16.jump.atAfter === null || looksLikeViewport(W16.jump.atAfter);

    const beforeFly = await selectionOffset();
    W16.jump.rafTicks = await rafTicks();
    W16.jump.cameraObservable = W16.jump.rafTicks > 0;
    W16.jump.selectedClassLanded = beforeFly?.target === true;
    const offBefore = beforeFly?.target ? Math.hypot(beforeFly.dx, beforeFly.dy) : null;
    const settled = await settle();
    const offAfter = settled?.target ? Math.hypot(settled.dx, settled.dy) : null;
    W16.jump.offsetBefore = offBefore;
    W16.jump.offsetAfter = offAfter;
    W16.jump.flyHadSomewhereToGo = offBefore !== null && offBefore > 2;
    W16.jump.cameraMoved = offBefore !== null && offAfter !== null && Math.abs(offAfter - offBefore) > 2;
    W16.jump.hostCentred = offAfter !== null && offAfter <= 2;
    W16.jump.flyTrace = settled.trace;
    W16.jump.atAfterFly = new URL(page.url()).searchParams.get("at");
  }

  // A control, the same one the open case gets: with JavaScript off the jump
  // anchor is a plain link and must still render a figure. It will NOT carry a
  // selection — the rewrite is the client interceptor's — and saying so here
  // keeps the no-JS contract honest instead of reading as a regression.
  const noJs2 = await browser.newContext({ javaScriptEnabled: false });
  const plain2 = await noJs2.newPage();
  await plain2.goto(`${BASE}${jumpHref}`, { waitUntil: "domcontentloaded" });
  W16.jump.withoutJavaScript = {
    lanes: await plain2.locator("svg.mj-converge-canvas .mj-converge-lane").count(),
    selected: await plain2.locator(".mj-converge-lane--selected").count(),
    note: "0 selected is correct: the rewrite is the client interceptor's, and ?at=<address> is not a viewport",
  };
  await noJs2.close();
  await page.bringToFront();
}

// And the SSR half, which is the reason `?sel=` is a URL parameter at all: a
// shared link highlights with JavaScript off.
const selShare = W16.laneClick.sel;
if (!selShare) {
  W16.sharedLinkWithoutJavaScript = { ran: false, why: "case 1 produced no selection to share" };
}
if (selShare) {
  const noJs3 = await browser.newContext({ javaScriptEnabled: false });
  const plain3 = await noJs3.newPage();
  await plain3.goto(
    `${BASE}/repository/layers?focus=nonlinear-ode-solve&sel=${encodeURIComponent(selShare)}`,
    { waitUntil: "domcontentloaded" },
  );
  W16.sharedLinkWithoutJavaScript = {
    ran: true,
    selected: await plain3.locator(SELECTED).count(),
    lanes: await plain3.locator("svg.mj-converge-canvas .mj-converge-lane").count(),
  };
  await noJs3.close();
}

out.w16Selection = W16;

// --- Case 3 (owner's zoom note, 2026-08-11): a card click lands on the -------
// drawing it was clicked on, not on the first drawing of the same node.
//
// "quantum linear solve zoomed into the process of the same name in a
// different place in the map." One node is drawn in several places since W15,
// and a card href used to carry only the node id — so the selection the
// interceptor derived fell to the FIRST drawing. The href now names its own
// occurrence in `?sel=`, and this case clicks a name on a SECOND drawing and
// asks where the camera went. It is only non-vacuous when such a second
// drawing exists AND its name is inside the viewport; both are reported.
//
// It also reads the presentation half back: with the card open, the canvas
// must carry the veil class, the selected element must keep full opacity
// while a sibling is dimmed, and the card surface must be translucent — the
// owner's "the item needs to show up through the card itself".
const CARD = {};
{
  // A tall viewport, for one reason: the second drawing of a node is usually
  // deep in a saturated figure, and a click can only land inside the window.
  // The fly centres into whatever box it has, so the geometry stays honest.
  const cardPage = await browser.newPage({ viewport: { width: 1400, height: 6000 } });

  const walkUrl = new URL(`${BASE}/repository/layers`);
  walkUrl.searchParams.set("focus", "linear-ode-solve");
  const walked = new Set();
  let pair = null;
  let walkRounds = 0;
  for (; walkRounds < 8; walkRounds++) {
    await cardPage.goto(walkUrl.toString(), { waitUntil: "networkidle" });
    pair = await cardPage.evaluate(() => {
      const byCard = new Map();
      for (const a of document.querySelectorAll("svg.mj-converge-canvas a[href*='card=']")) {
        const href = a.getAttribute("href");
        const u = new URL(href, location.href);
        const card = u.searchParams.get("card");
        const sel = u.searchParams.get("sel");
        if (!card || !sel) continue;
        const list = byCard.get(card) ?? [];
        if (!list.some((entry) => entry.sel === sel)) list.push({ sel, href });
        byCard.set(card, list);
      }
      for (const [card, list] of byCard) {
        if (list.length >= 2) return { card, first: list[0], second: list[1] };
      }
      return null;
    });
    if (pair) break;
    const grew = await cardPage.evaluate(() => {
      const open = new Set(new URLSearchParams(location.search).getAll("open"));
      const found = [];
      for (const a of document.querySelectorAll("svg.mj-converge-canvas a[href*='open=']")) {
        for (const value of new URL(a.getAttribute("href"), location.href).searchParams.getAll("open")) {
          if (!open.has(value)) found.push(value);
        }
      }
      return [...new Set(found)];
    });
    const fresh = grew.filter((value) => !walked.has(value));
    if (fresh.length === 0) break;
    for (const value of fresh) {
      walked.add(value);
      walkUrl.searchParams.append("open", value);
    }
  }

  CARD.walkRounds = walkRounds;
  CARD.pairFound = pair !== null;
  CARD.caseExisted = false;
  if (pair) {
    CARD.cardId = pair.card;
    CARD.firstDrawingSel = pair.first.sel;
    CARD.clickedDrawingSel = pair.second.sel;
    // The control that keeps this case able to fail: if the two drawings share
    // an address the click cannot distinguish them and the case proves nothing.
    CARD.drawingsDistinct = pair.first.sel !== pair.second.sel;

    const aim = await cardPage.evaluate((href) => {
      const a = [...document.querySelectorAll("svg.mj-converge-canvas a[href*='card=']")].find(
        (x) => x.getAttribute("href") === href,
      );
      const hit = a?.querySelector(".mj-converge-hit");
      if (!hit) return null;
      const r = hit.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, pair.second.href);
    CARD.clickedAt = aim;
    CARD.inViewport = aim !== null && aim.x >= 0 && aim.x <= 1400 && aim.y >= 0 && aim.y <= 6000;

    if (CARD.inViewport && CARD.drawingsDistinct) {
      await cardPage.mouse.click(aim.x, aim.y);
      CARD.selArrived = await cardPage
        .waitForFunction(() => window.location.search.includes("sel="), null, { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      const after = new URL(cardPage.url());
      CARD.selAfter = after.searchParams.get("sel");
      CARD.cardAfter = after.searchParams.get("card");
      // The verdict the owner's note is about: the selection is the clicked
      // occurrence — not the node id, and not the first drawing of it.
      CARD.landedOnClickedNotFirst =
        CARD.selAfter === pair.second.sel && CARD.selAfter !== pair.first.sel;

      const measure = async () =>
        cardPage.evaluate(
          ([boxSel, selSel]) => {
            const root = document.querySelector(boxSel);
            const target = document.querySelector(selSel);
            if (!root || !target) return { root: root !== null, target: target !== null };
            const box = root.getBoundingClientRect();
            const rect = target.getBoundingClientRect();
            return {
              root: true,
              target: true,
              dx: rect.left + rect.width / 2 - (box.left + box.width / 2),
              dy: rect.top + rect.height / 2 - (box.top + box.height / 2),
            };
          },
          [CANVAS_BOX, SELECTED],
        );
      const beforeFly = await measure();
      CARD.selectedClassLanded = beforeFly?.target === true;
      CARD.rafTicks = await cardPage.evaluate(
        () =>
          new Promise((resolve) => {
            let n = 0;
            const t0 = performance.now();
            const step = () => {
              n += 1;
              if (performance.now() - t0 < 400) requestAnimationFrame(step);
              else resolve(n);
            };
            requestAnimationFrame(step);
            setTimeout(() => resolve(n), 1200);
          }),
      );
      CARD.cameraObservable = CARD.rafTicks > 0;
      const offBefore = beforeFly?.target ? Math.hypot(beforeFly.dx, beforeFly.dy) : null;
      // The same settle discipline as the W16 cases: the fly waits out the
      // geometry morph before it measures, so stability alone is not evidence.
      const started = Date.now();
      let last = null;
      let stable = 0;
      let latest = null;
      while (Date.now() - started < 9000) {
        latest = await measure();
        const key = latest && latest.target ? `${Math.round(latest.dx)},${Math.round(latest.dy)}` : null;
        stable = key !== null && key === last ? stable + 1 : 0;
        last = key;
        if (stable >= 3 && Date.now() - started >= 1200) break;
        await cardPage.waitForTimeout(120);
      }
      const offAfter = latest?.target ? Math.hypot(latest.dx, latest.dy) : null;
      CARD.offsetBefore = offBefore;
      CARD.offsetAfter = offAfter;
      CARD.caseExisted = offBefore !== null && offBefore > 2;
      CARD.clickedOccurrenceCentred = offAfter !== null && offAfter <= 2;

      // The presentation half, read off the rendered page rather than the
      // stylesheet: veil on the canvas, full ink on the selected element, a
      // dimmed sibling, and a see-through card surface.
      CARD.presentation = await cardPage.evaluate(() => {
        const card = document.querySelector(".mj-card");
        const bg = card ? getComputedStyle(card).backgroundColor : null;
        const alpha = bg?.match(/\/\s*([\d.]+)\)/) ?? bg?.match(/rgba\([^)]+,\s*([\d.]+)\)/);
        const selected = document.querySelector(
          ".mj-converge-lane--selected, .mj-converge-hub--selected",
        );
        const dimmed = document.querySelector(
          ".mj-converge-canvas--veiled .mj-converge-lane:not(.mj-converge-lane--selected)",
        );
        return {
          veiledCanvases: document.querySelectorAll(".mj-converge-canvas--veiled").length,
          cardBackground: bg,
          cardAlpha: alpha ? Number(alpha[1]) : null,
          selectedOpacity: selected ? getComputedStyle(selected).opacity : null,
          dimmedSiblingOpacity: dimmed ? getComputedStyle(dimmed).opacity : null,
        };
      });
    }
  }
  await cardPage.close();
}
out.cardClickOccurrence = CARD;

// ---------------------------------------------------------------------------
// W20, the paper surface: one click on a paper opens its pipeline on the map
// ---------------------------------------------------------------------------
//
// The plan doc names this case (W20-paper-surface.md §Verification): from the
// paper page, "see it on the map" is ONE navigation; the branches of the
// paper's pathway are open in that single document with no `open=` values in
// the URL (the reveal IS the open set, computed server-side); the cited
// occurrences carry `--paper-cited`; the paper panel sits over the figure;
// and the camera frames the entry node. What only a browser can see:
//
//   1. the link is a plain cross-document navigation — no interceptor — so
//      "one navigation" is a claim about the LANDING, not a client trick;
//   2. the landed URL carries `paper=` and ZERO `open=` params while the
//      figure draws MORE lanes than the same subject drawn bare: that pair is
//      the observable form of "the reveal opened branches server-side";
//   3. JS off serves the same panel, highlight and selection (SSR honesty);
//   4. the camera fly on arrival is the W16 machinery fed by the reveal's
//      `sel` — measured on a FRESH page with `rafTicks` beside the verdict,
//      because this case sits exactly on the visible-but-starved trap: it
//      begins with the kind of cross-document click that killed rAF above.
//
// Discovery walks the papers index by cited-by count (each row prints its
// number) rather than pinning a slug: which paper opens branches is the
// corpus's business, and a pinned slug is a fixture drifting from the
// register. A walk that found only branchless landings says so.

const PAPER = {};
{
  const paperPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await paperPage.goto(`${BASE}/repository/papers`, { waitUntil: "networkidle" });
  const candidates = await paperPage.evaluate(() => {
    const rows = [...document.querySelectorAll(".mj-papers-list > li")];
    return rows
      .map((li) => {
        const a = li.querySelector("a.mj-papers-list-title");
        const count = li.querySelector(".mj-layers-count")?.textContent ?? "";
        const digits = count.match(/\d+/);
        return a ? { href: a.getAttribute("href"), citedBy: digits ? Number(digits[0]) : 0 } : null;
      })
      .filter(Boolean)
      .sort((x, y) => y.citedBy - x.citedBy)
      .map((entry) => entry.href);
  });
  PAPER.indexRows = candidates.length;

  /**
   * Per-canvas readings, scoped: the layers page draws MANY figures, so every
   * count is taken inside ONE `svg.mj-converge-canvas`. The subject a canvas
   * draws is read off its own `open=` anchors (every open value is prefixed
   * with the figure's subject id) — the DOM's answer, deliberately not an
   * import from `paper-reveal.ts`, which is the thing under test.
   */
  const canvasStats = (p) =>
    p.evaluate(() =>
      [...document.querySelectorAll("svg.mj-converge-canvas")].map((svg) => {
        const anchor = svg.querySelector("a[href*='open=']");
        const value = anchor
          ? new URL(anchor.getAttribute("href"), location.href).searchParams.getAll("open").at(-1)
          : null;
        return {
          subject: value ? value.split(":")[0] : null,
          lanes: svg.querySelectorAll(".mj-converge-lane").length,
          cited: svg.querySelectorAll(".mj-converge-lane--paper-cited")
            .length,
          selected: svg.querySelectorAll(
            ".mj-converge-lane--selected, .mj-converge-hub--selected",
          ).length,
        };
      }),
    );

  // The walk: first paper whose page carries the link AND whose landing
  // opened branches. Bounded, and the bound reports. A branchless landing is
  // kept as a fallback so the panel/camera/SSR verdicts still run on a real
  // landing even if no walked paper opens a branch.
  let chosen = null;
  let visited = 0;
  for (const href of candidates.slice(0, 12)) {
    visited += 1;
    await paperPage.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    const seeMap = await paperPage.evaluate(() => {
      const a = document.querySelector(".mj-papers-see-map a");
      return a
        ? {
            href: a.getAttribute("href"),
            shape: document.querySelector(".mj-papers-shape")?.getAttribute("data-shape") ?? null,
          }
        : null;
    });
    if (!seeMap) continue;

    // The click itself: tag the document, click, and expect it REPLACED —
    // this link deliberately keeps the cross-document navigation.
    await paperPage.evaluate(() => {
      window.__stayed = true;
    });
    await paperPage.locator(".mj-papers-see-map a").click();
    await paperPage.waitForLoadState("networkidle");

    const url = new URL(paperPage.url());
    const canvases = await canvasStats(paperPage);
    const paperCanvas = canvases.find((c) => c.cited > 0) ?? null;
    const landing = {
      fromPaperPage: href,
      traceShape: seeMap.shape,
      url: paperPage.url(),
      documentReplaced: await paperPage.evaluate(() => window.__stayed !== true),
      paperParam: url.searchParams.get("paper"),
      openParamsInUrl: url.searchParams.getAll("open").length,
      panel: await paperPage.evaluate(() => {
        const panel = document.querySelector(".mj-paper-panel");
        return panel
          ? {
              present: true,
              title: panel.querySelector(".mj-paper-panel-title")?.textContent?.trim() || null,
              count: panel.querySelector(".mj-paper-panel-count")?.textContent?.trim() || null,
            }
          : { present: false };
      }),
      figure: paperCanvas,
      figuresDrawn: canvases.length,
    };

    // The bare control for "the reveal opened branches": the same subject
    // focused with NO paper. Strictly more lanes under the reveal is the
    // observable meaning of "`?paper=` landed an open set" — and the bare
    // figure carrying ZERO `--paper-cited` marks is what keeps the mark a
    // statement about the paper rather than a decoration the figure always
    // wears.
    if (paperCanvas?.subject) {
      await paperPage.goto(
        `${BASE}/repository/layers?focus=${encodeURIComponent(paperCanvas.subject)}`,
        { waitUntil: "networkidle" },
      );
      const bare = (await canvasStats(paperPage)).find((c) => c.subject === paperCanvas.subject) ?? null;
      landing.bareLanes = bare?.lanes ?? null;
      landing.bareCited = bare?.cited ?? null;
      landing.branchesOpened = bare !== null && paperCanvas.lanes > bare.lanes;
    } else {
      landing.bareLanes = null;
      landing.bareCited = null;
      landing.branchesOpened = false;
    }

    if (chosen === null || (!chosen.branchesOpened && landing.branchesOpened)) chosen = landing;
    if (landing.branchesOpened) break;
  }
  PAPER.paperPagesVisited = visited;
  PAPER.landing = chosen;
  PAPER.caseExisted = chosen !== null;
  PAPER.branchCaseExisted = chosen?.branchesOpened === true;
  await paperPage.close();

  if (chosen) {
    const landingUrl = chosen.url;

    // Camera: a FRESH page (rAF alive), direct goto of the landing URL. The
    // reveal's `sel` arrives as SSR state, so the fly is the mount effect —
    // there is no click to time against, only the settle discipline.
    const camPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await camPage.goto(landingUrl, { waitUntil: "networkidle" });
    const cam = {};
    cam.rafTicks = await camPage.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0;
          const t0 = performance.now();
          const step = () => {
            n += 1;
            if (performance.now() - t0 < 400) requestAnimationFrame(step);
            else resolve(n);
          };
          requestAnimationFrame(step);
          setTimeout(() => resolve(n), 1200);
        }),
    );
    cam.cameraObservable = cam.rafTicks > 0;
    const measure = () =>
      camPage.evaluate(() => {
        const root = document.querySelector(".mj-canvas-viewport");
        const target = document.querySelector(
          ".mj-converge-lane--selected, .mj-converge-hub--selected",
        );
        if (!root || !target) return { root: root !== null, target: target !== null };
        const box = root.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        return {
          root: true,
          target: true,
          dx: rect.left + rect.width / 2 - (box.left + box.width / 2),
          dy: rect.top + rect.height / 2 - (box.top + box.height / 2),
        };
      });
    const first = await measure();
    cam.selectedClassLanded = first?.target === true;
    const started = Date.now();
    let last = null;
    let stable = 0;
    let latest = null;
    while (Date.now() - started < 9000) {
      latest = await measure();
      const key = latest && latest.target ? `${Math.round(latest.dx)},${Math.round(latest.dy)}` : null;
      stable = key !== null && key === last ? stable + 1 : 0;
      last = key;
      if (stable >= 3 && Date.now() - started >= 1200) break;
      await camPage.waitForTimeout(120);
    }
    cam.offsetAtLoad = first?.target ? Math.hypot(first.dx, first.dy) : null;
    cam.offsetSettled = latest?.target ? Math.hypot(latest.dx, latest.dy) : null;
    // Framed-at-load counts: the claim under test is the FRAME, not the
    // journey — an SSR camera that lands already centred passes honestly.
    cam.entryFramed = cam.offsetSettled !== null && cam.offsetSettled <= 2;
    PAPER.camera = cam;
    await camPage.close();

    // SSR honesty: JS off serves panel + highlight + selection + open figure.
    const noJsPaper = await browser.newContext({ javaScriptEnabled: false });
    const plainPaper = await noJsPaper.newPage();
    await plainPaper.goto(landingUrl, { waitUntil: "domcontentloaded" });
    PAPER.withoutJavaScript = await plainPaper.evaluate(() => {
      const panel = document.querySelector(".mj-paper-panel");
      return {
        panel: panel !== null,
        panelTitle: panel?.querySelector(".mj-paper-panel-title")?.textContent?.trim() || null,
        cited: document.querySelectorAll(
          ".mj-converge-lane--paper-cited",
        ).length,
        selected: document.querySelectorAll(
          ".mj-converge-lane--selected, .mj-converge-hub--selected",
        ).length,
        lanes: document.querySelectorAll("svg.mj-converge-canvas .mj-converge-lane").length,
      };
    });
    await noJsPaper.close();

    // Junk slug: the figure survives, the panel says unknown (no title — the
    // honest note, not silence), and nothing wears the mark.
    const junkPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await junkPage.goto(`${BASE}/repository/layers?paper=zzz-not-a-registered-paper`, {
      waitUntil: "networkidle",
    });
    PAPER.junkSlug = await junkPage.evaluate(() => {
      const panel = document.querySelector(".mj-paper-panel");
      return {
        panel: panel !== null,
        titleAbsent: panel ? panel.querySelector(".mj-paper-panel-title") === null : null,
        note: panel?.querySelector(".mj-paper-panel-count")?.textContent?.trim() || null,
        cited: document.querySelectorAll(
          ".mj-converge-lane--paper-cited",
        ).length,
        lanes: document.querySelectorAll("svg.mj-converge-canvas .mj-converge-lane").length,
      };
    });
    await junkPage.close();

    // The mode must not fight the reader (D-W20.2): from the landing, a
    // lane's own open-toggle must add its branch AND keep the paper. The
    // figure's hrefs cannot name the paper (`figureHref` builds them without
    // one) — the carry is `carryPaper`'s rule 2 in the CLICK interceptor, so
    // this case must CLICK, not follow the href; a first version of it
    // followed the href, read the documented no-JS degradation, and reported
    // the design as a defect. The href-as-written is measured too, below, as
    // exactly what the contract says it is. A tall window, for the CARD
    // case's reason: the toggle may sit deep in the revealed figure, and a
    // click can only land inside the window.
    const readerPage = await browser.newPage({ viewport: { width: 1400, height: 6000 } });
    await readerPage.goto(landingUrl, { waitUntil: "networkidle" });
    await readerPage.evaluate(() => {
      window.__stayed = true;
    });
    // ANY in-window toggle in the cited figure, not the first in DOM order:
    // the arrival camera centres the entry node, and the first version of
    // this case aimed at the DOM's first anchor, got x = -207, and went
    // vacuous. Which toggle carries the reader deeper is not this case's
    // business — that the surface survives the toggle is.
    const toggle = await readerPage.evaluate(() => {
      const within = (p) =>
        p.x >= 0 && p.x <= window.innerWidth && p.y >= 0 && p.y <= window.innerHeight;
      for (const svg of document.querySelectorAll("svg.mj-converge-canvas")) {
        if (!svg.querySelector(".mj-converge-lane--paper-cited"))
          continue;
        let sawAnchor = false;
        for (const a of svg.querySelectorAll("a[href*='open=']")) {
          const hit = a.querySelector(".mj-converge-strand-hit, .mj-converge-frame-hit");
          if (!hit) continue;
          sawAnchor = true;
          const local = hit.getPointAtLength(hit.getTotalLength() / 2);
          const ctm = hit.getScreenCTM();
          if (!ctm) continue;
          const p = new DOMPoint(local.x, local.y).matrixTransform(ctm);
          if (within(p)) return { href: a.getAttribute("href"), x: p.x, y: p.y, offscreenOnly: false };
        }
        // The cited figure had toggles but the camera framed all of them out —
        // report that shape rather than wandering into another figure.
        return sawAnchor ? { href: null, x: null, y: null, offscreenOnly: true } : null;
      }
      return null;
    });
    PAPER.readerToggle = {
      href: toggle?.href ?? null,
      offscreenOnly: toggle?.offscreenOnly ?? null,
      caseExisted: toggle?.href != null,
    };
    if (toggle?.href) {
      // Expected FALSE, and that is the design, not the defect: the carry is
      // the interceptor's. If this ever turns true the hrefs learned to name
      // the paper and the degradation contract below has changed shape.
      PAPER.readerToggle.hrefCarriesPaperItself = new URL(toggle.href, BASE).searchParams.has(
        "paper",
      );
      const aim = { x: toggle.x, y: toggle.y };
      PAPER.readerToggle.clickedAt = aim;
      PAPER.readerToggle.topmostAtAim = await readerPage.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("class") ?? null,
        aim,
      );
      {
        await readerPage.mouse.click(aim.x, aim.y);
        PAPER.readerToggle.openArrived = await readerPage
          .waitForFunction(() => window.location.search.includes("open="), null, { timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        const after = new URL(readerPage.url());
        PAPER.readerToggle.after = {
          stayed: await readerPage.evaluate(() => window.__stayed === true),
          paperKept: after.searchParams.get("paper") === chosen.paperParam,
          openParamsInUrl: after.searchParams.getAll("open").length,
          panel: await readerPage.evaluate(() => document.querySelector(".mj-paper-panel") !== null),
          cited: await readerPage.evaluate(
            () =>
              document.querySelectorAll(
                ".mj-converge-lane--paper-cited",
              ).length,
          ),
        };
        PAPER.readerToggle.surfaceSurvivedTheClick =
          PAPER.readerToggle.after.stayed &&
          PAPER.readerToggle.after.paperKept &&
          PAPER.readerToggle.after.openParamsInUrl > 0 &&
          PAPER.readerToggle.after.panel &&
          PAPER.readerToggle.after.cited > 0;
      }

      // The href as written, in the contract's own words: "a full navigation
      // lands on the href as written — opens persist … the highlight and
      // panel end." A panel that survived here would mean the contract's
      // words no longer describe the code.
      await readerPage.goto(`${BASE}${toggle.href}`, { waitUntil: "networkidle" });
      PAPER.readerToggle.noJsDegradation = await readerPage.evaluate(() => ({
        opensPersist: new URLSearchParams(location.search).getAll("open").length > 0,
        panelEnds: document.querySelector(".mj-paper-panel") === null,
        citedEnds:
          document.querySelectorAll(
            ".mj-converge-lane--paper-cited",
          ).length === 0,
      }));
    }
    await readerPage.close();
  }
}
out.paperSurface = PAPER;

console.log(JSON.stringify(out, null, 2));
await browser.close();
