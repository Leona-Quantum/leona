import assert from "node:assert/strict";
import { test } from "node:test";

import { verificationFromMetadata } from "./verification-record.ts";

// Trimmed verbatim from GET /v1/artifacts/{id}/versions/current in production on
// 2026-07-20 (the qiskit Bell artifact). Pinned to the real payload because the
// failure this guards against is not a crash — it is reading the wrong key and
// silently rendering "nothing recorded" for artifacts that have a full check list.
const REAL_VERSION_METADATA = {
  source: "verified_agent_candidate",
  openqasm_role: "interchange",
  candidate_revision: 1,
  verification_summary: {
    critic: {
      summary: "All checks pass. The implementation exactly matches the plan.",
      severity: "none",
      confidence: "high",
      residual_risks: [],
    },
    decision: "pass",
    deterministic_checks: [
      { method: "structural", result: "pass" },
      { method: "resource_contract", result: "pass" },
      { method: "measurement_policy", result: "pass" },
      { method: "native_optimization_evidence", result: "pass" },
      { method: "return_contract", result: "pass" },
      { method: "exact", result: "pass" },
      { method: "statistical", result: "pass" },
      { method: "statistical_reproducibility", result: "pass" },
    ],
  },
  canonical_representation: "framework_code",
};

test("reads every check the verifier recorded on a real saved version", () => {
  const record = verificationFromMetadata(REAL_VERSION_METADATA);
  assert.equal(record.checks?.length, 8);
  assert.deepEqual(record.checks?.[5], { method: "exact", result: "pass" });
  assert.match(record.criticSummary ?? "", /All checks pass/);
});

test("keeps a failing check rather than reporting only the passes", () => {
  const record = verificationFromMetadata({
    verification_summary: {
      deterministic_checks: [
        { method: "return_contract", result: "pass" },
        { method: "exact", result: "fail" },
      ],
    },
  });
  assert.deepEqual(record.checks, [
    { method: "return_contract", result: "pass" },
    { method: "exact", result: "fail" },
  ]);
});

test("degrades to nothing recorded instead of throwing on absent or malformed data", () => {
  for (const value of [null, undefined, "", 7, {}, { verification_summary: null }]) {
    assert.deepEqual(verificationFromMetadata(value), {});
  }
  // Older versions predate the stored check list; the tab must fall back to prose
  // rather than render an empty list that reads as "no checks ran".
  assert.equal(verificationFromMetadata({ verification_summary: {} }).checks, undefined);
  assert.equal(
    verificationFromMetadata({ verification_summary: { deterministic_checks: [{ method: 1 }] } })
      .checks,
    undefined,
  );
});
