import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, test } from "node:test";
import {
  CONTROL_PLANE_TIMEOUT_MS,
  controlPlaneUnavailable,
  fetchControlPlane,
  forwardFromControlPlane,
  isControlPlaneTimeout,
  openControlPlaneStream,
} from "./control-plane.ts";
import { TRUSTED_CALLER_HEADER } from "./trusted-caller.ts";

/**
 * These run against a real socket rather than a stubbed `fetch`. The whole
 * point of the change is what happens to a connection that is accepted and then
 * goes quiet, and a stub that resolves or rejects on command cannot tell the
 * difference between "we abort it" and "we still wait forever".
 */
function listen(handler: Parameters<typeof createServer>[1]): Promise<{
  origin: string;
  server: Server;
}> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) throw new Error("no port");
      resolve({ origin: `http://127.0.0.1:${address.port}`, server });
    });
  });
}

const servers: Server[] = [];
after(() => {
  for (const server of servers) {
    // `close` alone only stops new connections. These servers deliberately hold
    // requests open forever, so without destroying the live sockets the runner
    // waits on a drained-looking event loop that never drains — a regression
    // that removes the abort would hang the suite instead of ending it red.
    server.closeAllConnections();
    server.close();
  }
});

/**
 * Save, set, and restore `MAJORANA_TRUSTED_CALLER_TOKEN` around `run` —
 * same idiom `trusted-caller.test.ts` uses, kept local here rather than
 * exported because it mutates process-global state and no other file in
 * this suite should be tempted to reuse it across a parallel test.
 */
async function withEnvToken<T>(token: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.MAJORANA_TRUSTED_CALLER_TOKEN;
  if (token === undefined) delete process.env.MAJORANA_TRUSTED_CALLER_TOKEN;
  else process.env.MAJORANA_TRUSTED_CALLER_TOKEN = token;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.MAJORANA_TRUSTED_CALLER_TOKEN;
    else process.env.MAJORANA_TRUSTED_CALLER_TOKEN = previous;
  }
}

const TOKEN = "trusted-caller-token-for-tests-0123456789";

/**
 * The proof leona 707 actually needs: every proxied call carries the secret,
 * not just the ones a caller happens to build it into. Real sockets, same
 * reasoning as the rest of this file — a stubbed `fetch` cannot tell
 * "attached" from "silently dropped" on the way to the wire, and that
 * distinction is the entire point of this change (`AuthFailureThrottle`'s
 * block-exemption on the API side is inert unless this header actually
 * arrives).
 */
test("fetchControlPlane attaches the trusted-caller secret when configured", async () => {
  let received: NodeJS.Dict<string | string[]> = {};
  const { origin, server } = await listen((request, response) => {
    received = request.headers;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{}");
  });
  servers.push(server);

  await withEnvToken(TOKEN, () =>
    fetchControlPlane(`${origin}/v1/me`, { headers: { Authorization: "Bearer x" } }),
  );

  assert.equal(received[TRUSTED_CALLER_HEADER.toLowerCase()], TOKEN);
  // The caller's own headers must survive alongside it, not be replaced by it.
  assert.equal(received.authorization, "Bearer x");
});

test("fetchControlPlane sends nothing extra when the secret is unconfigured", async () => {
  let received: NodeJS.Dict<string | string[]> = {};
  const { origin, server } = await listen((request, response) => {
    received = request.headers;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{}");
  });
  servers.push(server);

  await withEnvToken(undefined, () => fetchControlPlane(`${origin}/v1/me`));

  assert.equal(received[TRUSTED_CALLER_HEADER.toLowerCase()], undefined);
});

test("openControlPlaneStream attaches the trusted-caller secret too", async () => {
  let received: NodeJS.Dict<string | string[]> = {};
  const { origin, server } = await listen((request, response) => {
    received = request.headers;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end();
  });
  servers.push(server);

  const upstream = await withEnvToken(TOKEN, () =>
    openControlPlaneStream(`${origin}/v1/runs/x/events/stream`),
  );
  await upstream.body?.cancel();

  assert.equal(received[TRUSTED_CALLER_HEADER.toLowerCase()], TOKEN);
});

test("a timeout is recognised through undici's wrapper, not just at the top", () => {
  assert.equal(isControlPlaneTimeout(new DOMException("timed out", "TimeoutError")), true);
  // What `fetch` actually throws: a TypeError carrying the real reason.
  const wrapped = new TypeError("fetch failed");
  (wrapped as { cause?: unknown }).cause = new DOMException("timed out", "TimeoutError");
  assert.equal(isControlPlaneTimeout(wrapped), true);
  assert.equal(isControlPlaneTimeout(new Error("connection refused")), false);
  assert.equal(isControlPlaneTimeout(undefined), false);
});

test("a cause chain that loops does not hang the check", () => {
  const a = new Error("a");
  const b = new Error("b");
  (a as { cause?: unknown }).cause = b;
  (b as { cause?: unknown }).cause = a;
  assert.equal(isControlPlaneTimeout(a), false);
});

