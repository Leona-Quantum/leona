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
 * Three of the four combinations are silent because they are consistent or
 * uninformative:
 *
 * - configured + `trusted` — working.
 * - not configured + `anonymous` — consistent; this deployment never claimed
 *   otherwise, and saying so on every page render would be noise.
 * - no header at all — an API that predates the exemption. Nothing is wrong and
 *   nothing is provable; a rolling deploy passes through this state.
 *
 * The fourth is the one that has to be loud: **we sent a token and the API still
 * called us anonymous.** That is a wrong or stale secret, and it has no other
 * symptom — the page renders, from data that is quietly about to go stale.
 */
export function reportCallerTrust(
  headers: Headers,
  url: string,
  log: (message: string) => void = console.error,
  token: string = trustedCallerToken(),
): void {
  const verdict = headers.get(CALLER_TRUST_HEADER)?.trim().toLowerCase();
  if (!verdict) return;
  if (!token) return;
  if (verdict === "trusted") return;
  log(
    `[trusted-caller] sent MAJORANA_TRUSTED_CALLER_TOKEN and the API answered ` +
      `"${verdict}" (${url}). The renderer is being metered as an anonymous ` +
      `caller; the catalog will fall back to the static corpus under load. ` +
      `Check TRUSTED_CALLER_TOKEN on the API service matches this deployment.`,
  );
}
