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
    { type: "run.error", stage: "review", message: "candidate_budget_exhausted" },
    { type: "run.finished", status: "failed" },
  ]);

  assert.equal(outcome?.eyebrow, "Run incomplete");
  assert.equal(outcome?.title, "No accepted result was produced");
  assert.equal(outcome?.callout?.title, "Starting point only");
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

test("the simple pipeline is presented as AI-reviewed and explicitly unverified", () => {
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

  assert.equal(outcome?.eyebrow, "AI-reviewed result");
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
