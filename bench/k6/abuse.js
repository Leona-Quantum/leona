// Abuse scenarios for the API's admission controls — the 05-security.md §2
// release-gate box "Rate limits + quota enforcement demonstrated under k6 abuse
// scenario", which stood at "partial: both exist and are unit-tested; no k6 run
// has been done" from the day it was written.
//
// ## What a demonstration has to do that a unit test does not
//
// Every control here already has unit tests, and they pass. What they cannot
// show is the behaviour under genuine concurrency against a real database:
//
//   - `reserve_execute_run_slot` takes `SELECT ... FOR UPDATE` on the user row
//     precisely because two submissions at the boundary used to read the same
//     count and both pass. A test that issues its requests in sequence proves
//     the arithmetic and never touches the lock. Forty k6 VUs submitting at once
//     are separate connections hitting one Postgres row, which is the thing.
//   - The per-IP limiter's failure mode is *silent staleness*, not an error, so
//     "it refuses an abuser" is only half the claim. The other half — it does
//     not refuse anybody else while doing so — needs a second caller reading
//     THROUGH the flood, which is what `bystander` is.
//
// ## Every scenario has a control
//
// A refusal test alone passes just as well against a service that refuses
// everything, and this repository has shipped exactly that class of mistake: a
// limiter whose first shape exempted any caller who sent an `Authorization`
// header, and a "limit" that a chunked body walked straight through. So:
//
//   anon_flood       is controlled by  bystander        (a different address)
//   anon_flood       is controlled by  trusted_renderer (the SAME address, with
//                                                        the secret — so the
//                                                        exemption is proved to
//                                                        come from the token and
//                                                        not from the address)
//   oversized_body   is controlled by  ordinary_body
//   quota_storm      is controlled by  its own admitted count, which must be
//                                      EXACTLY the tier allowance — not merely
//                                      "some were refused", which a service that
//                                      refused everything would also satisfy
//
// ## Thresholds, not numbers
//
// Every claim is a k6 threshold, so this exits non-zero when the demonstration
// fails. A benchmark that prints numbers and asserts nothing cannot be a gate,
// and each threshold below is paired with a `count > 0` on the same scenario so
// that a scenario which never ran fails loudly instead of passing vacuously.
//
// Run it with `bench/k6/run-abuse.sh`, which builds the environment the
// assertions assume. Read that script before pointing this at anything shared.
import http from "k6/http";
import exec from "k6/execution";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:8000";
const TOKEN = __ENV.API_TOKEN || "";
const TRUSTED = __ENV.TRUSTED_TOKEN || "";

// The API's own default, asserted rather than assumed: `run-abuse.sh` reads it
// out of rate_limit.py and fails if it cannot. Testing against the real ceiling
// rather than a lowered one is the difference between demonstrating production
// and demonstrating a test fixture.
const ANON_LIMIT = Number(__ENV.ANON_LIMIT || "1200");

// Free tier: 5 verified runs a week, metered as 5 x 30,000 tokens. With no
// worker draining the queue every admitted run stays in flight and is charged
// TOKENS_PER_RUN_EQUIVALENT, so the boundary is exact: five admitted, the rest
// refused. An exact number is what makes this a race test — "roughly five"
// would pass with the row lock deleted.
const EXPECTED_ADMITTED = Number(__ENV.EXPECTED_ADMITTED || "5");

const FLOOD_ADDR = "198.51.100.10";
const BYSTANDER_ADDR = "198.51.100.200";

// --- counters -------------------------------------------------------------
// Named per scenario so a threshold can speak about one scenario alone. k6's
// built-in http_req_failed cannot: it is global, and a scenario that is SUPPOSED
// to produce 429s would drag it over any bound worth setting.

// Every flood request that actually left the generator. Without this,
// `flood_refused == 0` is ambiguous between the two explanations that matter —
// "the limiter did not refuse" and "the load generator never reached the
// ceiling" — and the first run of this suite was the second one.
const floodAttempts = new Counter("flood_attempts");
const floodRefused = new Counter("flood_refused");
const floodServed = new Counter("flood_served");
const floodUnexpected = new Counter("flood_unexpected");

const bystanderServed = new Counter("bystander_served");
const bystanderRefused = new Counter("bystander_refused");

