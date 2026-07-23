import assert from "node:assert/strict";
import { test } from "node:test";

import { artifactExportManifest } from "./artifact-export.ts";
import type { LibraryArtifact } from "./library-data.ts";

const BASE: LibraryArtifact = {
  id: "artifact-1", slug: "artifact-1", title: "Bell state", family: "Bell", framework: "qiskit",
  status: "inconclusive", updatedAt: "2026-07-23T00:00:00Z", description: "", tags: [], verification: "",
  code: "print('bell')", qasm: null, resourceRows: [], source: "run",
  verificationSummary: {
    decision: "inconclusive", evidence_strength: null, reason_code: "required_check_unavailable",
    candidate_defect_observed: false, failure_class: "capability_limit", retry_target: "none",
    semantic_review_decision: "ready", checks: [{ method: "ghz_state_property", result: "unavailable" }],
    unverified_claims: ["GHZ phase"],
  },
};

test("export preserves the authoritative verdict and warning", () => {
  const manifest = artifactExportManifest(BASE, { framework: "qiskit", code: BASE.code });
  assert.equal((manifest.verification_summary as { decision: string }).decision, "inconclusive");
  assert.match(String(manifest.verification_warning), /correctness has not been confirmed/);
});

test("legacy exports never default to Verified", () => {
  const manifest = artifactExportManifest({ ...BASE, status: "legacy_unknown", verificationSummary: null }, { framework: "qiskit", code: BASE.code });
  assert.equal(manifest.verification_summary, null);
  assert.match(String(manifest.verification_warning), /Do not treat this export as Verified/);
});

test("edited exports carry stale state instead of prior PASS evidence", () => {
  const manifest = artifactExportManifest({ ...BASE, status: "stale", verificationSummary: null }, { framework: "qiskit", code: "edited" });
  assert.equal(manifest.verification_state, "stale");
  assert.match(String(manifest.verification_warning), /stale because the source changed/);
});
