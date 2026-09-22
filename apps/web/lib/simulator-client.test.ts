import assert from "node:assert/strict";
import test from "node:test";

import { TIER_LIMITS } from "./account-tier.ts";
import {
  MAX_JOB_BUDGET_MS,
  MIN_JOB_BUDGET_MS,
  SimulatorClient,
  simulator,
  simulatorJobBudgetMs,
  type SimulatorOutcome,
  type SimulatorWorkerPort,
} from "./simulator-client.ts";
import {
  SIMULATOR_PROTOCOL_VERSION,
  createSimulatorContext,
  handleSimulatorRequest,
  runSimulatorJob,
  type SimulatorJob,
  type SimulatorRequest,
} from "./simulator-protocol.ts";
import type { ParsedBuilderCircuit } from "./studio-parse.ts";
import { sampleCircuitCounts } from "./studio-simulation.ts";

/*
 * The client's promises, each tested against a fake worker that answers
 * exactly as the real one does (`handleSimulatorRequest`, through a structured
 * clone) but only when told to, so a test can hold a job "in flight":
 *
 * - one job at a time goes to the worker;
 * - a newer ask from the same consumer supersedes the older one, a waiting
 *   job is dropped unsent, and an answer to a superseded job reaches nobody;
 * - identical asks share one computation, even across a cancel;
 * - without a worker, or once one fails, the same function runs here;
 * - a worker that goes quiet is stopped at the job's budget, and the job is
 *   answered `timed_out` rather than re-run here.
 */

const BELL: ParsedBuilderCircuit = {
  qubitCount: 2,
  steps: [
    { id: "h", gate: "H", qubits: [0] },
    { id: "cx", gate: "CX", qubits: [0, 1] },
    { id: "m0", gate: "M", qubits: [0] },
    { id: "m1", gate: "M", qubits: [1] },
  ],
};

const CUSTOM: ParsedBuilderCircuit = { qubitCount: 1, steps: [{ id: "g", gate: "CUSTOM", qubits: [0], customGateId: "mine" }] };

function job(seed: number): Extract<SimulatorJob, { kind: "cpu_counts" }> {
  return { kind: "cpu_counts", circuit: BELL, shots: 64, seed };
}

class FakeWorker implements SimulatorWorkerPort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  readonly posted: SimulatorRequest[] = [];
  terminated = false;
  readonly #context = createSimulatorContext();

  postMessage(message: SimulatorRequest) {
    this.posted.push(structuredClone(message));
  }

  terminate() {
    this.terminated = true;
  }

  /** Answers the most recent request the way simulator.worker.ts would. */
  answerLatest() {
    const handled = handleSimulatorRequest(this.posted[this.posted.length - 1], this.#context);
    assert.ok(handled);
    this.onmessage?.({ data: structuredClone(handled.response, { transfer: handled.transfer }) });
  }

  seeds(): number[] {
    return this.posted.map((request) => (request.job as { seed: number }).seed);
  }
}

/** Collects the fallback's tasks so a test decides when "after paint" is. */
function manualSchedule() {
  const tasks: (() => void)[] = [];
  return {
    tasks,
    schedule: (task: () => void) => {
      tasks.push(task);
      return () => undefined;
    },
    runAll() {
      while (tasks.length) tasks.shift()!();
    },
  };
}

/** Lets promise callbacks that are already due run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Resolves to the outcome if the promise has settled, or "pending". */
async function peek<T>(promise: Promise<T>): Promise<T | "pending"> {
  return Promise.race([promise, settle().then(() => "pending" as const)]);
}

function done<T>(outcome: SimulatorOutcome<T> | "pending"): Extract<SimulatorOutcome<T>, { status: "done" }> {
  assert.notEqual(outcome, "pending", "expected the job to have answered");
  assert.equal((outcome as SimulatorOutcome<T>).status, "done", JSON.stringify(outcome));
  return outcome as Extract<SimulatorOutcome<T>, { status: "done" }>;
}

test("with no Worker the job runs on this thread, on its scheduled turn, and returns what the worker would", async () => {
  const later = manualSchedule();
  const client = new SimulatorClient({ createWorker: () => null, schedule: later.schedule });
  const pending = client.run("page", job(7));
  assert.equal(await peek(pending), "pending", "nothing is computed during the call that asks");
  assert.equal(later.tasks.length, 1);
  later.runAll();
  const outcome = done(await peek(pending));
  assert.equal(outcome.ranOn, "main_thread");
  assert.deepEqual(outcome.result, sampleCircuitCounts(BELL, 64, 7));
  assert.deepEqual(outcome.result, runSimulatorJob(job(7), createSimulatorContext()));
});