test("giving up waiting answers 504, and failing outright answers 502", async () => {
  const timedOut = controlPlaneUnavailable(new DOMException("t", "TimeoutError"));
  assert.equal(timedOut.status, 504);
  const refused = controlPlaneUnavailable(new Error("ECONNREFUSED"));
  assert.equal(refused.status, 502);
  assert.equal((await refused.json()).error, "control plane unavailable");
});

/** Short enough to keep the suite fast; the production value is asserted below. */
const TEST_TIMEOUT_MS = 300;

test("the shipped timeout is the one constant, and it is a sane one", () => {
  assert.equal(CONTROL_PLANE_TIMEOUT_MS, 15_000);
});

/**
 * The three tests below assert that something gives up. Without an explicit
 * per-test timeout the regression they exist to catch — no abort at all — does
 * not fail them, it hangs them, and node's runner has no default deadline. A
 * mutation run proved exactly that: deleting the signal wedged the suite
 * instead of turning it red.
 */
const DEADLINE = { timeout: TEST_TIMEOUT_MS * 20 };

test("a whole-response timeout aborts an upstream that goes quiet mid-body", DEADLINE, async () => {
  const { origin, server } = await listen((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write('{"partial":');
    // and then nothing, forever.
  });
  servers.push(server);

  const upstream = await fetchControlPlane(`${origin}/v1/me`, {}, TEST_TIMEOUT_MS);
  await assert.rejects(upstream.text(), (error: unknown) => isControlPlaneTimeout(error));
});

test("a stream whose headers arrive is not cut off by the timeout", DEADLINE, async () => {
  const { origin, server } = await listen((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(": open\n\n");
    // Never ends on its own. A whole-response timeout would abort this; a
    // headers-only timeout must not — a live run streams for far longer.
    setTimeout(() => {
      response.write("data: late\n\n");
      response.end();
    }, TEST_TIMEOUT_MS * 4).unref();
  });
  servers.push(server);

  const upstream = await openControlPlaneStream(
    `${origin}/v1/runs/x/events/stream`,
    {},
    TEST_TIMEOUT_MS,
  );
  assert.equal(upstream.status, 200);

  // Read well after the timeout would have fired and assert the body is still
  // live rather than aborted.
  await new Promise((resolve) => setTimeout(resolve, TEST_TIMEOUT_MS * 3));
  const reader = upstream.body?.getReader();
  assert.ok(reader, "expected a readable body");
  const first = await reader.read();
  assert.equal(first.done, false);
  await reader.cancel();
});

test("a stream whose headers never arrive does trip the timeout", DEADLINE, async () => {
  const { origin, server } = await listen(() => {
    // Accept the connection and say nothing at all.
  });
  servers.push(server);

  const started = Date.now();
  await assert.rejects(
    openControlPlaneStream(`${origin}/v1/runs/x/events/stream`, {}, TEST_TIMEOUT_MS),
    (error: unknown) => isControlPlaneTimeout(error),
  );
  assert.ok(
    Date.now() - started >= TEST_TIMEOUT_MS - 50,
    "should have waited for the timeout rather than failing immediately",
  );
});

test("forwardFromControlPlane passes the status and content type through", async () => {
  const forwarded = forwardFromControlPlane(
    new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(forwarded.status, 201);
  assert.equal(forwarded.headers.get("Content-Type"), "application/json");
  assert.deepEqual(await forwarded.json(), { ok: true });
});

test("forwardFromControlPlane drops the body on statuses that must not carry one", () => {
  // `new Response(body, { status: 204 })` throws. A proxy that forwards a 204
  // without this check answers 500 on an operation that already succeeded —
  // which is every revoke and every delete.
  for (const status of [204, 205, 304]) {
    const forwarded = forwardFromControlPlane(new Response(null, { status }));
    assert.equal(forwarded.status, status);
    assert.equal(forwarded.body, null);
  }
});

test("forwardFromControlPlane keeps a refusal intact", async () => {
  // A 409 from the control plane is an ANSWER: the sentence inside it is what
  // the user reads. Rewriting or swallowing it here loses the reason.
  const forwarded = forwardFromControlPlane(
    new Response(JSON.stringify({ detail: "already a member of this workspace" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(forwarded.status, 409);
  assert.deepEqual(await forwarded.json(), { detail: "already a member of this workspace" });
});

test("forwardFromControlPlane defaults the content type when the upstream sent none", () => {
  // A byte body rather than a string: `new Response("{}")` labels itself
  // text/plain, so a string here would test the platform default instead of
  // this function.
  const upstream = new Response(Uint8Array.from([123, 125]), { status: 200 });
  assert.equal(upstream.headers.get("Content-Type"), null);
  assert.equal(forwardFromControlPlane(upstream).headers.get("Content-Type"), "application/json");
});
