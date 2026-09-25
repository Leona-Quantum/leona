/**
 * ai-ops 372. Proves two things the `/benchmarks` page depends on, against
 * the real exported functions rather than by reading the JSX:
 *
 *  1. A pending run never yields a number — `completedRunFacts` returns
 *     `null` for it and `isRunPendingForDisplay` is true, which is what the
 *     page reads to render "Re-run in progress" instead of a score.
 *  2. The headline always tracks the latest COMPLETED run, skipping over a
 *     pending one even when the pending one is chronologically last.
 *
 * `page.tsx` cannot be loaded by `node --test` at all (it is an async Server
 * Component with extensionless imports and JSX — see `public-title.test.ts`'s
 * header for the standing reason this repository tests the page's logic in a
 * sibling `lib/` module instead), so this file is the render test the task
 * calls for, exercising the exact functions the page calls with the exact
 * placeholder data the page ships with.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  QISKIT_HUMANEVAL_CEILING,
  QISKIT_HUMANEVAL_CONTROLS,
  QISKIT_HUMANEVAL_RUNS,
  type QiskitHumanEvalRun,
} from "./qiskit-humaneval.ts";
import {
  completedRunFacts,
  formatTemplate,
  headlineFacts,
  isRunPendingForDisplay,
  latestCompletedRun,
} from "./qiskit-humaneval-view.ts";

test("the shipped data file has exactly one completed run and one pending run", () => {
  assert.equal(QISKIT_HUMANEVAL_RUNS.length, 2, "this test's other assertions assume the shipped two-run shape");
  assert.equal(QISKIT_HUMANEVAL_RUNS[0].pending, false);
  assert.equal(QISKIT_HUMANEVAL_RUNS[1].pending, true);
});

test("a pending run carries no number field — the page has nothing to invent", () => {
  const pending = QISKIT_HUMANEVAL_RUNS[1];
  assert.equal(pending.passed, null);
  assert.equal(pending.total, null);
  assert.equal(pending.gradable, null);
  assert.equal(pending.passedOfGradable, null);
  assert.equal(pending.spendUsd, null);
  assert.equal(pending.wallTimeHours, null);
  assert.equal(completedRunFacts(pending), null, "completedRunFacts must refuse a pending run");
  assert.equal(isRunPendingForDisplay(pending), true, "the history table row must render as pending");
});

test("completedRunFacts reproduces the first run's own published numbers, not invented ones", () => {
  const firstRun = QISKIT_HUMANEVAL_RUNS[0];
  const facts = completedRunFacts(firstRun);
  assert.ok(facts, "the first run is not pending and must produce facts");
  // Copied from the run's own report JSON / README
  // (ai-ops/desk/leona/plans/strategy-20260921/benchmark-runs-20260923/README.md):
  // "68/151 passed (45.0%)" and "against that 106-task ceiling: 64/106 (60.4%)".
  assert.equal(facts.passed, 68);
  assert.equal(facts.total, 151);
  assert.equal(facts.gradable, 106);
  assert.equal(facts.passedOfGradable, 64);
  assert.equal(facts.passRatePct, 45.0, "68/151 must compute to the README's own 45.0%");
  assert.equal(facts.gradableRatePct, 60.4, "64/106 must compute to the README's own 60.4%");
  assert.equal(isRunPendingForDisplay(firstRun), false);
});

test("latestCompletedRun skips a trailing pending run and returns the newest completed one", () => {
  assert.equal(latestCompletedRun(QISKIT_HUMANEVAL_RUNS), QISKIT_HUMANEVAL_RUNS[0]);
  assert.equal(latestCompletedRun([]), null);
  const allPending: QiskitHumanEvalRun[] = QISKIT_HUMANEVAL_RUNS.map((run) => ({ ...run, pending: true }));
  assert.equal(latestCompletedRun(allPending), null, "no completed run anywhere must yield null, not a guess");
});

test("headlineFacts tracks whichever run is the newest COMPLETED one, not just the last array entry", () => {
  // Today: run[1] is pending, so the headline must be run[0]'s facts.
  assert.deepEqual(headlineFacts(QISKIT_HUMANEVAL_RUNS), completedRunFacts(QISKIT_HUMANEVAL_RUNS[0]));

  // Once the re-run finishes, `pending` flips to false and its number fields
  // are filled in — simulated here without touching the shipped file, to
  // prove the headline moves to it automatically rather than needing a code
  // change. Values are fabricated for this test only, not shipped anywhere.
  const secondRunFinished: QiskitHumanEvalRun = {
    ...QISKIT_HUMANEVAL_RUNS[1],
    pending: false,
    passed: 90,
    total: 151,
    gradable: 106,
    passedOfGradable: 80,
    spendUsd: 6.5,
    wallTimeHours: 2.5,
  };
  const withFinishedRerun = [QISKIT_HUMANEVAL_RUNS[0], secondRunFinished];
  const headline = headlineFacts(withFinishedRerun);
  assert.ok(headline);
  assert.equal(headline.passed, 90, "the headline must move to the newer completed run, not stay on the first");
  assert.equal(isRunPendingForDisplay(secondRunFinished), false);
});

test("the sandbox ceiling adds up: gradable + blocked-for-IBM-cloud + blocked-for-file-write = total", () => {
  const { totalTasks, gradableTasks, blockedTasks, blockedNeedsIbmCloud, blockedNeedsFileWrite } = QISKIT_HUMANEVAL_CEILING;
  assert.equal(gradableTasks + blockedTasks, totalTasks);
  assert.equal(blockedNeedsIbmCloud + blockedNeedsFileWrite, blockedTasks);
});

test("the zero-spend controls match what the README records: canonical reproduces the ceiling, garbage scores zero", () => {
  assert.equal(QISKIT_HUMANEVAL_CONTROLS.stubCanonical.passed, QISKIT_HUMANEVAL_CEILING.gradableTasks);
  assert.equal(QISKIT_HUMANEVAL_CONTROLS.stubCanonical.total, QISKIT_HUMANEVAL_CEILING.totalTasks);
  assert.equal(QISKIT_HUMANEVAL_CONTROLS.stubGarbage.passed, 0);
  assert.equal(QISKIT_HUMANEVAL_CONTROLS.stubGarbage.total, QISKIT_HUMANEVAL_CEILING.totalTasks);
});

test("formatTemplate fills every token and leaves no {token} behind", () => {
  const filled = formatTemplate("{a} of {b} ({c}%)", { a: 68, b: 151, c: 45.0 });
  assert.equal(filled, "68 of 151 (45%)");
  assert.doesNotMatch(filled, /\{[a-zA-Z]+\}/, "an unfilled placeholder must never reach the page");
});

test("formatTemplate does not partially match one token name inside another", () => {
  // Regression guard: a naive global find of "{gradable}" must not also eat
  // "{gradableTasks}" or vice versa depending on substitution order.
  const filled = formatTemplate("{gradable} vs {gradableTasks}", { gradable: 106, gradableTasks: 106 });
  assert.equal(filled, "106 vs 106");
});
