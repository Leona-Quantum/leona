import assert from "node:assert/strict";
import { test } from "node:test";

import { artifactFromResource, statusFromResource } from "./library-data.ts";

// Trimmed verbatim from GET /v1/artifacts in production on 2026-07-20. The grade
// fields are what the list resource has carried since the Vault list stopped
// fabricating "Verified"; Studio's own copy of this mapper never read them.
const PHYSICAL = {
  id: "019f7f2f-47ee-78ab-aafd-c1f6281589cf",
  slug: "run-019f7f2d09c9",
  title: "3-qubit quantum phase estimation",
  family: "QPE",
  framework: "qiskit",
  updated_at: "2026-07-20T11:02:00Z",
  current_version_id: "019f7f2f-4840-7f69-b70a-01f2fbd0785c",
  verifier_decision: "pass",
  evidence_strength: "physical",
};

const STRUCTURAL = { ...PHYSICAL, id: "structural-1", evidence_strength: "structural" };
const FAILED = { ...PHYSICAL, id: "failed-1", verifier_decision: "fail", evidence_strength: null };
const UNGRADED = (() => {
  const { verifier_decision, evidence_strength, ...rest } = PHYSICAL;
  void verifier_decision;
  void evidence_strength;
  return { ...rest, id: "ungraded-1" };
})();

test("a physically verified artifact reads as verified", () => {
  assert.equal(statusFromResource(PHYSICAL), "verified");
  assert.equal(artifactFromResource(PHYSICAL)[0].status, "verified");
});

test("a structural pass is not called verified", () => {
  // The whole point. Studio's mapper returned `existing?.status ?? "verified"`,
  // so any artifact this browser had not already cached was shown as Verified in
  // the Studio picker no matter what the pipeline actually proved.
  assert.equal(statusFromResource(STRUCTURAL), "structural");
  assert.equal(artifactFromResource(STRUCTURAL)[0].status, "structural");
});

test("a failed artifact does not inherit a grade from the server", () => {
  assert.equal(statusFromResource(FAILED), null);
});

test("an artifact the server cannot grade still falls back", () => {
  // A version saved before verification_summary existed. Null means "unknown",
  // not "failed", so the old fallback still applies — but only here.
  assert.equal(statusFromResource(UNGRADED), null);
  assert.equal(artifactFromResource(UNGRADED)[0].status, "verified");
});

test("a public reference keeps its caveat status", () => {
  const publicReference = { ...UNGRADED, id: "public-1", slug: "public-grover-3" };
  const artifact = artifactFromResource(publicReference)[0];
  assert.equal(artifact.status, "verified_caveats");
  assert.equal(artifact.source, "public");
});

test("a payload that is not an artifact yields nothing rather than a blank card", () => {
  assert.deepEqual(artifactFromResource(null), []);
  assert.deepEqual(artifactFromResource({ id: "no-title" }), []);
  assert.deepEqual(artifactFromResource("nope"), []);
});
