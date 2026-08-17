// The shared secret that tells the API this request is our own renderer, not an
// anonymous reader — and the check that the API agreed.
//
// ## Why this exists
//
// `/v1/catalog/*` takes no credential, so the API meters it per source address.
// Nothing in a browser ever calls it: `repository-source.ts` fetches server-side,
// so the only traffic that endpoint sees is Vercel's SSR egress — a handful of
// addresses shared by every visitor at once. The limiter's entire subject was us.
//
// Tripping it returns nothing to anybody. `getRepositoryEntries` catches the
// failure and serves the committed static corpus, so the public catalog would
// quietly start serving stale data under exactly the load a launch produces.
// A control whose failure mode is silent staleness is the one worth un-sharing.
//
// ## Why the response is checked and not just the request sent
//
// Sending a header proves nothing. The token can be absent from the Vercel
// environment, misspelled, or left behind by a secret rotation on the API side,
// and every one of those looks identical from here: the fetch succeeds, the page
// renders, and we are back in the anonymous bucket without knowing it. So the
// API echoes its verdict and `reportCallerTrust` compares it against what we
// believe we sent. A mismatch is the only symptom this failure has.
//
// ## Server-only
//
// `MAJORANA_TRUSTED_CALLER_TOKEN` carries no `NEXT_PUBLIC_` prefix, so Next will
// not inline it into a client bundle, and the only importer of this module is
// server-side. Both halves matter: the prefix rule is what makes it impossible
// to leak by accident, and `scripts/check-client-bundle-secrets.mjs` fails the
// build on a `NEXT_PUBLIC_*` name that says secret.
//
// ## Why the token is a parameter and not a module constant
//
// It was a module constant first — `const TOKEN = process.env...` — and that is
// untestable in the only way that matters. Every case worth pinning is a
// *different* configuration (set, unset, set-but-rejected), and a value frozen at
// import time makes them one case: whichever the test process happened to start
// with. The env read now happens per call, and the pure functions take the token
// explicitly so the tests exercise the policy rather than the environment.

/** Set by the API on every `/v1/catalog/*` response. `trusted` or `anonymous`. */
export const CALLER_TRUST_HEADER = "x-majorana-caller-trust";

/** Sent to the API. Must match `rate_limit.TRUSTED_CALLER_HEADER` there. */
export const TRUSTED_CALLER_HEADER = "X-Majorana-Trusted-Caller";

/** The configured secret, or "" when this deployment cannot identify itself. */
export function trustedCallerToken(): string {
  return process.env.MAJORANA_TRUSTED_CALLER_TOKEN?.trim() ?? "";
}

/**
 * Request headers for a catalog fetch.
 *
 * Returns the base headers unchanged when no token is configured — an
 * unconfigured deployment must behave exactly as it did before this file
 * existed, not send an empty header that the API would have to decide about.
 */
export function withTrustedCallerHeader(
  base: Record<string, string>,
  token: string = trustedCallerToken(),
): Record<string, string> {
  if (!token) return base;
  return { ...base, [TRUSTED_CALLER_HEADER]: token };
}

/**
 * Compare the API's verdict against what we sent, and log the disagreement.
 *
 * Two combinations are silent because they are consistent:
 *
 * - configured + `trusted` — working.
 * - not configured — this deployment never claimed otherwise, and saying so on
 *   every page render would be noise.
 *
 * The loud one is: **we sent a token and the API did not agree we are trusted.**
 * That is a wrong or stale secret, and it has no other symptom — the page
 * renders, from data that is quietly about to go stale.
 *
 * ## A MISSING header is the symptom, not the absence of one
 *
 * This function used to return early on a missing header, reasoning that it
 * meant "an API that predates the exemption — nothing is wrong and nothing is
 * provable". That reasoning was true when it was written and is now exactly
 * backwards, because the API changed underneath it. `app.py` sets the verdict
 * only on a response that is not publicly cacheable:
 *
 *     if "public" not in response.headers.get("Cache-Control", ""):
 *         response.headers[CALLER_TRUST_HEADER] = ...
 *
 * A trusted caller has its `Cache-Control: public` flipped to `private`, so it
 * gets the header. An anonymous one keeps `public` — so the verdict is
 * **stripped**, and all six catalog routes we fetch are `public`. The state a
 * stale secret produces is therefore *no header at all*, which is the one state
 * this function was hard-coded to call fine. Verified against the deployed API
 * on 2026-08-17 with a negative control: the real token answers
 * `x-majorana-caller-trust: trusted` with `Cache-Control: private`; a wrong
 * token answers `public` with no verdict header whatsoever.
 *
 * So the detector for the failure it was written for could not fire, and the
 * test suite pinned the blindness in place.
 *
 * ## Telling an old API apart from a rejection, without a false alarm
 *
 * The two look identical in the verdict header — both absent — so this reads a
 * second header instead. The current API adds `x-majorana-trusted-caller` to
 * `Vary` on every publicly cacheable response, and it does that for *both*
 * verdicts, before it decides whether to strip anything. An API that predates
 * the exemption emits no such `Vary`. That makes the discriminator exact:
 *
 * - no verdict + `Vary` names our header — a current API that called us
 *   anonymous. Loud.
 * - no verdict + no such `Vary` — an older API, or a route outside the metered
 *   surface. Silent, as before; a rolling deploy passes through this state.
 */
export function reportCallerTrust(
  headers: Headers,
  url: string,
  log: (message: string) => void = console.error,
  token: string = trustedCallerToken(),
): void {
  if (!token) return;
  const verdict = headers.get(CALLER_TRUST_HEADER)?.trim().toLowerCase();
  if (verdict === "trusted") return;
  if (!verdict && !varyNamesTrustedCaller(headers)) return;
  const answered = verdict
    ? `answered "${verdict}"`
    : `stripped the verdict, which it only does for an anonymous caller,`;
  log(
    `[trusted-caller] sent MAJORANA_TRUSTED_CALLER_TOKEN and the API ` +
      `${answered} (${url}). The renderer is being metered as an anonymous ` +
      `caller; the catalog will fall back to the static corpus under load. ` +
      `Check TRUSTED_CALLER_TOKEN on the API service matches this deployment.`,
  );
}

/**
 * True when the response's `Vary` names our credential header.
 *
 * Split out and matched on a token boundary rather than with `includes`, because
 * `Vary` is a comma-separated list this header shares with `Accept-Encoding`,
 * and a substring test would also match a future header that merely has ours as
 * a prefix.
 */
function varyNamesTrustedCaller(headers: Headers): boolean {
  const vary = headers.get("vary");
  if (!vary) return false;
  const wanted = TRUSTED_CALLER_HEADER.toLowerCase();
  return vary
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .includes(wanted);
}
