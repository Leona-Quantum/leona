#!/usr/bin/env node
// The read-back for #426 (owner inbox `e6585b`: "do not zoom in when clicking to
// expand/contract. just recenter."), run in a real browser against a real
// deployment.
//
// ## Why this exists as a script rather than an assertion in `readback-probe.mjs`
//
// #426 changes CAMERA behaviour. No SSR byte moves — the served HTML is
// identical before and after — so a bytes-and-content probe has nothing to
// assert, and `readback-probe.mjs`'s own header says bytes are necessary and
// not sufficient. S1 declined to invent one rather than fake a verdict, which
// was the right call; this is the arm that was owed instead.
//
// ## What it measures, and why a click and not a navigation
//
// The recenter path only exists when the component STAYS MOUNTED: `selKey`
// unchanged, `layoutKey` changed. A full page load is a first mount, where
// `selKey` goes null → something and the W16 fly correctly FRAMES — arriving on
// a `?sel=` link is choosing a subject. So the probe clicks the open control the
// way a reader does and lets Next's client navigation keep the component alive.
// A probe that navigated instead would measure the mount path and report the
// wrong feature green.
//
// ## The control, because "the zoom did not change" is also what a broken
// measurement says
//
// Between the two toggles the probe zooms the camera itself with a ctrl-wheel
// gesture and asserts the reading MOVED. Without that, a probe reading a
// constant — a stale style, a transform it cannot parse, a page that never
// hydrated — passes exactly like a working one.
//
// ## rAF liveness, recorded beside the verdict
//
// This canvas's camera is a `requestAnimationFrame` tween, and a tab can report
// `visibilityState: "visible"` while being served zero rAF callbacks (measured
// on this project, in an agent browser pane). A camera probe in a starved tab
// fails for a reason that has nothing to do with the code under test, so the
// frame count is printed with the result and a starved run is reported as
// INCONCLUSIVE rather than as a failure.
//
// Usage: node scripts/probe-camera-recenter.mjs [--origin https://leonaqt.com]
//        [--figure nonlinear-ode-solve] [--sel 1.0]

import { chromium } from "@playwright/test";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const ORIGIN = arg("origin", "https://leonaqt.com");
const FIGURE = arg("figure", "nonlinear-ode-solve");
const SEL = arg("sel", "1.0");
const SETTLE_MS = 1400;

/** The live camera scale, read from the one element every transform goes through. */
const readScale = async (page) =>
  page.evaluate(() => {
    const layer = document.querySelector(".mj-canvas-layer");
    if (!layer) return null;
    const t = layer.style.transform || getComputedStyle(layer).transform;
    const m = /scale\(([-\d.eE+]+)\)/u.exec(t);
    if (m) return Number(m[1]);
    // A computed matrix, if the browser normalised the inline string.
    const mm = /matrix\(([-\d.eE+]+)/u.exec(t);
    return mm ? Number(mm[1]) : null;
  });

const rafFrames = async (page, ms) =>
  page.evaluate(
    (window_ms) =>
      new Promise((resolve) => {
        let n = 0;
        const stop = performance.now() + window_ms;
        const tick = () => {
          n += 1;
          if (performance.now() < stop) requestAnimationFrame(tick);
          else resolve(n);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );


/**
 * A viewport point genuinely ON a lane's hit stroke — lifted from
 * `probe-converge-continuity.mjs`, which paid for this lesson first.
 *
 * A lane is a bowed curve, so its bounding-box centre is usually empty space:
 * `.click()` aims there, the `<svg>` behind takes the event, and Playwright
 * reports "intercepts pointer events" — which reads exactly like a broken
 * control and is nothing of the kind. `getPointAtLength` puts the aim on the
 * painted stroke instead, and `elementFromPoint` confirms the anchor is topmost
 * BEFORE the click is spent, because a synthetic click that misses is
 * indistinguishable from a feature that does not work.
 */
const clickOpenControl = async (page, say) => {
  const marked = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll("svg.mj-converge-canvas a[href*='open=']")];
    for (const a of anchors) {
      const hit = a.querySelector(".mj-converge-strand-hit") ?? a.querySelector("path");
      if (!hit) continue;
      hit.setAttribute("data-aim", "here");
      return a.getAttribute("href");
    }
    return null;
  });
  if (marked === null) return { ok: false, why: "no open control with a hit path" };
  const aim = await page.evaluate(() => {
    const path = document.querySelector('[data-aim="here"]');
    if (!path || typeof path.getPointAtLength !== "function") return null;
    const local = path.getPointAtLength(path.getTotalLength() / 2);
    const ctm = path.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(local.x, local.y).matrixTransform(ctm);
    return { x: p.x, y: p.y };
  });
  if (!aim) return { ok: false, why: "no point found on the open control's hit stroke" };
  const box = page.viewportSize();
  if (aim.x < 0 || aim.y < 0 || aim.x > box.width || aim.y > box.height) {
    return { ok: false, why: `the open control is off-screen at ${Math.round(aim.x)},${Math.round(aim.y)}` };
  }
  const topmost = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("class") ?? null, aim);
  say(`[camera] aiming at ${Math.round(aim.x)},${Math.round(aim.y)} — topmost there is "${topmost}" (href ${marked})`);
  await page.mouse.click(aim.x, aim.y);
  return { ok: true, topmost };
};

