// The error envelope, asserted against the shape `app.py` actually emits.
//
// Every fixture below is the body a real handler produces, not a body invented
// to make the reader pass. `_problem` builds `{type, title, status, code}` and
// then `body.update(extra)` — so a typed refusal's `reason`, `diagnostics` and
// `losses` land as SIBLINGS of `title`. That is the single fact this module
// exists to encode, and the regression these cases exist to catch: reading
// `payload.detail` throws nothing, returns undefined, and degrades silently to
// client-side filler (ai-ops issue 153).
//
// The last block is the guard that matters most. It reads `app.py` from source
// and fails if `_problem` stops writing `title`, or starts writing `detail` —
// because on that day every assertion above would still pass while the app went
// back to showing generic text.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  refusalField,
  refusalReason,
  refusalSentence,
  refusalStrings,
  responseString,
  submittedId,
} from "./api-error.ts";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_APP = join(WEB_ROOT, "..", "..", "services", "api", "src", "majorana_api", "app.py");

/** `routes/artifacts.py` — source that fails the framework contract. */
const CONTRACT_FAILED = {
  type: "about:blank",
  title: "This source does not satisfy the framework contract.",
  status: 422,
  code: "http_error",
  reason: "source_contract_failed",
  diagnostics: ["no FINAL_CIRCUIT", "no RESULT"],
};

/** `routes/artifacts.py` — a restore that would drop capabilities. */
const RESTORE_LOSES = {
  type: "about:blank",
  title: "Restoring this version would leave the artifact without a result. Confirm to restore it anyway.",
  status: 409,
  code: "http_error",
  reason: "restore_loses_capabilities",
  losses: ["result"],
};

/** `routes/qpu.py` — storage refused, and deliberately carries no sentence. */
const CREDENTIAL_STORAGE_DOWN = {
  type: "about:blank",
  title: "request refused",
  status: 503,
  code: "http_error",
  reason: "credential_storage_unavailable",
};

/** `app.py::_pool_exhausted` — saturation, not a fault. */
const AT_CAPACITY = {
  type: "about:blank",
  title: "the service is at capacity",
  status: 503,
  code: "capacity_exhausted",
  reason: "capacity_exhausted",
};

test("the sentence comes from title, which is where the API puts it", () => {
  assert.equal(refusalSentence(CONTRACT_FAILED), "This source does not satisfy the framework contract.");
  assert.equal(refusalSentence(AT_CAPACITY), "the service is at capacity");
  assert.equal(refusalSentence(CREDENTIAL_STORAGE_DOWN), "request refused");
});

test("the reason is a sibling of title, never nested under detail", () => {
  assert.equal(refusalReason(CONTRACT_FAILED), "source_contract_failed");
  assert.equal(refusalReason(RESTORE_LOSES), "restore_loses_capabilities");
  assert.equal(refusalReason(CREDENTIAL_STORAGE_DOWN), "credential_storage_unavailable");
});

test("extension fields are siblings too", () => {
  assert.deepEqual(refusalStrings(CONTRACT_FAILED, "diagnostics"), ["no FINAL_CIRCUIT", "no RESULT"]);
  assert.deepEqual(refusalStrings(RESTORE_LOSES, "losses"), ["result"]);
  assert.equal(refusalField(RESTORE_LOSES, "status"), 409);
  assert.equal(refusalField(CONTRACT_FAILED, "nothing_here"), undefined);
});

test("a non-string inside diagnostics is dropped rather than rendered", () => {
  // The server sends `diagnostics[:10]` of strings; a future field that is not
  // one must not reach `join("; ")` and print `[object Object]` at a user.
  assert.deepEqual(refusalStrings({ diagnostics: ["ok", 7, null, { a: 1 }] }, "diagnostics"), ["ok"]);
  assert.deepEqual(refusalStrings({ diagnostics: "not an array" }, "diagnostics"), []);
  assert.deepEqual(refusalStrings({}, "diagnostics"), []);
});

test("the BFF's own error shapes still yield their sentence", () => {
  // `app/api/**/route.ts` answer their own 400s with `{error}`, and
  // `controlPlaneUnavailable` produces a body that never reached the API.
  assert.equal(refusalSentence({ error: "expected a JSON body" }), "expected a JSON body");
  assert.equal(refusalSentence({ detail: "control plane unavailable" }), "control plane unavailable");
  assert.equal(refusalSentence({ detail: { error: "nested" } }), "nested");
});

test("title wins over the fallbacks when a body carries both", () => {
  assert.equal(refusalSentence({ title: "from the API", detail: "from somewhere else" }), "from the API");
  assert.equal(refusalSentence({ title: "from the API", error: "from the BFF" }), "from the API");
});

test("nothing usable yields null, so a caller's own fallback survives", () => {
  assert.equal(refusalSentence(null), null);
  assert.equal(refusalSentence({}), null);
  assert.equal(refusalSentence({ title: "" }), null);
  assert.equal(refusalSentence("refused"), null);
  assert.equal(refusalSentence(undefined), null);
  assert.equal(refusalReason({}), null);
  assert.equal(refusalReason({ reason: "" }), null);
  assert.equal(refusalReason(null), null);
});

test("the server still writes title, and still writes no detail", () => {
  // Read from source: this is the premise every case above rests on, and it
  // lives in another language in another service. If `_problem` is rewritten to
  // emit FastAPI's default envelope, the fixtures here would go on passing
  // while the real app silently returned to generic text.
  const source = readFileSync(API_APP, "utf8");
  const body = /body = \{([^}]*)\}/.exec(source)?.[1];
  assert.ok(body, "app.py::_problem no longer builds a literal body — this guard is inert");
  assert.match(body, /"title": title/, "_problem stopped writing `title`");
  assert.doesNotMatch(body, /"detail"/, "_problem started writing `detail` — the reader must be revisited");
  assert.match(
    source,
    /extra=\{k: v for k, v in detail\.items\(\) if k != "error"\}/,
    "_http_exc stopped flattening a typed refusal's fields into siblings of `title`",
  );
});

test("a submitted id is read only when it really is a non-empty string", () => {
  // `as { id?: string }` followed by `!payload.id` looked like validation and
  // was not: the cast is taken on trust and the truthiness test accepts any
  // non-zero number, so `{"id": 1}` reached a route path and a stored chat as
  // though it were a string. Raised by CodeRabbit on this PR.
  assert.equal(submittedId({ id: "run_01J", conversation_id: "c_1" }), "run_01J");
  assert.equal(submittedId({ id: 1 }), null);
  assert.equal(submittedId({ id: "" }), null);
  assert.equal(submittedId({ id: null }), null);
  assert.equal(submittedId({ id: { toString: () => "run_01J" } }), null);
  assert.equal(submittedId({}), null);
  assert.equal(submittedId(null), null);
});

test("the fields riding alongside the id get the same treatment", () => {
  assert.equal(responseString({ conversation_id: "c_1" }, "conversation_id"), "c_1");
  assert.equal(responseString({ conversation_id: 7 }, "conversation_id"), null);
  assert.equal(responseString({}, "conversation_id"), null);
  assert.equal(responseString("nope", "conversation_id"), null);
});
