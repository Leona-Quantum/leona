import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artifactExportFilename,
  artifactExportHeader,
  artifactExportManifest,
  artifactExportSource,
} from "./artifact-export.ts";
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

test("a failed artifact is the one export that must not leave without a warning", () => {
  // `fail` fell through every branch to `null`, so the header said FAIL while the
  // manifest's own warning field was empty. The repository holds failed-check
  // artifacts now, so this is a state a reader will actually meet.
  const failed: LibraryArtifact = {
    ...BASE,
    status: "failed",
    verificationSummary: {
      ...BASE.verificationSummary!,
      decision: "fail",
      candidate_defect_observed: true,
      failure_class: "candidate_defect",
      retry_target: "code_generation",
      reason_code: "deterministic_check_failed",
      checks: [{ method: "success_criteria", result: "fail" }],
    },
  };

  const manifest = artifactExportManifest(failed, { framework: "qiskit", code: BASE.code });

  assert.match(String(manifest.verification_warning), /Do not treat this export as working/);
  assert.match(artifactExportHeader(failed, "qiskit", AT), /FAILED/);
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

const AT = new Date("2026-07-26T10:00:00Z");

test("raw export filenames carry the framework so two exports cannot collide", () => {
  // Exporting the same circuit as Qiskit and as Cirq to compare them must not
  // produce two files with the same name.
  assert.equal(artifactExportFilename(BASE, "qiskit"), "artifact-1.qiskit.py");
  assert.equal(artifactExportFilename(BASE, "cirq"), "artifact-1.cirq.py");
  assert.notEqual(artifactExportFilename(BASE, "qiskit"), artifactExportFilename(BASE, "cirq"));
});

test("OpenQASM exports get the .qasm extension, not .py", () => {
  assert.equal(artifactExportFilename(BASE, "openqasm3"), "artifact-1.openqasm3.qasm");
});

test("the provenance header comments in the target language", () => {
  // A `#` header would be a syntax error in OpenQASM, so the exported file
  // would not parse — the header must never cost the file its runnability.
  assert.ok(artifactExportHeader(BASE, "qiskit", AT).split("\n").every((l) => l.startsWith("#")));
  assert.ok(artifactExportHeader(BASE, "openqasm3", AT).split("\n").every((l) => l.startsWith("//")));
});

test("the header states an unconfirmed verdict rather than omitting it", () => {
  // The dangerous export is the one that quietly drops a missing or failed
  // verdict and reads as ordinary working code.
  assert.match(artifactExportHeader(BASE, "qiskit", AT), /INCONCLUSIVE/);
  assert.match(
    artifactExportHeader({ ...BASE, status: "stale", verificationSummary: null }, "qiskit", AT),
    /STALE/,
  );
  assert.match(
    artifactExportHeader({ ...BASE, status: "legacy_unknown", verificationSummary: null }, "qiskit", AT),
    /NONE — no typed verification evidence/,
  );
});

test("the header records which artifact and when", () => {
  const header = artifactExportHeader(BASE, "qiskit", AT);
  assert.match(header, /artifact-1/);
  assert.match(header, /2026-07-26T10:00:00\.000Z/);
});

test("raw source keeps the original code intact below the header", () => {
  const file = artifactExportSource(BASE, { framework: "qiskit", code: "print('bell')" }, AT);
  const [header, ...rest] = file.split("\n\n");
  assert.ok(header.startsWith("#"));
  assert.equal(rest.join("\n\n"), "print('bell')\n");
});
