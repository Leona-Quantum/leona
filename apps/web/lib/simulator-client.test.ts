import assert from "node:assert/strict";
import test from "node:test";

import { SimulatorClient, simulator, type SimulatorOutcome, type SimulatorWorkerPort } from "./simulator-client.ts";
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
 * - without a worker, or once one fails, the same function runs here.
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
