// Motion and entry probe for the guided tours (apps/web/components/tour).
//
// probe-tour-walk.mjs proves every step can be finished. This one watches HOW the
// overlay moves while it happens: it polls the card, the spotlight ring, the veil
// and the phase every ~40 ms while a step changes, while the page scrolls under a
// spotlight, and while a tour is started from a page other than the one its first
// step lives on. It prints only the moments something changed, then a verdict per
// scenario. Headless Chromium, for the same reason as the walk: the in-app browser
// pane reports the document hidden and pauses every animation.
//
//   MAJORANA_LOCAL_DEV_AUTH=true pnpm --filter @majorana/web exec next dev -p 3100
//   cd packages/ts/ui-visual && node scripts/probe-tour-motion.mjs --base http://localhost:3100
import { chromium } from "@playwright/test";

const argValue = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};
const BASE = argValue("--base") ?? "http://localhost:3100";
const ONLY = argValue("--only")?.split(",") ?? null;
// Hides the laid-out rest of a typing line, restoring the bug typing-growth exists to catch.
const MUTATE_TYPING = process.argv.includes("--mutate-typing");
const VIEWPORT = { width: 1280, height: 800 };
const DISMISSED = { version: 1, active: null, completed: [], furthest: {}, invite: "dismissed" };

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function open(browser, seed = DISMISSED) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript((value) => {
    try {
      if (!sessionStorage.getItem("__seeded")) {
        localStorage.setItem("majorana.tour.v1", value);
        sessionStorage.setItem("__seeded", "1");
      }
    } catch {}
  }, JSON.stringify(seed));
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  pageerror: ${error.message.split("\n")[0]}`));
  return { context, page };
}

function snapshot(targetName) {
  const box = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)];
  };
  // The card's layout box, not its painted one: its entrance animation scales it, and a
  // bounding rect would report that as the card moving.
  const layout = (element) => (element ? [element.offsetLeft, element.offsetTop, element.offsetWidth, element.offsetHeight] : null);
  const layer = document.querySelector("[data-tour-layer]");
  const card = document.querySelector("[data-tour-card]");
  const target = targetName ? document.querySelector(`[data-tour="${targetName}"]`) : null;
  return {
    step: layer?.getAttribute("data-step") ?? null,
    phase: layer?.getAttribute("data-phase") ?? null,
    card: layout(card),
    ring: box(document.querySelector(".mj-tour-ring")),
    target: box(target),
    dim: Boolean(document.querySelector(".mj-tour-scrim")),
    orb: box(layer?.querySelector(":scope > .mj-tour-orb")),
    status: card ? [...card.querySelectorAll(".mj-tour-status")].map((node) => node.textContent) : [],
    chooser: Boolean(document.querySelector(".mj-tour-chooser")),
    path: location.pathname,
  };
}

async function sample(page, ms, targetName = null, during = null) {
  const out = [];
  const start = Date.now();
  let fired = false;
  while (Date.now() - start < ms) {
    if (during && !fired && Date.now() - start > during.at) {
      fired = true;
      await during.run().catch((error) => out.push({ t: Date.now() - start, error: `during: ${String(error).slice(0, 80)}` }));
    }
    try {
      out.push({ t: Date.now() - start, ...(await page.evaluate(snapshot, targetName)) });
    } catch (error) {
      out.push({ t: Date.now() - start, error: String(error).split("\n")[0].slice(0, 80) });
    }
    await page.waitForTimeout(35);
  }
  return out;
}

/** One line per change of step, phase, veil, status or a card move of more than 8 px. */
function printChanges(samples) {
  let last = null;
  for (const s of samples) {
    if (s.error) {
      console.log(`  ${String(s.t).padStart(5)}ms  (${s.error})`);
      continue;
    }
    const moved = last?.card && s.card && (Math.abs(last.card[0] - s.card[0]) > 8 || Math.abs(last.card[1] - s.card[1]) > 8 || Math.abs(last.card[3] - s.card[3]) > 8);
    const changed = !last || last.step !== s.step || last.phase !== s.phase || last.dim !== s.dim || last.path !== s.path || String(last.status) !== String(s.status) || Boolean(last.card) !== Boolean(s.card) || moved;
    if (changed) console.log(`  ${String(s.t).padStart(5)}ms  ${s.path} step=${s.step} phase=${s.phase} dim=${s.dim} card=${s.card} ring=${s.ring} ${s.status.length ? `status=${JSON.stringify(s.status)}` : ""}`);
    last = s;
  }
}

/** The card parked in the bottom-right corner, where it waits when it has nothing to point at. */
const inCorner = (s) => Boolean(s.card) && s.card[0] + s.card[2] > VIEWPORT.width - 40 && s.card[1] + s.card[3] > VIEWPORT.height - 40;

async function waitLayer(page, predicate, arg, timeout = 60_000) {
  await page.waitForFunction(predicate, arg, { timeout, polling: 100 });
}

async function openChooser(page) {
  await page.locator("[data-tour=\"tour-help\"]").first().click({ timeout: 60_000 });
  await page.locator(".mj-tour-chooser").waitFor({ timeout: 30_000 });
}

async function startFromChooser(page, title) {
  await page.locator(".mj-tour-chooser .mj-tour-track", { hasText: title }).locator("button").first().click();
}

const scenarios = {
  // A reading step's Next: the card and spotlight should travel once, directly.
  async "step-change"(browser) {
    const { context, page } = await open(browser, { ...DISMISSED, active: { track: "around", step: 0, paused: false, resume: null } });
    await page.goto(`${BASE}/run`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await waitLayer(page, () => document.querySelector("[data-tour-layer]")?.getAttribute("data-phase") === "reading", null);
    await page.waitForTimeout(1200);
    const samples = await sample(page, 2600, null, { at: 150, run: () => page.locator("[data-tour-card] [data-primary=\"true\"]").click() });
    printChanges(samples);
    const after = samples.filter((s) => s.t > 200 && !s.error);
    check("step-change: the card never parks in the corner between steps", !after.some(inCorner), `${after.filter(inCorner).length} corner samples`);
    check("step-change: the veil never drops between steps", !after.some((s) => s.step && !s.dim), `${after.filter((s) => s.step && !s.dim).length} undimmed samples`);
    await context.close();
  },

  // A card centred beside its target grows while its line types, so its top edge climbs.
  // Teach's last step: three lines of text, where the card's two-line minimum hides nothing.
  async "typing-growth"(browser) {
    const { context, page } = await open(browser, { ...DISMISSED, active: { track: "teach", step: 6, paused: false, resume: null } });
    await page.goto(`${BASE}/run`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    if (MUTATE_TYPING) await page.addStyleTag({ content: ".mj-tour-line-rest { display: none !important; }" });
    await waitLayer(page, () => ["waiting", "reading"].includes(document.querySelector("[data-tour-layer]")?.getAttribute("data-phase") ?? ""), null);
    const samples = await sample(page, 1800);
    const cards = samples.filter((s) => s.card).map((s) => s.card);
    const tops = new Set(cards.map((card) => card[1]));
    const heights = new Set(cards.map((card) => card[3]));
    printChanges(samples);
    check("typing-growth: the card keeps one height while its line types", heights.size <= 1, `heights ${[...heights].join(",")}`);
    check("typing-growth: the card keeps one position while its line types", tops.size <= 1, `tops ${[...tops].join(",")}`);
    await context.close();
  },

  // The page scrolls under a spotlight: the ring should sit on the control every frame.
  async "scroll-follow"(browser) {
    const { context, page } = await open(browser, { ...DISMISSED, active: { track: "read", step: 2, paused: false, resume: null } });
    await page.goto(`${BASE}/repository`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await waitLayer(page, () => ["waiting", "reading"].includes(document.querySelector("[data-tour-layer]")?.getAttribute("data-phase") ?? ""), null);
    await page.waitForTimeout(2200);
    const samples = await sample(page, 2000, "atlas-entry-link", { at: 100, run: () => page.mouse.wheel(0, 260) });
    const offsets = samples.filter((s) => s.ring && s.target).map((s) => Math.abs(s.ring[1] - (s.target[1] - 8)));
    const worst = Math.max(0, ...offsets);
    printChanges(samples);
    check("scroll-follow: the ring stays on the control while the page scrolls", worst <= 6, `worst vertical gap ${worst}px over ${offsets.length} samples`);
    await context.close();
  },

  // Start a Run tour from Studio: one trip to Run, no "Next stop" or "You're on" flash.
  async "entry-from-studio"(browser) {
    const { context, page } = await open(browser);
    await page.goto(`${BASE}/studio?new=1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await openChooser(page);
    const samples = await sample(page, 7000, null, { at: 50, run: () => startFromChooser(page, "First light") });
    printChanges(samples);
    const flashes = samples.filter((s) => ["away", "wandered"].includes(s.phase));
    check("entry-from-studio: lands on Run", samples.at(-1)?.path === "/run", samples.at(-1)?.path);
    check("entry-from-studio: no away/wandered flash while it travels", flashes.length === 0, `${flashes.length} samples: ${[...new Set(flashes.map((s) => s.phase))].join(",")}`);
    check("entry-from-studio: the step is on screen at the end", ["reading", "waiting"].includes(samples.at(-1)?.phase), samples.at(-1)?.phase);
    await context.close();
  },

  // Start Build from Settings → Guided tours.
  async "entry-from-settings"(browser) {
    const { context, page } = await open(browser);
    await page.goto(`${BASE}/account#tours`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const row = page.locator(".mj-tour-settings .mj-tour-track", { hasText: "Build" });
    await row.waitFor({ timeout: 60_000 });
    const samples = await sample(page, 8000, null, { at: 50, run: () => row.locator("button").first().click() });
    printChanges(samples);
    const flashes = samples.filter((s) => ["away", "wandered"].includes(s.phase));
    check("entry-from-settings: lands on Run", samples.at(-1)?.path === "/run", samples.at(-1)?.path);
    check("entry-from-settings: no away/wandered flash while it travels", flashes.length === 0, `${flashes.length} samples`);
    check("entry-from-settings: the step is on screen at the end", ["reading", "waiting", "satisfied"].includes(samples.at(-1)?.phase), samples.at(-1)?.phase);
    await context.close();
  },

  // Start the Atlas track from the workspace: a different root layout, so a full load.
  async "entry-read-from-notebooks"(browser) {
    const { context, page } = await open(browser);
    await page.goto(`${BASE}/notebooks`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await openChooser(page);
    const samples = await sample(page, 14000, null, { at: 50, run: () => startFromChooser(page, "Read") });
    printChanges(samples);
    const end = samples.at(-1);
    check("entry-read-from-notebooks: lands on the Atlas", end?.path === "/repository", end?.path);
    check("entry-read-from-notebooks: the step is on screen at the end", ["reading", "waiting"].includes(end?.phase), `${end?.step} ${end?.phase}`);
    await context.close();
  },

  // Start Teach from Run, where Notebooks is one click away.
  async "entry-teach-from-run"(browser) {
    const { context, page } = await open(browser);
    await page.goto(`${BASE}/run`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await openChooser(page);
    const samples = await sample(page, 9000, null, { at: 50, run: () => startFromChooser(page, "Teach") });
    printChanges(samples);
    const flashes = samples.filter((s) => ["away", "wandered"].includes(s.phase));
    check("entry-teach-from-run: lands on Notebooks", samples.at(-1)?.path === "/notebooks", samples.at(-1)?.path);
    check("entry-teach-from-run: no away/wandered flash while it travels", flashes.length === 0, `${flashes.length} samples`);
    await context.close();
  },
};

const browser = await chromium.launch();
try {
  for (const [name, run] of Object.entries(scenarios)) {
    if (ONLY && !ONLY.includes(name)) continue;
    console.log(`\n== ${name}`);
    try {
      await run(browser);
    } catch (error) {
      check(`${name}: ran to the end`, false, String(error).split("\n")[0].slice(0, 200));
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
