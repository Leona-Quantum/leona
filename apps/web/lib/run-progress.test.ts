import assert from "node:assert/strict";
import { test } from "node:test";

import { runProgressFromEvents, type ProgressEvent } from "./run-progress.ts";

const queued: ProgressEvent = { type: "run.queued", mode: "execute" };

test("projects the fixed circuit pipeline into five calm product stages", () => {
  const progress = runProgressFromEvents(
    [
      queued,
      {
        type: "plan.produced",
        plan: { algorithm: "Bell", framework: "qiskit", qubits_estimate: 2 },
      },
      { type: "code.generated", revision: 1 },
    ],
    true,
  );

  assert.equal(progress?.label, "Run in progress");
  assert.equal(progress?.headline, "Run the candidate inside the sandbox");
  assert.deepEqual(
    progress?.items.map(({ id, state }) => [id, state]),
    [
      ["plan", "done"],
      ["generate", "done"],
      ["execute", "active"],
      ["review", "waiting"],
      ["save", "waiting"],
    ],
  );
});

test("a failed execution returns to Generate as one repair cycle", () => {
  const progress = runProgressFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "Bell" } },
      { type: "code.generated", revision: 1 },
      { type: "sandbox.result", exit_code: 1, duration_ms: 820 },
    ],
    true,
  );

  assert.equal(progress?.items.find((item) => item.id === "generate")?.state, "active");
  assert.match(
    progress?.items.find((item) => item.id === "generate")?.detail ?? "",
    /needs repair/,
  );
  assert.equal(progress?.items.find((item) => item.id === "execute")?.state, "waiting");
});

test("successful terminal replay is stable and fully complete", () => {
  const progress = runProgressFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "Bell" } },
      { type: "code.generated", revision: 1 },
      { type: "sandbox.result", exit_code: 0, duration_ms: 1200 },
      { type: "verification.semantic_review", decision: "ready" },
      { type: "artifact.saved", artifact_id: "artifact-1" },
      { type: "run.finished", status: "succeeded" },
    ],
    false,
  );

  assert.equal(progress?.label, "Run complete");
  assert.equal(progress?.headline, "Circuit generated, executed, reviewed, and saved");
  assert.ok(progress?.items.every((item) => item.state === "done"));
  assert.equal(
    progress?.items.find((item) => item.id === "execute")?.detail,
    "Sandbox completed in 1.2 s",
  );
});

test("run error immediately marks the owning stage without waiting for terminal replay", () => {
  const progress = runProgressFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "Bell" } },
      {
        type: "run.error",
        stage: "generate",
        message: "generation provider unavailable (deepseek:rate_limited, HTTP 429)",
      },
    ],
    false,
  );

  assert.equal(progress?.label, "Run needs attention");
  assert.equal(progress?.items.find((item) => item.id === "generate")?.state, "error");
  assert.equal(progress?.headline, "The model provider is temporarily rate-limited");
});

test("simple-pipeline aggregate error stages map to the correct visible row", () => {
  const progress = runProgressFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "Bell" } },
      { type: "code.generated", revision: 1 },
      { type: "run.error", stage: "execute", message: "sandbox unavailable" },
      { type: "run.finished", status: "failed" },
    ],
    false,
  );

  assert.equal(progress?.items.find((item) => item.id === "execute")?.state, "error");
  assert.equal(progress?.items.find((item) => item.id === "review")?.state, "waiting");
});

test("a successful replay without an artifact does not claim Save completed", () => {
  const progress = runProgressFromEvents(
    [
      queued,
      { type: "plan.produced", plan: { algorithm: "Bell" } },
      { type: "code.generated", revision: 1 },
      { type: "sandbox.result", exit_code: 0 },
      { type: "run.finished", status: "succeeded" },
    ],
    false,
  );

  assert.equal(progress?.headline, "Circuit generated, executed, and reviewed");
  assert.equal(progress?.items.find((item) => item.id === "save")?.state, "stopped");
  assert.equal(progress?.items.find((item) => item.id === "save")?.detail, "No artifact was saved");
});

test("ordinary chat events do not gain a circuit progress card", () => {
  assert.equal(
    runProgressFromEvents(
      [
        { type: "run.queued", mode: "chat" },
        { type: "chat.completed", status: "succeeded" },
      ],
      false,
    ),
    null,
  );
});
