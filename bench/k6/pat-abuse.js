// Abuse scenario for personal access tokens — the release-gate item PR 973 left
// owed: `plans/rebuild/05-security.md` §2's "k6 abuse run against the per-token
// ceiling", the one box that switch-on (`LEONA_PERSONAL_ACCESS_TOKENS`) was waiting
// on. Sibling to `abuse.js`, same conventions (thresholds, not printed numbers; a
// control for every refusal; the ceiling read from source, never restated), kept
// separate because it exercises a different credential and a different fixture
// problem: `abuse.js` floods an ANONYMOUS caller and a shared-secret trusted
// renderer, both of which need no state; every scenario here needs a real, minted
// token, which needs a real user and workspace in Postgres. `run-pat-abuse.sh`
// mints six of them through the repository layer (never through WorkOS) with
// `mint_pat_fixtures.py` before this file ever runs, and hands their secrets in as
// environment variables.
//
// ## What "per-token, not global" means and how it is shown
//
// The ceiling in `rate_limit.py` is keyed on the token's id. A limiter keyed on the
// caller's address, or on nothing at all, would ALSO refuse `FLOOD_TOKEN` past some
// count — so refusing the flood alone proves nothing about which key the limiter
// actually uses. `SECOND_TOKEN` is what proves it: a second, live token, reading the
// same route through the whole flood, on an unrelated account. If the ceiling were
// per-account, per-address or global, this token would be refused too. It is not
// refused at all, which is the claim.
//
// ## Six scopes of the ruling, six scenarios, one fixture each
//
//   token_flood        FLOOD_TOKEN      exactly the real per-token ceiling served,
//                                        the rest 429 — never a softened number
//   second_token_reader SECOND_TOKEN    unaffected by FLOOD_TOKEN's flood
//   revoked_token       REVOKED_TOKEN   401 — revoked before this file ever ran
//   expired_token       EXPIRED_TOKEN   401 — aged past its own expiry beforehand
//   readonly_run        READONLY_TOKEN  403 token_scope_insufficient on POST /runs
//   run_scope_admitted  RUNSCOPE_TOKEN  201 on the SAME route, wider scope
//   hardware_refused    RUNSCOPE_TOKEN  403 on POST /qpu/submissions — no scope
//                                       reaches it, so the widest token is used
//                                       deliberately: a narrower one refusing here
//                                       would prove nothing about the missing scope
//
// Run it with `bench/k6/run-pat-abuse.sh`. Read that script before pointing this at
// anything but the throwaway API it starts — see `run-abuse.sh`'s own docstring for
// why: these scenarios exceed real admission ceilings on purpose.
import http from "k6/http";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:8000";

const FLOOD_TOKEN = __ENV.FLOOD_TOKEN || "";
const SECOND_TOKEN = __ENV.SECOND_TOKEN || "";
const REVOKED_TOKEN = __ENV.REVOKED_TOKEN || "";
const EXPIRED_TOKEN = __ENV.EXPIRED_TOKEN || "";
const READONLY_TOKEN = __ENV.READONLY_TOKEN || "";
const RUNSCOPE_TOKEN = __ENV.RUNSCOPE_TOKEN || "";

// The API's own default, read out of rate_limit.py by run-pat-abuse.sh and passed
// in — never restated as a literal here, for the same reason ANON_LIMIT in
// abuse.js is not: a copy of this number in two places is a second place for it to
// be wrong, and the failure is invisible, because the flood would simply never
// reach a limit that had quietly drifted.
const TOKEN_LIMIT = Number(__ENV.TOKEN_LIMIT || "600");

// Multiplier and window chosen against what this request actually costs. Unlike
// the anonymous limiter (a pure in-process check before any handler runs), EVERY
// personal-access-token request resolves the token against Postgres BEFORE the
// per-token ceiling is even consulted (`auth/deps.py::get_verified_token` calls
// `resolve_presented` first, `_meter_token` second) — so this flood is a real
// database round trip per attempt, not a bare counter increment. 2x the ceiling
// over 30s keeps the required throughput well inside what one uvicorn worker and
// one Postgres container answer locally, while staying comfortably inside the
// limiter's own 60s window, so the count is exact rather than a race against a
// window rollover.
const FLOOD_DURATION_S = 30;
const FLOOD_MULTIPLIER = 2;
const FLOOD_RATE = Math.ceil((TOKEN_LIMIT * FLOOD_MULTIPLIER) / FLOOD_DURATION_S);

