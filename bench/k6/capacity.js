// Capacity profiles for the 100-user launch target.
//
// This file intentionally does not start an API, provision a database, or
// create a worker. `run-capacity.sh` provides the safety boundary and the
// target is expected to be prepared separately. The profiles are one
// per-VU iteration by default: exactly 100 VUs arrive together, then stop.
// That keeps a submit test from silently creating an unbounded number of runs.
import http from "k6/http";
import exec from "k6/execution";
import { Counter } from "k6/metrics";

const SCENARIO_NAMES = ["read_100", "sse_100", "submit_100", "mixed_100"];
const SCENARIO = __ENV.CAPACITY_SCENARIO || "read_100";
const BASE = normalizeBaseUrl(__ENV.BASE_URL || "http://127.0.0.1:8000");
const API_TOKEN = __ENV.API_TOKEN || "";
const USER_COUNT = positiveInteger("CAPACITY_USER_COUNT", 100);
const MAX_DURATION = __ENV.CAPACITY_MAX_DURATION || "60s";
const REQUEST_TIMEOUT = __ENV.CAPACITY_REQUEST_TIMEOUT || "15s";
const SSE_TIMEOUT = __ENV.CAPACITY_SSE_TIMEOUT || "15s";
const MAX_DURATION_MS = durationMs(MAX_DURATION);
const REQUEST_TIMEOUT_MS = durationMs(REQUEST_TIMEOUT);
const SSE_TIMEOUT_MS = durationMs(SSE_TIMEOUT);
const READ_LIMIT = positiveInteger("CAPACITY_READ_LIMIT", 100);
const MIN_CATALOG_ENTRIES = nonNegativeInteger("CAPACITY_MIN_CATALOG_ENTRIES", 1);
const READ_P95_MS = positiveInteger("CAPACITY_READ_P95_MS", 10000);
const SUBMIT_P95_MS = positiveInteger("CAPACITY_SUBMIT_P95_MS", 10000);
const SSE_RUN_ID = __ENV.CAPACITY_SSE_RUN_ID || "";
const RUN_PREFIX = __ENV.CAPACITY_RUN_PREFIX || "";

const MIX_READ_PERCENT = nonNegativeInteger("CAPACITY_MIX_READ_PERCENT", 70);
const MIX_SSE_PERCENT = nonNegativeInteger("CAPACITY_MIX_SSE_PERCENT", 20);
const MIX_SUBMIT_PERCENT = nonNegativeInteger("CAPACITY_MIX_SUBMIT_PERCENT", 10);

const NONLOCAL_APPROVAL = "I_UNDERSTAND_THIS_IS_NOT_PRODUCTION";
const WRITE_APPROVAL = "I_UNDERSTAND_THIS_CREATES_TEST_RUNS";
const PRODUCTION_APPROVAL = "I_UNDERSTAND_THIS_CAN_AFFECT_PRODUCTION";

// --- safety and configuration --------------------------------------------

function normalizeBaseUrl(value) {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!/^https?:\/\/[^/?#]+(?:[/?#].*)?$/i.test(trimmed)) {
    throw new Error("BASE_URL must be an absolute http(s) URL");
  }
  if (trimmed.indexOf("?") >= 0 || trimmed.indexOf("#") >= 0) {
    throw new Error("BASE_URL must not contain a query or fragment");
  }
  const authority = /^https?:\/\/([^/]+)/i.exec(trimmed);
  if (authority && authority[1].indexOf("@") >= 0) {
    throw new Error("BASE_URL must not contain embedded credentials");
  }
  return trimmed;
}

function targetHost(url) {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  if (!match) throw new Error("BASE_URL has no host");
  let host = match[1].toLowerCase();
  if (host[0] === "[") host = host.slice(1, host.indexOf("]"));
  else host = host.split(":")[0];
  return host;
}

