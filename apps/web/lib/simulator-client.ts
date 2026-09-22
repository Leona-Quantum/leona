import { scheduleAfterPaint } from "./qpu-noise.ts";
import type { ParseLimits } from "./qpu-ideal.ts";
import {
  SIMULATOR_PROTOCOL_VERSION,
  createSimulatorContext,
  isSimulatorResponse,
  runSimulatorJob,
  type SimulatorContext,
  type SimulatorJob,
  type SimulatorRequest,
  type SimulatorResultOf,
} from "./simulator-protocol.ts";

/**
 * The page's side of the simulator worker (simulator-protocol.ts has the why).
 *
 * `simulator.run(consumer, job)` resolves to the job's result, computed in
 * the worker where there is one and on this thread where there is not. A
 * "consumer" is one place on the page that wants a result — the noise preview
 * for one panel, the hardware-runs page's comparison loop — and each consumer
 * holds at most one job: asking again supersedes the last ask.
 *
 * ## What superseding does, and why it does not terminate the worker
 *
 * The client sends the worker ONE job at a time and keeps the rest itself.
 * A superseded job that is still waiting here is dropped and never runs. A
 * superseded job the worker has already started finishes, and its result is
 * dropped. Switching circuits therefore wastes at most the one job in flight,
 * and never queues up stale work behind it.
 *
 * Terminating the worker would get the new job started sooner, at the price
 * of the worker's prepared-circuit cache — the thing that makes switching
 * devices for the same circuit cost no second simulation — and of loading
 * the worker again. The common switch in Studio is between devices, so the
 * cache wins.
 *
 * ## Shared jobs
 *
 * Two asks for the same job (the same inputs, compared as JSON) share one
 * computation, including an ask that arrives while the job is already
 * running. That is what keeps a React effect that is torn down and re-run
 * with the same inputs — a remount, a list refresh, Strict Mode in
 * development — from computing the same thing twice: the cleanup cancels,
 * and the re-run picks the running job back up.
 *
 * ## Fallback
 *
 * Where a worker cannot be had — no `Worker` (SSR, `node --test`), a
 * constructor that throws, or a worker that fires `error` because its script
 * was refused or failed to load (a CSP that does not admit it; a chunk that
 * 404s after a deploy) — the client runs the same `runSimulatorJob` on this
 * thread, one macrotask after the next paint, exactly as the pages scheduled
 * it before the worker existed. The job the broken worker was holding is run
 * here instead, so nobody's placeholder waits forever. Once a worker has
 * failed, the client does not try another one this page load.
 *
 * ## A worker that goes quiet
 *
 * A worker that took a job and neither answers nor fails would hold the one
 * slot forever, and every later simulation on the page would wait behind it.
 * So each job sent to a worker carries a time budget sized from the job
 * (`simulatorJobBudgetMs` below). When it runs out, that worker is
 * terminated, the job answers `timed_out`, and the next job gets a fresh
 * worker. The timed-out job is NOT re-run here: it is the one job known to be
 * slow, and running it on this thread would freeze the page for exactly as
 * long as the worker was spared.
 */

export type SimulatorOutcome<T> =
  | { status: "done"; result: T; ranOn: "worker" | "main_thread" }
  /** A newer ask from the same consumer replaced this one, or it was cancelled. */
  | { status: "superseded" }
  /** The job itself threw (the kernel refuses a custom gate, say). It would
   * have thrown on the main thread too; the message is the thrown one. */
  | { status: "failed"; error: string }
  /** The worker did not answer within the job's budget and was stopped. */
  | { status: "timed_out"; budgetMs: number };

/** The parts of a `Worker` the client uses, so tests can hand it a fake. */
export type SimulatorWorkerPort = {
  postMessage(message: SimulatorRequest): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
};

/** Runs a task later and returns a function that cancels it. */
export type SimulatorSchedule = (task: () => void) => () => void;

/** Runs a task after `ms` milliseconds and returns a function that cancels it. */
export type SimulatorTimer = (task: () => void, ms: number) => () => void;

const defaultTimer: SimulatorTimer = (task, ms) => {
  const handle = setTimeout(task, ms);
  return () => clearTimeout(handle);
};

