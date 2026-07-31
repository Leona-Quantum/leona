import assert from "node:assert/strict";
import { test } from "node:test";

import { runOutcomeFromEvents, type OutcomeEvent } from "./run-outcome.ts";

const queued: OutcomeEvent = { type: "run.queued", mode: "execute" };

const baseSummary = {
  decision: "pass",
  evidence_strength: "physical",
  reason_code: "all_required_checks_passed",
  candidate_defect_observed: false,
  failure_class: null,
  retry_target: "none",
  semantic_review_decision: "ready",
  checks: [{ method: "structural", result: "pass" }],
  unverified_claims: [],
};

test("a fresh failed run without a summary is not mislabeled as legacy", () => {
  const outcome = runOutcomeFromEvents([
    queued,
    { type: "plan.produced", plan: { problem_summary: "Prepare a Bell state", framework: "qiskit" } },
    { type: "code.generated", revision: 1, code: "print('candidate')" },
    {
      type: "run.best_effort",
      revision: 2,
      candidates_considered: 3,
      failed_checks: ["structural"],
      critic_summary: "The entangling operation is missing.",
      code: "print('best effort')",
      language: "python",
    },
    {
      type: "run.error",
      stage: "verify",
      code: "candidate_budget_exhausted",
      message: "intent review did not align the candidate",
    },
    { type: "run.finished", status: "failed" },
  ]);

  assert.equal(outcome?.eyebrow, "Best available result");
  assert.equal(outcome?.title, "The strongest candidate was preserved");
  assert.equal(outcome?.callout?.title, "Why it was not accepted");
  assert.equal(outcome?.tone, "warn");
  assert.equal(outcome?.code?.source, "print('best effort')");
  assert.doesNotMatch(JSON.stringify(outcome), /Legacy/);
});

test("provider failures use stable user-facing copy", () => {
  const outcome = runOutcomeFromEvents([
    queued,
    { type: "plan.produced", plan: { problem_summary: "Prepare a Bell state" } },
    {
      type: "run.error",
      stage: "generate",
      message: "planner provider call failed (deepseek:rate_limited, HTTP 429)",
    },
    { type: "run.finished", status: "failed" },
  ]);

  assert.equal(outcome?.title, "Generation could not complete");
  assert.equal(
    outcome?.callout?.body,
    "The model provider is temporarily rate-limited. Retry in a moment.",
  );
  assert.doesNotMatch(JSON.stringify(outcome), /HTTP 429/);
});

test("worker verify-stage failures are presented as review failures", () => {
  const outcome = runOutcomeFromEvents([
    queued,
    { type: "plan.produced", plan: { problem_summary: "Run Grover search" } },
    { type: "code.generated", revision: 1, code: "FINAL_CIRCUIT = object()" },
    {
      type: "run.best_effort",
      revision: 3,
      candidates_considered: 3,
      code: "FINAL_CIRCUIT = object()",
    },
    { type: "run.error", stage: "verify", message: "review could not accept the candidate" },
    { type: "run.finished", status: "failed" },
  ]);

  assert.equal(
    outcome?.callout?.body,
    "Review stopped before the step completed.",
  );
});

test("invalid reviewer output explains that a new run retries it", () => {
  const outcome = runOutcomeFromEvents([
    queued,
    { type: "plan.produced", plan: { problem_summary: "Run amplitude estimation" } },
    { type: "run.error", stage: "verify", message: "intent reviewer returned invalid structured data" },
    { type: "run.finished", status: "failed" },
  ]);

  assert.equal(
    outcome?.callout?.body,
    "The reviewer response could not be read. New runs retry this case automatically.",
  );
});

test("only successful records without a typed summary are legacy", () => {
  const outcome = runOutcomeFromEvents([
    queued,
    { type: "plan.produced", plan: { problem_summary: "Prepare a Bell state" } },
    { type: "run.finished", status: "succeeded" },
  ]);

  assert.equal(outcome?.eyebrow, "Legacy result");
  assert.equal(outcome?.title, "Verification evidence is unavailable");
});