test("the worker is sent one job at a time, the next only once the first is answered", async () => {
  const worker = new FakeWorker();
  const client = new SimulatorClient({ createWorker: () => worker });
  const first = client.run("panel-a", job(1));
  const second = client.run("panel-b", job(2));
  assert.deepEqual(worker.seeds(), [1], "the second waits in the client, not in the worker");
  worker.answerLatest();
  const answered = done(await peek(first));
  assert.equal(answered.ranOn, "worker");
  assert.deepEqual(answered.result, sampleCircuitCounts(BELL, 64, 1));
  assert.deepEqual(worker.seeds(), [1, 2]);
  worker.answerLatest();
  assert.deepEqual(done(await peek(second)).result, sampleCircuitCounts(BELL, 64, 2));
  assert.equal(worker.posted[0].protocol, SIMULATOR_PROTOCOL_VERSION);
});

test("a newer ask from the same consumer supersedes the one in flight, and nothing stale queues behind it", async () => {
  const worker = new FakeWorker();
  const client = new SimulatorClient({ createWorker: () => worker });
  const a = client.run("preview", job(10));
  const b = client.run("preview", job(11));
  const c = client.run("preview", job(12));
  assert.deepEqual(await peek(a), { status: "superseded" });
  assert.deepEqual(await peek(b), { status: "superseded" });
  assert.equal(await peek(c), "pending");
  assert.deepEqual(worker.seeds(), [10], "b was dropped while it waited: it is never sent");
  worker.answerLatest(); // a's answer: it reaches nobody
  assert.deepEqual(worker.seeds(), [10, 12], "the latest ask goes next, not b");
  assert.equal(await peek(c), "pending", "a's answer was not handed to c");
  worker.answerLatest();
  assert.deepEqual(done(await peek(c)).result, sampleCircuitCounts(BELL, 64, 12));
});

test("superseding a waiting job drops it without touching another consumer's job in flight", async () => {
  const worker = new FakeWorker();
  const client = new SimulatorClient({ createWorker: () => worker });
  const other = client.run("runs-page", job(20));
  const waiting = client.run("preview", job(21));
  const replacement = client.run("preview", job(22));
  assert.deepEqual(await peek(waiting), { status: "superseded" });
  worker.answerLatest();
  assert.deepEqual(done(await peek(other)).result, sampleCircuitCounts(BELL, 64, 20));
  assert.deepEqual(worker.seeds(), [20, 22]);
  worker.answerLatest();
  assert.deepEqual(done(await peek(replacement)).result, sampleCircuitCounts(BELL, 64, 22));
});

test("identical asks share one computation", async () => {
  const worker = new FakeWorker();
  const client = new SimulatorClient({ createWorker: () => worker });
  const first = client.run("studio-panel", job(30));
  const second = client.run("runs-panel", job(30));
  const again = client.run("studio-panel", job(30));
  assert.equal(again, first, "the same consumer asking the same thing gets the same promise");
  worker.answerLatest();
  assert.equal(worker.posted.length, 1);
  assert.deepEqual(done(await peek(first)).result, done(await peek(second)).result);
});

test("a job cancelled and asked for again before it finishes is picked back up, not computed twice", async () => {
  // The shape of a React effect torn down and re-run with the same inputs.
  const worker = new FakeWorker();
  const client = new SimulatorClient({ createWorker: () => worker });
  const before = client.run("preview", job(40));
  client.cancel("preview");
  assert.deepEqual(await peek(before), { status: "superseded" });
  const after = client.run("preview", job(40));
  assert.equal(worker.posted.length, 1);
  worker.answerLatest();
  assert.deepEqual(done(await peek(after)).result, sampleCircuitCounts(BELL, 64, 40));
  assert.equal(worker.posted.length, 1);
});

test("a reply that is not for the job in flight is ignored by id", async () => {
  const worker = new FakeWorker();
  const client = new SimulatorClient({ createWorker: () => worker });
  const pending = client.run("page", job(50));
  worker.onmessage?.({ data: { protocol: SIMULATOR_PROTOCOL_VERSION, id: 999, ok: true, result: { "00": 64 } } });
  worker.onmessage?.({ data: { not: "a reply" } });
  assert.equal(await peek(pending), "pending");
  worker.answerLatest();
  assert.deepEqual(done(await peek(pending)).result, sampleCircuitCounts(BELL, 64, 50));
});