// ---------------------------------------------------------------------------
// The time budget for one worker job.
//
// A statevector job's cost is close to (amplitudes) x (passes over them):
// 2^n amplitudes, one pass per gate, plus the passes each job makes after the
// simulation. Fitted to the three 20-qubit jobs measured in headless Chromium
// against a production build (simulator-protocol.ts, 2026-09-22, one run
// each), that is about 1.5 ns per amplitude per pass on the Mac they ran on:
//
//   comparison, 1,000 gates:              2,412 ms / (2^20 x 1,500)   = 1.5 ns
//   noise estimate, 400 gates, 7 devices:   875 ms / (2^20 x   596)   = 1.4 ns
//   CPU run, 1,000 gates, 1,000 shots:    2,337 ms / (2^20 x 2,000)   = 1.1 ns
//
// The budget is TWENTY times that estimate. A low-end phone runs this kind
// of loop five to ten times slower than that Mac, and the estimate itself is
// read from the program text (below), not from the parsed circuit, so it can
// be off by a factor of two either way. A budget is a bound on how long a
// hung worker can stall the page, not a forecast, so it errs long.
//
// The floor, 15 s, is what a small job gets. Its real cost is milliseconds;
// the floor is there for the first job of a page, which also waits for the
// worker's script (about 70 KB) to arrive over whatever connection the reader
// has. The ceiling, 10 minutes, caps the one case the formula runs away on:
// the developer tier's largest CPU run (20 qubits, 4,000 operations, 65,536
// shots, each shot scanning the whole distribution) estimates at about 110 s
// on that Mac, so twenty times it would be 36 minutes. Ten minutes still
// leaves that run more than five times its estimate.
// ---------------------------------------------------------------------------

const NS_PER_AMPLITUDE_PASS = 1.5;
const BUDGET_SAFETY_FACTOR = 20;
export const MIN_JOB_BUDGET_MS = 15_000;
export const MAX_JOB_BUDGET_MS = 10 * 60_000;

/** After the simulation a comparison sorts the whole distribution (to find
 * its top rows) and takes a log-gamma per outcome for the shot-noise figure:
 * about 400 passes' worth at 20 qubits, measured in Node as the gap between
 * a comparison and the simulation inside it. Rounded up. */
const COMPARISON_PASSES = 500;

/** Per device, a noise estimate mixes with uniform (one pass), applies the
 * readout flip (one pass per qubit), takes two distances and picks the top
 * rows (about four passes). Counted as qubits + 8. */
const NOISE_PASSES_PER_DEVICE_BEYOND_QUBITS = 8;

/** A program read through the standard-gate decomposition can come out with
 * more steps than it has statements; two per statement covers the common
 * gates, and the tier's operation cap bounds it whatever happens. */
const STEPS_PER_STATEMENT = 2;

/** The milliseconds a worker may take over `job` before it is stopped. */
export function simulatorJobBudgetMs(job: SimulatorJob): number {
  let qubits: number;
  let passes: number;
  switch (job.kind) {
    case "cpu_counts":
      qubits = job.circuit.qubitCount;
      // Each shot scans at most the whole cumulative distribution.
      passes = job.circuit.steps.length + job.shots;
      break;
    case "compare_ideal": {
      const program = programSize(job.qasm, job.limits);
      qubits = program.qubits;
      passes = program.steps + COMPARISON_PASSES;
      break;
    }
    case "noise_estimate": {
      const program = programSize(job.qasm, job.limits);
      qubits = program.qubits;
      passes = program.steps + job.noise.profiles.length * (program.qubits + NOISE_PASSES_PER_DEVICE_BEYOND_QUBITS);
      break;
    }
  }
  const estimateMs = (2 ** qubits * passes * NS_PER_AMPLITUDE_PASS) / 1e6;
  return Math.round(Math.min(MAX_JOB_BUDGET_MS, Math.max(MIN_JOB_BUDGET_MS, BUDGET_SAFETY_FACTOR * estimateMs)));
}

/**
 * Qubits and steps read off the OpenQASM text, without parsing it on this
 * thread. Both are capped by the tier's limits, because the worker refuses a
 * program over either before it simulates anything, so a refused program
 * costs nothing close to its size. A program with no register declaration
 * this recognises is assumed to be as wide as the tier allows.
 */
function programSize(qasm: string, limits: ParseLimits): { qubits: number; steps: number } {
  let declared = 0;
  for (const match of qasm.matchAll(/\bqubit\s*\[\s*(\d+)\s*\]|\bqreg\s+\w+\s*\[\s*(\d+)\s*\]/g)) {
    declared += Number(match[1] ?? match[2]);
  }
  const statements = qasm.split(";").length - 1;
  return {
    qubits: Math.min(limits.cpuSimQubits, declared > 0 ? declared : limits.cpuSimQubits),
    steps: Math.min(limits.cpuSimOperations, Math.max(1, statements) * STEPS_PER_STATEMENT),
  };
}

