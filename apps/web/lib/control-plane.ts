/**
 * One way for the BFF to call the control plane, with one timeout.
 *
 * Every route under `app/api/` proxies to the control plane inside a try/catch
 * that answers 502 when the call throws. Without a timeout that catch never
 * runs against the failure it was written for: an upstream that accepts the
 * connection and then says nothing holds the handler open until the platform
 * kills it, so the browser waits on a request that will never answer instead of
 * being told the control plane is unreachable.
 *
 * CodeRabbit raised this on PRs 176 and 177 and it was declined both times, on
 * the grounds that fixing the two or three routes a PR happens to touch reads
 * as "these are special". Hence one helper and one constant, applied to every
 * call site at once.
 *
 * Nothing here imports from `next/server`: the repo's tests run on the bare
 * node runner, which cannot resolve it, and a helper the tests cannot load is
 * a helper nobody checks. Route handlers accept any `Response`.
 *
 * ## Every proxied call now carries the trusted-caller secret too (leona 707)
 *
 * Both helpers below attach `TRUSTED_CALLER_HEADER` (`withTrustedCallerHeader`,
 * `./trusted-caller.ts`) to every outgoing request, not only the ones that
 * happen to construct it themselves. Before this, exactly ONE caller in this
 * whole app sent that header — `repository-source.ts`'s anonymous catalog
 * fetch — because that was the only traffic the header was ever built for
 * (metering our own SSR egress separately from anonymous readers on
 * `/v1/catalog/*`). `services/api`'s `AuthFailureThrottle` (ai-ops issue 145) later
 * grew a SECOND use for the same secret — a caller presenting it is exempt
 * from being BLOCKED for accumulated 401s — and that exemption is worthless
 * against the attack it exists for (an attacker forging this BFF's own
 * address to get it blocked) unless the BFF's authenticated proxy traffic
 * presents the secret too, which it did not, anywhere, until this change.
 *
 * **The exemption on the API side is inert unless the caller actually
 * presents the secret.** Read `AuthFailureThrottle`'s docstring in
 * `services/api/src/majorana_api/rate_limit.py` before assuming this header
 * covers a caller it does not — at the time that exemption was written,
 * exactly one caller sent it, and it was not this one.
 *
 * Safe to ship unconditionally: `withTrustedCallerHeader` degrades to
 * returning the base headers unchanged when `MAJORANA_TRUSTED_CALLER_TOKEN`
 * is unset (every environment except production today), so an unconfigured
 * deployment sends exactly what it sent before this change.
 *
 * Not `server-only`, on purpose, checked rather than assumed: this package
 * has `server-only` available transitively (`account-tier-server.ts` already
 * imports it), but a bare `import("server-only")` under plain Node — the
 * runtime `control-plane.test.ts` uses — throws `Cannot find package
 * 'server-only'`, because its enforcement is a webpack/Next build-time
 * resolution trick, not something the package does at import time outside
 * that pipeline. Adding it here would break the exact test-without-Next
 * property this file's own docstring already argues for. The guarantee this
 * secret needs is the `NEXT_PUBLIC_` prefix rule instead: `trusted-caller.ts`
 * reads `MAJORANA_TRUSTED_CALLER_TOKEN`, which carries no such prefix, so
 * Next never inlines it into a client bundle — confirmed against
 * `next.config.ts`, which defines no `env` override that would re-expose it.
 * A client-bundled read would resolve to `undefined`, and
 * `trustedCallerToken()` treats that identically to "unset": the failure mode
 * of a leak attempt here is the header quietly not being sent, never the
 * secret's value reaching a browser.
 */

import { withTrustedCallerHeader } from "./trusted-caller.ts";

/** Base URL of the control plane. The dev default matches `services/api`. */
export const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * How long the BFF waits for the control plane before giving up.
 *
 * Above the slowest thing a proxied route legitimately does (run submission,
 * which the control plane answers after enqueueing rather than after
 * executing) and well under the platform's own function ceiling, so the 502/504
 * below is what the browser sees rather than a platform timeout page.
 */
export const CONTROL_PLANE_TIMEOUT_MS = 15_000;