const trustedServed = new Counter("trusted_served");
const trustedRefused = new Counter("trusted_refused");
const trustedMisverdict = new Counter("trusted_misverdict");

const oversizeRefused = new Counter("oversize_refused");
const oversizeAccepted = new Counter("oversize_accepted");
const ordinaryNotRefused = new Counter("ordinary_not_refused");

const quotaAdmitted = new Counter("quota_admitted");
const quotaRefused = new Counter("quota_refused");
const quotaUnexpected = new Counter("quota_unexpected");

const soakServed = new Counter("soak_served");
const soakRefused = new Counter("soak_refused");
const serverErrors = new Counter("server_errors");

// --- helpers --------------------------------------------------------------

// What the renderer actually fetches: a 100-record page of the list view, ~384 KB.
// The soak uses this because the soak is about the real read.
const CATALOG_PAGE = `${BASE}/v1/catalog/entries?limit=100&offset=0&view=list`;

// The SAME route, one record, ~3 KB.
//
// The admission scenarios use this and the difference is not cosmetic. The
// limiter answers before the handler, before a dependency, before a database
// session exists — `LIMITED_PATH_PREFIXES` decides on the path alone — so the
// payload is irrelevant to what is being tested. It is very relevant to whether
// the test can be performed: the first run of this suite floods with the full
// page, and at ~20 ms of real work per request a single worker could only
// absorb 1188 of them inside the window. The ceiling is 1200. The flood failed
// to reach the limit it was trying to prove, k6 dropped 2543 iterations, and
// `flood_refused` came back 0 — which reads exactly like a broken limiter.
//
// A cheap request is what lets the load generator, rather than the service under
// test, decide the rate.
const CATALOG_PROBE = `${BASE}/v1/catalog/entries?limit=1&view=list`;

/**
 * The API keys its limiter on the FIRST X-Forwarded-For entry, and that entry
 * is client-supplied by design — `client_address` documents why the leftmost is
 * read even though it is forgeable. That decision is what makes a per-address
 * demonstration possible at all from one machine: the header is exactly what
 * Cloud Run's front end injects in production, so setting it here reproduces
 * the production shape rather than working around it.
 */
function asAddress(addr, extra) {
  return Object.assign({ "X-Forwarded-For": addr, Accept: "application/json" }, extra || {});
}

/** Any 5xx, anywhere, is a failure of every scenario at once. */
function noteStatus(response) {
  if (response.status >= 500) serverErrors.add(1);
  return response.status;
}

