// Headless walk of every guided tour (apps/web/lib/tour, TUTORIAL.md).
//
// Clicks through every step of every track on a real dev server, including a
// wrong click, "Do it for me", an idle nudge, a reader's own prompt, Ask, the
// Settings row, reduced motion, Japanese and a phone-width viewport. Headless
// Chromium because the in-app browser pane reports the document as hidden and
// every animation there is paused.
//
// Not in CI: it needs a signed-in dev server, and CI workflows are out of scope
// for this change. Run it by hand:
//
//   MAJORANA_LOCAL_DEV_AUTH=true pnpm --filter @majorana/web exec next dev -p 3103
//   cd packages/ts/ui-visual && node --experimental-strip-types scripts/probe-tour-walk.mjs --base http://localhost:3103
//
// Without the API running, steps that need it must skip with a notice; the
// "online" scenarios mock `/api/me`, `/api/runs` and the conversation route in
// the browser, and say so in their names.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { TOURS_COPY } from "../../../../apps/web/lib/workspace-locale.ts";
import { stepCopyKey, tourById } from "../../../../apps/web/lib/tour/tracks.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../../..");
const argValue = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};
const BASE = argValue("--base") ?? "http://localhost:3103";
const SHOTS = argValue("--shots") ?? join(REPO, "docs/ui/screenshots/ux-pass6-20260912/tour");
const ONLY = argValue("--only")?.split(",") ?? null;
const TRACE = process.argv.includes("--trace");
const EN = TOURS_COPY.en;
mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const DISMISSED = { version: 1, active: null, completed: [], furthest: {}, invite: "dismissed" };

async function open(browser, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: options.reducedMotion ?? "no-preference",
  });
  if (options.cookies) await context.addCookies(options.cookies.map((cookie) => ({ url: BASE, ...cookie })));
  if (options.theme) {
    // The saved theme the inline head script reads before first paint (lib/theme.ts).
    await context.addInitScript((theme) => {
      try {
        localStorage.setItem("majorana.theme.v1", theme);
      } catch {}
    }, options.theme);
  }
  await context.addInitScript((seed) => {
    const log = (key, value) => {
      try {
        const list = JSON.parse(sessionStorage.getItem(key) ?? "[]");
        list.push(value);
        sessionStorage.setItem(key, JSON.stringify(list));
      } catch {}
    };
    window.addEventListener("leona:tour-signal", (event) => log("__tourSignals", event.detail));
    window.addEventListener("leona:nala", (event) => log("__nalaCues", event.detail.cue));
    try {
      if (seed && !sessionStorage.getItem("__seeded")) {
        localStorage.setItem("majorana.tour.v1", seed);
        sessionStorage.setItem("__seeded", "1");
      }
    } catch {}
  }, options.seed === null ? null : JSON.stringify(options.seed ?? DISMISSED));
  if (options.online) await mockOnline(context, options.online);
  const page = await context.newPage();
  if (options.clock) await page.clock.install();
  page.on("pageerror", (error) => console.log(`  pageerror: ${error.message.split("\n")[0]}`));
  return { context, page };
}

/** The workspace, as far as the browser can tell, is online. Everything here is a fixture. */
async function mockOnline(context, { answer = "", runId = "tour-walk-run" } = {}) {
  await context.route("**/api/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspace_id: "w-tour", role: "owner", is_personal_workspace: true }) }));
  await context.route("**/api/runs", (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: runId, conversation_id: "c-tour" }) });
  });
  await context.route(`**/api/runs/${runId}/conversation`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "c-tour", turns: [{ run: { id: runId, task_prompt: "fixture", conversation_id: "c-tour" }, events: answer ? [{ type: "chat.completed", text: answer }, { type: "run.finished", status: "succeeded" }] : [] }] }),
  }));
}