test("a worker that fails mid-job hands that job to this thread, and no second worker is tried", async () => {
  const later = manualSchedule();
  const workers: FakeWorker[] = [];
  const client = new SimulatorClient({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    schedule: later.schedule,
  });
  const inFlight = client.run("page", job(60));
  assert.equal(workers.length, 1);
  // What a script refused by the CSP, a chunk that 404s, or a crash all look like.
  workers[0].onerror?.({ type: "error" });
  assert.equal(workers[0].terminated, true);
  later.runAll();
  const rescued = done(await peek(inFlight));
  assert.equal(rescued.ranOn, "main_thread");
  assert.deepEqual(rescued.result, sampleCircuitCounts(BELL, 64, 60));
  const next = client.run("page", job(61));
  later.runAll();
  assert.equal(done(await peek(next)).ranOn, "main_thread");
  assert.equal(workers.length, 1, "the page does not keep trying workers");
});

test("a message the page cannot read is a broken worker too", async () => {
  const later = manualSchedule();
  const worker = new FakeWorker();
  const client = new SimulatorClient({ createWorker: () => worker, schedule: later.schedule });
  const pending = client.run("page", job(62));
  worker.onmessageerror?.({ type: "messageerror" });
  later.runAll();
  assert.equal(done(await peek(pending)).ranOn, "main_thread");
});

test("a Worker constructor that throws, or a post that throws, falls back to this thread", async () => {
  const later = manualSchedule();
  const throwing = new SimulatorClient({
    createWorker: () => {
      throw new DOMException("refused", "SecurityError");
    },
    schedule: later.schedule,
  });
  const one = throwing.run("page", job(70));
  later.runAll();
  assert.equal(done(await peek(one)).ranOn, "main_thread");

  const unpostable = new FakeWorker();
  unpostable.postMessage = () => {
    throw new DOMException("could not clone", "DataCloneError");
  };
  const refusing = new SimulatorClient({ createWorker: () => unpostable, schedule: later.schedule });
  const two = refusing.run("page", job(71));
  later.runAll();
  assert.equal(done(await peek(two)).ranOn, "main_thread");
  assert.equal(unpostable.terminated, true);
});

test("a job that throws answers `failed` with the thrown message, from the worker and from this thread alike", async () => {
  const worker = new FakeWorker();
  const viaWorker = new SimulatorClient({ createWorker: () => worker });
  const fromWorker = viaWorker.run("page", { kind: "cpu_counts", circuit: CUSTOM, shots: 4, seed: 1 });
  worker.answerLatest();
  const expected = { status: "failed", error: "Custom gates are not eligible for the bounded CPU simulator." };
  assert.deepEqual(await peek(fromWorker), expected);

  const later = manualSchedule();
  const inThread = new SimulatorClient({ createWorker: () => null, schedule: later.schedule });
  const fromThread = inThread.run("page", { kind: "cpu_counts", circuit: CUSTOM, shots: 4, seed: 1 });
  later.runAll();
  assert.deepEqual(await peek(fromThread), expected);
});

test("without a worker, a job superseded while it waits for its turn is never run at all", async () => {
  const later = manualSchedule();
  const ran: number[] = [];
  const client = new SimulatorClient({
    createWorker: () => null,
    schedule: later.schedule,
    runJob: (asked, context) => {
      ran.push((asked as { seed: number }).seed);
      return runSimulatorJob(asked, context);
    },
  });
  const stale = client.run("preview", job(80));
  const fresh = client.run("preview", job(81));
  later.runAll();
  assert.deepEqual(ran, [81], "the stale job cost nothing");
  assert.deepEqual(await peek(stale), { status: "superseded" });
  assert.deepEqual(done(await peek(fresh)).result, sampleCircuitCounts(BELL, 64, 81));
});

test("cancelling a consumer with nothing asked does nothing", () => {
  const client = new SimulatorClient({ createWorker: () => null });
  client.cancel("nobody");
});

test("the page's own simulator creates no worker in Node and answers on this thread", async () => {
  // Node has no global Worker, which is the SSR and `node --test` case the
  // fallback exists for. This goes through the real default scheduler.
  assert.equal(typeof (globalThis as { Worker?: unknown }).Worker, "undefined");
  const outcome = await simulator.run("node-test", job(90));
  assert.equal(outcome.status, "done");
  assert.equal((outcome as Extract<typeof outcome, { status: "done" }>).ranOn, "main_thread");
  assert.deepEqual((outcome as Extract<typeof outcome, { status: "done" }>).result, sampleCircuitCounts(BELL, 64, 90));
});

