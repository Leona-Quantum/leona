/**
 * The notebook "Run on hardware" card, without a DOM: the fingerprint a submission
 * carries (and that finds its runs again after a reload), and the state machine that
 * decides when a click may send a paid job.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_HARDWARE_CARD_STATE,
  MAX_SOURCE_FINGERPRINT_CHARS,
  canSubmit,
  clearRecentQpuRuns,
  defaultDeviceId,
  hardwareCardReducer,
  isRunOfRequest,
  latestRunOfRequest,
  notebookHardwareFingerprint,
  parseNotebookHardwareFingerprint,
  phaseForRun,
  qasmDigest,
  recentQpuRuns,
  refusalText,
  type HardwareCardEvent,
  type HardwareCardState,
} from "./notebook-hardware.ts";
import { QpuSubmissionRefused, type QpuBackendInfo, type QpuCostEstimate, type QpuRunRecord } from "./qpu.ts";
import { WORKSPACE_COPY } from "./workspace-locale.ts";

const NOTEBOOK = "01a0d0f3-b812-77d4-a642-b09b62188874";
const DIGEST = "ba7816bf8f01";

function run(overrides: Partial<QpuRunRecord> = {}): QpuRunRecord {
  return {
    id: "run-1",
    provider: "ibm",
    device_id: "ibm.open_plan",
    provider_job_id: null,
    backend_name: null,
    shots: 1024,
    status: "queued",
    source_fingerprint: `notebook:${NOTEBOOK}:v3:c05:${DIGEST}`,
    estimated_total_usd: null,
    rate_source: "https://example.test/rates",
    rate_confirmed_on: "2026-09-01",
    raw_counts: null,
    error: null,
    submitted_at: null,
    completed_at: null,
    created_at: "2026-09-23T00:00:00Z",
    ...overrides,
  };
}

const ESTIMATE: QpuCostEstimate = {
  device_id: "ibm.open_plan",
  shots: 1024,
  basis: "free_tier_allowance",
  currency: "USD",
  task_fee_usd: null,
  shot_fees_usd: null,
  total_usd: null,
  allowance_note: "Counts against the Open Plan's monthly minutes.",
  rate_source: "https://example.test/rates",
  rate_confirmed_on: "2026-09-01",
  disclaimer: "Estimate only.",
};

function play(events: HardwareCardEvent[], from: HardwareCardState = INITIAL_HARDWARE_CARD_STATE): HardwareCardState {
  return events.reduce(hardwareCardReducer, from);
}

// --------------------------------------------------------------------------- fingerprints

test("qasmDigest is the first 12 hex digits of the program's SHA-256", async () => {
  // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad (FIPS 180-2).
  assert.equal(await qasmDigest("abc"), "ba7816bf8f01");
  assert.notEqual(await qasmDigest("OPENQASM 3.0;\nqubit[1] q;"), await qasmDigest("OPENQASM 3.0;\nqubit[2] q;"));
});

test("the fingerprint is notebook:<id>:v<seq>:<cell>:<digest>, and parses back", () => {
  const fingerprint = notebookHardwareFingerprint({ notebookId: NOTEBOOK, seq: 3, cellId: "c05", digest: DIGEST });
  assert.equal(fingerprint, `notebook:${NOTEBOOK}:v3:c05:${DIGEST}`);
  assert.deepEqual(parseNotebookHardwareFingerprint(fingerprint), { notebookId: NOTEBOOK, seq: 3, cellId: "c05", digest: DIGEST });
});

test("the longest fingerprint the product can build fits the route's 200 characters", () => {
  const longest = notebookHardwareFingerprint({
    notebookId: NOTEBOOK,
    seq: 999_999,
    // `_CELL_ID_RE` in the contract: at most 32 characters.
    cellId: "c".repeat(32),
    digest: DIGEST,
  });
  assert.ok(longest.length <= MAX_SOURCE_FINGERPRINT_CHARS, `${longest.length}`);
});

test("a fingerprint that would not fit, or would not parse back, throws rather than truncating", () => {
  assert.throws(() => notebookHardwareFingerprint({ notebookId: "x".repeat(200), seq: 1, cellId: "c01", digest: DIGEST }), /200/);
  assert.throws(() => notebookHardwareFingerprint({ notebookId: NOTEBOOK, seq: 1, cellId: "C:01", digest: DIGEST }), /malformed/);
  assert.throws(() => notebookHardwareFingerprint({ notebookId: NOTEBOOK, seq: 1, cellId: "c01", digest: "XYZ" }), /malformed/);
});

test("Studio's fingerprints and anything else are not notebook fingerprints", () => {
  assert.equal(parseNotebookHardwareFingerprint("fnv1a-0badf00d"), null);
  assert.equal(parseNotebookHardwareFingerprint(`notebook:${NOTEBOOK}:3:c05:${DIGEST}`), null);
  assert.equal(parseNotebookHardwareFingerprint(`notebook:${NOTEBOOK}:v3:c05:${DIGEST}:extra`), null);
});

test("a run belongs to a request by notebook, cell and circuit, in any version", () => {
  const key = { notebookId: NOTEBOOK, cellId: "c05", digest: DIGEST };
  assert.equal(isRunOfRequest(run({ source_fingerprint: `notebook:${NOTEBOOK}:v1:c05:${DIGEST}` }), key), true);
  assert.equal(isRunOfRequest(run({ source_fingerprint: `notebook:${NOTEBOOK}:v9:c05:${DIGEST}` }), key), true);
  assert.equal(isRunOfRequest(run({ source_fingerprint: `notebook:${NOTEBOOK}:v3:c06:${DIGEST}` }), key), false, "another cell");
  assert.equal(isRunOfRequest(run({ source_fingerprint: `notebook:${NOTEBOOK}:v3:c05:000000000000` }), key), false, "another circuit");
  assert.equal(isRunOfRequest(run({ source_fingerprint: `notebook:${NOTEBOOK}x:v3:c05:${DIGEST}` }), key), false, "a notebook id that merely starts the same");
  assert.equal(isRunOfRequest(run({ source_fingerprint: "fnv1a-0badf00d" }), key), false);
});

test("latestRunOfRequest takes the newest match and says which version sent it", () => {
  const key = { notebookId: NOTEBOOK, cellId: "c05", digest: DIGEST };
  const items = [
    run({ id: "other", source_fingerprint: `notebook:${NOTEBOOK}:v4:c02:${DIGEST}` }),
    run({ id: "newest", source_fingerprint: `notebook:${NOTEBOOK}:v2:c05:${DIGEST}` }),
    run({ id: "older", source_fingerprint: `notebook:${NOTEBOOK}:v1:c05:${DIGEST}` }),
  ];
  const found = latestRunOfRequest(items, key);
  assert.equal(found?.run.id, "newest");
  assert.equal(found?.seq, 2);
  assert.equal(latestRunOfRequest([items[0]], key), null);
});

// --------------------------------------------------------------------------- the state machine

test("the happy path: idle, estimating, confirm, submitting, queued, running, done", () => {
  let state = play([{ type: "chooseDevice", deviceId: "ibm.open_plan" }]);
  assert.equal(state.phase, "idle");
  state = play([{ type: "estimate" }], state);
  assert.equal(state.phase, "estimating");
  state = play([{ type: "estimated", deviceId: "ibm.open_plan", estimate: ESTIMATE }], state);
  assert.equal(state.phase, "confirm");
  assert.equal(state.estimate, ESTIMATE);
  state = play([{ type: "submit" }], state);
  assert.equal(state.phase, "submitting");
  state = play([{ type: "submitted", run: run() }], state);
  assert.equal(state.phase, "queued");
  state = play([{ type: "polled", run: run({ status: "running" }) }], state);
  assert.equal(state.phase, "running");
  state = play([{ type: "polled", run: run({ status: "done", raw_counts: { "00": 510, "11": 514 } }) }], state);
  assert.equal(state.phase, "done");
  assert.deepEqual(state.run?.raw_counts, { "00": 510, "11": 514 });
});

function atConfirm(): HardwareCardState {
  return play([
    { type: "chooseDevice", deviceId: "ibm.open_plan" },
    { type: "estimate" },
    { type: "estimated", deviceId: "ibm.open_plan", estimate: ESTIMATE },
  ]);
}

test("a second submit — a double click, or a click while the first is in flight — changes nothing", () => {
  const submitting = hardwareCardReducer(atConfirm(), { type: "submit" });
  assert.equal(submitting.phase, "submitting");
  assert.equal(hardwareCardReducer(submitting, { type: "submit" }), submitting, "the same object: a no-op");
  const queued = hardwareCardReducer(submitting, { type: "submitted", run: run() });
  assert.equal(hardwareCardReducer(queued, { type: "submit" }), queued);
});

test("nothing is ever submitted without passing through confirm", () => {
  for (const phase of ["idle", "estimating", "queued", "running", "done", "error"] as const) {
    const state: HardwareCardState = { ...INITIAL_HARDWARE_CARD_STATE, phase, deviceId: "ibm.open_plan", estimate: ESTIMATE };
    assert.equal(hardwareCardReducer(state, { type: "submit" }), state, phase);
  }
  // A confirm with no price in hand is not a confirm.
  const priceless: HardwareCardState = { ...INITIAL_HARDWARE_CARD_STATE, phase: "confirm", deviceId: "ibm.open_plan", estimate: null };
  assert.equal(hardwareCardReducer(priceless, { type: "submit" }), priceless);
});

test("an estimate for a device the reader has changed away from is dropped", () => {
  const estimating = play([{ type: "chooseDevice", deviceId: "a" }, { type: "estimate" }]);
  const moved = hardwareCardReducer(estimating, { type: "chooseDevice", deviceId: "b" });
  assert.equal(moved.phase, "idle");
  assert.equal(hardwareCardReducer(moved, { type: "estimated", deviceId: "a", estimate: ESTIMATE }), moved);
  const reEstimating = hardwareCardReducer(moved, { type: "estimate" });
  assert.equal(hardwareCardReducer(reEstimating, { type: "estimated", deviceId: "a", estimate: ESTIMATE }), reEstimating);
  assert.equal(hardwareCardReducer(reEstimating, { type: "estimateFailed", deviceId: "a", message: "x" }), reEstimating);
});

test("changing device at confirm throws the old price away", () => {
  const moved = hardwareCardReducer(atConfirm(), { type: "chooseDevice", deviceId: "other" });
  assert.equal(moved.phase, "idle");
  assert.equal(moved.estimate, null);
  assert.equal(hardwareCardReducer(moved, { type: "submit" }), moved);
});

test("the device cannot change while a submission is on its way or running", () => {
  const submitting = hardwareCardReducer(atConfirm(), { type: "submit" });
  assert.equal(hardwareCardReducer(submitting, { type: "chooseDevice", deviceId: "other" }), submitting);
  const running = play([{ type: "submitted", run: run({ status: "running" }) }], submitting);
  assert.equal(hardwareCardReducer(running, { type: "chooseDevice", deviceId: "other" }), running);
});

test("a failed estimate and a refused submission both land in error, and can be retried", () => {
  const failed = play([{ type: "chooseDevice", deviceId: "a" }, { type: "estimate" }, { type: "estimateFailed", deviceId: "a", message: "no price" }]);
  assert.equal(failed.phase, "error");
  assert.equal(failed.error?.message, "no price");
  assert.equal(hardwareCardReducer(failed, { type: "estimate" }).phase, "estimating");

  const refused = play([{ type: "submit" }, { type: "submitFailed", message: "No key", reason: "credentials_unconfigured" }], atConfirm());
  assert.equal(refused.phase, "error");
  assert.deepEqual(refused.error, { message: "No key", reason: "credentials_unconfigured" });
});

test("a run the provider failed is an error with the provider's sentence, and Run again resets", () => {
  const failed = play([{ type: "submit" }, { type: "submitted", run: run({ status: "error", error: "provider reported ERROR" }) }], atConfirm());
  assert.equal(failed.phase, "error");
  assert.equal(failed.error?.message, "provider reported ERROR");
  const again = hardwareCardReducer(failed, { type: "again" });
  assert.equal(again.phase, "idle");
  assert.equal(again.run, null);
  assert.equal(again.deviceId, "ibm.open_plan", "the device choice survives");
});

test("a poll answer for a different run, or after the card moved on, is dropped", () => {
  const queued = play([{ type: "submit" }, { type: "submitted", run: run() }], atConfirm());
  assert.equal(hardwareCardReducer(queued, { type: "polled", run: run({ id: "someone-else", status: "done" }) }), queued);
  const done = hardwareCardReducer(queued, { type: "polled", run: run({ status: "done" }) });
  assert.equal(hardwareCardReducer(done, { type: "polled", run: run({ status: "running" }) }), done, "a finished run does not go backwards");
});

test("a restored run lands only in an untouched card", () => {
  const restored = hardwareCardReducer(INITIAL_HARDWARE_CARD_STATE, { type: "restored", run: run({ status: "done" }), fromSeq: 2 });
  assert.equal(restored.phase, "done");
  assert.equal(restored.restoredFromSeq, 2);
  const restoredQueued = hardwareCardReducer(INITIAL_HARDWARE_CARD_STATE, { type: "restored", run: run({ status: "queued" }), fromSeq: null });
  assert.equal(restoredQueued.phase, "queued", "an unfinished run resumes polling");
  // The reader started pricing a new run before the lookup answered: the lookup loses.
  const estimating = play([{ type: "chooseDevice", deviceId: "a" }, { type: "estimate" }]);
  assert.equal(hardwareCardReducer(estimating, { type: "restored", run: run({ status: "done" }), fromSeq: null }), estimating);
  const confirm = atConfirm();
  assert.equal(hardwareCardReducer(confirm, { type: "restored", run: run({ status: "done" }), fromSeq: null }), confirm);
});

test("cancel at confirm goes back to what was on show before", () => {
  assert.equal(hardwareCardReducer(atConfirm(), { type: "cancel" }).phase, "idle");
  const done = hardwareCardReducer(INITIAL_HARDWARE_CARD_STATE, { type: "restored", run: run({ status: "done" }), fromSeq: null });
  const pricingAgain = play([{ type: "chooseDevice", deviceId: "b" }, { type: "estimate" }, { type: "estimated", deviceId: "b", estimate: ESTIMATE }], done);
  assert.equal(pricingAgain.phase, "confirm");
  const cancelled = hardwareCardReducer(pricingAgain, { type: "cancel" });
  assert.equal(cancelled.phase, "done");
  assert.equal(cancelled.run?.id, "run-1", "the earlier result is still shown");
});

test("phaseForRun maps every provider status", () => {
  assert.equal(phaseForRun({ status: "queued" }), "queued");
  assert.equal(phaseForRun({ status: "running" }), "running");
  assert.equal(phaseForRun({ status: "done" }), "done");
  assert.equal(phaseForRun({ status: "error" }), "error");
  assert.equal(phaseForRun({ status: "cancelled" }), "error");
});

test("canSubmit needs confirm, a price, a key, a submittable device and the fingerprint", () => {
  const ok = { credentialMissing: false, submittable: true, digestReady: true };
  assert.equal(canSubmit(atConfirm(), ok), true);
  assert.equal(canSubmit(atConfirm(), { ...ok, credentialMissing: true }), false);
  assert.equal(canSubmit(atConfirm(), { ...ok, submittable: false }), false);
  assert.equal(canSubmit(atConfirm(), { ...ok, digestReady: false }), false);
  assert.equal(canSubmit(INITIAL_HARDWARE_CARD_STATE, ok), false);
});

test("the default device is the first one Leona can submit to", () => {
  const backends = [
    { device_id: "braket.ionq.forte", submittable: false },
    { device_id: "ibm.open_plan", submittable: true },
  ] as QpuBackendInfo[];
  assert.equal(defaultDeviceId(backends), "ibm.open_plan");
  assert.equal(defaultDeviceId([backends[0]]), "braket.ionq.forte", "priced-only is still shown, so it can be priced");
  assert.equal(defaultDeviceId([]), null);
});

test("refusals read the same sentence Studio's panel gives them", () => {
  const studio = WORKSPACE_COPY.en.studio;
  assert.deepEqual(refusalText(new QpuSubmissionRefused("x", "credentials_unconfigured"), studio), {
    message: studio.hardwareBlockedReason("credentials_unconfigured"),
    reason: "credentials_unconfigured",
  });
  const spent = refusalText(new QpuSubmissionRefused("x", "qpu_spend_exhausted", { spent: 20, limit: 25, estimate: 9 }), studio);
  assert.equal(spent.message, studio.hardwareSpendExhausted("$9.00", "$25.00", "$20.00"));
  const free = refusalText(new QpuSubmissionRefused("x", "qpu_spend_exhausted", { spent: 0, limit: 0, estimate: 9 }), studio);
  assert.equal(free.message, studio.hardwareSpendFreeTier("$9.00"));
  assert.deepEqual(refusalText(new Error("network down"), studio), { message: "network down", reason: null });
});

// --------------------------------------------------------------------------- the shared history page

test("every card on a page shares one read of the recent history, and a failure is not kept", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let fail = false;
  globalThis.fetch = (async () => {
    calls += 1;
    if (fail) return new Response("{}", { status: 503 });
    return new Response(JSON.stringify({ items: [run()], next_cursor: null }), { status: 200 });
  }) as typeof fetch;
  try {
    clearRecentQpuRuns();
    const [first, second] = await Promise.all([recentQpuRuns(1_000), recentQpuRuns(1_500)]);
    assert.equal(calls, 1);
    assert.equal(first, second);
    await recentQpuRuns(40_000); // past the 30 s window
    assert.equal(calls, 2);

    clearRecentQpuRuns();
    fail = true;
    await assert.rejects(recentQpuRuns(50_000));
    fail = false;
    await recentQpuRuns(50_001);
    assert.equal(calls, 4, "the failed read was retried rather than served from the cache");
  } finally {
    globalThis.fetch = original;
    clearRecentQpuRuns();
  }
});
