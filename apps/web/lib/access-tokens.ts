/**
 * Personal access tokens, as the account settings pane reads them.
 *
 * Proposal 7 Phase B, owner ruling ai-ops 362 option 1. Everything here is pure: the
 * pane is a client component the test suite cannot import, so what can be decided
 * without React is decided here and tested directly (the pattern `account-tier.ts` and
 * `run-allowance.ts` already follow in this directory).
 *
 * ## The one thing this file is careful about
 *
 * A token's secret exists in exactly one response, to the request that minted it, and
 * this module never stores it, never derives anything from it, and has no function
 * that takes one. `tokenState` and `formatTokenTail` work from the LISTED record,
 * which by construction cannot carry a secret. That is deliberate: a helper here that
 * accepted a token would eventually be called with one by something that logs.
 */

/** The listed shape of a token, mirroring `majorana_contracts.tokens.PersonalAccessToken`. */
export type AccessTokenRecord = {
  id: string;
  tail: string;
  name: string;
  workspace_id: string;
  scopes: string[];
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

/**
 * Which of three states a token is in, in the order that decides what is shown.
 *
 * Revoked outranks expired on purpose. A token that was killed and then also ran out
 * should read as killed: that is the fact its owner acted on, and "expired" would
 * quietly credit the clock with somebody's decision.
 */
export type AccessTokenState = "active" | "revoked" | "expired";

export function tokenState(record: AccessTokenRecord, now: Date): AccessTokenState {
  if (record.revoked_at) return "revoked";
  // Strictly after, matching the server: `_live` in the repository compares
  // `expires_at > now`, so the expiry instant itself is still live.
  return new Date(record.expires_at) > now ? "active" : "expired";
}

/** `lq_pat_…AbCd` — how a person tells two of their own tokens apart. */
export function formatTokenTail(tail: string): string {
  return `lq_pat_…${tail}`;
}

/**
 * Whole days until a token expires, or a negative number once it has.
 *
 * Whole days because that is the unit the lifetime is set in, and because a countdown
 * in hours invites reading a deadline off a page that may have been open all night.
 */
export function daysUntilExpiry(record: AccessTokenRecord, now: Date): number {
  const ms = new Date(record.expires_at).getTime() - now.getTime();
  return Math.ceil(ms / 86_400_000);
}

/**
 * Newest first, and never mixed: live tokens above the dead ones.
 *
 * Sorting by date alone would file a token revoked this morning above one still
 * driving something, which is the wrong way round for the question this list is opened
 * to answer — "what is currently able to act as me".
 */
export function sortTokens(records: AccessTokenRecord[], now: Date): AccessTokenRecord[] {
  const rank = (record: AccessTokenRecord) => (tokenState(record, now) === "active" ? 0 : 1);
  return [...records].sort(
    (a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at),
  );
}

/**
 * Whether this deployment has the feature at all.
 *
 * `404` from `GET /api/tokens` is the control plane's answer while
 * `LEONA_PERSONAL_ACCESS_TOKENS` is off, and it is the ONLY status that means the
 * feature is absent. Everything else — 401, 429, 5xx, an unreachable service — is an
 * outage, and an outage must leave the pane in place showing its error: it is the only
 * place a token can be REVOKED, and hiding it takes that away from somebody who may be
 * reaching for it precisely because something is wrong. A pane that vanished whenever
 * the API was unreachable would also read as "your tokens are gone".
 */
export function featureIsAbsent(status: number): boolean {
  return status === 404;
}