async function state(page) {
  return page.evaluate(() => {
    const layer = document.querySelector("[data-tour-layer]");
    const card = document.querySelector("[data-tour-card]");
    const primary = card?.querySelector("[data-primary=\"true\"]");
    return {
      step: layer?.dataset.step ?? null,
      phase: layer?.dataset.phase ?? null,
      lines: card ? [...card.querySelectorAll(".mj-tour-status")].map((node) => node.textContent) : [],
      line: card?.querySelector(".mj-tour-line")?.textContent ?? null,
      primary: primary ? { label: primary.textContent, disabled: primary.disabled } : null,
      buttons: card ? [...card.querySelectorAll(".mj-tour-actions .mj-tour-button")].map((button) => button.textContent) : [],
      finished: document.querySelector("[data-tour-finished]")?.getAttribute("data-tour-finished") ?? null,
      path: location.pathname,
      hash: location.hash,
    };
  });
}

const signals = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("__tourSignals") ?? "[]"));
const cues = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("__nalaCues") ?? "[]"));

async function clickCard(page, label) {
  await page.locator("[data-tour-card] button", { hasText: label }).first().click({ timeout: 8_000 });
}

async function waitStepChange(page, from, timeout = 20_000) {
  await page.waitForFunction((key) => document.querySelector("[data-tour-layer]")?.dataset.step !== key, from, { timeout });
}

async function waitFor(page, predicate, arg, timeout = 90_000) {
  await page.waitForFunction(predicate, arg, { timeout, polling: 250 });
}

function stepOf(key) {
  const [tourId, index] = [key.slice(0, key.lastIndexOf(".")), Number(key.slice(key.lastIndexOf(".") + 1))];
  const tour = tourById(tourId);
  const step = tour.steps[index];
  return { tour, step, words: EN.steps[stepCopyKey(tour, step)] };
}

/** Do what the step asks, the way a person would: fill the field, press the control. */
async function perform(page, key) {
  const { step, words } = stepOf(key);
  const target = page.locator(`[data-tour="${step.target}"]`).filter({ visible: true }).first();
  if (step.expect.kind === "value") {
    const field = await target.evaluateHandle((element) => (element.matches("textarea, select, input") ? element : element.querySelector("textarea, select, input:not([type=hidden]):not([type=file])")));
    const tag = await field.evaluate((element) => element.tagName);
    if (tag === "SELECT") await field.asElement().selectOption(step.fill);
    else await field.asElement().fill(words.fill ?? "tour walk");
    return;
  }
  const control = await target.evaluateHandle((element) => (element.matches("button, a[href], summary, [role=tab]") ? element : element.querySelector("summary, button, a[href]")));
  await control.asElement().click();
}

/**
 * Walk one tour to its end. `hooks[stepKey]` runs once instead of the default
 * action for that step. Returns what the walk saw, for the checks.
 */
async function walk(page, tourId, hooks = {}) {
  const seen = [];
  const phases = {};
  const offline = [];
  const hidden = [];
  const used = new Set();
  let finished = false;
  for (let guard = 0; guard < 120; guard += 1) {
    const now = await state(page);
    if (!now.step || !now.step.startsWith(`${tourId}.`)) {
      if (now.finished === tourId) {
        finished = true;
        break;
      }
      // No layer on screen is not the end: a full page load between Atlas pages
      // removes it for a moment. Ask the stored progress whether the tour is on.
      const stillActive = await page.evaluate((id) => {
        try {
          return JSON.parse(localStorage.getItem("majorana.tour.v1") ?? "{}").active?.track === id;
        } catch {
          return false;
        }
      }, tourId).catch(() => true);
      if (seen.length && !now.step && !stillActive) break;
      if (seen.length && now.step) break; // resumed into another tour
      await page.waitForTimeout(400);
      continue;
    }
    if (!seen.includes(now.step)) seen.push(now.step);
    (phases[now.step] ??= new Set()).add(now.phase);
    if (TRACE) console.log(`  · ${now.step} ${now.phase} ${now.path} [${now.lines.join(" | ")}]`);
    if (hooks[now.step] && !used.has(now.step) && !["locating", "away", "success"].includes(now.phase)) {
      used.add(now.step);
      await hooks[now.step](now);
      continue;
    }
    try {
      switch (now.phase) {
        case "locating":
        case "success":
          await page.waitForTimeout(300);
          break;
        case "reading":
        case "satisfied":
          await clickCard(page, now.primary.label);
          await waitStepChange(page, now.step);
          break;
        case "waiting":
          await perform(page, now.step);
          await waitStepChange(page, now.step, 90_000);
          break;
        case "away":
          // A navigation the tour already started may still be landing: look again
          // before pressing anything, so the walk does not race the page.
          await page.waitForTimeout(1500);
          if ((await state(page)).phase !== "away") break;
          if (now.buttons.includes(EN.card.takeMeThere)) {
            await clickCard(page, EN.card.takeMeThere);
            await waitFor(page, (key) => { const layer = document.querySelector("[data-tour-layer]"); return !layer || layer.dataset.step !== key || layer.dataset.phase !== "away"; }, now.step);
          } else {
            await clickCard(page, EN.card.skipStep);
            await waitStepChange(page, now.step);
          }
          break;
        case "offline":
          offline.push(now.step);
          await clickCard(page, EN.card.skipAhead);
          await waitStepChange(page, now.step);
          break;
        case "hidden":
          hidden.push(now.step);
          await clickCard(page, EN.card.skipStep);
          await waitStepChange(page, now.step);
          break;
        case "wandered":
          await clickCard(page, EN.card.backToTour);
          await page.waitForTimeout(1500);
          break;
        default:
          await page.waitForTimeout(300);
      }
    } catch (error) {
      console.log(`  stuck at ${now.step} (${now.phase}): ${error.message.split("\n")[0]}`);
      break;
    }
  }
  return { seen, phases, offline, hidden, finished };
}