/** A clock the test advances by hand: `fire` runs every timer still armed. */
function manualTimers() {
  const armed: { task: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    armed,
    setTimer: (task: () => void, ms: number) => {
      const timer = { task, ms, cancelled: false };
      armed.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    live: () => armed.filter((timer) => !timer.cancelled),
    fire() {
      for (const timer of armed.splice(0)) if (!timer.cancelled) timer.task();
    },
  };
}

function hungWorkers() {
  const workers: FakeWorker[] = [];
  return {
    workers,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  };
}

test("a worker that never answers is stopped at the job's budget, and the job answers timed_out without being re-run here", async () => {
  const clock = manualTimers();
  const later = manualSchedule();
  const pool = hungWorkers();
  const ranHere: number[] = [];
  const client = new SimulatorClient({
    createWorker: pool.createWorker,
    schedule: later.schedule,
    setTimer: clock.setTimer,
    runJob: (asked, context) => {
      ranHere.push((asked as { seed: number }).seed);
      return runSimulatorJob(asked, context);
    },
  });
  const hung = client.run("page", job(100));
  assert.equal(clock.live().length, 1, "the job carries a watchdog");
  assert.equal(clock.live()[0].ms, simulatorJobBudgetMs(job(100)), "armed for the job's own budget");
  assert.equal(await peek(hung), "pending", "nothing happens before the budget runs out");

  clock.fire();
  assert.deepEqual(await peek(hung), { status: "timed_out", budgetMs: simulatorJobBudgetMs(job(100)) });
  assert.equal(pool.workers[0].terminated, true, "the quiet worker is terminated");
  later.runAll();
  assert.deepEqual(ranHere, [], "the job that proved slow is not handed to the main thread");

  // Later work goes to a fresh worker, and is answered normally.
  const next = client.run("page", job(101));
  assert.equal(pool.workers.length, 2);
  assert.deepEqual(pool.workers[1].seeds(), [101]);
  pool.workers[1].answerLatest();
  const answered = done(await peek(next));
  assert.equal(answered.ranOn, "worker");
  assert.deepEqual(answered.result, sampleCircuitCounts(BELL, 64, 101));
});

test("work queued behind a hung job starts on a fresh worker when the budget runs out", async () => {
  const clock = manualTimers();
  const pool = hungWorkers();
  const client = new SimulatorClient({ createWorker: pool.createWorker, setTimer: clock.setTimer });
  const hung = client.run("preview", job(110));
  const waiting = client.run("runs-page", job(111));
  assert.deepEqual(pool.workers[0].seeds(), [110], "the second job waits behind the first");
  clock.fire();
  assert.equal((await peek(hung) as SimulatorOutcome<unknown>).status, "timed_out");
  assert.deepEqual(pool.workers[1].seeds(), [111], "and is sent to a new worker, not the stalled one");
  pool.workers[1].answerLatest();
  assert.deepEqual(done(await peek(waiting)).result, sampleCircuitCounts(BELL, 64, 111));
});

test("a stopped worker is detached: nothing it sends afterwards reaches the job now running", async () => {
  const clock = manualTimers();
  const pool = hungWorkers();
  const client = new SimulatorClient({ createWorker: pool.createWorker, setTimer: clock.setTimer });
  void client.run("page", job(120));
  const quiet = pool.workers[0];
  const lateReply = quiet.onmessage;
  clock.fire();
  const current = client.run("page", job(121));
  assert.equal(quiet.onmessage, null);
  assert.equal(quiet.onerror, null);
  assert.equal(quiet.onmessageerror, null);
  // Even a handler captured before it was detached cannot answer the new job:
  // the reply carries the old job's id.
  lateReply?.({ data: { protocol: 1, id: pool.workers[1].posted[0].id - 1, ok: true, result: { "00": 64 } } });
  assert.equal(await peek(current), "pending");
  pool.workers[1].answerLatest();
  assert.deepEqual(done(await peek(current)).result, sampleCircuitCounts(BELL, 64, 121));
});

test("an answer in time disarms the watchdog, and a failing worker disarms it before the job moves here", async () => {
  const clock = manualTimers();
  const worker = new FakeWorker();
  const client = new SimulatorClient({ createWorker: () => worker, setTimer: clock.setTimer });
  const answered = client.run("page", job(130));
  worker.answerLatest();
  assert.equal(done(await peek(answered)).ranOn, "worker");
  assert.equal(clock.live().length, 0);
  assert.equal(worker.terminated, false, "a worker that answers is kept");

  const later = manualSchedule();
  const failing = new FakeWorker();
  const other = new SimulatorClient({ createWorker: () => failing, setTimer: clock.setTimer, schedule: later.schedule });
  const rescued = other.run("page", job(131));
  failing.onerror?.({ type: "error" });
  assert.equal(clock.live().length, 0, "the watchdog does not also fire on the rescued job");
  later.runAll();
  assert.equal(done(await peek(rescued)).ranOn, "main_thread");
});

test("the budget is at least twenty times each measured 20-qubit job, and stays between its floor and ceiling", () => {
  const limits = TIER_LIMITS.developer;
  const program = (qubits: number, gates: number) => [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    `qubit[${qubits}] q;`,
    `bit[${qubits}] c;`,
    ...Array.from({ length: gates }, (_, index) => (index % 3 === 2 ? `cx q[${index % qubits}], q[${(index + 1) % qubits}];` : `h q[${index % qubits}];`)),
    "c = measure q;",
  ].join("\n");
  const wide = { qubitCount: 20, steps: Array.from({ length: 1_000 }, (_, index) => ({ id: String(index), gate: "H" as const, qubits: [index % 20] })) };
  const noise = {
    gate_model: true,
    machine_chosen_at_submit: true,
    profiles: Array.from({ length: 7 }, (_, index) => ({ machine: `m${index}`, one_qubit_gate_error: null, two_qubit_gate_error: null, readout_error: null })),
  };

  // The three jobs measured in headless Chromium, production build, 2026-09-22
  // (simulator-protocol.ts): 2,412 ms, 875 ms and 2,337 ms.
  const measured: [Parameters<typeof simulatorJobBudgetMs>[0], number][] = [
    [{ kind: "compare_ideal", qasm: program(20, 1_000), submittedFingerprint: "x", counts: null, limits }, 2_412],
    [{ kind: "noise_estimate", qasm: program(20, 400), limits, noise }, 875],
    [{ kind: "cpu_counts", circuit: wide, shots: 1_000, seed: 1 }, 2_337],
  ];
  for (const [measuredJob, ms] of measured) {
    const budget = simulatorJobBudgetMs(measuredJob);
    assert.ok(budget >= 20 * ms, `${measuredJob.kind}: budget ${budget} ms is under 20 x ${ms} ms`);
    assert.ok(budget < MAX_JOB_BUDGET_MS, `${measuredJob.kind}: a measured job should not need the ceiling`);
  }

  // A small job gets the floor, which covers loading the worker itself.
  assert.equal(simulatorJobBudgetMs(job(1)), MIN_JOB_BUDGET_MS);
  assert.equal(simulatorJobBudgetMs({ kind: "compare_ideal", qasm: program(2, 2), submittedFingerprint: "x", counts: null, limits }), MIN_JOB_BUDGET_MS);

  // The developer tier's largest CPU run would run past twenty times its
  // estimate; the ceiling holds it.
  const largest = { qubitCount: 20, steps: Array.from({ length: 4_000 }, (_, index) => ({ id: String(index), gate: "H" as const, qubits: [index % 20] })) };
  assert.equal(simulatorJobBudgetMs({ kind: "cpu_counts", circuit: largest, shots: 65_536, seed: 1 }), MAX_JOB_BUDGET_MS);

  // A declared register wider than the tier is refused before any simulation,
  // so it is sized at the tier's width, not at what the text claims.
  const over = simulatorJobBudgetMs({ kind: "compare_ideal", qasm: program(24, 100), submittedFingerprint: "x", counts: null, limits });
  const atLimit = simulatorJobBudgetMs({ kind: "compare_ideal", qasm: program(20, 100), submittedFingerprint: "x", counts: null, limits });
  assert.equal(over, atLimit);

  // Two qubits fewer is a quarter of the work, and a quarter of the budget.
  const narrower = simulatorJobBudgetMs({ kind: "compare_ideal", qasm: program(18, 1_000), submittedFingerprint: "x", counts: null, limits });
  const wider = simulatorJobBudgetMs(measured[0][0]);
  assert.ok(narrower > MIN_JOB_BUDGET_MS);
  assert.ok(Math.abs(wider / narrower - 4) < 0.01, `expected a 4x budget, got ${wider / narrower}`);
});
