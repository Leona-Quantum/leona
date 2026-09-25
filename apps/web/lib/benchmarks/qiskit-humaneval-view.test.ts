/**
 * ai-ops 372. Proves what the `/benchmarks` page depends on, against the
 * real exported functions rather than by reading the JSX:
 *
 *  1. A pending run never yields a number — `completedRunFacts` returns
 *     `null` for it and `isRunPendingForDisplay` is true, which is what the
 *     page reads to render "Re-run in progress" instead of a score. Tested
 *     against a synthetic fixture (`PENDING_FIXTURE` below), not the shipped
 *     data — both shipped runs are complete as of the 2026-09-25 re-run, so
 *     this is the only way to exercise the pending branch at all, and it
 *     keeps these assertions correct regardless of the shipped runs' own
 *     state.
 *  2. The headline always tracks the latest COMPLETED run, skipping over a
 *     pending one even when the pending one is chronologically last.
 *  3. The shipped data reproduces both runs' real, published numbers.
 *
 * `page.tsx` cannot be loaded by `node --test` at all (it is an async Server
 * Component with extensionless imports and JSX — see `public-title.test.ts`'s
 * header for the standing reason this repository tests the page's logic in a
 * sibling `lib/` module instead), so this file is the render test the task
 * calls for, exercising the exact functions the page calls with the exact
 * data the page ships with.
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
  firstAndLatestCompletedFacts,
  formatTemplate,
  formatWallTimeHours,
  headlineFacts,
  isRunPendingForDisplay,
  latestCompletedRun,
} from "./qiskit-humaneval-view.ts";

/** A synthetic pending run, shaped exactly like a real one, for exercising the pending branch in isolation. */
const PENDING_FIXTURE: QiskitHumanEvalRun = {
  date: "2099-01-01",
  label: "Synthetic pending run (test fixture, never shipped)",
  model: "deepseek-v4-pro",
  pipelineCommit: null,
  datasetCommit: null,
  passed: null,
  total: null,
  gradable: null,
  passedOfGradable: null,
  spendUsd: null,
  wallTimeHours: null,
  notes: "test fixture",
  pending: true,
};

test("the shipped data file has both runs complete as of the 2026-09-25 re-run", () => {
  assert.equal(QISKIT_HUMANEVAL_RUNS.length, 2, "this test's other assertions assume the shipped two-run shape");
  for (const run of QISKIT_HUMANEVAL_RUNS) {
    assert.equal(run.pending, false, `${run.label} should be complete, not pending`);
    assert.equal(isRunPendingForDisplay(run), false, `${run.label} should not render as pending`);
  }
});

test("a pending run carries no number field — the page has nothing to invent", () => {
  assert.equal(PENDING_FIXTURE.passed, null);
  assert.equal(PENDING_FIXTURE.total, null);
  assert.equal(PENDING_FIXTURE.gradable, null);
  assert.equal(PENDING_FIXTURE.passedOfGradable, null);
  assert.equal(PENDING_FIXTURE.spendUsd, null);
  assert.equal(PENDING_FIXTURE.wallTimeHours, null);
  assert.equal(completedRunFacts(PENDING_FIXTURE), null, "completedRunFacts must refuse a pending run");
  assert.equal(isRunPendingForDisplay(PENDING_FIXTURE), true, "the history table row must render as pending");
});

test("completedRunFacts reproduces the first run's own published numbers (2026-09-23, before the fix)", () => {
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
});

test("completedRunFacts reproduces the second run's own published numbers (2026-09-25, after the fix)", () => {
  const secondRun = QISKIT_HUMANEVAL_RUNS[1];
  const facts = completedRunFacts(secondRun);
  assert.ok(facts, "the second run is complete and must produce facts");
  // Copied from the re-run's own report JSON / README
  // (ai-ops/desk/leona/plans/strategy-20260921/benchmark-runs-20260923/rerun-20260925/README.md):
  // "85/151 passed (56.3%)" and "75/106 (70.8%)" against the sandbox ceiling.
  assert.equal(facts.passed, 85);
  assert.equal(facts.total, 151);
  assert.equal(facts.gradable, 106);
  assert.equal(facts.passedOfGradable, 75);
  assert.equal(facts.passRatePct, 56.3, "85/151 must compute to the README's own 56.3%");
  assert.equal(facts.gradableRatePct, 70.8, "75/106 must compute to the README's own 70.8%");
  assert.equal(secondRun.pipelineCommit, "dbdddd5ff6323ca55b45944e8088def4239ec0d6", "PR 1010's merged dev commit");
  assert.equal(secondRun.spendUsd, 4.8147);
});

