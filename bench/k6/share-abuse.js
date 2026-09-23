// Abuse scenario for public notebook share links — the §1a/§2 release-gate item
// PR 988 left owed: this is a NEW ANONYMOUS ROUTE (`POST
// /v1/notebooks/shared/lookup`, ai-ops 349 option 2) and had no k6 evidence.
// Sibling to `abuse.js` and `pat-abuse.js`, same conventions (thresholds, not
// printed numbers; a control for every refusal; the real ceiling read from
// source, never restated), kept separate because it exercises a route with its
// own fixture shape: a share link needs a real notebook and a real minted token,
// which `mint_share_fixtures.py` provides through the repository layer (never
// through WorkOS, never through the mint HTTP route — nothing here signs anyone
// in). Run it with `bench/k6/run-share-abuse.sh`.
//
// ## What this demonstrates
//
//   - The shared per-address anonymous ceiling (`rate_limit.DEFAULT_ANON_LIMIT`)
//     covers this route exactly like `/v1/catalog/*`: a flood on one address is
//     refused with 429 past the ceiling, and EXACTLY the ceiling is served —
//     never a softened number.
//   - The control for it: a SECOND address, reading the SAME live link through
//     the whole flood, is never refused. If the limiter were keyed on the token
//     or the notebook instead of the address, this would fail.
//   - A syntactically-valid but never-minted token, a revoked token and an
//     expired token each answer 404 — never 401/403, per the brief's own
//     wording (a share link's holder has no other credential to be challenged
//     for; distinguishing "wrong" from "used to work" would confirm a real
//     link to a guesser).
//   - The answer-key sentinel `mint_share_fixtures.py` planted on both surfaces
//     `routes/notebook_shares.py` redacts (a solution cell's source, and that
//     same cell's prior stdout in `report`) never appears in ANY response body
//     this file reads — the flood's, the second address's, or any refusal's.
//   - Nothing, anywhere, 500s.
//
// ## Why the flood and the second address share one token
//
// Unlike `pat-abuse.js`'s per-TOKEN ceiling, this route's ceiling is per-ADDRESS
// (the same `LIMITED_PATH_PREFIXES` middleware `abuse.js`'s `anon_flood` and
// `tour_signal_flood` already prove). A second, unrelated token would prove
// nothing that a second address does not already prove; one live token is
// enough, and using it from two addresses is what isolates the variable that
// actually matters here.
import http from "k6/http";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:8000";

const VALID_TOKEN = __ENV.VALID_TOKEN || "";
const REVOKED_TOKEN = __ENV.REVOKED_TOKEN || "";
const EXPIRED_TOKEN = __ENV.EXPIRED_TOKEN || "";
const RANDOM_TOKEN = __ENV.RANDOM_TOKEN || "";
const SENTINEL = __ENV.SENTINEL || "";

// The real production default, read out of rate_limit.py by run-share-abuse.sh
// and passed in — never restated as a literal here. Same reasoning as
// abuse.js's ANON_LIMIT and pat-abuse.js's TOKEN_LIMIT: a copy of this number
// in a shell script is a second place for it to be wrong, and the failure would
// be invisible (the flood would simply never reach a ceiling that had quietly
// drifted, and every threshold would pass regardless of the real default).
const ANON_LIMIT = Number(__ENV.ANON_LIMIT || "900");

const LOOKUP = `${BASE}/v1/notebooks/shared/lookup`;

const FLOOD_ADDR = "198.51.100.60";
const SECOND_ADDR = "198.51.100.161";
// Distinct from both of the above, and used for every lifecycle check, so a
// revoked/expired/random probe can never be mistaken for flood traffic and
// refused by the ceiling instead of by the lifecycle check it is meant to
// exercise — regardless of how these scenarios happen to be scheduled.
const LIFECYCLE_ADDR = "198.51.100.219";

// --- counters ---------------------------------------------------------------
const floodAttempts = new Counter("share_flood_attempts");
const floodServed = new Counter("share_flood_served");
const floodRefused = new Counter("share_flood_refused");
const floodUnexpected = new Counter("share_flood_unexpected");

const secondServed = new Counter("share_second_served");
const secondRefused = new Counter("share_second_refused");

const randomNotFound = new Counter("share_random_404");
const randomUnexpected = new Counter("share_random_unexpected");

const revokedNotFound = new Counter("share_revoked_404");
const revokedUnexpected = new Counter("share_revoked_unexpected");

const expiredNotFound = new Counter("share_expired_404");
const expiredUnexpected = new Counter("share_expired_unexpected");

const sentinelLeaked = new Counter("sentinel_leaked");
const serverErrors = new Counter("server_errors");

// --- helpers -----------------------------------------------------------------

/** Same forgeable-by-design header abuse.js's asAddress() sets — the API keys
 * its limiter on the first X-Forwarded-For entry, which is what Cloud Run's
 * front end injects in production. */