type AnyOutcome = SimulatorOutcome<unknown>;

type Subscription = { consumer: string; entry: Entry; resolve: (outcome: AnyOutcome) => void; promise: Promise<AnyOutcome> };

type Entry = { id: number; key: string; job: SimulatorJob; subscribers: Map<string, Subscription> };

export class SimulatorClient {
  readonly #createWorker: () => SimulatorWorkerPort | null;
  readonly #schedule: SimulatorSchedule;
  readonly #runJob: (job: SimulatorJob, context: SimulatorContext) => unknown;
  readonly #setTimer: SimulatorTimer;
  readonly #budgetMs: (job: SimulatorJob) => number;
  readonly #context = createSimulatorContext();
  #worker: SimulatorWorkerPort | null = null;
  #workerFailed = false;
  #queue: Entry[] = [];
  #running: { entry: Entry; on: "worker" | "main_thread" } | null = null;
  #cancelWatchdog: (() => void) | null = null;
  readonly #subscriptions = new Map<string, Subscription>();
  #nextId = 1;

  constructor(options: {
    createWorker: () => SimulatorWorkerPort | null;
    /** When the main-thread fallback runs a job. After the next paint by default. */
    schedule?: SimulatorSchedule;
    /** The fallback's job runner. `runSimulatorJob` always, except in tests
     * that need to see whether a job ran at all. */
    runJob?: (job: SimulatorJob, context: SimulatorContext) => unknown;
    /** The watchdog's clock. `setTimeout` except in tests. */
    setTimer?: SimulatorTimer;
    /** Each worker job's budget. `simulatorJobBudgetMs` except in tests. */
    budgetMs?: (job: SimulatorJob) => number;
  }) {
    this.#createWorker = options.createWorker;
    this.#schedule = options.schedule ?? scheduleAfterPaint;
    this.#runJob = options.runJob ?? runSimulatorJob;
    this.#setTimer = options.setTimer ?? defaultTimer;
    this.#budgetMs = options.budgetMs ?? simulatorJobBudgetMs;
  }

  run<J extends SimulatorJob>(consumer: string, job: J): Promise<SimulatorOutcome<SimulatorResultOf<J>>> {
    const key = JSON.stringify(job);
    const existing = this.#subscriptions.get(consumer);
    if (existing?.entry.key === key) return existing.promise as Promise<SimulatorOutcome<SimulatorResultOf<J>>>;
    if (existing) this.#unsubscribe(existing);

    const running = this.#running?.entry.key === key ? this.#running.entry : undefined;
    let entry = running ?? this.#queue.find((queued) => queued.key === key);
    if (!entry) {
      entry = { id: this.#nextId, key, job, subscribers: new Map() };
      this.#nextId += 1;
      this.#queue.push(entry);
    }
    let resolve!: (outcome: AnyOutcome) => void;
    const promise = new Promise<AnyOutcome>((settle) => {
      resolve = settle;
    });
    const subscription: Subscription = { consumer, entry, resolve, promise };
    entry.subscribers.set(consumer, subscription);
    this.#subscriptions.set(consumer, subscription);
    this.#pump();
    return promise as Promise<SimulatorOutcome<SimulatorResultOf<J>>>;
  }

  /** Withdraws the consumer's ask, if it has one. Its promise resolves `superseded`. */
  cancel(consumer: string): void {
    const existing = this.#subscriptions.get(consumer);
    if (existing) this.#unsubscribe(existing);
  }

  #unsubscribe(subscription: Subscription) {
    const { consumer, entry } = subscription;
    entry.subscribers.delete(consumer);
    this.#subscriptions.delete(consumer);
    subscription.resolve({ status: "superseded" });
    // Nobody wants it any more. Waiting: never run it. Running: let it finish
    // (see the module comment) and drop the answer, unless an ask for the same
    // job picks it back up first.
    if (entry.subscribers.size === 0) this.#queue = this.#queue.filter((queued) => queued !== entry);
  }

