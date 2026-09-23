import assert from "node:assert/strict";
import test from "node:test";

import { TOUR_SHOW_IDS, TOUR_TRACK_IDS } from "./types.ts";
import { ALL_TOURS } from "./tracks.ts";
import { TOUR_SIGNAL_KINDS, TOUR_SIGNAL_NO_STEP } from "./signal.ts";

/**
 * Drift test for `POST /v1/tour-signals` (ai-ops 326): the API accepts a
 * `track`/`step`/`kind` only when each is in a fixed, hand-maintained set —
 * `services/api/src/majorana_api/tour_signal_vocabulary.py`'s `KNOWN_TRACKS`,
 * `KNOWN_STEPS` and `TOUR_SIGNAL_KINDS` — because it takes no credential and
 * bounding cardinality is the whole of its defence against an anonymous
 * caller storing arbitrary strings forever.
 *
 * That Python module cannot be imported from a bare `node --test` run, so
 * this test does the other half of the job the module's own docstring
 * describes: DERIVE the tour vocabulary that actually exists today, straight
 * from `tracks.ts` and `types.ts` (never a second hand-copied list on this
 * side either), and assert it equals a literal MIRROR of the Python module,
 * transcribed below and dated. Add a step to `tracks.ts` — or a kind to
 * `signal.ts` — without updating the mirror here AND in
 * `tour_signal_vocabulary.py`, and this goes red; the reverse (widening
 * either Python file, or this mirror, without a matching tour) goes red the
 * same way, because every assertion is set equality, not subset.
 *
 * Mutation-tested: adding a fake step id to `tracks.ts` (or removing one from
 * the mirror below) turns `DERIVED_STEPS` and `MIRRORED_STEPS` unequal and
 * this file's tests fail — see the PR body for the exact mutation run.
 */

// ---------------------------------------------------------------------------
// The mirror. Mechanically transcribed from
// services/api/src/majorana_api/tour_signal_vocabulary.py on 2026-09-23 —
// update BOTH files together when a tour changes.
// ---------------------------------------------------------------------------

const MIRRORED_TRACKS: readonly string[] = [
  "around",
  "first-light",
  "build",
  "teach",
  "read",
  "show-cirq",
  "show-visual",
  "show-simulate",
  "show-export",
  "show-mode",
  "show-framework",
  "show-attach",
  "show-usage",
  "show-theme",
  "show-lesson",
  "show-qapp",
  "show-atlas",
];

const MIRRORED_STEPS: readonly string[] = [
  "account",
  "answer",
  "attach",
  "brief",
  "code",
  "convert",
  "course",
  "courses",
  "create",
  "entry",
  "export",
  "fields",
  "filters",
  "framework",
  "gates",
  "hello",
  "make",
  "map",
  "mode",
  "new-chat",
  "options",
  "plan",
  "playhead",
  "preferences",
  "prompt",
  "qapps",
  "rail",
  "result",
  "run",
  "save",
  "saved",
  "search",
  "settings",
  "simulation",
  "source",
  "split",
  "starter",
  "studio",
  "summary",
  "tours",
  "usage",
  "visual",
  "watch",
];

const MIRRORED_KINDS: readonly string[] = [
  "tour_started",
  "step_done",
  "step_skipped",
  "did_it_for_me",
  "offline_skip",
  "tour_done",
  "tour_left",
  "step_missed",
  "ask_show_me",
  "ask_nala",
];

// ---------------------------------------------------------------------------
// The derivation, from the live source of truth.
// ---------------------------------------------------------------------------

function derivedTracks(): Set<string> {
  return new Set<string>([...TOUR_TRACK_IDS, ...TOUR_SHOW_IDS]);
}

function derivedSteps(): Set<string> {
  const steps = new Set<string>();
  for (const tour of ALL_TOURS) {
    for (const step of tour.steps) steps.add(step.id);
  }
  return steps;
}

test("every track and show id in tracks.ts/types.ts is in the API's mirror", () => {
  assert.deepEqual(derivedTracks(), new Set(MIRRORED_TRACKS));
});

test("every step id anywhere in tracks.ts is in the API's mirror", () => {
  assert.deepEqual(derivedSteps(), new Set(MIRRORED_STEPS));
});

test("signal.ts's ten kinds are exactly the API's mirror", () => {
  assert.deepEqual(new Set(TOUR_SIGNAL_KINDS), new Set(MIRRORED_KINDS));
});

test("the mirror lists have no duplicate and no accidental overlap with the sentinel", () => {
  assert.equal(MIRRORED_TRACKS.length, new Set(MIRRORED_TRACKS).size);
  assert.equal(MIRRORED_STEPS.length, new Set(MIRRORED_STEPS).size);
  assert.equal(MIRRORED_KINDS.length, new Set(MIRRORED_KINDS).size);
  // TOUR_SIGNAL_NO_STEP ("_track") marks a track-level signal and is
  // deliberately outside the real step vocabulary — see its own docstring in
  // signal.ts. If a future real step were ever literally named "_track" this
  // assertion is what would notice the collision before the drift test above
  // started passing for the wrong reason.
  assert.ok(!MIRRORED_STEPS.includes(TOUR_SIGNAL_NO_STEP));
  assert.ok(!derivedSteps().has(TOUR_SIGNAL_NO_STEP));
});

test("track ids and show ids do not collide with each other", () => {
  // KNOWN_TRACKS on the API side is one flat set of both; if a track and a
  // show ever shared an id, `tourById`'s Map in tracks.ts would already have
  // silently dropped one tour, which is a worse failure than this one and a
  // reason to fail loudly here too.
  assert.equal(TOUR_TRACK_IDS.length + TOUR_SHOW_IDS.length, derivedTracks().size);
});
