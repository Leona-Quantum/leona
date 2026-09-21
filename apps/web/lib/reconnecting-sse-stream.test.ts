import assert from "node:assert/strict";
import test from "node:test";

import { followReconnectingSseStream, reconnectDelayMs } from "./reconnecting-sse-stream.ts";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

function withStubbedFetch(impl: typeof fetch, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("reconnectDelayMs doubles from 1s, capped at 10s — the Run page's own formula", () => {
  assert.equal(reconnectDelayMs(0), 1000);
  assert.equal(reconnectDelayMs(1), 2000);
  assert.equal(reconnectDelayMs(2), 4000);
  assert.equal(reconnectDelayMs(3), 8000);
  assert.equal(reconnectDelayMs(4), 10000);
  assert.equal(reconnectDelayMs(10), 10000, "stays capped, does not overflow or shrink");
});

test("reconnectDelayMs honors a custom base/max", () => {
  assert.equal(reconnectDelayMs(0, { baseMs: 500, maxMs: 2000 }), 500);
  assert.equal(reconnectDelayMs(2, { baseMs: 500, maxMs: 2000 }), 2000);
});

test("a single successful connection resolves 'terminal' on its terminal block", async () => {
  await withStubbedFetch(
    (async () => new Response(streamOf(['data: {"type":"run.finished"}\n\n']), { status: 200 })) as typeof fetch,
    async () => {
      const blocks: string[] = [];
      const outcome = await followReconnectingSseStream({
        request: () => ({ url: "/x" }),
        signal: new AbortController().signal,
        onBlock: (block) => {
          blocks.push(block.data);
          return (JSON.parse(block.data) as { type: string }).type === "run.finished";
        },
      });
      assert.equal(outcome, "terminal");
      assert.deepEqual(blocks, ['{"type":"run.finished"}']);
    },
  );
});

test("the fix: repeated drops are retried, not given up on after the first one", async () => {
  // Before this module existed, `use-run-progress.ts` reported a stream
  // "lost" after exactly one failed attempt — indistinguishable, to a caller,
  // from a stream that could never have succeeded. This is the regression
  // test: three attempts fail/drop before the fourth finally connects and
  // reaches its terminal event, and the outcome is still "terminal". A
  // single-attempt implementation could not pass this — it would resolve
  // (or report) failure after the very first 503.
  let attempts = 0;
  const connectionErrors: Array<Error | null> = [];
  const waits: number[] = [];
  await withStubbedFetch(
    (async () => {
      attempts += 1;
      if (attempts < 4) return new Response(null, { status: 503 });
      return new Response(streamOf(['data: {"type":"run.finished"}\n\n']), { status: 200 });
    }) as typeof fetch,
    async () => {
      const outcome = await followReconnectingSseStream({
        request: () => ({ url: "/x" }),
        signal: new AbortController().signal,
        onBlock: (block) => (JSON.parse(block.data) as { type: string }).type === "run.finished",
        onConnectionChange: (error) => connectionErrors.push(error),
        wait: async (ms) => {
          waits.push(ms);
        },
      });
      assert.equal(outcome, "terminal");
    },
  );
  assert.equal(attempts, 4, "it must have reconnected three times before succeeding");
  assert.deepEqual(waits, [1000, 2000, 4000], "backoff keeps doubling across consecutive drops");
  assert.equal(connectionErrors.length, 4);
  for (const error of connectionErrors.slice(0, 3)) {
    assert.ok(error instanceof Error && /503/.test(error.message));
  }
  assert.equal(connectionErrors[3], null, "the final, successful connect reports no error");
});

test("the retry counter resets after any parsed block, not only a terminal one", async () => {
  let call = 0;
  const waits: number[] = [];
  await withStubbedFetch(
    (async () => {
      call += 1;
      if (call <= 2) return new Response(streamOf(['data: {"type":"run.queued"}\n\n']), { status: 200 });
      return new Response(streamOf(['data: {"type":"run.finished"}\n\n']), { status: 200 });
    }) as typeof fetch,
    async () => {
      const outcome = await followReconnectingSseStream({
        request: () => ({ url: "/x" }),
        signal: new AbortController().signal,
        onBlock: (block) => (JSON.parse(block.data) as { type: string }).type === "run.finished",
        wait: async (ms) => {
          waits.push(ms);
        },
      });
      assert.equal(outcome, "terminal");
    },
  );
  // Each of the first two connections delivers one real (non-terminal) block
  // and then ends without a terminal event — a drop, so it is retried. If the
  // attempt counter did not reset on that block, the second wait would be
  // 2000ms instead of 1000ms.
  assert.deepEqual(waits, [1000, 1000]);
});

test("request() is rebuilt on every attempt, so Last-Event-ID can follow a partial connection", async () => {
  let call = 0;
  const seenHeaders: Array<Record<string, string> | undefined> = [];
  await withStubbedFetch(
    (async (_url: unknown, init?: RequestInit) => {
      call += 1;
      seenHeaders.push(init?.headers as Record<string, string> | undefined);
      if (call === 1) return new Response(streamOf(['id: 7\ndata: {"type":"run.queued"}\n\n']), { status: 200 });
      return new Response(streamOf(['id: 8\ndata: {"type":"run.finished"}\n\n']), { status: 200 });
    }) as typeof fetch,
    async () => {
      let lastEventId: number | null = null;
      const outcome = await followReconnectingSseStream({
        request: () => ({
          url: "/x",
          headers: lastEventId !== null ? { "Last-Event-ID": String(lastEventId) } : undefined,
        }),
        signal: new AbortController().signal,
        onBlock: (block) => {
          if (block.id !== null) lastEventId = block.id;
          return (JSON.parse(block.data) as { type: string }).type === "run.finished";
        },
        wait: async () => {},
      });
      assert.equal(outcome, "terminal");
    },
  );
  assert.equal(seenHeaders[0], undefined);
  assert.deepEqual(seenHeaders[1], { "Last-Event-ID": "7" });
});

test("a response with no body is treated as a drop and retried", async () => {
  let call = 0;
  await withStubbedFetch(
    (async () => {
      call += 1;
      if (call === 1) return new Response(null, { status: 200 });
      return new Response(streamOf(['data: {"type":"run.finished"}\n\n']), { status: 200 });
    }) as typeof fetch,
    async () => {
      const outcome = await followReconnectingSseStream({
        request: () => ({ url: "/x" }),
        signal: new AbortController().signal,
        onBlock: (block) => (JSON.parse(block.data) as { type: string }).type === "run.finished",
        wait: async () => {},
      });
      assert.equal(outcome, "terminal");
    },
  );
  assert.equal(call, 2);
});

test("a rejected fetch (network error) is retried like any other drop", async () => {
  let call = 0;
  await withStubbedFetch(
    (async () => {
      call += 1;
      if (call === 1) throw new TypeError("network error");
      return new Response(streamOf(['data: {"type":"run.finished"}\n\n']), { status: 200 });
    }) as typeof fetch,
    async () => {
      const outcome = await followReconnectingSseStream({
        request: () => ({ url: "/x" }),
        signal: new AbortController().signal,
        onBlock: (block) => (JSON.parse(block.data) as { type: string }).type === "run.finished",
        wait: async () => {},
      });
      assert.equal(outcome, "terminal");
    },
  );
  assert.equal(call, 2);
});

test("an already-aborted signal resolves 'aborted' without ever calling fetch", async () => {
  let called = false;
  await withStubbedFetch(
    (async () => {
      called = true;
      throw new Error("must not be called");
    }) as typeof fetch,
    async () => {
      const controller = new AbortController();
      controller.abort();
      const outcome = await followReconnectingSseStream({
        request: () => ({ url: "/x" }),
        signal: controller.signal,
        onBlock: () => true,
      });
      assert.equal(outcome, "aborted");
    },
  );
  assert.equal(called, false);
});

test("aborting while waiting to reconnect resolves 'aborted' instead of retrying again", async () => {
  await withStubbedFetch(
    (async () => new Response(null, { status: 500 })) as typeof fetch,
    async () => {
      const controller = new AbortController();
      const outcome = await followReconnectingSseStream({
        request: () => ({ url: "/x" }),
        signal: controller.signal,
        onBlock: () => true,
        wait: async () => {
          controller.abort();
        },
      });
      assert.equal(outcome, "aborted");
    },
  );
});