function asAddress(addr) {
  return { "X-Forwarded-For": addr, "Content-Type": "application/json", Accept: "application/json" };
}

function lookup(token, addr) {
  return http.post(LOOKUP, JSON.stringify({ token }), { headers: asAddress(addr) });
}

/** Any 5xx, anywhere, fails every scenario at once. */
function noteStatus(response) {
  if (response.status >= 500) serverErrors.add(1);
  return response.status;
}

/** The sentinel must never appear in a body we can read — on a 200 it would be
 * the redaction failing; on anything else it should not be present at all. */
function noteSentinel(response) {
  if (SENTINEL && response.body && response.body.indexOf(SENTINEL) !== -1) {
    sentinelLeaked.add(1);
  }
}

export const options = {
  discardResponseBodies: false,
  scenarios: {
    // One address, far above the real ceiling. constant-arrival-rate so the
    // rate is a property of the test, not of how fast the service answers.
    share_flood: {
      executor: "constant-arrival-rate",
      rate: Math.ceil((ANON_LIMIT * 3) / 20),
      timeUnit: "1s",
      duration: "20s",
      preAllocatedVUs: 40,
      maxVUs: 120,
      exec: "flood",
      startTime: "0s",
    },
    // A different address, reading the SAME live link at a human pace, for the
    // whole time the flood runs — genuinely concurrent, not merely adjacent.
    share_second_address: {
      executor: "constant-arrival-rate",
      rate: 2,
      timeUnit: "1s",
      duration: "18s",
      preAllocatedVUs: 4,
      maxVUs: 8,
      exec: "secondAddress",
      startTime: "1s",
    },
    // Lifecycle checks. Each touches no shared state and no admission ceiling
    // (LIFECYCLE_ADDR), so there is no reason to sequence them after the flood.
    share_random_token: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 3,
      exec: "randomCheck",
      startTime: "0s",
    },
    share_revoked_token: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 3,
      exec: "revokedCheck",
      startTime: "0s",
    },
    share_expired_token: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 3,
      exec: "expiredCheck",
      startTime: "0s",
    },
  },
  thresholds: {
    // --- the flood is refused, and EXACTLY the real ceiling is served --------
    share_flood_attempts: [`count>${ANON_LIMIT}`],
    share_flood_served: [`count==${ANON_LIMIT}`],
    share_flood_refused: ["count>0"],
    share_flood_unexpected: ["count==0"],

    // --- and a different address is not touched by the flood -----------------
    share_second_served: ["count>0"],
    share_second_refused: ["count==0"],

    // --- lifecycle: random/revoked/expired are 404, never 401/403 ------------
    share_random_404: ["count>0"],
    share_random_unexpected: ["count==0"],
    share_revoked_404: ["count>0"],
    share_revoked_unexpected: ["count==0"],
    share_expired_404: ["count>0"],
    share_expired_unexpected: ["count==0"],

    // --- the answer key never crosses the public boundary --------------------
    sentinel_leaked: ["count==0"],

    // --- and nothing anywhere 500s --------------------------------------------
    server_errors: ["count==0"],
  },
};

// --- scenario bodies ----------------------------------------------------------

export function flood() {
  floodAttempts.add(1);
  const response = lookup(VALID_TOKEN, FLOOD_ADDR);
  const status = noteStatus(response);
  noteSentinel(response);
  if (status === 429) {
    // Actionable, not just a number — the same check abuse.js's anon_flood and
    // tour_signal_flood make on this same limiter.
    const retryAfter = Number(response.headers["Retry-After"] || "0");
    const contentType = response.headers["Content-Type"] || "";
    if (retryAfter < 1 || contentType.indexOf("application/problem+json") !== 0) {
      floodUnexpected.add(1);
    } else {
      floodRefused.add(1);
    }
  } else if (status === 200) {
    floodServed.add(1);
  } else {
    floodUnexpected.add(1);
  }
}

export function secondAddress() {
  const response = lookup(VALID_TOKEN, SECOND_ADDR);
  const status = noteStatus(response);
  noteSentinel(response);
  if (status === 429) secondRefused.add(1);
  else secondServed.add(1);
}

export function randomCheck() {
  const response = lookup(RANDOM_TOKEN, LIFECYCLE_ADDR);
  const status = noteStatus(response);
  noteSentinel(response);
  if (status === 404) randomNotFound.add(1);
  else randomUnexpected.add(1);
}

export function revokedCheck() {
  const response = lookup(REVOKED_TOKEN, LIFECYCLE_ADDR);
  const status = noteStatus(response);
  noteSentinel(response);
  if (status === 404) revokedNotFound.add(1);
  else revokedUnexpected.add(1);
}

export function expiredCheck() {
  const response = lookup(EXPIRED_TOKEN, LIFECYCLE_ADDR);
  const status = noteStatus(response);
  noteSentinel(response);
  if (status === 404) expiredNotFound.add(1);
  else expiredUnexpected.add(1);
}