  #pump() {
    if (this.#running || this.#queue.length === 0) return;
    const entry = this.#queue.shift()!;
    const worker = this.#ensureWorker();
    if (worker) {
      try {
        this.#running = { entry, on: "worker" };
        worker.postMessage({ protocol: SIMULATOR_PROTOCOL_VERSION, id: entry.id, job: entry.job });
        const budgetMs = this.#budgetMs(entry.job);
        this.#cancelWatchdog = this.#setTimer(() => this.#onTimeout(entry, budgetMs), budgetMs);
        return;
      } catch {
        // A job that cannot be cloned into a message. Nothing in the protocol
        // should be, so treat it like any other broken worker.
        this.#abandonWorker();
      }
    }
    this.#runOnMainThread(entry);
  }

  #runOnMainThread(entry: Entry) {
    this.#running = { entry, on: "main_thread" };
    this.#schedule(() => {
      if (this.#running?.entry !== entry) return;
      if (entry.subscribers.size === 0) {
        // Superseded while it waited for its turn: the work is skipped
        // entirely, which a worker job already under way cannot be.
        this.#running = null;
        this.#pump();
        return;
      }
      let outcome: AnyOutcome;
      try {
        outcome = { status: "done", result: this.#runJob(entry.job, this.#context), ranOn: "main_thread" };
      } catch (cause) {
        outcome = { status: "failed", error: cause instanceof Error ? cause.message : String(cause) };
      }
      this.#finish(entry, outcome);
    });
  }

  #finish(entry: Entry, outcome: AnyOutcome) {
    this.#disarmWatchdog();
    this.#running = null;
    for (const subscription of entry.subscribers.values()) {
      this.#subscriptions.delete(subscription.consumer);
      subscription.resolve(outcome);
    }
    entry.subscribers.clear();
    this.#pump();
  }

  #ensureWorker(): SimulatorWorkerPort | null {
    if (this.#workerFailed) return null;
    if (this.#worker) return this.#worker;
    let worker: SimulatorWorkerPort | null;
    try {
      worker = this.#createWorker();
    } catch {
      worker = null;
    }
    if (!worker) {
      this.#workerFailed = true;
      return null;
    }
    worker.onmessage = (event) => this.#onMessage(event.data);
    worker.onerror = () => this.#onWorkerFailure();
    worker.onmessageerror = () => this.#onWorkerFailure();
    this.#worker = worker;
    return worker;
  }

  #onMessage(data: unknown) {
    if (!isSimulatorResponse(data)) return;
    const running = this.#running;
    // A reply to anything but the job in flight is a leftover from a worker
    // this client already gave up on. Ignored by id, never trusted.
    if (!running || running.on !== "worker" || running.entry.id !== data.id) return;
    this.#finish(
      running.entry,
      data.ok ? { status: "done", result: data.result, ranOn: "worker" } : { status: "failed", error: data.error },
    );
  }

  #onWorkerFailure() {
    this.#disarmWatchdog();
    this.#abandonWorker();
    const running = this.#running;
    if (running?.on === "worker") this.#runOnMainThread(running.entry);
  }

  /** The job's budget ran out with no answer: stop that worker, answer the
   * job, and let the next one start on a fresh worker. */
  #onTimeout(entry: Entry, budgetMs: number) {
    this.#cancelWatchdog = null;
    if (this.#running?.entry !== entry || this.#running.on !== "worker") return;
    this.#retireWorker();
    this.#finish(entry, { status: "timed_out", budgetMs });
  }

  #disarmWatchdog() {
    this.#cancelWatchdog?.();
    this.#cancelWatchdog = null;
  }

  /** A worker that loaded but cannot be used: never try another. */
  #abandonWorker() {
    this.#workerFailed = true;
    this.#retireWorker();
  }

  /** Terminates the current worker and detaches it, so nothing it sends or
   * fires afterwards can reach a job it no longer holds. */
  #retireWorker() {
    const worker = this.#worker;
    this.#worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    try {
      worker.terminate();
    } catch {
      // Already gone.
    }
  }
}

/**
 * The browser's worker. `new Worker(new URL(…, import.meta.url), { type:
 * "module" })` written out literally is the form the bundler recognises and
 * emits as a same-origin chunk (see simulator.worker.ts on why the CSP
 * requires exactly that). Null where there is no `Worker` at all.
 */
function createBrowserWorker(): SimulatorWorkerPort | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./simulator.worker.ts", import.meta.url), { type: "module" }) as unknown as SimulatorWorkerPort;
}

/** The page's one simulator. Creates its worker on the first job, not on import. */
export const simulator = new SimulatorClient({ createWorker: createBrowserWorker });