function assertTargetSafety(url) {
  const host = targetHost(url);
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local) {
    if (
      __ENV.CAPACITY_ALLOW_NONLOCAL_TARGET !== "1" ||
      __ENV.CAPACITY_NONLOCAL_TARGET_APPROVAL !== NONLOCAL_APPROVAL
    ) {
      throw new Error(
        "Refusing non-local BASE_URL. Set CAPACITY_ALLOW_NONLOCAL_TARGET=1 and " +
          `CAPACITY_NONLOCAL_TARGET_APPROVAL=${NONLOCAL_APPROVAL} only for an approved test target`,
      );
    }
  }

  const productionLike =
    host === "api.leonaquantum.com" || /(^|[.-])(prod|production)([.-]|$)/i.test(host);
  if (
    productionLike &&
    (__ENV.CAPACITY_ALLOW_PRODUCTION !== "1" ||
      __ENV.CAPACITY_PRODUCTION_TARGET_APPROVAL !== PRODUCTION_APPROVAL)
  ) {
    throw new Error(
      "Refusing a production-like BASE_URL. Use an isolated local or staging target; " +
        "production requires a separate explicit approval",
    );
  }
}

function requireWriteApproval() {
  if (
    __ENV.CAPACITY_ALLOW_WRITES !== "1" ||
    __ENV.CAPACITY_WRITE_APPROVAL !== WRITE_APPROVAL
  ) {
    throw new Error(
      "This profile creates test runs. Set CAPACITY_ALLOW_WRITES=1 and " +
        `CAPACITY_WRITE_APPROVAL=${WRITE_APPROVAL}`,
    );
  }
}

