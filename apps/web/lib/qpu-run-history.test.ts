import assert from "node:assert/strict";
import test from "node:test";

import { TIER_LIMITS } from "./account-tier.ts";
import { backendNameOf, fetchLatestQpuRunFor, fetchQpuRunHistory, type QpuRunHistoryItem } from "./qpu.ts";
import { appendRunPage, groupRunsByBackend, readRun } from "./qpu-run-history.ts";
import { sourceFingerprint } from "./studio-simulation.ts";

const BELL_QASM = [
  "OPENQASM 3.0;",
  'include "stdgates.inc";',
  "qubit[2] q;",
  "bit[2] c;",
  "h q[0];",
  "cx q[0], q[1];",
  "c = measure q;",
].join("\n");

let sequence = 0;
function run(overrides: Partial<QpuRunHistoryItem> = {}): QpuRunHistoryItem {
  sequence += 1;
  return {
    id: `00000000-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    provider: "ibm",
    device_id: "ibm.open_plan",
    provider_job_id: `job-${sequence}`,
    backend_name: "ibm_brisbane",
    shots: 1000,
    status: "done",
    source_fingerprint: sourceFingerprint(BELL_QASM),
    estimated_total_usd: null,
    rate_source: "https://example.invalid/rates",
    rate_confirmed_on: "2026-09-22",
    raw_counts: { "00": 480, "11": 470, "01": 30, "10": 20 },
    error: null,
    submitted_at: "2026-09-22T00:00:00Z",
    completed_at: "2026-09-22T00:10:00Z",
    created_at: "2026-09-22T00:00:00Z",
    qasm: BELL_QASM,
    ...overrides,
  };
}

test("runs group by the machine that ran them, in order of each machine's latest run", () => {
  const newest = run({ backend_name: "ibm_torino" });
  const middle = run({ backend_name: "ibm_brisbane" });
  const older = run({ backend_name: "ibm_torino" });
  const groups = groupRunsByBackend([newest, middle, older]);
  assert.deepEqual(
    groups.map((group) => [group.backend, group.runs.map((item) => item.id)]),
    [
      ["ibm_torino", [newest.id, older.id]],
      ["ibm_brisbane", [middle.id]],
    ],
  );
});

test("runs with no recorded machine form one group, last, and are never assigned one", () => {
  // Newest of all, and still last: that group is not a device.
  const unrecordedNewest = run({ backend_name: null });
  const recorded = run({ backend_name: "ibm_brisbane" });
  const fromAnOlderApi = run();
  delete (fromAnOlderApi as { backend_name?: unknown }).backend_name;
  const blank = run({ backend_name: "   " });

  const groups = groupRunsByBackend([unrecordedNewest, recorded, fromAnOlderApi, blank]);
  assert.deepEqual(groups.map((group) => group.backend), ["ibm_brisbane", null]);
  assert.deepEqual(groups[1].runs.map((item) => item.id), [unrecordedNewest.id, fromAnOlderApi.id, blank.id]);
  assert.equal(backendNameOf(fromAnOlderApi), null);
  assert.equal(backendNameOf(blank), null);
});

test("an empty history is no groups, not one empty group", () => {
  assert.deepEqual(groupRunsByBackend([]), []);
});

test("appending a page that was already shown repeats no run", () => {
  const first = [run(), run()];
  const second = [run()];
  const once = appendRunPage(first, second);
  const twice = appendRunPage(once, second);
  assert.deepEqual(twice.map((item) => item.id), [...first, ...second].map((item) => item.id));
});

test("a finished run is compared against its own stored program", () => {
  const reading = readRun(run(), TIER_LIMITS.free);
  assert.equal(reading.kind, "compared");
  if (reading.kind !== "compared") return;
  assert.equal(reading.comparison.status, "computed");
  if (reading.comparison.status !== "computed") return;
  // 50 of 1000 shots landed outside {00, 11}: a distance of 0.05 from ideal.
  assert.ok(Math.abs(reading.comparison.tvd - 0.05) < 1e-9, `tvd ${reading.comparison.tvd}`);
  assert.ok(reading.comparison.shotNoiseTvd > 0);
});

test("a stored program that does not match its fingerprint is not compared", () => {
  const reading = readRun(run({ source_fingerprint: "fnv1a-00000000" }), TIER_LIMITS.free);
  assert.deepEqual(reading, { kind: "compared", comparison: { status: "unavailable", reason: "circuit_changed" } });
});

test("unfinished and failed runs get their own reading, not a comparison", () => {
  assert.deepEqual(readRun(run({ status: "queued", raw_counts: null }), TIER_LIMITS.free), { kind: "in_progress" });
  assert.deepEqual(readRun(run({ status: "running", raw_counts: null }), TIER_LIMITS.free), { kind: "in_progress" });
  assert.deepEqual(readRun(run({ status: "error", raw_counts: null }), TIER_LIMITS.free), { kind: "ended_without_counts" });
  assert.deepEqual(readRun(run({ status: "cancelled" }), TIER_LIMITS.free), { kind: "ended_without_counts" });
});

function captureFetch(body: unknown, status = 200): string[] {
  const urls: string[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (url: string) => {
    urls.push(url);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return urls;
}

test("the history client sends the cursor, limit and fingerprint it was given", async () => {
  const urls = captureFetch({ items: [], next_cursor: null });
  await fetchQpuRunHistory();
  await fetchQpuRunHistory({ cursor: "abc", limit: 25, sourceFingerprint: "fnv1a-1234abcd" });
  assert.deepEqual(urls, [
    "/api/qpu/runs",
    "/api/qpu/runs?cursor=abc&limit=25&source_fingerprint=fnv1a-1234abcd",
  ]);
});

test("a body that is not a history is an error, never an empty history", async () => {
  captureFetch("<html>bad gateway</html>");
  await assert.rejects(() => fetchQpuRunHistory(), /malformed/);
  captureFetch({ detail: "nope" });
  await assert.rejects(() => fetchQpuRunHistory(), /malformed/);
  captureFetch({ items: [] }, 502);
  await assert.rejects(() => fetchQpuRunHistory(), /unavailable \(502\)/);
});

test("the latest run of a circuit is the first item of a one-row page, or null", async () => {
  const latest = run();
  const urls = captureFetch({ items: [latest], next_cursor: "x" });
  assert.equal((await fetchLatestQpuRunFor(latest.source_fingerprint))?.id, latest.id);
  assert.equal(urls[0], `/api/qpu/runs?limit=1&source_fingerprint=${latest.source_fingerprint}`);
  captureFetch({ items: [], next_cursor: null });
  assert.equal(await fetchLatestQpuRunFor("fnv1a-00000000"), null);
});