const ME = `${BASE}/v1/me`;

// --- counters --------------------------------------------------------------
const floodAttempts = new Counter("pat_flood_attempts");
const floodServed = new Counter("pat_flood_served");
const floodRefused = new Counter("pat_flood_refused");
const floodUnexpected = new Counter("pat_flood_unexpected");

const secondServed = new Counter("pat_second_served");
const secondRefused = new Counter("pat_second_refused");

const revoked401 = new Counter("pat_revoked_401");
const revokedUnexpected = new Counter("pat_revoked_unexpected");

const expired401 = new Counter("pat_expired_401");
const expiredUnexpected = new Counter("pat_expired_unexpected");

const readonlyRefused = new Counter("pat_readonly_refused");
const readonlyUnexpected = new Counter("pat_readonly_unexpected");

const runAdmitted = new Counter("pat_run_admitted");
const runUnexpected = new Counter("pat_run_unexpected");

const hardwareRefused = new Counter("pat_hardware_refused");
const hardwareUnexpected = new Counter("pat_hardware_unexpected");

const serverErrors = new Counter("server_errors");

// --- helpers -----------------------------------------------------------------

function auth(token) {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

/** Any 5xx, anywhere, fails every scenario at once. */
function noteStatus(response) {
  if (response.status >= 500) serverErrors.add(1);
  return response.status;
}

function isProblemJson(response) {
  return (response.headers["Content-Type"] || "").indexOf("application/problem+json") === 0;
}

function reasonOf(response) {
  try {
    return (response.json() || {}).reason || "";
  } catch (_) {
    return "";
  }
}

export const options = {
  discardResponseBodies: false,
  scenarios: {
    // One token, far above its own ceiling. constant-arrival-rate so the rate is a
    // property of the test, not of how fast the service happens to answer.
    token_flood: {
      executor: "constant-arrival-rate",
      rate: FLOOD_RATE,
      timeUnit: "1s",
      duration: `${FLOOD_DURATION_S}s`,
      preAllocatedVUs: 20,
      maxVUs: 60,
      exec: "flood",
      startTime: "0s",
    },
    // A second, unrelated token, reading the SAME route at a human pace, for the
    // whole time the flood runs. Its window sits strictly inside the flood's
    // (28s inside 30s) so it is genuinely concurrent, not merely adjacent.
    second_token_reader: {
      executor: "constant-arrival-rate",
      rate: 3,
      timeUnit: "1s",
      duration: `${FLOOD_DURATION_S - 2}s`,
      preAllocatedVUs: 4,
      maxVUs: 8,
      exec: "secondReader",
      startTime: "1s",
    },
    // Lifecycle checks. Each is its own token and touches no shared state, so
    // there is no reason to sequence them after the flood.
    revoked_token: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 3,
      exec: "revokedCheck",
      startTime: "0s",
    },
    expired_token: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 3,
      exec: "expiredCheck",
      startTime: "0s",
    },
    // Scope checks: the same route, refused on a read-only token and admitted on a
    // read+run one.
    readonly_run: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 2,
      exec: "readonlyRunCheck",
      startTime: "0s",
    },
    run_scope_admitted: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      exec: "runScopeAdmittedCheck",
      startTime: "0s",
    },
    // Hardware is refused for every token — asserted on the WIDEST one, since a
    // narrower token being refused would say nothing about the missing scope.
    hardware_refused: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 2,
      exec: "hardwareCheck",
      startTime: "0s",
    },
  },
  thresholds: {
    // --- the flood is refused, and EXACTLY the real ceiling is served ---------
    pat_flood_attempts: [`count>${TOKEN_LIMIT}`],
    pat_flood_served: [`count==${TOKEN_LIMIT}`],
    pat_flood_refused: ["count>0"],
    pat_flood_unexpected: ["count==0"],

    // --- and a second token is not touched by the first's flood --------------
    pat_second_served: ["count>0"],
    pat_second_refused: ["count==0"],

    // --- lifecycle: revoked and expired are 401, nothing else ----------------
    pat_revoked_401: ["count>0"],
    pat_revoked_unexpected: ["count==0"],
    pat_expired_401: ["count>0"],
    pat_expired_unexpected: ["count==0"],

    // --- scope: read-only refused, read+run admitted, on the same route -------
    pat_readonly_refused: ["count>0"],
    pat_readonly_unexpected: ["count==0"],
    pat_run_admitted: ["count>0"],
    pat_run_unexpected: ["count==0"],

    // --- hardware: refused for every token, including the widest -------------
    pat_hardware_refused: ["count>0"],
    pat_hardware_unexpected: ["count==0"],

    // --- and nothing anywhere 500s ---------------------------------------------
    server_errors: ["count==0"],
  },
};