const main = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const fails = [];
  const say = (line) => console.log(line);

  const url = `${ORIGIN}/repository/layers?focus=${FIGURE}&sel=${encodeURIComponent(SEL)}&cb=${process.pid}`;
  say(`[camera] ${url}`);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(SETTLE_MS);

  const frames = await rafFrames(page, 500);
  say(`[camera] rAF liveness: ${frames} frames in 500ms (visibilityState=${await page.evaluate(() => document.visibilityState)})`);
  if (frames < 5) {
    say("[camera] INCONCLUSIVE — the tab is not being served frames; the camera cannot be measured here.");
    await browser.close();
    process.exit(2);
  }

  const selected = await page.locator("[data-selected='true'], .mj-converge-lane--selected").count();
  say(`[camera] elements marked selected: ${selected}`);

  // --- the toggle, clicked the way a reader clicks it -----------------------
  //
  // **A VISIBLE one.** After the arrival fly the camera is framing one lane, so
  // most open controls are off-screen, and `.first()` picked one of those: the
  // click timed out against an element that exists in the DOM and not on the
  // screen. A reader clicks what they can see, and so does this.
  const z0 = await readScale(page);
  say(`[camera] scale before the toggle: ${z0}`);
  if (z0 === null) {
    say("[camera] FAIL — no camera transform found; the probe cannot see what it is measuring.");
    await browser.close();
    process.exit(1);
  }
  const first = await clickOpenControl(page, say);
  if (!first.ok) {
    say(`[camera] INCONCLUSIVE — ${first.why}; nothing was toggled.`);
    await browser.close();
    process.exit(2);
  }
  await page.waitForTimeout(SETTLE_MS);
  const z1 = await readScale(page);
  const openedInUrl = /[?&]open=/u.test(page.url());
  say(`[camera] after clicking an open control: scale ${z1}, url carries open= ${openedInUrl}`);
  if (!openedInUrl) fails.push("the click did not open anything — nothing was exercised");
  if (z1 !== null && Math.abs(z1 / z0 - 1) > 0.01) {
    fails.push(`expanding changed the zoom ${z0} → ${z1} (the defect e6585b names)`);
  }

  // --- the control: the instrument must be able to see a change ------------
  await page.mouse.move(720, 450);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(600);
  const z2 = await readScale(page);
  say(`[camera] after a ctrl-wheel zoom by the reader: scale ${z2}`);
  if (z2 === null || Math.abs(z2 / z1 - 1) < 0.01) {
    fails.push(`the reading did not move when the camera was zoomed (${z1} → ${z2}) — this probe cannot detect a zoom change, so its other verdicts are worthless`);
  }

  // --- and again at the zoom the reader chose, which is the owner's case ----
  const second = await clickOpenControl(page, say);
  if (!second.ok) {
    fails.push(`no second toggle was possible: ${second.why}`);
  } else {
    await page.waitForTimeout(SETTLE_MS);
    const z3 = await readScale(page);
    say(`[camera] after a second toggle, at the reader's own zoom: scale ${z3}`);
    if (z3 !== null && Math.abs(z3 / z2 - 1) > 0.01) {
      fails.push(`a toggle at the reader's own zoom changed it ${z2} → ${z3}`);
    }
  }

  await browser.close();
  if (fails.length > 0) {
    say(`\n[camera] FAIL (${fails.length}):`);
    for (const f of fails) say(`  · ${f}`);
    process.exit(1);
  }
  say("\n[camera] PASS — expanding recentered without changing the reader's zoom, and the probe demonstrated it can see a zoom change.");
};

await main();
