/**
 * What a refused hardware submission tells the person in front of it.
 *
 * `submitQpuRun` read `payload.detail.blocked_reason` — FastAPI's default
 * shape, not this API's. `services/api/app._problem` flattens EVERY refusal to
 * `{type, title, status, code, ...extensions}`, so `detail` was always
 * undefined and every refusal this endpoint has ever produced fell through to
 * `qpu submission failed (409)`. Nothing failed: the gate's carefully worded
 * explanation, the 404 for an unknown device, and the new spend refusal all
 * arrived on screen as a status code in parentheses.
 *
 * `project-shares.ts` documents having made and found the identical mistake in
 * the sharing client, which is why these read through its helpers rather than a
 * third parser.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { QpuSubmissionRefused, fetchQpuEstimate, isPricedOnly, submitQpuRun } from "./qpu.ts";
import { WORKSPACE_COPY } from "./workspace-locale.ts";

const REQUEST = {
  device_id: "braket.ionq.forte",
  shots: 1_000_000,
  qasm: 'OPENQASM 3.0; include "stdgates.inc"; qubit[1] q;',
  source_fingerprint: "fnv1a-test",
};

function respondWith(body: unknown, status: number) {
  (globalThis as { fetch?: unknown }).fetch = async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

test("a spend refusal carries the server's sentence, its reason and its numbers", async () => {
  // The real body, copied from what the endpoint returns: the account that was
  // measured authorizing $96,006.30 now meets this.
  respondWith(
    {
      type: "about:blank",
      title:
        "This submission is estimated at $80,000.30. Your plan includes $0.00 of hardware time per week and $0.00 is already authorized. Free-queue devices and browser simulation stay available.",
      status: 429,
      code: "http_error",
      reason: "qpu_spend_exhausted",
      spent_usd: 0.0,
      limit_usd: 0.0,
      estimate_usd: 80000.3,
    },
    429,
  );

  await assert.rejects(
    () => submitQpuRun(REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof QpuSubmissionRefused, "a refusal must be its own type");
      const refusal = error as QpuSubmissionRefused;
      assert.equal(refusal.reason, "qpu_spend_exhausted");
      assert.equal(refusal.estimateUsd, 80000.3);
      assert.equal(refusal.limitUsd, 0);
      assert.equal(refusal.spentUsd, 0);
      assert.ok(refusal.message.includes("$80,000.30"), refusal.message);
      return true;
    },
  );
});

test("a zero amount is a number, not a missing one", async () => {
  // `spent_usd: 0` is the ordinary case for the tier this refuses most, and a
  // truthiness check on it reports "unknown" for the one account that always
  // hits this limit.
  respondWith({ title: "refused", reason: "qpu_spend_exhausted", spent_usd: 0, limit_usd: 0, estimate_usd: 12 }, 429);
  await assert.rejects(
    () => submitQpuRun(REQUEST),
    (error: unknown) => {
      assert.equal((error as QpuSubmissionRefused).spentUsd, 0);
      assert.equal((error as QpuSubmissionRefused).limitUsd, 0);
      return true;
    },
  );
});

test("the deployment gate's 409 reaches the screen as its reason, not as 409", async () => {
  // This one is not new. It has been broken since the route shipped.
  respondWith(
    { type: "about:blank", title: "request refused", status: 409, code: "http_error", blocked_reason: "submission_disabled" },
    409,
  );

  await assert.rejects(
    () => submitQpuRun(REQUEST),
    (error: unknown) => {
      assert.equal((error as QpuSubmissionRefused).reason, "submission_disabled");
      return true;
    },
  );
});

test("a 404 for an unknown device says what the server said", async () => {
  respondWith({ type: "about:blank", title: "unknown QPU device", status: 404, code: "http_error" }, 404);
  await assert.rejects(
    () => submitQpuRun(REQUEST),
    (error: unknown) => {
      assert.equal((error as Error).message, "unknown QPU device");
      assert.equal((error as QpuSubmissionRefused).reason, null);
      return true;
    },
  );
});

test("a refusal with no readable body still says something true", async () => {
  // A proxy answering 502 with HTML, or an empty body.
  //
  // The first version of this test asserted `error instanceof Error` — which a
  // raw `SyntaxError` from `response.json()` satisfies perfectly, so it passed
  // against a client that threw "Unexpected token '<'" at the user and never
  // reached the fallback at all. An assertion loose enough to accept the bug is
  // not a test of anything; this one names the type and the sentence.
  (globalThis as { fetch?: unknown }).fetch = async () => new Response("<html>", { status: 502 });
  await assert.rejects(
    () => submitQpuRun(REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof QpuSubmissionRefused, `got ${(error as Error)?.name}`);
      assert.equal((error as Error).message, "qpu submission failed (502)");
      assert.equal((error as QpuSubmissionRefused).reason, null);
      return true;
    },
  );
});

test("an empty body on a refusal is handled like an unreadable one", async () => {
  (globalThis as { fetch?: unknown }).fetch = async () => new Response("", { status: 429 });
  await assert.rejects(
    () => submitQpuRun(REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof QpuSubmissionRefused, `got ${(error as Error)?.name}`);
      assert.equal((error as Error).message, "qpu submission failed (429)");
      return true;
    },
  );
});

test("a 2xx whose body does not parse is reported, not returned as a record", async () => {
  // Returning it would put `undefined` in `status` and poll `undefined` forever.
  (globalThis as { fetch?: unknown }).fetch = async () => new Response("<html>", { status: 201 });
  await assert.rejects(
    () => submitQpuRun(REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof QpuSubmissionRefused);
      assert.match((error as Error).message, /unreadable body/);
      return true;
    },
  );
});

test("an accepted submission is still returned as the record", async () => {
  respondWith({ id: "record-1", status: "queued", estimated_total_usd: 14.8 }, 201);
  const record = await submitQpuRun(REQUEST);
  assert.equal(record.id, "record-1");
  assert.equal(record.status, "queued");
});

test("only an explicit submittable: false marks a device as priced-only", () => {
  // Only IBM has a submit route. A Braket device is priced but Leona cannot run
  // it, and before the API refused it the job ran on IBM under Braket's label.
  assert.equal(isPricedOnly({ submittable: false }), true);
  assert.equal(isPricedOnly({ submittable: true }), false);
  // An API older than the field never refused on it, so absence is not a refusal.
  assert.equal(isPricedOnly({}), false);
});

test("the provider_not_supported refusal reaches the screen as its reason", async () => {
  respondWith(
    { type: "about:blank", title: "request refused", status: 409, code: "http_error", blocked_reason: "provider_not_supported" },
    409,
  );
  await assert.rejects(submitQpuRun(REQUEST), (error: unknown) => {
    assert.ok(error instanceof QpuSubmissionRefused);
    assert.equal(error.reason, "provider_not_supported");
    return true;
  });
});

test("both locales say why a priced-only device was refused, not the generic fallback", () => {
  for (const locale of ["en", "ja"] as const) {
    const studio = WORKSPACE_COPY[locale].studio;
    const specific = studio.hardwareBlockedReason("provider_not_supported");
    assert.notEqual(specific, studio.hardwareBlockedReason("a-reason-nobody-defined"), locale);
    assert.match(specific, /IBM/, locale);
    assert.match(studio.hardwarePricedOnly, /IBM/, locale);
  }
});


/**
 * Zero-noise extrapolation (proposal 5, increment 4) rides on the same two
 * requests. The flag is sent only when it is on: both request models are
 * `extra="forbid"`, so a key an older API does not know would refuse every
 * ordinary submission during a deploy.
 */
