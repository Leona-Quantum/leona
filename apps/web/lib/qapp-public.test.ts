import assert from "node:assert/strict";
import test from "node:test";
import { loadPublicQapp } from "./qapp-public.ts";

/**
 * `loadPublicQapp` calls `fetchControlPlane(controlPlaneUrl(...))`, and
 * `controlPlaneUrl` resolves against `CONTROL_PLANE_URL`, a module-level
 * constant `control-plane.ts` freezes from `process.env.NEXT_PUBLIC_API_URL`
 * at IMPORT time — before this file's first test line ever runs, so setting
 * that env var here would be too late to change anything (confirmed by
 * running it: the constant stayed `http://localhost:8000` regardless).
 * `control-plane.test.ts` sidesteps this by testing `fetchControlPlane`
 * against an explicit origin it passes in directly; this file cannot do that,
 * because `loadPublicQapp` builds the URL internally.
 *
 * So this stubs the one thing underneath both layers: the global `fetch`
 * `control-plane.ts` calls. That is a real behavioural claim, not a shortcut
 * around one — this file's whole job is deciding what a `PublicQapp` fetch's
 * status code means, not the wire behaviour `control-plane.test.ts` already
 * covers with real sockets (timeouts, header attachment). Restored after
 * every test, always via `finally`, so a failing assertion cannot leave a
 * later test running against a stubbed `fetch`.
 */
async function withStubbedFetch<T>(
  stub: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const QAPP = {
  slug: "bell-explorer",
  title: "Bell explorer",
  description: "Prepares a Bell pair.",
  framework: "qiskit",
  qubits_estimate: 2,
  ui_document: "<html></html>",
  input_schema: { type: "object", properties: {} },
  output_schema: { type: "object", properties: {} },
  version: 3,
  fingerprint: "abc123",
  published_at: "2026-01-01T00:00:00Z",
};

test("a published Qapp round-trips through loadPublicQapp", async () => {
  let requestedUrl: string | undefined;
  await withStubbedFetch(
    async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(QAPP), { status: 200 });
    },
    async () => {
      const result = await loadPublicQapp(QAPP.slug);
      assert.deepEqual(result, QAPP);
    },
  );
  assert.equal(requestedUrl, `http://localhost:8000/v1/qapps/public/${QAPP.slug}`);
});

test("a 404 from the control plane — unpublished, private, deleted, or unknown — returns null, not a thrown error", async () => {
  // `services/api/.../routes/qapps.py`'s `public_qapp()` answers 404 for all
  // four of those cases alike; this is the one function both `/q/[slug]` and
  // `/embed/q/[slug]` call (see each page's own import), so both get a clean
  // `notFound()` from the SAME 404, not a second, hand-rolled visibility check
  // that could disagree with the control plane's.
  await withStubbedFetch(
    async () => new Response(JSON.stringify({ title: "qapp not found" }), { status: 404 }),
    async () => {
      const result = await loadPublicQapp("nonexistent-or-private-slug");
      assert.equal(result, null);
    },
  );
});

test("any other failure throws, rather than being silently treated as absent", async () => {
  await withStubbedFetch(
    async () => new Response(JSON.stringify({ title: "internal error" }), { status: 500 }),
    async () => {
      await assert.rejects(() => loadPublicQapp("some-slug"), /temporarily unavailable/);
    },
  );
});

test("the slug is percent-encoded into the control-plane path", async () => {
  let requestedUrl: string | undefined;
  await withStubbedFetch(
    async (input) => {
      requestedUrl = String(input);
      return new Response("{}", { status: 404 });
    },
    async () => {
      await loadPublicQapp("has a space/and a slash");
    },
  );
  assert.equal(requestedUrl, "http://localhost:8000/v1/qapps/public/has%20a%20space%2Fand%20a%20slash");
});
