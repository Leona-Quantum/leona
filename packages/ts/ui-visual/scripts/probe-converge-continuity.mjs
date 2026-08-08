// Does opening a line actually *move* the drawing rather than replace the page?
//
// Three things have to be true at once and none can be read off the source:
//   1. the click is intercepted, so the document is never replaced;
//   2. React keeps the lane elements, so their `d` changes on the same nodes;
//   3. the CSS transitions therefore fire.
//
// Playwright rather than the agent browser pane, for the same reason as the SVG
// view-transition probe: an agent tab is hidden, and a hidden document behaves
// differently enough that "did not run" and "does not work" look identical.
//
// Serve first:  NEXT_DIST_DIR=.next-prod-agent pnpm --filter @majorana/web start --port 3457
// Then:         node scripts/probe-converge-continuity.mjs [url]
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://127.0.0.1:3457";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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

console.log(JSON.stringify(out, null, 2));
await browser.close();