function captureBodies(): string[] {
  const bodies: string[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (_url: unknown, init?: { body?: string }) => {
    bodies.push(init?.body ?? "");
    return new Response(JSON.stringify({ id: "r", status: "queued", device_id: "ibm.open_plan", shots: 1 }), { status: 201 });
  };
  return bodies;
}

test("zne is sent only when it is on", async () => {
  const bodies = captureBodies();
  await submitQpuRun(REQUEST);
  await submitQpuRun({ ...REQUEST, zne: false });
  await submitQpuRun({ ...REQUEST, zne: true });
  await fetchQpuEstimate("ibm.open_plan", 1024);
  await fetchQpuEstimate("ibm.open_plan", 1024, { zne: true });
  const parsed = bodies.map((body) => JSON.parse(body) as Record<string, unknown>);
  assert.equal("zne" in parsed[0], false);
  assert.equal("zne" in parsed[1], false);
  assert.equal(parsed[2].zne, true);
  assert.deepEqual(parsed[3], { device_id: "ibm.open_plan", shots: 1024 });
  assert.deepEqual(parsed[4], { device_id: "ibm.open_plan", shots: 1024, zne: true });
});

test("the ZNE cost sentence names the circuits and both shot totals in both locales", () => {
  for (const locale of ["en", "ja"] as const) {
    const sentence = WORKSPACE_COPY[locale].studio.hardwareZneCost("3", "3,072", "1,024");
    for (const part of ["3", "3,072", "1,024"]) assert.ok(sentence.includes(part), `${locale}: ${part}`);
    assert.equal(sentence.includes("\u2014"), false, "no em dashes in reader-facing copy");
  }
});