test("latestCompletedRun returns the newest completed run, and skips a trailing pending one", () => {
  assert.equal(latestCompletedRun(QISKIT_HUMANEVAL_RUNS), QISKIT_HUMANEVAL_RUNS[1], "both shipped runs are complete, so the newest one wins");
  assert.equal(latestCompletedRun([]), null);
  assert.equal(latestCompletedRun([PENDING_FIXTURE]), null, "no completed run anywhere must yield null, not a guess");
  assert.equal(
    latestCompletedRun([QISKIT_HUMANEVAL_RUNS[0], PENDING_FIXTURE]),
    QISKIT_HUMANEVAL_RUNS[0],
    "a trailing pending run must not shadow an earlier completed one",
  );
});

test("headlineFacts tracks whichever run is the newest COMPLETED one, not just the last array entry", () => {
  // Today: both shipped runs are complete, so the headline is the second (newest) one's facts.
  assert.deepEqual(headlineFacts(QISKIT_HUMANEVAL_RUNS), completedRunFacts(QISKIT_HUMANEVAL_RUNS[1]));

  // A future third run, still in progress, must not move the headline onto it.
  const withInProgressThirdRun = [...QISKIT_HUMANEVAL_RUNS, PENDING_FIXTURE];
  assert.deepEqual(
    headlineFacts(withInProgressThirdRun),
    completedRunFacts(QISKIT_HUMANEVAL_RUNS[1]),
    "a trailing pending run must not become the headline",
  );

  // Once that third run finishes, the headline must move to it automatically
  // — simulated here without touching the shipped file. Values are
  // fabricated for this test only, not shipped anywhere.
  const thirdRunFinished: QiskitHumanEvalRun = {
    ...PENDING_FIXTURE,
    pending: false,
    passed: 90,
    total: 151,
    gradable: 106,
    passedOfGradable: 80,
    spendUsd: 6.5,
    wallTimeHours: 2.5,
  };
  const withFinishedThirdRun = [...QISKIT_HUMANEVAL_RUNS, thirdRunFinished];
  const headline = headlineFacts(withFinishedThirdRun);
  assert.ok(headline);
  assert.equal(headline.passed, 90, "the headline must move to the newer completed run, not stay on the second");
  assert.equal(isRunPendingForDisplay(thirdRunFinished), false);
});

test("firstAndLatestCompletedFacts compares the very first run against the newest completed one", () => {
  const comparison = firstAndLatestCompletedFacts(QISKIT_HUMANEVAL_RUNS);
  assert.ok(comparison);
  assert.deepEqual(comparison.first, completedRunFacts(QISKIT_HUMANEVAL_RUNS[0]));
  assert.deepEqual(comparison.latest, completedRunFacts(QISKIT_HUMANEVAL_RUNS[1]));
  assert.equal(comparison.first.passed, 68);
  assert.equal(comparison.latest.passed, 85, "the score moved from 68 to 85 after the review-step fix");
  assert.equal(comparison.first.passedOfGradable, 64);
  assert.equal(comparison.latest.passedOfGradable, 75);

  assert.equal(firstAndLatestCompletedFacts([]), null, "no runs at all must yield null, not a guess");
  assert.equal(
    firstAndLatestCompletedFacts([PENDING_FIXTURE]),
    null,
    "a first run that is itself still pending must yield null",
  );
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

test("formatWallTimeHours rounds to 2 decimal places — the one place this number is rounded", () => {
  assert.equal(formatWallTimeHours(QISKIT_HUMANEVAL_RUNS[0].wallTimeHours ?? NaN), "2.46");
  assert.equal(formatWallTimeHours(QISKIT_HUMANEVAL_RUNS[1].wallTimeHours ?? NaN), "1.84");
  // The data file itself stores full precision, not the rounded display value.
  assert.notEqual(QISKIT_HUMANEVAL_RUNS[0].wallTimeHours, 2.46);
  assert.notEqual(QISKIT_HUMANEVAL_RUNS[1].wallTimeHours, 1.84);
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
