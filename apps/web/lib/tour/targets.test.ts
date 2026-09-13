/**
 * Every tour points at something real, and says it in both languages.
 *
 * A tour step names a `data-tour` attribute, not a CSS path, so that a UI
 * refactor that removes a control breaks THIS test instead of silently leaving a
 * spotlight around nothing (TUTORIAL.md, risk c). The scan reads the source
 * rather than a rendered page: most targets sit behind sign-in, a live run or an
 * open drawer, and a render test would need all three. What it proves is that
 * the attribute is still written somewhere in app/ or components/; the headless
 * walk (packages/ts/ui-visual/scripts/probe-tour-walk.mjs) is what proves it is
 * on screen.
 *
 * The scan asserts what it found, not only what it failed to find: a guard that
 * walks an empty tree passes forever.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { TOURS_COPY } from "../workspace-locale.ts";
import { showKeywords } from "./intent.ts";
import { ALL_TOURS, stepCopyKey } from "./tracks.ts";
import { TOUR_SHOW_IDS, TOUR_TRACK_IDS } from "./types.ts";

const WEB_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCAN_DIRS = ["app", "components"];
const SKIP = (name: string) => name === "node_modules" || name.startsWith(".next");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

function read(relative: string): string {
  return readFileSync(join(WEB_ROOT, relative), "utf8");
}

/**
 * The names written as attributes: `data-tour="x"`, every string literal inside
 * `data-tour={…}`, and `tour="x"` props on a component that forwards
 * `data-tour={tour}`. Two computed templates are expanded from the values they
 * are computed from, and each expansion first asserts the template still exists.
 */
function declaredTargets(): { names: Set<string>; files: number } {
  const names = new Set<string>();
  const files = SCAN_DIRS.flatMap((dir) => sourceFiles(join(WEB_ROOT, dir)));
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/data-tour=(?:"([a-z0-9-]+)"|\{([^}]*)\})/g)) {
      if (match[1]) names.add(match[1]);
      if (match[2]) for (const literal of match[2].matchAll(/"([a-z0-9-]+)"/g)) names.add(literal[1]!);
    }
    if (source.includes("data-tour={tour}")) {
      for (const match of source.matchAll(/\btour="([a-z0-9-]+)"/g)) names.add(match[1]!);
    }
  }

  // PanelTabs: data-tour={`${idPrefix}-tab-${panel}`}, used by Studio with idPrefix="studio".
  const panelTabs = read("components/panel-tabs.tsx");
  assert.ok(panelTabs.includes("data-tour={`${idPrefix}-tab-${panel}`}"), "PanelTabs no longer writes its data-tour template");
  assert.ok(read("app/(app)/studio/studio-workspace.tsx").includes("idPrefix=\"studio\""), "Studio no longer renders PanelTabs with idPrefix=\"studio\"");
  const panels = [...read("lib/studio-panels.ts").matchAll(/"(code|visual|simulation|summary)"/g)].map((match) => match[1]!);
  assert.ok(panels.length >= 4, `expected the four Studio panels, read ${panels.join(",")}`);
  for (const panel of panels) names.add(`studio-tab-${panel}`);

  // Settings rail: data-tour={`settings-${pane.id}`}, pane ids from account-content.tsx.
  assert.ok(read("app/(app)/account/account-panes.tsx").includes("data-tour={`settings-${pane.id}`}"), "the Settings rail no longer writes its data-tour template");
  const paneIds = [...read("app/(app)/account/account-content.tsx").matchAll(/\bid: "([a-z]+)"/g)].map((match) => match[1]!);
  assert.ok(paneIds.includes("preferences") && paneIds.includes("tours"), `Settings panes read as ${paneIds.join(",")}`);
  for (const id of paneIds) names.add(`settings-${id}`);

  return { names, files: files.length };
}

const { names: DECLARED, files: FILES_SCANNED } = declaredTargets();

test("the scan reaches the source tree and finds the attributes", () => {
  assert.ok(FILES_SCANNED > 100, `walked only ${FILES_SCANNED} files`);
  assert.ok(DECLARED.size >= 45, `found only ${DECLARED.size} data-tour names: ${[...DECLARED].sort().join(", ")}`);
  assert.equal(DECLARED.has("no-such-control"), false, "negative control");
});

