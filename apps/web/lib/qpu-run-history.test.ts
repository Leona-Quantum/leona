import assert from "node:assert/strict";
import test from "node:test";

import { TIER_LIMITS } from "./account-tier.ts";
import {
  afterRestore,
  backendNameOf,
  fetchLatestQpuRunFor,
  fetchQpuRunHistory,
  runForCircuit,
  type QpuRunHistoryItem,
} from "./qpu.ts";
import {
  appendRunPage,
  applyRunUpdates,
  compareRun,
  groupRunsByBackend,
  mitigateRun,
  nextMacrotask,
  readRun,
  unfinishedRunIds,
  workThroughComparisons,
} from "./qpu-run-history.ts";
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
  const comparison = compareRun(run(), TIER_LIMITS.free);
  assert.equal(comparison.status, "computed");
  if (comparison.status !== "computed") return;
  // 50 of 1000 shots landed outside {00, 11}: a distance of 0.05 from ideal.
  assert.ok(Math.abs(comparison.tvd - 0.05) < 1e-9, `tvd ${comparison.tvd}`);
  assert.ok(comparison.shotNoiseTvd > 0);
});

test("a stored program that does not match its fingerprint is not compared", () => {
  assert.deepEqual(compareRun(run({ source_fingerprint: "fnv1a-00000000" }), TIER_LIMITS.free), {
    status: "unavailable",
    reason: "circuit_changed",
  });
});

test("reading a run never computes: a finished run without a result is still being worked out", () => {
  const finished = run();
  assert.deepEqual(readRun(finished, new Map()), { kind: "working_out" });
  const comparison = compareRun(finished, TIER_LIMITS.free);
  assert.deepEqual(readRun(finished, new Map([[finished.id, comparison]])), { kind: "compared", comparison });
});

test("a run's mitigated readings are measured against the comparison it already has", () => {
  // Proposal 5, increment 4: the page works these out in the same task as the
  // comparison, reusing its ideal, so there is no second simulation.
  const item = run({
    mitigation: {
      version: 1,
      readout: {
        register: "c",
        calibrated_at: null,
        bits: [
          { clbit: 0, qubit: 0, prob_meas1_prep0: 0.02, prob_meas0_prep1: 0.04, source: "backend_properties" },
          { clbit: 1, qubit: 1, prob_meas1_prep0: 0.02, prob_meas0_prep1: 0.03, source: "backend_properties" },
        ],
      },
    },
  });
  const comparison = compareRun(item, TIER_LIMITS.free);
  const readings = mitigateRun(item, comparison);
  assert.equal(readings?.readout.status, "computed");
  if (readings?.readout.status !== "computed" || comparison.status !== "computed") return;
  assert.ok(readings.readout.reading.tvd < comparison.tvd, `${readings.readout.reading.tvd} vs ${comparison.tvd}`);
  assert.equal(readings.zne, null);
  // No computed comparison, nothing to measure against.
  const mismatched = run({ source_fingerprint: "fnv1a-00000000" });
  assert.equal(mitigateRun(mismatched, compareRun(mismatched, TIER_LIMITS.free)), null);
});

test("unfinished and failed runs get their own reading, not a comparison", () => {
  const none = new Map();
  assert.deepEqual(readRun(run({ status: "queued", raw_counts: null }), none), { kind: "in_progress" });
  assert.deepEqual(readRun(run({ status: "running", raw_counts: null }), none), { kind: "in_progress" });
  assert.deepEqual(readRun(run({ status: "error", raw_counts: null }), none), { kind: "ended_without_counts" });
  assert.deepEqual(readRun(run({ status: "cancelled" }), none), { kind: "ended_without_counts" });
});

