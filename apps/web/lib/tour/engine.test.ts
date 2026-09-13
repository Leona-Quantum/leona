import assert from "node:assert/strict";
import test from "node:test";

import {
  IDLE_NUDGE_MS,
  TOUR_STORAGE_KEY,
  classifyPrompt,
  clickOutcome,
  correctionFor,
  emptyProgress,
  finishTour,
  formatTourHash,
  mayWriteTourHash,
  moveTo,
  nextRunnableStep,
  offersHelp,
  parseProgress,
  parseTourHash,
  readProgress,
  restartTour,
  routeMatches,
  startTour,
  tourStatus,
  valueMatches,
  writeProgress,
} from "./engine.ts";
import { centreCard, holeFor, placeCard } from "./geometry.ts";
import { matchShow } from "./intent.ts";
import { ALL_TOURS, TOUR_TRACKS, tourById } from "./tracks.ts";

const build = tourById("build")!;
const firstLight = tourById("first-light")!;
const showCirq = tourById("show-cirq")!;

test("tracks are built in the owner's order (ai-ops 298, option 1)", () => {
  assert.deepEqual(TOUR_TRACKS.map((tour) => tour.id), ["around", "first-light", "build", "teach", "read"]);
});

test("the URL hash is one-based and round-trips", () => {
  assert.equal(formatTourHash("build", 3), "#tour=build.4");
  assert.deepEqual(parseTourHash("#tour=build.4", tourById), { track: "build", step: 3 });
  assert.deepEqual(parseTourHash("tour=around.1", tourById), { track: "around", step: 0 });
});

test("a hash naming a missing tour or a step out of range is ignored, not clamped", () => {
  assert.equal(parseTourHash("#tour=nope.1", tourById), null);
  assert.equal(parseTourHash("#tour=build.0", tourById), null);
  assert.equal(parseTourHash(`#tour=build.${build.steps.length + 1}`, tourById), null);
  assert.equal(parseTourHash("#usage", tourById), null);
});

test("the tour never takes a fragment another feature owns", () => {
  assert.equal(mayWriteTourHash(""), true);
  assert.equal(mayWriteTourHash("#tour=around.2"), true);
  assert.equal(mayWriteTourHash("#usage"), false, "/account#usage selects a Settings pane");
});

test("route patterns: exact, one-or-more segments, prefix, workspace, locale", () => {
  assert.equal(routeMatches("/studio", "/studio?new=1"), true);
  assert.equal(routeMatches("/studio", "/studio/x"), false);
  assert.equal(routeMatches("/run/*", "/run"), false);
  assert.equal(routeMatches("/run/*", "/run/abc"), true);
  assert.equal(routeMatches("/repository*", "/repository"), true);
  assert.equal(routeMatches("/repository*", "/repository/layers"), true);
  assert.equal(routeMatches("/repository*", "/repositoryx"), false);
  assert.equal(routeMatches("@workspace", "/notebooks/courses"), true);
  assert.equal(routeMatches("@workspace", "/repository"), false);
  assert.equal(routeMatches("/run|/studio", "/studio"), true);
  assert.equal(routeMatches("/repository", "/ja/repository"), true);
  assert.equal(routeMatches("/run", "/run/"), true);
});

test("values match by pattern, and a broken pattern fails closed", () => {
  assert.equal(valueMatches("^cirq$", "cirq"), true);
  assert.equal(valueMatches("^cirq$", "qiskit"), false);
  assert.equal(valueMatches("(", "anything"), false);
});

test("a length rule counts characters across words, not one unbroken run (found by the headless walk)", () => {
  const prompt = build.steps.find((step) => step.id === "prompt")!.expect!.match;
  assert.equal(valueMatches(prompt, "Find the ground state energy of H2 with VQE"), true, "ordinary words must pass");
  assert.equal(valueMatches(prompt, "  short one  "), false, "eight non-space characters is not twelve");
  const brief = firstLight.steps.find((step) => step.id === "brief")!.expect!.match;
  assert.equal(valueMatches(brief, "a b c"), true);
  assert.equal(valueMatches(brief, "  ab "), false);
  for (const tour of ALL_TOURS) {
    for (const step of tour.steps) {
      if (step.expect?.kind === "value") assert.doesNotMatch(step.expect.match, /\\S\{\d+,\}/, `${tour.id}.${step.id} uses a run-length rule`);
    }
  }
});

test("a click on the dimmed page is a miss only when the step waits for an action", () => {
  const clickStep = build.steps.find((step) => step.id === "code")!;
  const readingStep = build.steps.find((step) => step.id === "framework")!;
  const waitStep = build.steps.find((step) => step.id === "plan")!;
  assert.equal(clickOutcome(clickStep, "target"), "match");
  assert.equal(clickOutcome(clickStep, "scrim"), "miss");
  assert.equal(clickOutcome(clickStep, "tour"), "ignore");
  assert.equal(clickOutcome(readingStep, "scrim"), "ignore");
  assert.equal(clickOutcome(waitStep, "scrim"), "ignore", "nothing to get wrong while a run is working");
});

test("a correction names what was clicked, and a step's own line is used only for its look-alike", () => {
  const mode = build.steps.find((step) => step.id === "mode")!;
  const words = { wrong: "That's the framework picker.", targets: { "run-framework": "framework picker", "run-attach": "attach button" }, notQuite: (thing: string) => `That's the ${thing}.`, generic: "Not that one." };
  assert.equal(correctionFor(mode, "run-framework", words), "That's the framework picker.");
  assert.equal(correctionFor(mode, "run-attach", words), "That's the attach button.", "the framework line would be untrue here");
  assert.equal(correctionFor(mode, null, words), "Not that one.");
  assert.equal(correctionFor(mode, "run-mode", words), "Not that one.", "the target itself is never 'not that one' by name");
});

