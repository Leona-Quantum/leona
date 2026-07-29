import assert from "node:assert/strict";
import { test } from "node:test";

import {
  recommendedVerificationAction,
  verificationFromMetadata,
  verificationFromResource,
  verificationSummaryFromValue,
} from "./verification-record.ts";

const SUMMARY = {
  decision: "inconclusive",
  evidence_strength: null,
  reason_code: "required_check_unavailable",
  candidate_defect_observed: false,
  failure_class: "capability_limit",
  retry_target: "verification",
  semantic_review_decision: "ready",
  checks: [
    { method: "return_contract", result: "pass" },
    { method: "statistical", result: "unavailable" },
    { method: "statistical_reproducibility", result: "error" },
  ],
  unverified_claims: ["Expected physical distribution"],
};

test("reads the complete typed API summary without inferring a verdict", () => {
  const summary = verificationFromResource({ verification_summary: SUMMARY });
  assert.equal(summary?.decision, "inconclusive");
  assert.deepEqual(summary?.checks, SUMMARY.checks);
  assert.deepEqual(summary?.unverified_claims, SUMMARY.unverified_claims);
  assert.match(recommendedVerificationAction(summary!), /same candidate revision/);
});

test("reads the simple pipeline outcome as typed inconclusive evidence, not legacy", () => {
  const summary = verificationSummaryFromValue({
    decision: "inconclusive",
    semantic_review_decision: "ready",
    evidence_strength: "structural",
    reason_code: "ai_review_aligned",
    candidate_defect_observed: false,
    failure_class: "evidence_gap",
    retry_target: "none",
    checks: [
      { method: "structural", result: "pass" },
      { method: "return_contract", result: "pass" },
    ],
    unverified_claims: ["quantum correctness", "physical fidelity", "optimality"],
  });

  assert.equal(summary?.decision, "inconclusive");
  assert.equal(summary?.reason_code, "ai_review_aligned");
  assert.equal(summary?.evidence_strength, "structural");
  assert.deepEqual(summary?.checks, [
    { method: "structural", result: "pass" },
    { method: "return_contract", result: "pass" },
  ]);
});

test("rejects malformed, partial, and dishonest inconclusive summaries", () => {
  for (const value of [
    null,
    {},
    { decision: "pass" },
    { ...SUMMARY, reason_code: "" },
    { ...SUMMARY, candidate_defect_observed: true },
    { ...SUMMARY, retry_target: "generate_more" },
  ]) {
    assert.equal(verificationSummaryFromValue(value), null);
  }
});

test("keeps bounded recognized checks and claims", () => {
  const summary = verificationSummaryFromValue({
    ...SUMMARY,
    checks: [...Array.from({ length: 60 }, () => ({ method: "return_contract", result: "pass" })), { method: 1, result: "pass" }],
    unverified_claims: Array.from({ length: 60 }, (_, index) => `claim-${index}`),
  });
  assert.equal(summary?.checks?.length, 50);
  assert.equal(summary?.unverified_claims?.length, 50);
});

test("legacy metadata remains displayable but never becomes a typed PASS", () => {
  const record = verificationFromMetadata({
    verification_summary: {
      decision: "pass",
      deterministic_checks: [
        { method: "return_contract", result: "pass" },
        { method: "exact", result: "fail" },
      ],
      critic: { summary: "Historical critic text" },
      evidence_strength: "physical",
    },
  });
  assert.equal(record.summary, null);
  assert.deepEqual(record.checks, [
    { method: "return_contract", result: "pass" },
    { method: "exact", result: "fail" },
  ]);
  assert.equal(record.criticSummary, "Historical critic text");
  assert.equal(record.evidenceStrength, "physical");
});

test("absent or malformed metadata degrades to unknown", () => {
  for (const value of [null, undefined, "", 7, {}, { verification_summary: null }]) {
    assert.deepEqual(verificationFromMetadata(value), { summary: null });
  }
});
