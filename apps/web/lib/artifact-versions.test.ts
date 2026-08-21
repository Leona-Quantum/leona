import assert from "node:assert/strict";
import { test } from "node:test";

import {
  restoreRefusalLosses,
  versionPageFromResource,
} from "./artifact-versions.ts";

// The shape GET /v1/artifacts/{id}/versions returns. The two rows are the two
// writers that actually collide in Studio: a worker materialization and the
// draft a user typed over it.
const RUN_VERSION = {
  id: "019f7f2f-4840-7f69-b70a-01f2fbd0785c",
  seq: 1,
  is_current: true,
  code_lang: "qiskit",
  fingerprint: "a".repeat(64),
  export_status: "lossless",
  export_reason: null,
  limitations: null,
  verification_summary: null,
  created_at: "2026-07-20T11:02:00Z",
  origin: "agent_run",
  has_qasm: true,
  has_resource_estimates: true,
  has_framework_variants: false,
  exportable: true,
  verified: true,
  restore_losses: [],
};

const DRAFT_VERSION = {
  ...RUN_VERSION,
  id: "019f7f31-0000-7000-8000-000000000001",
  seq: 2,
  is_current: false,
  export_status: "unsupported",
  origin: "studio_draft",
  has_qasm: false,
  has_resource_estimates: false,
  exportable: false,
  verified: false,
  restore_losses: ["qasm", "export", "resource_estimates", "verification"],
};

const PAGE = {
  versions: [DRAFT_VERSION, RUN_VERSION],
  current_version_id: RUN_VERSION.id,
  next_before_seq: null,
};

test("the current version is the one flagged current, not the newest", () => {
  // Restoring moves a pointer without writing a row, so seq 1 is current here
  // while seq 2 exists and is newer. Reading position would label the wrong row.
  const page = versionPageFromResource(PAGE);
  assert.deepEqual(
    page.versions.map((row) => row.seq),
    [2, 1],
  );
  assert.deepEqual(
    page.versions.map((row) => row.isCurrent),
    [false, true],
  );
  assert.equal(page.currentVersionId, RUN_VERSION.id);
});

test("a draft carries none of the capabilities a run does", () => {
  const [draft, run] = versionPageFromResource(PAGE).versions;
  assert.deepEqual(
    [draft.hasQasm, draft.exportable, draft.verified, draft.hasResourceEstimates],
    [false, false, false, false],
  );
  assert.deepEqual([run.hasQasm, run.exportable, run.verified], [true, true, true]);
});

test("restoring a draft over a run reports every loss", () => {
  const [draft] = versionPageFromResource(PAGE).versions;
  assert.deepEqual(draft.restoreLosses, ["qasm", "export", "resource_estimates", "verification"]);
});

test("a missing capability field reads as absent, never as present", () => {
  // A field the server did not send is not a capability the version has.
  // Defaulting the other way is how the canvas gets handed QASM that is not there.
  const bare = { versions: [{ id: "x", seq: 1 }], current_version_id: null };
  const [row] = versionPageFromResource(bare).versions;
  assert.deepEqual(
    [row.hasQasm, row.exportable, row.verified, row.isCurrent, row.hasFrameworkVariants],
    [false, false, false, false, false],
  );
  assert.equal(row.origin, "unknown");
  assert.deepEqual(row.restoreLosses, []);
});

test("an origin the web does not know about is unknown, not the nearest match", () => {
  const page = versionPageFromResource({
    versions: [{ ...RUN_VERSION, origin: "qpu_replay" }],
  });
  assert.equal(page.versions[0].origin, "unknown");
});

test("a loss code the web cannot render is dropped rather than shown raw", () => {
  // The dialog renders each code through the locale table. An unrecognised code
  // has no Japanese, so passing it through would ship a bare identifier.
  const page = versionPageFromResource({
    versions: [{ ...DRAFT_VERSION, restore_losses: ["qasm", "telemetry", 7] }],
  });
  assert.deepEqual(page.versions[0].restoreLosses, ["qasm"]);
});