test("Do it for me is offered after two misses or an idle nudge", () => {
  assert.equal(offersHelp(0, false), false);
  assert.equal(offersHelp(1, false), false);
  assert.equal(offersHelp(2, false), true);
  assert.equal(offersHelp(0, true), true);
  assert.equal(IDLE_NUDGE_MS, 20_000);
});

test("offline, steps that need the API are skipped and counted, never silently", () => {
  const runIndex = firstLight.steps.findIndex((step) => step.id === "prompt");
  const offline = nextRunnableStep(firstLight, runIndex, false);
  assert.equal(firstLight.steps[offline.index]!.id, "visual");
  assert.equal(offline.skipped, 4, "run, watch, answer, saved");
  const online = nextRunnableStep(firstLight, runIndex, true);
  assert.equal(firstLight.steps[online.index]!.id, "run");
  assert.equal(online.skipped, 0);
  assert.deepEqual(nextRunnableStep(firstLight, firstLight.steps.length - 1, true), { index: -1, skipped: 0 });
});

test("a reader's own prompt is told apart from the suggested one", () => {
  const suggested = ["Build a Bell state circuit and verify its measured distribution."];
  assert.equal(classifyPrompt("", suggested), "empty");
  assert.equal(classifyPrompt("  build a bell state circuit and verify its measured distribution.\n", suggested), "suggested");
  assert.equal(classifyPrompt("Make a GHZ state on three qubits", suggested), "own");
});

test("progress survives a round trip through storage", () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) };
  const started = startTour(emptyProgress(), build);
  const moved = moveTo(started, build, 4);
  assert.equal(writeProgress(storage, moved), true);
  assert.ok(memory.has(TOUR_STORAGE_KEY));
  const back = readProgress(storage, tourById);
  assert.deepEqual(back.active, { track: "build", step: 4, paused: false, resume: null });
  assert.equal(back.furthest.build, 4);
  assert.equal(back.invite, "started");
});

test("stored progress that no longer makes sense is dropped or clamped", () => {
  assert.deepEqual(parseProgress("not json", tourById), emptyProgress());
  assert.deepEqual(parseProgress(JSON.stringify({ version: 2 }), tourById), emptyProgress());
  const stale = parseProgress(JSON.stringify({ version: 1, active: { track: "gone", step: 1 }, completed: ["gone", "read"], furthest: { build: 999 } }), tourById);
  assert.equal(stale.active, null);
  assert.deepEqual(stale.completed, ["read"]);
  assert.equal(stale.furthest.build, build.steps.length - 1);
  assert.equal(readProgress(null, tourById).active, null);
});

test("a Show-me started inside a track returns to that step when it ends", () => {
  const inBuild = moveTo(startTour(emptyProgress(), build), build, 7);
  const inShow = startTour(inBuild, showCirq, { returnTo: inBuild.active });
  assert.deepEqual(inShow.active?.resume, { track: "build", step: 7 });
  const done = finishTour(inShow, showCirq);
  assert.deepEqual(done.active, { track: "build", step: 7, paused: false, resume: null });
  assert.ok(done.completed.includes("show-cirq"));
});

test("status reads done, in progress and new; restart clears the check", () => {
  const done = finishTour(startTour(emptyProgress(), build), build);
  assert.equal(tourStatus(done, build).state, "done");
  const restarted = restartTour(done, build);
  assert.equal(tourStatus(restarted, build).state, "in-progress");
  assert.equal(restarted.completed.includes("build"), false);
  assert.equal(tourStatus(emptyProgress(), build).state, "new");
});

test("questions find the Show-me that answers them, in either language", () => {
  assert.equal(matchShow("How do I convert this to Cirq?"), "show-cirq");
  assert.equal(matchShow("Cirqに変換したい"), "show-cirq");
  assert.equal(matchShow("export the circuit as OpenQASM"), "show-export");
  assert.equal(matchShow("how much of my plan is left"), "show-usage");
  assert.equal(matchShow("ダークテーマにしたい"), "show-theme");
  assert.equal(matchShow("what is the meaning of life"), null);
  assert.equal(matchShow("   "), null);
});

test("the card lands beside the spotlight and never off screen", () => {
  const viewport = { width: 1280, height: 800 };
  const card = { width: 340, height: 180 };
  const hole = holeFor({ left: 20, top: 100, width: 200, height: 36 }, viewport);
  const right = placeCard(hole, card, "right", viewport);
  assert.equal(right.side, "right");
  assert.ok(right.left >= hole.left + hole.width);
  const cramped = placeCard(holeFor({ left: 0, top: 0, width: 360, height: 700 }, { width: 375, height: 812 }), card, "right", { width: 375, height: 812 });
  assert.ok(cramped.left >= 12 && cramped.left + card.width <= 375 - 12 + 0.001);
  assert.ok(cramped.top >= 12 && cramped.top + card.height <= 812 - 12 + 0.001);
  const centred = centreCard(card, viewport);
  assert.ok(centred.left > 0 && centred.top > 0);
});

test("every tour has at least one step and unique step ids", () => {
  for (const tour of ALL_TOURS) {
    assert.ok(tour.steps.length > 0, tour.id);
    assert.equal(new Set(tour.steps.map((step) => step.id)).size, tour.steps.length, `${tour.id} has duplicate step ids`);
    if (tour.kind === "show") assert.ok(tour.steps.length <= 3, `${tour.id}: a Show-me is three steps at most`);
  }
});
