// Does opening a line actually *move* the drawing rather than replace the page?
//
// Three things have to be true at once and none can be read off the source:
//   1. the click is intercepted, so the document is never replaced;
//   2. React keeps the lane elements, so their `d` changes on the same nodes;
//   3. the CSS transitions therefore fire.
//
// Since W16 it also asks whether the click *selects*, and whether the camera
// flies to what it selected — see the section at the foot of this file.
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
const SELECTED = ".mj-converge-lane--selected, .mj-converge-feed--selected, .mj-converge-hub--selected";

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

/** Mark the hit stroke inside one anchor and return a point genuinely on it. */
async function aimInsideAnchor(anchorSelector, nth = 0) {
  const marked = await page.evaluate(
    ([sel, index]) => {
      document.querySelectorAll("[data-aim]").forEach((el) => el.removeAttribute("data-aim"));
      const a = document.querySelectorAll(sel)[index];
      const hit = a?.querySelector(".mj-converge-strand-hit");
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
W16.laneClick = { href: selectable.href, clickedAt: selectable.point };
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
  await page
    .waitForFunction(() => window.location.search.includes("sel="), null, { timeout: 5000 })
    .catch(() => {});

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
  if (grew.length === 0) break;
  for (const value of grew) jumpUrl.searchParams.append("open", value);
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
  const aimed = await aimInsideAnchor("svg.mj-converge-canvas a[href*='at=']", index);
  W16.jump.clickedAt = aimed.point;
  if (aimed.point) {
    W16.jump.topmostAtAim = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("class") ?? null,
      aimed.point,
    );
    await page.mouse.click(aimed.point.x, aimed.point.y);
    await page
      .waitForFunction(() => window.location.search.includes("sel="), null, { timeout: 5000 })
      .catch(() => {});
    const after = new URL(page.url());
    W16.jump.selAfter = after.searchParams.get("sel");
    W16.jump.atAfter = after.searchParams.get("at");
    // The whole point of rule 1: the address moved out of `at` and into `sel`,
    // and whatever is left in `at` is a viewport again — before W16 this value
    // reached `parseViewport`, was rejected into IDENTITY, and the "jump"
    // shipped as a camera reset.
    W16.jump.addressMovedToSel = W16.jump.selAfter === hostAddress;
    W16.jump.atIsAViewportAgain =
      W16.jump.atAfter === null ||
      (W16.jump.atAfter.split(",").length === 3 &&
        W16.jump.atAfter.split(",").every((p) => p.trim() !== "" && Number.isFinite(Number(p))));

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
if (selShare) {
  const noJs3 = await browser.newContext({ javaScriptEnabled: false });
  const plain3 = await noJs3.newPage();
  await plain3.goto(
    `${BASE}/repository/layers?focus=nonlinear-ode-solve&sel=${encodeURIComponent(selShare)}`,
    { waitUntil: "domcontentloaded" },
  );
  W16.sharedLinkWithoutJavaScript = {
    selected: await plain3.locator(SELECTED).count(),
    lanes: await plain3.locator("svg.mj-converge-canvas .mj-converge-lane").count(),
  };
  await noJs3.close();
}

out.w16Selection = W16;

console.log(JSON.stringify(out, null, 2));
await browser.close();