export const options = {
  // Refusals are the POINT of this run, so k6's own pass/fail must not be
  // derived from HTTP status. Everything meaningful is a threshold below.
  discardResponseBodies: false,
  scenarios: {
    // One address far above the ceiling. `constant-arrival-rate` rather than a
    // VU loop so the rate is a property of the test and not of how fast the
    // service answers — a closed-loop test slows down exactly when the service
    // does, which is the moment you most want the pressure held.
    anon_flood: {
      executor: "constant-arrival-rate",
      rate: Math.ceil((ANON_LIMIT * 3) / 20),
      timeUnit: "1s",
      duration: "20s",
      preAllocatedVUs: 40,
      maxVUs: 120,
      exec: "flood",
      startTime: "0s",
    },
    // A different address, reading at a human pace, THROUGH the flood. Its
    // startTime and duration sit inside the flood's on purpose: measured after
    // the flood it would prove nothing, because the window would have rolled.
    bystander: {
      executor: "constant-arrival-rate",
      rate: 2,
      timeUnit: "1s",
      duration: "18s",
      preAllocatedVUs: 4,
      maxVUs: 8,
      exec: "bystander",
      startTime: "1s",
    },
    // Our own renderer, on the FLOODED address, holding the secret. Same
    // address as the flood so that a pass cannot be explained by the address —
    // only the token can explain it.
    trusted_renderer: {
      executor: "constant-arrival-rate",
      rate: 20,
      timeUnit: "1s",
      duration: "18s",
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: "trustedRenderer",
      startTime: "1s",
    },
    // Body-size admission. After the flood so its refusals cannot be confused
    // with the limiter's, and on its own address for the same reason.
    oversized_body: {
      executor: "per-vu-iterations",
      vus: 4,
      iterations: 3,
      exec: "oversizedBody",
      startTime: "22s",
    },
    // The control for it. A 1 MiB limit that refused every body would satisfy
    // `oversize_refused` perfectly.
    ordinary_body: {
      executor: "per-vu-iterations",
      vus: 4,
      iterations: 3,
      exec: "ordinaryBody",
      startTime: "22s",
    },
    // Forty concurrent submissions from ONE free account. Sequential requests
    // would exercise the arithmetic and never the lock; this is the burst the
    // lock was added for, arriving on forty connections at once.
    quota_storm: {
      executor: "shared-iterations",
      vus: 40,
      iterations: 40,
      exec: "quotaStorm",
      startTime: "30s",
      maxDuration: "60s",
    },
    // The launch shape: 120 readers, each a distinct address, sustained. Not an
    // abuse scenario — the control that says the ceilings above do not refuse a
    // full launch's worth of legitimate traffic.
    sustained_readers: {
      executor: "constant-vus",
      vus: 120,
      duration: "45s",
      exec: "soak",
      startTime: "95s",
    },
  },
  thresholds: {
    // --- the flood is refused, and only ever with a 429 -------------------
    // Attempts first, and above the ceiling, so that a failure downstream of it
    // cannot be misread. A suite that floods below the limit proves nothing and
    // says nothing about why.
    flood_attempts: [`count>${ANON_LIMIT}`],
    flood_refused: ["count>0"],
    flood_unexpected: ["count==0"],
    // The service must keep SERVING while it refuses. A limiter that answered
    // 429 to every single request inside the window would pass `flood_refused`
    // and would be broken.
    flood_served: ["count>0"],

    // --- and nobody else is refused while it happens ----------------------
    bystander_served: ["count>0"],
    bystander_refused: ["count==0"],

    // --- the exemption comes from the token, not the address --------------
    trusted_served: ["count>0"],
    trusted_refused: ["count==0"],
    trusted_misverdict: ["count==0"],

    // --- body size ---------------------------------------------------------
    oversize_refused: ["count>0"],
    oversize_accepted: ["count==0"],
    ordinary_not_refused: ["count>0"],

    // --- quota, exactly at the allowance ----------------------------------
    quota_admitted: [`count==${EXPECTED_ADMITTED}`],
    quota_refused: ["count>0"],
    quota_unexpected: ["count==0"],

    // --- a launch's worth of readers is served ----------------------------
    soak_served: ["count>0"],
    soak_refused: ["count==0"],
    // A COLLAPSE bound, not a capacity claim, and the difference is the whole
    // reason this number is 10s rather than something impressive.
    //
    // Unloaded, this route answers a 384 KB page in ~19 ms. Under this scenario
    // it answers in ~1.7s — and that gap is the harness, not the service: one
    // uvicorn worker, on a laptop, sharing a CPU with 120 k6 VUs and the
    // Postgres container they are all reading through. Production is Cloud Run
    // with `--max-instances` from infra/fleet.env, and the renderer reads this
    // route on a 300-second revalidate rather than once per visitor.
    //
    // So a tight threshold here would be measuring this machine and reporting it
    // as a promise about production. The claims this scenario CAN support are the
    // two above it — `soak_refused == 0`, so a launch's worth of readers is not
    // refused by the ceilings, and `server_errors == 0`. This bound only catches
    // the service falling over, which is worth catching and is not the same thing.
    "http_req_duration{scenario:sustained_readers}": ["p(95)<10000"],

    // --- and nothing anywhere 500s ----------------------------------------
    server_errors: ["count==0"],
  },
};

// --- scenario bodies ------------------------------------------------------