/** A scheduler the test drives by hand: nothing runs until `flushOne`. */
function manualScheduler() {
  const queue: { task: () => void; cancelled: boolean }[] = [];
  return {
    schedule: (task: () => void) => {
      const entry = { task, cancelled: false };
      queue.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    pending: () => queue.filter((entry) => !entry.cancelled).length,
    flushOne: () => {
      const entry = queue.shift();
      if (entry && !entry.cancelled) entry.task();
    },
  };
}

function worker(order: QpuRunHistoryItem[], cached = new Set<string>()) {
  const scheduler = manualScheduler();
  const computed: string[] = [];
  const results = new Map<string, unknown>();
  const stop = workThroughComparisons({
    order,
    isCached: (id) => cached.has(id) || results.has(id),
    compute: (item) => {
      computed.push(item.id);
      return { status: "unavailable", reason: "no_counts" };
    },
    onResult: (id, comparison) => results.set(id, comparison),
    schedule: scheduler.schedule,
  });
  return { scheduler, computed, results, stop, cached };
}

test("comparisons are worked out one per task, none during the call that plans them", () => {
  const order = [run(), run(), run()];
  const { scheduler, computed } = worker(order);
  // The whole point: planning computes nothing, it only asks for a turn.
  assert.deepEqual(computed, []);
  assert.equal(scheduler.pending(), 1);
  scheduler.flushOne();
  assert.deepEqual(computed, [order[0].id]);
  scheduler.flushOne();
  scheduler.flushOne();
  assert.deepEqual(computed, order.map((item) => item.id));
  assert.equal(scheduler.pending(), 0);
});

test("only finished runs are compared, each once, in the order given", () => {
  const finishedA = run();
  const queued = run({ status: "queued", raw_counts: null });
  const failed = run({ status: "error", raw_counts: null });
  const finishedB = run();
  const { scheduler, computed } = worker([finishedA, queued, finishedA, failed, finishedB]);
  for (let turn = 0; turn < 10; turn += 1) scheduler.flushOne();
  assert.deepEqual(computed, [finishedA.id, finishedB.id]);
});

test("a run already worked out is skipped without spending a task on it", () => {
  const order = [run(), run(), run()];
  const { scheduler, computed } = worker(order, new Set([order[0].id, order[1].id]));
  scheduler.flushOne();
  assert.deepEqual(computed, [order[2].id]);
  assert.equal(scheduler.pending(), 0);
});

test("the cache is asked when a task runs, not when the work was planned", () => {
  const order = [run(), run()];
  const { scheduler, computed, cached } = worker(order);
  // Worked out elsewhere (a worker this one replaced) after planning, before
  // this worker's turn came.
  cached.add(order[0].id);
  scheduler.flushOne();
  assert.deepEqual(computed, [order[1].id]);
});

test("everything cached schedules nothing at all", () => {
  const order = [run(), run()];
  const { scheduler, computed } = worker(order, new Set(order.map((item) => item.id)));
  assert.equal(scheduler.pending(), 0);
  assert.deepEqual(computed, []);
});

test("stopping cancels the pending task and computes nothing more", () => {
  const order = [run(), run(), run()];
  const { scheduler, computed, stop } = worker(order);
  scheduler.flushOne();
  stop();
  assert.equal(scheduler.pending(), 0);
  scheduler.flushOne();
  assert.deepEqual(computed, [order[0].id]);
});

test("the default scheduler prefers idle time and falls back to a zero timeout", async () => {
  const holder = globalThis as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
  const saved = { request: holder.requestIdleCallback, cancel: holder.cancelIdleCallback };
  try {
    delete holder.requestIdleCallback;
    delete holder.cancelIdleCallback;
    let ran = false;
    nextMacrotask(() => {
      ran = true;
    });
    assert.equal(ran, false, "never synchronous");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(ran, true);

    let cancelledRan = false;
    const cancel = nextMacrotask(() => {
      cancelledRan = true;
    });
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(cancelledRan, false);

    const idleCalls: { timeout?: number }[] = [];
    const cancelled: number[] = [];
    holder.requestIdleCallback = (_task: () => void, options: { timeout: number }) => {
      idleCalls.push(options);
      return 7;
    };
    holder.cancelIdleCallback = (handle: number) => cancelled.push(handle);
    nextMacrotask(() => undefined)();
    assert.equal(idleCalls.length, 1);
    assert.ok((idleCalls[0].timeout ?? 0) > 0, "a timeout, so a page that never idles still progresses");
    assert.deepEqual(cancelled, [7]);
  } finally {
    holder.requestIdleCallback = saved.request;
    holder.cancelIdleCallback = saved.cancel;
    if (saved.request === undefined) delete holder.requestIdleCallback;
    if (saved.cancel === undefined) delete holder.cancelIdleCallback;
  }
});

test("only queued and running runs are refreshed", () => {
  const queued = run({ status: "queued", raw_counts: null });
  const running = run({ status: "running", raw_counts: null });
  assert.deepEqual(unfinishedRunIds([run(), queued, run({ status: "error" }), running]), [queued.id, running.id]);
  assert.deepEqual(unfinishedRunIds([run(), run({ status: "cancelled" })]), []);
});

test("a refreshed record replaces the listed run but keeps its program", () => {
  const running = run({ status: "running", raw_counts: null, completed_at: null });
  const other = run();
  const { qasm: _qasm, ...record } = {
    ...running,
    status: "done" as const,
    raw_counts: { "00": 500, "11": 500 },
    completed_at: "2026-09-22T00:20:00Z",
  };
  const next = applyRunUpdates([running, other], [record]);
  assert.equal(next[0].status, "done");
  assert.deepEqual(next[0].raw_counts, { "00": 500, "11": 500 });
  assert.equal(next[0].qasm, running.qasm, "the single-record read has no program; the listed one is kept");
  assert.equal(next[1], other, "an untouched run keeps its identity");
});

test("a refresh that changes nothing returns the same list, and unlisted records are ignored", () => {
  const running = run({ status: "running", raw_counts: null });
  const items = [running];
  const { qasm: _qasm, ...same } = running;
  assert.equal(applyRunUpdates(items, [same]), items);
  assert.equal(applyRunUpdates(items, []), items);
  const { qasm: _other, ...stranger } = run();
  assert.equal(applyRunUpdates(items, [stranger]), items);
});

test("Studio shows a run only for the circuit on screen", () => {
  const onA = run({ source_fingerprint: "fnv1a-aaaaaaaa" });
  assert.equal(runForCircuit(onA, "fnv1a-aaaaaaaa"), onA);
  // The reader switched to circuit B: A's run is neither shown nor polled.
  assert.equal(runForCircuit(onA, "fnv1a-bbbbbbbb"), null);
  assert.equal(runForCircuit(onA, null), null);
  assert.equal(runForCircuit(null, "fnv1a-aaaaaaaa"), null);
});

test("a restore answer never overwrites a newer run of the same circuit, and replaces a leftover", () => {
  const leftoverA = run({ source_fingerprint: "fnv1a-aaaaaaaa" });
  const latestB = run({ source_fingerprint: "fnv1a-bbbbbbbb" });
  const submittedB = run({ source_fingerprint: "fnv1a-bbbbbbbb" });
  // Switched from A to B: B's latest run replaces A's leftover.
  assert.equal(afterRestore(leftoverA, latestB, "fnv1a-bbbbbbbb"), latestB);
  // B was submitted while the lookup was in flight: the submission wins.
  assert.equal(afterRestore(submittedB, latestB, "fnv1a-bbbbbbbb"), submittedB);
  // B never ran: A's leftover is cleared, not kept.
  assert.equal(afterRestore(leftoverA, null, "fnv1a-bbbbbbbb"), null);
  // An answer for some other circuit is never taken.
  assert.equal(afterRestore(null, leftoverA, "fnv1a-bbbbbbbb"), null);
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
