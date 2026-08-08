// Scratch probe (session 102): what can actually animate inside the converge canvas?
//
// The persistent-canvas design turns on two questions the agent browser cannot
// answer (a hidden document skips every view transition, which reads exactly
// like a broken feature — so this runs under Playwright, which gets a visible one):
//
//   1. Is `view-transition-name` on an SVG *child* ever captured? The canvas
//      already sets it on `<text>` inside `<svg>`, and a name that is never
//      captured is silent: the page still navigates, it just cuts.
//   2. Do CSS transitions fire on SVG geometry (`d`, `cx`, `cy`, `r`) when the
//      value arrives as a presentation **attribute**, which is how React writes it?
//
// Run from inside this package: `node scripts/probe-svg-view-transition.mjs`
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();

// ---------------------------------------------------------------------------
// 1. view-transition-name capture, child elements vs the root <svg> vs HTML
// ---------------------------------------------------------------------------
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  ::view-transition-group(*) { animation-duration: 2000ms; }
</style>
<svg id="fig" width="600" height="200" viewBox="0 0 600 200" style="view-transition-name: mj-fig-1">
  <path id="lane" d="M20,100 C200,100 400,100 580,100" stroke="black" fill="none" stroke-width="3"
        style="view-transition-name: mj-lane-1"/>
  <text id="name" x="300" y="80" text-anchor="middle" style="view-transition-name: mj-name-1">a lane name</text>
  <circle id="hub" cx="20" cy="100" r="8" style="view-transition-name: mj-hub-1"/>
  <g id="grp" style="view-transition-name: mj-grp-1"><rect x="10" y="150" width="40" height="20"/></g>
</svg>
<div id="html-control" style="width:100px;height:20px;background:#39c;view-transition-name: mj-html-1"></div>`);

const capture = await page.evaluate(async () => {
  const out = { visibility: document.visibilityState, computed: {}, captured: {}, pseudos: [] };
  for (const id of ["fig", "lane", "name", "hub", "grp", "html-control"]) {
    out.computed[id] = getComputedStyle(document.getElementById(id)).viewTransitionName;
  }
  const t = document.startViewTransition(() => {
    document.getElementById("fig").setAttribute("width", "800");
    document.getElementById("lane").setAttribute("d", "M20,40 C200,180 400,20 580,160");
    document.getElementById("name").setAttribute("y", "160");
    document.getElementById("hub").setAttribute("cx", "560");
    document.getElementById("grp").setAttribute("transform", "translate(400,0)");
    document.getElementById("html-control").style.width = "300px";
  });
  try {
    await t.ready;
  } catch (error) {
    out.error = String(error);
    return out;
  }
  const pseudos = [
    ...new Set(
      document
        .getAnimations()
        .map((a) => a.effect && a.effect.pseudoElement)
        .filter(Boolean),
    ),
  ];
  out.pseudos = pseudos;
  for (const name of ["mj-fig-1", "mj-lane-1", "mj-name-1", "mj-hub-1", "mj-grp-1", "mj-html-1"]) {
    out.captured[name] = pseudos.some((p) => p.includes(`(${name})`));
  }
  return out;
});

// ---------------------------------------------------------------------------
// 2. CSS transitions on SVG geometry, driven by an attribute write
// ---------------------------------------------------------------------------
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  #lane, #hub, #label, #hit { transition: d 600ms linear, cx 600ms linear, cy 600ms linear,
                                    r 600ms linear, x 600ms linear, y 600ms linear,
                                    width 600ms linear, height 600ms linear,
                                    opacity 600ms linear; }
  #g { transition: transform 600ms linear; }
</style>
<svg width="600" height="200" viewBox="0 0 600 200">
  <path id="lane" d="M20,100 C200,100 400,100 580,100" stroke="black" fill="none" stroke-width="3"/>
  <circle id="hub" cx="20" cy="100" r="8"/>
  <text id="label" x="100" y="60">n</text>
  <rect id="hit" x="40" y="40" width="120" height="15" fill="none" pointer-events="all"/>
  <g id="g"><rect width="10" height="10"/></g>
</svg>`);

const geometry = await page.evaluate(async () => {
  const out = {};
  const lane = document.getElementById("lane");
  const hub = document.getElementById("hub");
  const label = document.getElementById("label");
  const hit = document.getElementById("hit");
  const g = document.getElementById("g");
  // Force a style flush so the "before" value is settled.
  getComputedStyle(lane).d;
  // Attribute writes — exactly what React does when it re-renders the SVG.
  lane.setAttribute("d", "M20,40 C200,180 400,20 580,160");
  hub.setAttribute("cx", "560");
  hub.setAttribute("r", "20");
  label.setAttribute("x", "500");
  // The name's click target is a `<rect>`, which moves by x/y/width rather than
  // by cx/cy/r — a separate question from the circle's, and the one that decides
  // whether an invisible target can keep up with the visible name it belongs to.
  hit.setAttribute("x", "300");
  hit.setAttribute("width", "280");
  g.setAttribute("transform", "translate(300,50)");
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const running = document.getAnimations().map((a) => ({
    type: a.constructor.name,
    prop: a.transitionProperty ?? null,
    target: a.effect?.target?.id ?? null,
  }));
  out.running = running;
  out.transitionedProps = running.filter((a) => a.type === "CSSTransition").map((a) => `${a.target}.${a.prop}`);
  return out;
});

console.log(JSON.stringify({ capture, geometry }, null, 2));
await browser.close();