export function flood() {
  floodAttempts.add(1);
  const response = http.get(CATALOG_PROBE, { headers: asAddress(FLOOD_ADDR) });
  const status = noteStatus(response);
  if (status === 429) {
    // A refusal has to be actionable, not just a number. Both of these have
    // been wrong in this service before: `Retry-After: 0` reads as "retry now",
    // which is the instruction that caused the refusal.
    const retryAfter = Number(response.headers["Retry-After"] || "0");
    const contentType = response.headers["Content-Type"] || "";
    if (retryAfter < 1 || contentType.indexOf("application/problem+json") !== 0) {
      floodUnexpected.add(1);
    } else {
      floodRefused.add(1);
    }
  } else if (status === 200 || status === 404) {
    // 404 is the honest answer when SYSTEM_CATALOG_ENABLED is off. It still
    // proves admission, because the limiter answers before any handler runs —
    // but run-abuse.sh provisions the catalog so this is normally 200.
    floodServed.add(1);
  } else {
    floodUnexpected.add(1);
  }
}

export function bystander() {
  const response = http.get(CATALOG_PROBE, { headers: asAddress(BYSTANDER_ADDR) });
  const status = noteStatus(response);
  if (status === 429) bystanderRefused.add(1);
  else bystanderServed.add(1);
}

export function trustedRenderer() {
  const response = http.get(CATALOG_PROBE, {
    headers: asAddress(FLOOD_ADDR, { "X-Majorana-Trusted-Caller": TRUSTED }),
  });
  const status = noteStatus(response);
  // The verdict the API echoed. Checked separately from the status because the
  // two can disagree in the direction that matters: a renderer being served
  // only because the window has not filled yet looks identical to an exempt
  // one, right up to the moment it stops.
  const verdict = response.headers["X-Majorana-Caller-Trust"];
  if (verdict !== "trusted") trustedMisverdict.add(1);
  if (status === 429) trustedRefused.add(1);
  else trustedServed.add(1);
}

export function oversizedBody() {
  // Over MAX_REQUEST_BYTES (1 MiB). Sent to an authenticated route on purpose:
  // the size gate must answer BEFORE auth, so a 401 here would mean the body was
  // read first — which is the whole thing the limit exists to prevent.
  const body = "x".repeat(1024 * 1024 + 4096);
  const response = http.post(`${BASE}/v1/runs`, body, {
    headers: { "Content-Type": "application/json" },
  });
  const status = noteStatus(response);
  if (status === 413) oversizeRefused.add(1);
  else oversizeAccepted.add(1);
}

export function ordinaryBody() {
  const response = http.post(`${BASE}/v1/runs`, JSON.stringify({ task_prompt: "hello" }), {
    headers: { "Content-Type": "application/json" },
  });
  const status = noteStatus(response);
  // 401 is the expected answer — unauthenticated. Anything but 413 proves the
  // size gate let an ordinary document through, which is what this controls for.
  if (status !== 413) ordinaryNotRefused.add(1);
}

export function quotaStorm() {
  if (!TOKEN) {
    exec.test.abort("quota_storm needs API_TOKEN; run via bench/k6/run-abuse.sh");
  }
  const response = http.post(
    `${BASE}/v1/runs`,
    JSON.stringify({
      // EXPLICIT execute. An AUTO submission has not decided what it is yet and
      // is deliberately unmetered at this route — metering it would refuse
      // ordinary chat. So AUTO would measure nothing here.
      task_prompt: `k6 abuse scenario submission ${exec.scenario.iterationInTest}`,
      mode: "execute",
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
    },
  );
  const status = noteStatus(response);
  if (status === 200 || status === 201) {
    quotaAdmitted.add(1);
  } else if (status === 429) {
    let reason = "";
    try {
      reason = (response.json() || {}).reason || "";
    } catch (_) {
      reason = "";
    }
    // The typed reason, not merely the status. `run_allowance_exhausted` is a
    // wire value the web app matches on to show the plan message; a 429 from
    // the per-IP limiter would carry `anonymous_rate_limited` instead and would
    // mean this scenario measured the wrong control entirely.
    if (reason === "run_allowance_exhausted") quotaRefused.add(1);
    else quotaUnexpected.add(1);
  } else {
    quotaUnexpected.add(1);
  }
}

export function soak() {
  // One distinct address per VU: 120 readers, none of them individually near
  // the ceiling. That is the launch shape — the ceilings must not refuse it.
  const addr = `203.0.113.${(exec.vu.idInTest % 250) + 1}`;
  const response = http.get(CATALOG_PAGE, { headers: asAddress(addr) });
  const status = noteStatus(response);
  if (status === 429) soakRefused.add(1);
  else soakServed.add(1);
}