// --- scenario bodies -----------------------------------------------------------

export function flood() {
  floodAttempts.add(1);
  const response = http.get(ME, { headers: auth(FLOOD_TOKEN) });
  const status = noteStatus(response);
  if (status === 429) {
    // Actionable, not just a number: a `Retry-After: 0` reads as "retry now",
    // which is the instruction that caused the refusal — the same check
    // abuse.js's anon flood makes on its own limiter.
    const retryAfter = Number(response.headers["Retry-After"] || "0");
    if (retryAfter < 1 || !isProblemJson(response) || reasonOf(response) !== "token_rate_limited") {
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

export function secondReader() {
  const response = http.get(ME, { headers: auth(SECOND_TOKEN) });
  const status = noteStatus(response);
  if (status === 429) secondRefused.add(1);
  else secondServed.add(1);
}

export function revokedCheck() {
  const response = http.get(ME, { headers: auth(REVOKED_TOKEN) });
  const status = noteStatus(response);
  if (status === 401) revoked401.add(1);
  else revokedUnexpected.add(1);
}

export function expiredCheck() {
  const response = http.get(ME, { headers: auth(EXPIRED_TOKEN) });
  const status = noteStatus(response);
  if (status === 401) expired401.add(1);
  else expiredUnexpected.add(1);
}

export function readonlyRunCheck() {
  const response = http.post(
    `${BASE}/v1/runs`,
    JSON.stringify({ task_prompt: "k6 pat-abuse readonly probe", mode: "execute" }),
    { headers: Object.assign({ "Content-Type": "application/json" }, auth(READONLY_TOKEN)) },
  );
  const status = noteStatus(response);
  // The machine-readable reason, not just the status: a 403 for the wrong reason
  // (e.g. a route refusal instead of a scope refusal) would say nothing about
  // read-only tokens specifically.
  if (status === 403 && reasonOf(response) === "token_scope_insufficient") {
    readonlyRefused.add(1);
  } else {
    readonlyUnexpected.add(1);
  }
}

export function runScopeAdmittedCheck() {
  const response = http.post(
    `${BASE}/v1/runs`,
    JSON.stringify({ task_prompt: "k6 pat-abuse run-scope probe", mode: "execute" }),
    { headers: Object.assign({ "Content-Type": "application/json" }, auth(RUNSCOPE_TOKEN)) },
  );
  const status = noteStatus(response);
  if (status === 200 || status === 201) runAdmitted.add(1);
  else runUnexpected.add(1);
}

export function hardwareCheck() {
  const response = http.post(`${BASE}/v1/qpu/submissions`, JSON.stringify({}), {
    headers: Object.assign({ "Content-Type": "application/json" }, auth(RUNSCOPE_TOKEN)),
  });
  const status = noteStatus(response);
  if (status === 403) hardwareRefused.add(1);
  else hardwareUnexpected.add(1);
}