// Naming the reviewer invites the reader to discount the result on the strength of
// the reviewer rather than the evidence. The limits stay stated; the badge reports
// what the run did, not who checked it.
test("the simple pipeline is presented as executed and explicitly unverified", () => {
  const outcome = runOutcomeFromEvents([
    queued,
    {
      type: "plan.produced",
      plan: {
        problem_summary: "Prepare a Bell state",
        algorithm: "Bell",
        framework: "qiskit",
      },
    },
    { type: "code.generated", revision: 1, code: "FINAL_CIRCUIT = object()" },
    { type: "artifact.saved", artifact_id: "artifact-1" },
    {
      type: "run.finished",
      status: "succeeded",
      verification_summary: {
        ...baseSummary,
        decision: "inconclusive",
        evidence_strength: "structural",
        reason_code: "ai_review_aligned",
        failure_class: "evidence_gap",
        checks: [
          { method: "structural", result: "pass" },
          { method: "return_contract", result: "pass" },
          { method: "success_criteria", result: "pass" },
        ],
        unverified_claims: ["quantum correctness", "optimality"],
      },
    },
  ]);

  assert.equal(outcome?.eyebrow, "Executed result");
  assert.doesNotMatch(JSON.stringify(outcome), /AI[- ]reviewed/i);
  assert.equal(outcome?.tone, "warn");
  assert.equal(outcome?.callout?.title, "Strict verification was not run");
  assert.match(outcome?.callout?.body ?? "", /Quantum Correctness/);
  assert.ok(outcome?.badges.some((badge) => badge.label === "Saved to Vault"));
  assert.deepEqual(
    outcome?.facts.map((fact) => fact.label),
    ["Algorithm", "Framework", "Revision"],
  );
});

test("physical pass renders as a verified result", () => {
  const outcome = runOutcomeFromEvents([
    queued,
    { type: "plan.produced", plan: { problem_summary: "Prepare a Bell state" } },
    { type: "artifact.saved", artifact_id: "artifact-1" },
    {
      type: "run.finished",
      status: "succeeded",
      verification_summary: baseSummary,
    },
  ]);

  assert.equal(outcome?.tone, "ok");
  assert.equal(outcome?.eyebrow, "Verified result");
  assert.equal(outcome?.title, "The circuit passed verification");
});

test("ordinary chat does not gain a run outcome card", () => {
  assert.equal(
    runOutcomeFromEvents([
      { type: "run.queued", mode: "chat" },
      { type: "chat.completed", status: "succeeded" },
      { type: "run.finished", status: "succeeded" },
    ]),
    null,
  );
});

// Payloads below are exactly what services/worker emits: `run.error` carries a
// machine-readable `code`, a prose `message` that does NOT contain that code, and a
// contracts `Stage` value. The previous fixture used {stage: "review", message:
// "candidate_budget_exhausted"} — a shape the worker cannot produce — which let every
// code-based mapping rot while the suite stayed green.
const failingRun = (error: OutcomeEvent): OutcomeEvent[] => [
  queued,
  { type: "plan.produced", plan: { problem_summary: "H2 ground state", framework: "qiskit" } },
  { type: "code.generated", revision: 1, code: "print('candidate')" },
  {
    type: "run.best_effort",
    revision: 4,
    candidates_considered: 4,
    failed_checks: ["success_criteria"],
    code: "print('best effort')",
    language: "python",
  },
  error,
  { type: "run.finished", status: "failed" },
];

test("real worker failure codes reach the user as an actionable reason", () => {
  const cases: Array<[OutcomeEvent, RegExp]> = [
    [
      { type: "run.error", stage: "verify", code: "candidate_budget_exhausted", message: "intent review did not align the candidate" },
      /repair attempts were used/i,
    ],
    [
      { type: "run.error", stage: "verify", code: "plan_budget_exhausted", message: "intent review did not align the candidate" },
      /replan budget ran out/i,
    ],
    [
      { type: "run.error", stage: "final_execute", code: "sandbox_provider_failed", message: "sandbox execution failed" },
      /sandbox could not run/i,
    ],
    [
      { type: "run.error", stage: "screen", code: "basic_contract_failed", message: "generated source did not satisfy the basic execution contract" },
      /result keys the plan promised/i,
    ],
    [
      { type: "run.error", stage: null, code: "run_timeout", message: "run exceeded its time budget" },
      /exceeded its time budget/i,
    ],
    [
      { type: "run.error", stage: "export", code: "export_persistence_failed", message: "could not persist the conversion" },
      /could not be recorded/i,
    ],
  ];

  for (const [error, expected] of cases) {
    const outcome = runOutcomeFromEvents(failingRun(error));
    assert.match(outcome?.callout?.body ?? "", expected, `code ${error.code}`);
    assert.doesNotMatch(
      outcome?.callout?.body ?? "",
      /stopped before the step completed/,
      `code ${error.code} fell through to the generic wording`,
    );
  }
});

test("an unmapped code still names the stage it stopped in", () => {
  const outcome = runOutcomeFromEvents(
    failingRun({ type: "run.error", stage: "verify", code: "some_future_code", message: "unknown" }),
  );

  assert.match(outcome?.callout?.body ?? "", /Review stopped before the step completed/);
});
