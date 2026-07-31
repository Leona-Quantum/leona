import assert from "node:assert/strict";
import { test } from "node:test";

import {
  runActivityFromEvents,
  type RunActivityEvent,
} from "./run-activity.ts";

const queued: RunActivityEvent = { type: "run.queued", mode: "execute" };

test("projects low-level verification events into one semantic activity", () => {
  const activity = runActivityFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "VQE", framework: "qiskit" } },
      { type: "code.generated", revision: 1, language: "python", code: "print('ok')" },
      { type: "screen.result", lint_ok: true, typecheck_ok: true },
      { type: "resource.estimate", phase: "pre_verify", metrics: { qubits: 2 } },
      { type: "sandbox.result", phase: "verification", exit_code: 0, duration_ms: 1200 },
      { type: "verification.result", method: "return_contract", result: "pass" },
      { type: "verification.result", method: "exact_diag", result: "pass" },
      { type: "verification.semantic_review", decision: "ready" },
    ],
    false,
  );

  assert.deepEqual(
    activity?.items.map((item) => item.id),
    ["plan", "code", "checks", "execution", "verification"],
  );
  const verification = activity?.items.find((item) => item.id === "verification");
  assert.equal(verification?.status, "2/2 passed");
  assert.equal(verification?.state, "done");
  assert.equal(verification?.detail.kind, "verification");
  if (verification?.detail.kind === "verification") {
    assert.equal(verification.detail.eventIndices.length, 2);
  }
});

test("shows the verifier as active after sandbox execution without duplicating the run card", () => {
  const activity = runActivityFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "VQE" } },
      { type: "code.generated", revision: 1 },
      { type: "sandbox.result", phase: "verification", exit_code: 0 },
      { type: "stage.started", stage: "verify" },
    ],
    true,
  );

  assert.equal(activity?.headline, "Checking the result against the declared evidence");
  assert.equal(
    activity?.items.find((item) => item.id === "execution")?.state,
    "done",
  );
  assert.equal(
    activity?.items.find((item) => item.id === "verification")?.state,
    "active",
  );
  assert.equal(
    activity?.items.find((item) => item.id === "verification")?.defaultOpen,
    undefined,
  );
});

test("keeps repair revisions as attempt history instead of unexplained candidate cards", () => {
  const activity = runActivityFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "VQE", framework: "qiskit" } },
      { type: "code.generated", revision: 1, code: "bad()" },
      { type: "sandbox.result", phase: "verification", exit_code: 1 },
      { type: "code.generated", revision: 2, code: "better()" },
      { type: "verification.result", method: "exact_diag", result: "fail" },
      { type: "verification.semantic_review", decision: "code_repair" },
      { type: "code.generated", revision: 3, code: "best()" },
      { type: "stage.started", stage: "screen" },
    ],
    true,
  );

  const code = activity?.items.find((item) => item.id === "code");
  assert.equal(code?.status, "Revision 3");
  assert.match(code?.title ?? "", /3 revisions/);
  assert.equal(code?.detail.kind, "code");
  if (code?.detail.kind === "code") {
    assert.deepEqual(
      code.detail.attempts.map(({ revision, status }) => [revision, status]),
      [
        [1, "Repair requested"],
        [2, "Repair requested"],
        [3, "Selected"],
      ],
    );
  }
  assert.equal(
    activity?.items.find((item) => item.id === "checks")?.state,
    "active",
  );
});

test("preserves a best-effort result and never claims the package is already in Vault", () => {
  const activity = runActivityFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "VQE" } },
      { type: "code.generated", revision: 1, code: "candidate()" },
      { type: "sandbox.result", phase: "verification", exit_code: 0 },
      { type: "verification.result", method: "exact_diag", result: "fail" },
      {
        type: "run.best_effort",
        revision: 3,
        candidates_considered: 4,
        critic_summary: "Energy tolerance was not met.",
      },
      {
        type: "run.error",
        reason_code: "candidate_budget_exhausted",
        message: "candidate_budget_exhausted",
      },
      { type: "run.finished", status: "failed" },
    ],
    false,
  );

  assert.equal(activity?.label, "Run complete with limits");
  assert.equal(activity?.headline, "Best available result preserved");
  const code = activity?.items.find((item) => item.id === "code");
  assert.equal(code?.status, "Revision 3");
  assert.match(code?.title ?? "", /4 candidates considered/);
  const finalize = activity?.items.find((item) => item.id === "finalize");
  assert.equal(finalize?.state, "warn");
  assert.equal(finalize?.status, "Best available");
  assert.doesNotMatch(JSON.stringify(activity), /Vault/);
});

test("labels materialization as packaging rather than claiming the user kept it", () => {
  const activity = runActivityFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "VQE" } },
      { type: "code.generated", revision: 1 },
      { type: "artifact.saved", artifact_id: "artifact-1" },
      { type: "run.finished", status: "succeeded" },
    ],
    false,
  );

  const finalize = activity?.items.find((item) => item.id === "finalize");
  assert.equal(finalize?.status, "Packaged");
  assert.match(finalize?.title ?? "", /package is ready/i);
  assert.doesNotMatch(JSON.stringify(activity), /Vault/);
});

test("ordinary chat remains a conversation without agent activity chrome", () => {
  assert.equal(
    runActivityFromEvents(
      [
        { type: "run.queued", mode: "chat" },
        { type: "chat.completed", status: "succeeded" },
      ],
      false,
    ),
    null,
  );
});

test("reports a cancelled execution as stopped rather than replaying", () => {
  const activity = runActivityFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "VQE" } },
      { type: "code.generated", revision: 1 },
      { type: "run.finished", status: "cancelled" },
    ],
    false,
  );

  assert.equal(activity?.label, "Run stopped");
  assert.equal(activity?.headline, "The run was cancelled before completion");
});

test("normalizes provider failures from the durable error code", () => {
  const activity = runActivityFromEvents(
    [
      queued,
      { type: "run.error", stage: "plan", code: "model_not_found" },
      { type: "run.finished", status: "failed" },
    ],
    false,
  );

  assert.equal(activity?.headline, "The configured model is unavailable");
  assert.equal(activity?.items[0]?.state, "error");
});

test("keeps an explicit error row when a stage fails before producing its result event", () => {
  const activity = runActivityFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "VQE", framework: "qiskit" } },
      {
        type: "run.error",
        stage: "generate",
        code: "provider_unavailable",
        message: "generation provider call failed",
      },
      { type: "run.finished", status: "failed" },
    ],
    false,
  );

  const generated = activity?.items.find((item) => item.id === "code");
  assert.equal(generated?.state, "error");
  assert.equal(generated?.status, "Generation failed");
  assert.equal(generated?.title, "No candidate source was recorded");
});