test("every step's target, and every control a step waits for, is written in the source", () => {
  const missing: string[] = [];
  for (const tour of ALL_TOURS) {
    for (const step of tour.steps) {
      for (const name of [step.target, step.expect?.kind === "wait" || step.expect?.kind === "click" ? step.expect.match : undefined, step.wrongTarget]) {
        if (name && !DECLARED.has(name)) missing.push(`${tour.id}.${step.id} → ${name}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("every step has a title and a line in English and Japanese", () => {
  const problems: string[] = [];
  for (const tour of ALL_TOURS) {
    for (const step of tour.steps) {
      const key = stepCopyKey(tour, step);
      for (const locale of ["en", "ja"] as const) {
        const words = TOURS_COPY[locale].steps[key];
        if (!words || !words.title.trim() || !words.action.trim()) problems.push(`${locale} ${key}`);
      }
      const en = TOURS_COPY.en.steps[key];
      const ja = TOURS_COPY.ja.steps[key];
      if (Boolean(en?.wrong) !== Boolean(ja?.wrong)) problems.push(`${key}: wrong line in one language only`);
      if (Boolean(en?.fill) !== Boolean(ja?.fill)) problems.push(`${key}: fill in one language only`);
      if (step.wrongTarget && !en?.wrong) problems.push(`${key}: has a wrongTarget but no wrong line`);
      if (step.expect?.kind === "value" && !step.fill && !en?.fill) problems.push(`${key}: a value step "Do it for me" cannot fill`);
    }
  }
  const used = new Set(ALL_TOURS.flatMap((tour) => tour.steps.map((step) => stepCopyKey(tour, step))));
  for (const locale of ["en", "ja"] as const) {
    for (const key of Object.keys(TOURS_COPY[locale].steps)) if (!used.has(key)) problems.push(`${locale} ${key}: copy no step uses`);
  }
  assert.deepEqual(problems, []);
});

test("every control a correction can name has a name in both languages", () => {
  const problems: string[] = [];
  for (const name of DECLARED) {
    if (name.startsWith("settings-") || name.startsWith("studio-tab-") && !ALL_TOURS.some((tour) => tour.steps.some((step) => step.target === name))) continue;
    for (const locale of ["en", "ja"] as const) {
      if (!TOURS_COPY[locale].targets[name]) problems.push(`${locale} ${name}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("every design token the tour stylesheet uses is declared at the document root", () => {
  // check-token-vars counts a token as defined if ANY selector declares it. The
  // tour's veil was built on --lab-bg, which exists only under [data-surface="lab"],
  // so on every page the tour runs on the colour-mix was invalid and the SVG fill
  // fell back to opaque black. Only a declaration on a bare :root selector (with
  // attribute or :not() qualifiers, and inside @media) reaches the tour's layer.
  const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = strip(readFileSync(join(WEB_ROOT, "../../packages/ts/ui/tokens.css"), "utf8"));
  const rootScoped = new Set<string>();
  const selectors: string[] = [];
  let buffer = "";
  for (const char of tokens) {
    if (char === "{") {
      selectors.push(buffer.trim());
      buffer = "";
    } else if (char === "}") {
      const selector = selectors.pop() ?? "";
      if (selector.split(",").some((part) => /^:root(?:\[[^\]]*\]|:not\([^()]*\))*$/.test(part.trim()))) {
        for (const match of buffer.matchAll(/(--[\w-]+)\s*:/g)) rootScoped.add(match[1]!);
      }
      buffer = "";
    } else {
      buffer += char;
    }
  }
  assert.ok(rootScoped.has("--bg-0") && rootScoped.has("--text-0"), "positive control: the ground and ink tokens are root-scoped");
  assert.equal(rootScoped.has("--lab-bg"), false, "negative control: the lab palette is scoped to [data-surface=\"lab\"]");

  const tourCss = strip(read("components/tour/tour.css"));
  const used = [...tourCss.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((match) => match[1]!).filter((name) => !name.startsWith("--mj-tour-"));
  assert.ok(used.length > 20, `read only ${used.length} token references from tour.css`);
  assert.deepEqual([...new Set(used.filter((name) => !rootScoped.has(name)))], []);
});

test("every track and Show-me has its words, and every Show-me has keywords in both languages", () => {
  for (const locale of ["en", "ja"] as const) {
    for (const id of TOUR_TRACK_IDS) assert.ok(TOURS_COPY[locale].tracks[id].title, `${locale} ${id}`);
    for (const id of TOUR_SHOW_IDS) assert.ok(TOURS_COPY[locale].shows[id], `${locale} ${id}`);
  }
  for (const id of TOUR_SHOW_IDS) {
    const words = showKeywords(id);
    assert.ok(words.en.length > 0 && words.ja.length > 0, id);
  }
});