function positiveInteger(name, fallback) {
  const raw = __ENV[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(name, fallback) {
  const raw = __ENV[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function durationMs(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/i.exec(value.trim());
  if (!match) throw new Error("CAPACITY_SSE_TIMEOUT must use ms, s, or m");
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return unit === "ms" ? amount : unit === "s" ? amount * 1000 : amount * 60 * 1000;
}

if (!SCENARIO_NAMES.includes(SCENARIO)) {
  throw new Error(`CAPACITY_SCENARIO must be one of: ${SCENARIO_NAMES.join(", ")}`);
}
if (MIX_READ_PERCENT + MIX_SSE_PERCENT + MIX_SUBMIT_PERCENT !== 100) {
  throw new Error("CAPACITY_MIX_*_PERCENT values must sum to 100");
}
if (MAX_DURATION_MS <= 0 || REQUEST_TIMEOUT_MS <= 0 || SSE_TIMEOUT_MS <= 0) {
  throw new Error("capacity durations and timeouts must be greater than zero");
}
assertTargetSafety(BASE);

const needsAuth = SCENARIO !== "read_100";
const needsSeedRun = (SCENARIO === "sse_100" || SCENARIO === "mixed_100") && !SSE_RUN_ID;
const createsRuns = SCENARIO === "submit_100" || SCENARIO === "mixed_100" || needsSeedRun;
if (needsAuth && !API_TOKEN) {
  throw new Error("API_TOKEN is required for authenticated capacity profiles");
}
if (createsRuns) requireWriteApproval();

// --- counters -------------------------------------------------------------

const serverErrors = new Counter("capacity_server_errors");

const readAttempts = new Counter("capacity_read_attempts");
const readSuccess = new Counter("capacity_read_success");
const readUnexpected = new Counter("capacity_read_unexpected");

const submitAttempts = new Counter("capacity_submit_attempts");
const submitCreated = new Counter("capacity_submit_created");
const submitUnexpected = new Counter("capacity_submit_unexpected");

const sseAttempts = new Counter("capacity_sse_attempts");
const sseAccepted = new Counter("capacity_sse_accepted");
const sseTimeouts = new Counter("capacity_sse_timeouts");
const sseHandled = new Counter("capacity_sse_handled");
const sseProtocolErrors = new Counter("capacity_sse_protocol_errors");
const sseUnexpected = new Counter("capacity_sse_unexpected");

const CATALOG_URL = `${BASE}/v1/catalog/entries?limit=${READ_LIMIT}&offset=0&view=list`;

function authHeaders(extra) {
  return Object.assign(
    {
      Accept: "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
    },
    extra || {},
  );
}

function noteStatus(response) {
  if (response.status >= 500) serverErrors.add(1);
  return response.status;
}

function isTimeout(response) {
  const message = String(response.error || "").toLowerCase();
  // 105 is k6's documented request-timeout error code. Keep the text check as
  // a compatibility fallback for k6 builds that omit error_code.
  return response.error_code === 105 || message.indexOf("timeout") >= 0;
}

function isTerminalStatus(status) {
  return ["succeeded", "failed", "cancelled", "done", "error"].includes(status);
}

function parseJson(response, label) {
  try {
    return response.json();
  } catch (_) {
    throw new Error(`${label} returned non-JSON response (HTTP ${response.status})`);
  }
}

function catalogPreflight() {
  const response = http.get(CATALOG_URL, {
    timeout: REQUEST_TIMEOUT,
    tags: { capacity_operation: "setup_catalog" },
  });
  const status = noteStatus(response);
  const total = Number(response.headers["X-Catalog-Total"] || "0");
  if (status !== 200 || total < MIN_CATALOG_ENTRIES) {
    throw new Error(
      `catalog preflight failed: HTTP ${status}, X-Catalog-Total=${total}, ` +
        `expected at least ${MIN_CATALOG_ENTRIES}`,
    );
  }
}

function authPreflight() {
  const response = http.get(`${BASE}/v1/me`, {
    timeout: REQUEST_TIMEOUT,
    headers: authHeaders(),
    tags: { capacity_operation: "setup_auth" },
  });
  const status = noteStatus(response);
  if (status !== 200) {
    throw new Error(`auth preflight failed: HTTP ${status}`);
  }
}

function createSeedRun(prefix) {
  const response = http.post(
    `${BASE}/v1/runs`,
    JSON.stringify({
      task_prompt: `${prefix} SSE hold run`,
      mode: "chat",
      framework: "qiskit",
      response_locale: "en",
    }),
    {
      timeout: REQUEST_TIMEOUT,
      headers: authHeaders({
        "Content-Type": "application/json",
        "Idempotency-Key": `${prefix}-seed`,
      }),
      tags: { capacity_operation: "setup_seed_run" },
    },
  );
  const status = noteStatus(response);
  if (status !== 201) {
    throw new Error(`SSE seed run creation failed: HTTP ${status}`);
  }
  const body = parseJson(response, "SSE seed run creation");
  if (!body.id) throw new Error("SSE seed run creation returned no run id");
  return body.id;
}

function validateSeedRun(runId) {
  const response = http.get(`${BASE}/v1/runs/${runId}`, {
    timeout: REQUEST_TIMEOUT,
    headers: authHeaders(),
    tags: { capacity_operation: "setup_seed_run_check" },
  });
  const status = noteStatus(response);
  if (status !== 200) {
    throw new Error(`SSE seed run lookup failed: HTTP ${status}`);
  }
  const body = parseJson(response, "SSE seed run lookup");
  if (isTerminalStatus(body.status) && __ENV.CAPACITY_ALLOW_TERMINAL_SSE !== "1") {
    throw new Error(
      `SSE seed run ${runId} is already terminal (${body.status}); provide a queued/running ` +
        "run or set CAPACITY_ALLOW_TERMINAL_SSE=1 for a replay-only test",
    );
  }
}

export function setup() {
  const prefix = RUN_PREFIX || `k6-capacity-${Date.now()}`;
  if (needsAuth) authPreflight();
  if (SCENARIO === "read_100" || SCENARIO === "mixed_100") catalogPreflight();

  let runId = SSE_RUN_ID;
  if (needsSeedRun) runId = createSeedRun(prefix);
  if (SCENARIO === "sse_100" || SCENARIO === "mixed_100") validateSeedRun(runId);

  return { run_id: runId, run_prefix: prefix };
}

// --- operations -----------------------------------------------------------

function readCatalog() {
  readAttempts.add(1);
  const response = http.get(CATALOG_URL, {
    timeout: REQUEST_TIMEOUT,
    tags: { capacity_operation: "catalog_read" },
  });
  const status = noteStatus(response);
  if (status === 200) readSuccess.add(1);
  else readUnexpected.add(1);
}

function submitRun(data) {
  submitAttempts.add(1);
  const requestId = `${data.run_prefix}-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`;
  const response = http.post(
    `${BASE}/v1/runs`,
    JSON.stringify({
      // CHAT avoids the execute allowance and provider execution path. The
      // write still exercises auth, workspace scope, idempotency, run/event
      // persistence, and job enqueueing. A worker may process it, so writes
      // remain opt-in and the target must be isolated.
      task_prompt: `k6 capacity chat ${requestId}`,
      mode: "chat",
      framework: "qiskit",
      response_locale: "en",
    }),
    {
      timeout: REQUEST_TIMEOUT,
      headers: authHeaders({
        "Content-Type": "application/json",
        "Idempotency-Key": requestId,
      }),
      tags: { capacity_operation: "run_submit" },
    },
  );
  const status = noteStatus(response);
  if (status === 201) submitCreated.add(1);
  else submitUnexpected.add(1);
}

function streamRun(data) {
  sseAttempts.add(1);
  const response = http.get(`${BASE}/v1/runs/${data.run_id}/events/stream`, {
    timeout: SSE_TIMEOUT,
    headers: authHeaders({ Accept: "text/event-stream", "Last-Event-ID": "0" }),
    tags: { capacity_operation: "sse_stream" },
  });
  const status = noteStatus(response);
  if (status === 200) {
    const contentType = String(response.headers["Content-Type"] || "").toLowerCase();
    if (contentType.indexOf("text/event-stream") !== 0) {
      sseProtocolErrors.add(1);
      sseUnexpected.add(1);
    } else {
      sseAccepted.add(1);
      sseHandled.add(1);
    }
  } else if (isTimeout(response)) {
    // k6 returns a timeout for a deliberately held stream. Count it as
    // handled only when no HTTP error was returned; the JSON report preserves
    // the timeout count so the operator can distinguish held sockets from
    // completed/replayed streams.
    sseTimeouts.add(1);
    sseHandled.add(1);
  } else {
    sseUnexpected.add(1);
  }
}

function mixedKind(vuId) {
  const slot = ((vuId - 1) % 100) + 1;
  if (slot <= MIX_READ_PERCENT) return "read";
  if (slot <= MIX_READ_PERCENT + MIX_SSE_PERCENT) return "sse";
  return "submit";
}

function expectedMixedCounts() {
  const counts = { read: 0, sse: 0, submit: 0 };
  for (let vu = 1; vu <= USER_COUNT; vu += 1) counts[mixedKind(vu)] += 1;
  return counts;
}

export function read_100() {
  readCatalog();
}

export function sse_100(data) {
  streamRun(data);
}

export function submit_100(data) {
  submitRun(data);
}

export function mixed_100(data) {
  const kind = mixedKind(exec.vu.idInTest);
  if (kind === "read") readCatalog();
  else if (kind === "sse") streamRun(data);
  else submitRun(data);
}

// --- thresholds -----------------------------------------------------------

function addReadThresholds(thresholds, expected) {
  thresholds.capacity_read_attempts = [`count==${expected}`];
  thresholds.capacity_read_success = [`count==${expected}`];
  thresholds.capacity_read_unexpected = ["count==0"];
  thresholds["http_req_duration{capacity_operation:catalog_read}"] = [`p(95)<${READ_P95_MS}`];
}

function addSubmitThresholds(thresholds, expected) {
  thresholds.capacity_submit_attempts = [`count==${expected}`];
  thresholds.capacity_submit_created = [`count==${expected}`];
  thresholds.capacity_submit_unexpected = ["count==0"];
  thresholds["http_req_duration{capacity_operation:run_submit}"] = [`p(95)<${SUBMIT_P95_MS}`];
}

function addSseThresholds(thresholds, expected) {
  thresholds.capacity_sse_attempts = [`count==${expected}`];
  thresholds.capacity_sse_handled = [`count==${expected}`];
  thresholds.capacity_sse_unexpected = ["count==0"];
  thresholds.capacity_sse_protocol_errors = ["count==0"];
}

const thresholds = {
  capacity_server_errors: ["count==0"],
};
if (SCENARIO === "read_100") addReadThresholds(thresholds, USER_COUNT);
if (SCENARIO === "sse_100") addSseThresholds(thresholds, USER_COUNT);
if (SCENARIO === "submit_100") addSubmitThresholds(thresholds, USER_COUNT);
if (SCENARIO === "mixed_100") {
  const counts = expectedMixedCounts();
  addReadThresholds(thresholds, counts.read);
  addSseThresholds(thresholds, counts.sse);
  addSubmitThresholds(thresholds, counts.submit);
}

export const options = {
  discardResponseBodies: false,
  scenarios: {
    [SCENARIO]: {
      executor: "per-vu-iterations",
      vus: USER_COUNT,
      iterations: 1,
      maxDuration: MAX_DURATION,
      exec: SCENARIO,
    },
  },
  thresholds,
};