test("a malformed page is empty rather than throwing inside a panel", () => {
  assert.deepEqual(versionPageFromResource(null).versions, []);
  assert.deepEqual(versionPageFromResource({ versions: "soon" }).versions, []);
  assert.deepEqual(versionPageFromResource({ versions: [null, 3, {}] }).versions, []);
  assert.equal(versionPageFromResource({}).currentVersionId, null);
});

test("paging carries the cursor forward only when the server sent one", () => {
  assert.equal(versionPageFromResource({ ...PAGE, next_before_seq: 4 }).nextBeforeSeq, 4);
  assert.equal(versionPageFromResource(PAGE).nextBeforeSeq, null);
  assert.equal(versionPageFromResource({ ...PAGE, next_before_seq: "4" }).nextBeforeSeq, null);
});

test("only the capability refusal is read as one", () => {
  // The body below is what `routes/artifacts.py` actually puts on the wire.
  // It raises `HTTPException(detail={"error":…, "reason":…, "losses":…})`, but
  // `app.py::_http_exc` flattens that before it leaves the service: `error`
  // becomes `title` and every other key becomes a SIBLING of it.
  //
  // This case previously asserted the NESTED `{detail: {...}}` form, which no
  // deployment has ever sent. Both the reader and the test agreed with each
  // other and with nothing else, so the suite stayed green while the
  // confirm-and-restore dialog could never open on production (ai-ops issue 153).
  // That is the whole shape of the bug, preserved here as the reason this
  // fixture is written out in full rather than abbreviated.
  assert.deepEqual(
    restoreRefusalLosses({
      type: "about:blank",
      title: "Restoring this version would leave the artifact without qasm, verification.",
      status: 409,
      code: "http_error",
      reason: "restore_loses_capabilities",
      losses: ["qasm", "verification"],
    }),
    ["qasm", "verification"],
  );
  // Anything else must not be mistaken for "the user only has to confirm".
  assert.equal(restoreRefusalLosses({ title: "artifact version", status: 404 }), null);
  assert.equal(restoreRefusalLosses({ reason: "artifact_allowance_exhausted" }), null);
  assert.equal(restoreRefusalLosses(null), null);
  assert.equal(restoreRefusalLosses("gateway timeout"), null);
  // The shape that used to pass. Kept as an explicit negative so a future
  // "tolerant" reader cannot quietly reintroduce the envelope that hid this.
  assert.equal(
    restoreRefusalLosses({
      detail: { reason: "restore_loses_capabilities", losses: ["qasm", "verification"] },
    }),
    null,
  );
});

test("a version says whether its code is a circuit or a program", () => {
  const row = { id: "v1", seq: 1, is_current: true };
  assert.equal(
    versionPageFromResource({ versions: [{ ...row, program_role: "circuit" }] }).versions[0]
      .programRole,
    "circuit",
  );
  assert.equal(
    versionPageFromResource({ versions: [{ ...row, program_role: "program" }] }).versions[0]
      .programRole,
    "program",
  );
});

test("an absent or unrecognised role falls back to unknown, never to program", () => {
  // "unknown" is a real answer the server sends for source that binds neither
  // name, so absent and unrecognised both land on it. Defaulting to "program"
  // would label a circuit as a script — the mistake that got a published circuit
  // executed as one.
  const row = { id: "v1", seq: 1, is_current: true };
  for (const value of [undefined, null, "", "script", 7, {}]) {
    const parsed = versionPageFromResource({ versions: [{ ...row, program_role: value }] });
    assert.equal(parsed.versions[0].programRole, "unknown");
  }
});

test("a circuit the user brought in is named, not filed under unknown", () => {
  // The API's fifth writer. Until the web listed it, every user-imported
  // version arrived as "unknown" — the same word a legacy row gets, sitting
  // next to a restore button.
  const page = versionPageFromResource({
    versions: [{ ...RUN_VERSION, origin: "user_import" }],
  });
  assert.equal(page.versions[0].origin, "user_import");
});
