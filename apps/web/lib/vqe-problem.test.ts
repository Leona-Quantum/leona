import assert from "node:assert/strict";
import test from "node:test";
import { formatVqeProblem } from "./vqe-problem.ts";

test("formatVqeProblem keeps the RFC 9457 reason and request identity", () => {
  assert.equal(formatVqeProblem({
      title: "runtime readiness expired",
      reason_code: "vqe_runtime_readiness_stale",
      request_id: "req-123",
    }, "failed"),
    "runtime readiness expired [vqe_runtime_readiness_stale] (request req-123)",
  );
});

test("formatVqeProblem supports legacy detail while old routes are migrated", () => {
  assert.equal(formatVqeProblem({ detail: "legacy failure" }, "failed"), "legacy failure");
});

test("formatVqeProblem does not stringify an unknown body", () => {
  assert.equal(formatVqeProblem({ input: "secret" }, "safe fallback"), "safe fallback");
});
