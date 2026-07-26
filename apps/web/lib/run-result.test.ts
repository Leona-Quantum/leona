import assert from "node:assert/strict";
import { test } from "node:test";

import { runResultFromEvents } from "./run-result.ts";
import type { OutcomeEvent } from "./run-outcome.ts";

const succeeded = (
  extra: OutcomeEvent[] = [],
  verificationSummary?: unknown,
): OutcomeEvent[] => [
  { type: "run.queued", mode: "execute" },
  {
    type: "plan.produced",
    plan: {
      problem_summary: "Prepare and measure a Bell state",
      algorithm: "Bell",
      framework: "qiskit",
      expected_output_keys: ["counts"],
    },
  },
  { type: "code.generated", revision: 1, code: "print('bell')", language: "python" },
  ...extra,
  { type: "run.finished", status: "succeeded", verification_summary: verificationSummary },
];

test("a successful run leads with what it produced, not with a verdict", () => {
  const result = runResultFromEvents(
    succeeded([
      { type: "sandbox.result", result: { counts: { "00": 512, "11": 512 } } } as OutcomeEvent,
    ]),
  );

  assert.ok(result);
  assert.equal(result.summary, "Prepare and measure a Bell state");
  assert.equal(result.distribution?.shots, 1024);
  assert.deepEqual(
    result.distribution?.data.bars.map((bar) => bar.bitstring).sort(),
    ["00", "11"],
  );
  assert.equal(result.code?.source, "print('bell')");
});

test("scalar values are reported in the order the plan promised them", () => {
  const result = runResultFromEvents([
    { type: "run.queued", mode: "execute" },
    {
      type: "plan.produced",
      plan: {
        problem_summary: "H2 ground state",
        framework: "qiskit",
        expected_output_keys: ["energy_Ha", "iterations"],
      },
    },
    { type: "code.generated", revision: 2, code: "print('vqe')" },
    {
      type: "sandbox.result",
      result: { iterations: 34, energy_Ha: -1.1373061, notes: "converged" },
    } as OutcomeEvent,
    { type: "run.finished", status: "succeeded" },
  ]);

  assert.deepEqual(result?.values.map((value) => value.label), [
    "Energy Ha",
    "Iterations",
    "Notes",
  ]);
  assert.equal(result?.values[0].value, "-1.137306");
});

test("a distribution is found under whatever key the plan chose", () => {
  const result = runResultFromEvents(
    succeeded([
      { type: "sandbox.result", result: { histogram: { "000": 900, "111": 100 } } } as OutcomeEvent,
    ]),
  );

  assert.equal(result?.distribution?.shots, 1000);
  assert.equal(result?.distribution?.peakLabel, "000");
});

test("a run with no distribution still reports its values and code", () => {
  const result = runResultFromEvents(
    succeeded([{ type: "sandbox.result", result: { fidelity: 0.998 } } as OutcomeEvent]),
  );

  assert.equal(result?.distribution, null);
  assert.deepEqual(result?.values, [{ label: "Fidelity", value: "0.998" }]);
  assert.ok(result?.code);
});

test("a review that did not accept is marked, not hidden", () => {
  const result = runResultFromEvents(
    succeeded(
      [{ type: "sandbox.result", result: { counts: { "00": 1024 } } } as OutcomeEvent],
      {
        decision: "inconclusive",
        evidence_strength: "structural",
        reason_code: "trusted_evidence_without_review_acceptance",
        candidate_defect_observed: false,
        failure_class: null,
        retry_target: "none",
        semantic_review_decision: "code_repair",
        checks: [],
        unverified_claims: ["intent alignment"],
      },
    ),
  );

  // Distinguished by a LABEL, not by colour alone, and without naming the reviewer.
  assert.equal(result?.trust.tone, "warn");
  assert.equal(result?.trust.label, "Executed · needs attention");
  assert.deepEqual(result?.limitations, ["Intent Alignment"]);
});

test("a failed run produces no result view — the failure card owns that case", () => {
  assert.equal(
    runResultFromEvents([
      { type: "run.queued", mode: "execute" },
      { type: "run.finished", status: "failed" },
    ]),
    null,
  );
});

test("a failed verification still exposes protected results and best available code", () => {
  const result = runResultFromEvents([
    { type: "run.queued", mode: "execute" },
    {
      type: "plan.produced",
      plan: {
        problem_summary: "Estimate the H2 ground state",
        framework: "qiskit",
        expected_output_keys: ["energy_Ha"],
      },
    },
    { type: "code.generated", revision: 4, code: "print('revision 4')" },
    {
      type: "sandbox.result",
      result: { energy_Ha: -1.12 },
    } as OutcomeEvent,
    {
      type: "run.best_effort",
      revision: 4,
      code: "print('best revision 4')",
      language: "python",
      residual_risks: ["Energy missed the requested tolerance."],
    },
    {
      type: "run.finished",
      status: "failed",
      residual_risks: "Verification did not accept this candidate.",
    },
  ]);

  assert.ok(result);
  assert.equal(result.trust.label, "Best effort · not accepted");
  assert.equal(result.values[0]?.value, "-1.12");
  assert.equal(result.code?.label, "Best available code");
  assert.equal(result.code?.source, "print('best revision 4')");
  assert.deepEqual(result.limitations, [
    "Energy missed the requested tolerance.",
    "Verification did not accept this candidate.",
  ]);
});

test("a failed run never pairs an older revision's result with newer best-effort code", () => {
  const result = runResultFromEvents([
    { type: "run.queued", mode: "execute" },
    { type: "code.generated", revision: 1, code: "revision_one()" },
    { type: "sandbox.result", result: { energy_Ha: -1.137 } } as OutcomeEvent,
    { type: "code.generated", revision: 2, code: "revision_two()" },
    { type: "sandbox.result", result: null } as OutcomeEvent,
    {
      type: "run.best_effort",
      revision: 2,
      code: "revision_two()",
      language: "python",
    },
    { type: "run.finished", status: "failed" },
  ]);

  assert.ok(result);
  assert.deepEqual(result.values, []);
  assert.equal(result.distribution, null);
  assert.equal(result.code?.source, "revision_two()");
});

test("the result badge never advertises that a model did the reviewing", () => {
  const accepted = runResultFromEvents(
    succeeded([{ type: "sandbox.result", result: { counts: { "00": 1024 } } } as OutcomeEvent]),
  );

  assert.equal(accepted?.trust.label, "Executed");
  assert.doesNotMatch(JSON.stringify(accepted), /AI[- ]review/i);
});
