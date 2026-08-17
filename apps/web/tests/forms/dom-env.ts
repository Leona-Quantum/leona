// Shared test helpers for the form-submission suite (apps/web/tests/forms/*.test.tsx).
//
// The rest of apps/web is tested with plain `node --test` against `lib/*.test.ts`
// (see the root `test` script) — no DOM, no JSX, pure functions. That runner
// cannot render a form: `node --experimental-strip-types` strips TYPES, not JSX,
// so a `.tsx` file never even parses under it, and there is no `document` for a
// component to mount into. This suite exists because of that gap: no check in
// this repo has ever rendered one of these components and clicked its submit
// button (ai-ops issue 123).
//
// The jsdom `window`/`document` setup itself lives in preload.mjs, loaded via
// `node --import` (see run.mjs) rather than as an ordinary import here — see
// the comment at the top of that file for why it has to be a preload and not
// just "the first import in this file".
import { afterEach } from "node:test";
import { cleanup } from "@testing-library/react";

/**
 * jsdom hard-locks `window.location` (`configurable: false`, verified against
 * jsdom's own Window.js) and silently no-ops both `location.assign(url)` and
 * `location.href = url` — the target is discarded, not stored, so there is no
 * way to read back what a component asked to navigate to. That is why every
 * form here that navigates on success (`welcome-form.tsx`,
 * `workspace-sharing.tsx`'s switch/leave/delete) is verified by proving the
 * navigate call fired at all, not by reading the URL back — jsdom reports the
 * attempt as a "not implemented: navigation" event on its VirtualConsole
 * (exposed by preload.mjs), and that event is the only observable signal
 * this environment gives us. The destination itself is checked once, by
 * reading the component's source at the call site, not per test.
 */
export function waitForNavigationAttempt(timeoutMs = 1000): Promise<void> {
  const virtualConsole = (globalThis as { __formTestVirtualConsole?: { on: Function; removeListener: Function } })
    .__formTestVirtualConsole;
  if (!virtualConsole) throw new Error("preload.mjs did not run — was this file started via run.mjs?");
  return new Promise((resolve, reject) => {
    const onError = (err: Error & { type?: string }) => {
      if (err.type === "not-implemented" && /navigation/i.test(err.message)) {
        virtualConsole.removeListener("jsdomError", onError);
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      virtualConsole.removeListener("jsdomError", onError);
      reject(new Error(`no navigation attempt observed within ${timeoutMs}ms`));
    }, timeoutMs);
    virtualConsole.on("jsdomError", onError);
  });
}

/**
 * Stub `global.fetch` for one test. Each call records the request so a test
 * can assert on the exact payload the form's submit handler sent — the point
 * of this suite, not just that "something" was POSTed.
 */
export type RecordedRequest = { url: string; method: string; body: unknown; headers: Record<string, string> };

export function stubFetch(
  responder: (request: RecordedRequest) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>,
): { calls: RecordedRequest[]; restore: () => void } {
  const calls: RecordedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers as Record<string, string>) ?? {};
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const record: RecordedRequest = { url, method, body, headers };
    calls.push(record);
    const result = await responder(record);
    // Node's own built-in Response (undici), not jsdom's — jsdom does not
    // implement the Fetch API itself, and components call `.json()`/`.ok`/
    // `.status` on whatever this resolves to.
    return new Response(result.body !== undefined ? JSON.stringify(result.body) : undefined, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

afterEach(() => {
  cleanup();
});