/** Resolve a control-plane path against the base URL. */
export function controlPlaneUrl(path: string): URL {
  return new URL(path, CONTROL_PLANE_URL);
}

/**
 * `init` deliberately has no `signal`: this helper owns the abort, and a caller
 * that passed one would have it silently dropped. A route that genuinely needs
 * to compose signals should say so in the type, not discover it at runtime.
 *
 * `headers` is narrowed from `RequestInit`'s `HeadersInit` (which also allows
 * a `Headers` instance or a tuple array) to a plain `Record<string, string>`.
 * Every call site in this app already passes a plain object literal, and
 * `withTrustedCallerHeader` needs one to merge into — narrowing here means
 * that merge never has to branch on which shape it received.
 */
type ControlPlaneInit = Omit<RequestInit, "signal" | "headers"> & {
  headers?: Record<string, string>;
};

/*
 * Both helpers take `timeoutMs` last, defaulted to the constant above. It
 * exists so the timeout itself is testable in under a second instead of
 * fifteen; no route passes it, and a route that did would be reintroducing the
 * per-call magic number this change removed.
 */

/**
 * Call the control plane and wait no longer than {@link CONTROL_PLANE_TIMEOUT_MS}
 * for the *whole* response, body included.
 *
 * Not for streams — see {@link openControlPlaneStream}.
 */
export function fetchControlPlane(
  input: URL | string,
  init: ControlPlaneInit = {},
  timeoutMs: number = CONTROL_PLANE_TIMEOUT_MS,
): Promise<Response> {
  return fetch(input, {
    cache: "no-store",
    ...init,
    headers: withTrustedCallerHeader(init.headers ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Open a streaming response, timing out the connection but not the stream.
 *
 * `AbortSignal.timeout` would abort the body too, so the run-events SSE proxy
 * would drop every live run at the timeout regardless of how healthy it was.
 * The timer is cleared the moment the response headers arrive: a control plane
 * that never answers still trips, one that answers and then streams for an hour
 * is left alone.
 */
export async function openControlPlaneStream(
  input: URL | string,
  init: ControlPlaneInit = {},
  timeoutMs: number = CONTROL_PLANE_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("control plane timed out", "TimeoutError")),
    timeoutMs,
  );
  try {
    return await fetch(input, {
      cache: "no-store",
      ...init,
      headers: withTrustedCallerHeader(init.headers ?? {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a thrown value is this helper's timeout.
 *
 * `fetch` does not always surface the abort directly — undici wraps it as
 * `TypeError: fetch failed` with the real reason on `cause` — so a check
 * against the top-level error alone would report every timeout as a plain
 * outage and the 504 would never be reachable.
 */
export function isControlPlaneTimeout(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") break;
    const { name } = current as { name?: unknown };
    if (name === "TimeoutError" || name === "AbortError") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Hand the control plane's answer straight back to the browser.
 *
 * Every proxy route ends in the same four lines — forward the status, forward
 * the content type, and special-case the statuses that carry no body, because
 * constructing a `Response` with a body on a 204 throws. Ten routes writing
 * those four lines is ten chances to forget the third one, and the failure shows
 * up as a 500 on an operation that actually succeeded.
 *
 * Returns a plain `Response`, not a `NextResponse`, so this module stays
 * loadable by the bare node test runner — the same reason the rest of the file
 * imports nothing from `next/server`.
 */
const BODYLESS_STATUSES = new Set([204, 205, 304]);

export function forwardFromControlPlane(upstream: Response): Response {
  if (BODYLESS_STATUSES.has(upstream.status)) {
    return new Response(null, { status: upstream.status });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
}

/**
 * The answer when the control plane could not be reached.
 *
 * 504 when we gave up waiting, 502 when the call failed outright. Both say the
 * same thing to a person; the distinction is what makes a hung upstream
 * separable from a refused one in the logs.
 */
export function controlPlaneUnavailable(error: unknown): Response {
  return isControlPlaneTimeout(error)
    ? Response.json({ error: "control plane timed out" }, { status: 504 })
    : Response.json({ error: "control plane unavailable" }, { status: 502 });
}