async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), type: "png" });
}

/** Decode an 8-bit, non-interlaced RGB or RGBA PNG, which is what Chromium screenshots are. */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG: depth ${bitDepth}, colour type ${colorType}, interlace ${interlace}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = raw[start];
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0;
      let value = raw[start + 1 + x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, bpp, pixels };
}

/** Mean and spread of luma over an image. Spread is how much content is still legible. */
function lumaStats(image) {
  const values = [];
  for (let index = 0; index < image.pixels.length; index += image.bpp) {
    values.push(0.2126 * image.pixels[index] + 0.7152 * image.pixels[index + 1] + 0.0722 * image.pixels[index + 2]);
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  return { mean: Math.round(mean * 10) / 10, sd: Math.round(sd * 10) / 10 };
}

async function sampleBox(page, box) {
  const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.max(4, Math.round(box.width)), height: Math.max(4, Math.round(box.height)) };
  return lumaStats(decodePng(await page.screenshot({ clip, type: "png", animations: "disabled" })));
}

/** `rgb()`, `rgba()` or `color(srgb … / a)`, as getComputedStyle writes them. */
function parseColor(text) {
  const numbers = (text.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  if (/^color\(srgb/.test(text)) return { r: numbers[0] * 255, g: numbers[1] * 255, b: numbers[2] * 255, a: text.includes("/") ? numbers[3] : 1 };
  if (/^rgba?\(/.test(text)) return { r: numbers[0], g: numbers[1], b: numbers[2], a: numbers.length > 3 ? numbers[3] : 1 };
  return null;
}

function boxesOverlap(a, b) {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

/**
 * The veil must darken the page and leave it readable. Asserted three ways: the
 * computed colour is translucent and not opaque black, the pixels behind it got
 * darker, and they kept some of their contrast (an opaque veil leaves none).
 */
function checkVeil(label, colorText, before, after) {
  const color = parseColor(colorText ?? "");
  check(`${label}: colour is translucent, not opaque black`, Boolean(color) && color.a > 0.2 && color.a < 1 && colorText !== "rgb(0, 0, 0)", colorText);
  check(`${label}: the page behind is darker`, after.mean < before.mean - 3, `luma mean ${before.mean} → ${after.mean}`);
  check(`${label}: the page behind is still readable`, after.sd > 2 && after.sd > before.sd * 0.15 && after.sd < before.sd, `luma spread ${before.sd} → ${after.sd}`);
}

const scenarios = {
  async invite_and_around(browser) {
    const { context, page } = await open(browser, { seed: null });
    await page.goto(`${BASE}/run`);
    await waitFor(page, () => Boolean(document.querySelector("[data-tour-invite]")));
    check("invite: corner prompt appears on first visit, page not dimmed", !(await page.locator("[data-tour-layer]").count()));
    await shot(page, "01-invite");
    await page.locator("[data-tour-invite] button", { hasText: EN.invite.start }).click();
    await waitFor(page, () => document.querySelector("[data-tour-layer]")?.dataset.phase === "reading");
    const first = await state(page);
    check("around: starts at step 1 with the hash", first.step === "around.0" && first.hash === "#tour=around.1", `${first.step} ${first.hash}`);
    const motion = await page.evaluate(async () => {
      const core = document.querySelector(".mj-tour-orb-core");
      const name = getComputedStyle(core).animationName;
      const a = getComputedStyle(core).transform;
      await new Promise((resolve) => setTimeout(resolve, 700));
      const b = getComputedStyle(core).transform;
      return { name, moved: a !== b, visibility: document.visibilityState };
    });
    check("guide orb breathes (animation running in a visible document)", motion.name.includes("mj-tour-breathe") && motion.moved, JSON.stringify(motion));
    const described = await page.evaluate(() => document.querySelector("[data-tour=\"rail-run\"]")?.getAttribute("aria-describedby") ?? "");
    check("card describes the spotlighted control", described.includes("mj-tour-card-body"), described);
    await page.waitForTimeout(900);
    await shot(page, "02-around-rail");
    await page.keyboard.press("ArrowRight");
    await waitStepChange(page, "around.0");
    check("ArrowRight moves on from a reading step", (await state(page)).step === "around.1");
    const result = await walk(page, "around", {
      // The account menu step waits for a click, so the rest of the page is inert.
      "around.3": async (now) => {
        await waitFor(page, () => document.querySelector("[data-tour-layer]")?.dataset.phase === "waiting");
        await page.waitForTimeout(300);
        const inert = await page.evaluate(() => [...document.body.querySelectorAll("[inert]")].length);
        check("a waiting step makes the rest of the page inert", inert > 0, `${inert} inert elements`);
        await perform(page, now.step);
        await waitStepChange(page, now.step);
      },
    });
    const around = tourById("around");
    // around.0 was passed with ArrowRight above, before the walk started counting.
    check("around: every step visited, none hidden", result.seen.length + 1 === around.steps.length && !result.hidden.length, `${result.seen.length + 1}/${around.steps.length} ${result.hidden.length ? `hidden: ${result.hidden}` : ""}`);
    check("around: finished card shown", result.finished);
    await shot(page, "03-around-finished");
    const inertAfter = await page.evaluate(() => [...document.body.querySelectorAll("[inert]")].filter((node) => !node.closest(".mj-sidebar-user-drawer") && !node.matches(".mj-sidebar-user-drawer")).length);
    check("no inert left behind after the tour", inertAfter === 0, `${inertAfter}`);
    const sent = await signals(page);
    check("analytics: tour_done fired for around", sent.some((signal) => signal.event === "tour_done" && signal.tour === "around"), `${sent.length} signals`);
    await context.close();
  },

  async first_light_wrong_click_and_do_it_for_me(browser) {
    const { context, page } = await open(browser);
    await page.goto(`${BASE}/run`);
    await page.locator("[data-tour=\"tour-help\"]").click();
    await waitFor(page, () => Boolean(document.querySelector(".mj-tour-chooser")));
    await shot(page, "04-chooser");
    await page.locator(".mj-tour-track", { hasText: EN.tracks["first-light"].title }).locator("button", { hasText: EN.chooser.start }).click();
    const result = await walk(page, "first-light", {
      "first-light.1": async () => {
        await waitFor(page, () => document.querySelector("[data-tour-layer]")?.dataset.phase === "waiting");
        const other = await page.locator("[data-tour=\"run-starter\"]").first().boundingBox();
        await page.mouse.click(other.x + other.width / 2, other.y + other.height / 2);
        await page.waitForTimeout(250);
        const afterOne = await state(page);
        check("wrong click gets the step's own correction", afterOne.lines.includes(EN.steps["first-light.starter"].wrong), afterOne.lines.join(" | "));
        await shot(page, "05-first-light-correction");
        await page.mouse.click(other.x + other.width / 2, other.y + other.height / 2);
        await page.waitForTimeout(250);
        const afterTwo = await state(page);
        check("two misses offer Do it for me", afterTwo.buttons.includes(EN.card.doItForMe), afterTwo.buttons.join(","));
        await clickCard(page, EN.card.doItForMe);
        await page.waitForTimeout(450);
        const cursorShown = await page.locator(".mj-tour-cursor").count();
        check("Do it for me shows the guide cursor travelling", cursorShown === 1);
        await shot(page, "06-do-it-for-me");
        await waitStepChange(page, "first-light.1");
        const prompt = await page.locator("[data-tour=\"run-prompt\"]").first().inputValue();
        check("Do it for me pressed the real starter (prompt filled)", /Bell/i.test(prompt), prompt.slice(0, 60));
      },
      "first-light.6": async (now) => {
        check("offline: API steps skipped with a notice, never faked", now.lines.some((line) => line === EN.status.offlineSkipped(4)), now.lines.join(" | "));
        await shot(page, "07-offline-skip");
        if (now.phase === "away") await clickCard(page, EN.card.takeMeThere);
        else await perform(page, now.step);
        await page.waitForTimeout(500);
      },
    });
    const track = tourById("first-light");
    const apiSteps = track.steps.filter((step) => step.needs === "api").length;
    check("first-light: every step visited or honestly skipped offline", result.seen.length + apiSteps >= track.steps.length && result.finished, `seen ${result.seen.length}, api ${apiSteps}, finished ${result.finished}, hidden ${result.hidden}`);
    const sent = await signals(page);
    check("analytics: did_it_for_me and offline_skip recorded", sent.some((signal) => signal.event === "did_it_for_me" && signal.step === "starter") && sent.some((signal) => signal.event === "offline_skip"), sent.map((signal) => `${signal.event}:${signal.step ?? ""}`).join(","));
    const nala = await cues(page);
    check("Nala cues on the Run page: tilt on a miss, flick on success", nala.includes("tilt") && nala.includes("flick"), nala.join(","));
    await context.close();
  },

  async build_wrong_target_and_do_it_for_me(browser) {
    const { context, page } = await open(browser);
    await page.goto(`${BASE}/run#tour=build.1`);
    const result = await walk(page, "build", {
      "build.0": async () => {
        const framework = await page.locator("[data-tour=\"run-framework\"]").first().boundingBox();
        await page.mouse.click(framework.x + framework.width / 2, framework.y + framework.height / 2);
        await page.waitForTimeout(250);
        const one = await state(page);
        check("build: clicking the framework picker names it", one.lines.includes(EN.steps["build.mode"].wrong), one.lines.join(" | "));
        await shot(page, "08-build-correction");
        const attach = await page.locator("[data-tour=\"run-attach\"]").first().boundingBox();
        await page.mouse.click(attach.x + attach.width / 2, attach.y + attach.height / 2);
        await page.waitForTimeout(250);
        const two = await state(page);
        check("build: a different wrong control gets its own name, not the framework line", two.lines.includes(EN.status.notQuite(EN.targets["run-attach"])), two.lines.join(" | "));
        await clickCard(page, EN.card.doItForMe);
        await waitStepChange(page, "build.0");
        const mode = await page.locator("[data-tour=\"run-mode\"] select").first().inputValue();
        check("build: Do it for me set the mode to Execute", mode === "execute", mode);
      },
      "build.1": async () => {
        await page.locator("[data-tour=\"run-prompt\"]").first().fill("Find the ground state energy of H2 with VQE");
        await waitStepChange(page, "build.1");
        await page.waitForTimeout(300);
      },
      "build.6": async (now) => {
        check("build: typing your own prompt is acknowledged on the next card", now.lines.includes(EN.status.ownValue), now.lines.join(" | "));
        await perform(page, now.step);
        await waitStepChange(page, now.step, 60_000);
      },
    });
    const track = tourById("build");
    check("build: walked to the end", result.finished, `seen ${result.seen.length}/${track.steps.length}, offline ${result.offline}, hidden ${result.hidden}`);
    await shot(page, "09-build-end");
    await context.close();
  },

  async teach_from_settings(browser) {
    const { context, page } = await open(browser);
    await page.goto(`${BASE}/account`);
    await page.locator("[data-tour=\"settings-tours\"]").first().click();
    await waitFor(page, () => Boolean(document.querySelector(".mj-tour-settings")));
    await shot(page, "10-settings-guided-tours");
    await page.locator(".mj-tour-settings .mj-tour-track", { hasText: EN.tracks.teach.title }).locator("button", { hasText: EN.chooser.start }).click();
    await waitFor(page, () => location.pathname === "/notebooks" && Boolean(document.querySelector("[data-tour-layer]")));
    const result = await walk(page, "teach");
    const track = tourById("teach");
    check("teach: started from Settings, walked to the end", result.finished, `seen ${result.seen.length}/${track.steps.length}, offline ${result.offline}, hidden ${result.hidden}`);
    await context.close();
  },

  async read_on_the_atlas(browser) {
    const { context, page } = await open(browser);
    await page.goto(`${BASE}/run`);
    await page.locator("[data-tour=\"tour-help\"]").click();
    await page.locator(".mj-tour-track", { hasText: EN.tracks.read.title }).locator("button", { hasText: EN.chooser.start }).click();
    await waitFor(page, () => location.pathname.includes("/repository") && Boolean(document.querySelector("[data-tour-layer]")), null, 120_000);
    await page.waitForTimeout(1200);
    await shot(page, "11-read-atlas-search");
    const result = await walk(page, "read");
    const track = tourById("read");
    check("read: walked the Atlas across page loads to the end", result.finished, `seen ${result.seen.length}/${track.steps.length}, hidden ${result.hidden}`);
    await context.close();
  },

  async ask_and_show_me_mocked_online(browser) {
    const answer = "Open the Code tab and pick Cirq in the framework menu. Studio rewrites the circuit for you.";
    const { context, page } = await open(browser, { online: { answer, runId: "tour-ask-run" } });
    await page.goto(`${BASE}/run#tour=around.1`);
    await waitFor(page, () => document.querySelector("[data-tour-layer]")?.dataset.phase === "reading");
    await clickCard(page, EN.card.ask);
    await page.locator("#mj-tour-ask-input").fill("How do I convert this to Cirq?");
    await page.locator("[data-tour-card] .mj-tour-ask button", { hasText: EN.ask.submit }).click();
    const matched = await page.locator("[data-tour-card] .mj-tour-ask-reply").first().textContent();
    check("Ask: finds the matching Show-me without calling anything", matched === EN.ask.match(EN.shows["show-cirq"]), matched);
    check("Ask: the cost of asking Nala is shown before sending", (await page.locator("[data-tour-card] .mj-tour-ask-cost").textContent()) === EN.ask.cost);
    await page.locator("[data-tour-card] .mj-tour-ask button", { hasText: EN.ask.askNala }).click();
    await waitFor(page, (text) => document.querySelector("[data-tour-card]")?.textContent?.includes(text), answer.slice(0, 30), 20_000);
    check("Ask Nala (mocked API): the answer from the conversation route is shown", true);
    await shot(page, "12-ask-mocked");
    await page.locator("[data-tour-card] .mj-tour-ask button", { hasText: EN.ask.showMe }).click();
    await waitFor(page, () => document.querySelector("[data-tour-layer]")?.dataset.step?.startsWith("show-cirq"));
    const result = await walk(page, "show-cirq");
    check("Show me: the micro-tour runs to its end", result.seen.length === 2, result.seen.join(","));
    await waitFor(page, () => document.querySelector("[data-tour-layer]")?.dataset.step === "around.0", null, 20_000);
    check("Show me started from a track returns to that track's step", true);
    await context.close();
  },

  async own_prompt_mocked_online(browser) {
    const { context, page } = await open(browser, { online: { runId: "tour-own-run" } });
    await page.goto(`${BASE}/run#tour=first-light.2`);
    await walk(page, "first-light", {
      // Press the Bell starter, so the tour remembers the prompt it filled in...
      "first-light.1": async () => {
        await perform(page, "first-light.1");
        await waitStepChange(page, "first-light.1");
      },
      // ...then write a different one before sending.
      "first-light.2": async () => {
        await page.locator("[data-tour=\"run-prompt\"]").first().fill("Make a three-qubit GHZ state and show the counts");
        await perform(page, "first-light.2");
        await waitFor(page, () => location.pathname === "/run/tour-own-run", null, 30_000);
        await waitFor(page, () => document.querySelector("[data-tour-layer]")?.dataset.step === "first-light.3", null, 30_000);
        const now = await state(page);
        check("own prompt: the guide acknowledges it and carries on", now.lines.includes(EN.status.ownPrompt), now.lines.join(" | "));
        await shot(page, "13-own-prompt-mocked");
        await clickCard(page, EN.card.skipTour);
      },
    });
    await context.close();
  },

  async idle_nudge(browser) {
    const { context, page } = await open(browser, { clock: true });
    await page.goto(`${BASE}/run#tour=around.4`);
    await waitFor(page, () => document.querySelector("[data-tour-layer]")?.dataset.phase === "waiting");
    await page.clock.fastForward(21_000);
    await page.waitForTimeout(300);
    const now = await state(page);
    check("idle: a nudge after twenty quiet seconds, with Do it for me", now.lines.includes(EN.status.nudge) && now.buttons.includes(EN.card.doItForMe), now.lines.join(" | "));
    await page.keyboard.press("Escape");
    await waitStepChange(page, "around.3");
    const sent = await signals(page);
    check("Escape skips the step", sent.some((signal) => signal.event === "step_skipped" && signal.step === "account"));
    await context.close();
  },

  async reduced_motion_japanese(browser) {
    const { context, page } = await open(browser, { reducedMotion: "reduce", cookies: [{ name: "leona.locale.v2", value: "ja" }] });
    await page.goto(`${BASE}/run#tour=build.2`);
    await waitFor(page, () => Boolean(document.querySelector("[data-tour-card] .mj-tour-line")?.textContent));
    const now = await state(page);
    const expected = TOURS_COPY.ja.steps["build.prompt"].action;
    check("reduced motion: the line is there at once, no typing", now.line === expected, now.line);
    const motion = await page.evaluate(() => ({ orb: getComputedStyle(document.querySelector(".mj-tour-orb-core")).animationName, travel: getComputedStyle(document.querySelector(".mj-tour-orb")).transitionDuration }));
    check("reduced motion: the orb neither breathes nor travels", motion.orb === "none" && /^0s/.test(motion.travel), JSON.stringify(motion));
    await shot(page, "14-reduced-motion-ja");
    await context.close();
  },

  async scrim_dims_the_page(browser) {
    // Positive control for the pixel reader: a flat, known colour decodes as itself.
    {
      const { context, page } = await open(browser);
      await page.setContent("<div style=\"margin:0;width:60px;height:60px;background:rgb(40, 160, 90)\"></div>");
      const image = lumaStats(decodePng(await page.screenshot({ clip: { x: 20, y: 20, width: 20, height: 20 }, type: "png" })));
      const expected = 0.2126 * 40 + 0.7152 * 160 + 0.0722 * 90;
      check("pixel reader: a known colour decodes as itself", Math.abs(image.mean - expected) < 1.5 && image.sd < 1, `mean ${image.mean}, expected ${expected.toFixed(1)}, spread ${image.sd}`);
      await context.close();
    }
    for (const theme of ["light", "dark"]) {
      const { context, page } = await open(browser, { theme, reducedMotion: "reduce" });
      await page.goto(`${BASE}/run`);
      await waitFor(page, () => document.querySelectorAll("[data-tour=\"run-starter\"]").length > 0);
      await page.waitForTimeout(2500);
      const starter = await page.locator("[data-tour=\"run-starter\"]").first().boundingBox();
      const starterBefore = await sampleBox(page, starter);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("leona:tour", { detail: { action: "start", tour: "around", fromStart: true } })));
      await waitFor(page, () => document.querySelector("[data-tour-layer]")?.dataset.phase === "reading");
      await page.waitForTimeout(900);
      const layer = await page.evaluate(() => {
        const fill = document.querySelector(".mj-tour-scrim-fill");
        const card = document.querySelector("[data-tour-card]")?.getBoundingClientRect();
        const ring = document.querySelector(".mj-tour-ring")?.getBoundingClientRect();
        const box = (rect) => (rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null);
        return {
          theme: document.documentElement.dataset.theme,
          ground: getComputedStyle(document.body).backgroundColor,
          scrimVariable: getComputedStyle(document.querySelector("[data-tour-layer]")).getPropertyValue("--mj-tour-scrim").trim(),
          fill: fill ? getComputedStyle(fill).fill : null,
          card: box(card),
          hole: box(ring),
        };
      });
      const stack = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).slice(0, 4).map((node) => `${node.tagName.toLowerCase()}${node.getAttribute("class") ? `.${String(node.getAttribute("class")).trim().split(/\s+/).join(".")}` : ""}`), { x: starter.x + starter.width / 2, y: starter.y + starter.height / 2 });
      const starterAfter = await sampleBox(page, starter);
      console.log(`  ${theme} layer: ${JSON.stringify({ ...layer, stack })}`);
      await shot(page, `17-scrim-${theme}`);
      check(`scrim ${theme}: the theme is applied`, layer.theme === theme, `${layer.theme}, ground ${layer.ground}`);
      check(`scrim ${theme}: the sampled control sits behind the veil, clear of the card and the spotlight`, (!layer.card || !boxesOverlap(starter, layer.card)) && (!layer.hole || !boxesOverlap(starter, layer.hole)), JSON.stringify({ starter, card: layer.card, hole: layer.hole }));
      checkVeil(`scrim ${theme}`, layer.fill, starterBefore, starterAfter);

      await page.evaluate(() => window.dispatchEvent(new CustomEvent("leona:tour", { detail: { action: "leave" } })));
      await waitFor(page, () => !document.querySelector("[data-tour-layer]"));
      await page.waitForTimeout(500);
      const rail = await page.locator("[data-tour=\"rail-notebooks\"]").first().boundingBox();
      const railBefore = await sampleBox(page, rail);
      await page.locator("[data-tour=\"tour-help\"]").click();
      await waitFor(page, () => Boolean(document.querySelector(".mj-tour-chooser-backdrop")));
      await page.waitForTimeout(500);
      const chooser = await page.evaluate(() => {
        const node = document.querySelector(".mj-tour-chooser-backdrop");
        const dialog = document.querySelector(".mj-tour-chooser").getBoundingClientRect();
        return {
          background: getComputedStyle(node).backgroundColor,
          scrimVariable: getComputedStyle(node).getPropertyValue("--mj-tour-scrim").trim(),
          dialog: { x: dialog.left, y: dialog.top, width: dialog.width, height: dialog.height },
        };
      });
      const railAfter = await sampleBox(page, rail);
      console.log(`  ${theme} chooser: ${JSON.stringify(chooser)}`);
      await shot(page, `18-chooser-${theme}`);
      check(`chooser ${theme}: the sampled rail link sits outside the dialog`, !boxesOverlap(rail, chooser.dialog), JSON.stringify({ rail, dialog: chooser.dialog }));
      checkVeil(`chooser backdrop ${theme}`, chooser.background, railBefore, railAfter);
      await context.close();
    }
  },

  async phone_width(browser) {
    const { context, page } = await open(browser, { viewport: { width: 375, height: 812 } });
    await page.goto(`${BASE}/run#tour=first-light.2`);
    await waitFor(page, () => ["waiting", "hidden"].includes(document.querySelector("[data-tour-layer]")?.dataset.phase ?? ""));
    await page.waitForTimeout(800);
    const box = await page.locator("[data-tour-card]").boundingBox();
    check("phone: the card stays on screen", box && box.x >= 0 && box.x + box.width <= 375 && box.y >= 0 && box.y + box.height <= 812, JSON.stringify(box));
    await shot(page, "15-phone");
    await context.close();
  },
};

const browser = await chromium.launch();
for (const [name, run] of Object.entries(scenarios)) {
  if (ONLY && !ONLY.includes(name)) continue;
  console.log(`\n== ${name}`);
  try {
    await run(browser);
  } catch (error) {
    check(`${name} completed`, false, error.message.split("\n")[0]);
  }
}
await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
