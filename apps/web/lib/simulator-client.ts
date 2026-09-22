import { scheduleAfterPaint } from "./qpu-noise.ts";
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
 */

export type SimulatorOutcome<T> =
  | { status: "done"; result: T; ranOn: "worker" | "main_thread" }
  /** A newer ask from the same consumer replaced this one, or it was cancelled. */
  | { status: "superseded" }
  /** The job itself threw (the kernel refuses a custom gate, say). It would
   * have thrown on the main thread too; the message is the thrown one. */
  | { status: "failed"; error: string };

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

type AnyOutcome = SimulatorOutcome<unknown>;

type Subscription = { consumer: string; entry: Entry; resolve: (outcome: AnyOutcome) => void; promise: Promise<AnyOutcome> };

type Entry = { id: number; key: string; job: SimulatorJob; subscribers: Map<string, Subscription> };

export class SimulatorClient {
  readonly #createWorker: () => SimulatorWorkerPort | null;
  readonly #schedule: SimulatorSchedule;
  readonly #runJob: (job: SimulatorJob, context: SimulatorContext) => unknown;
  readonly #context = createSimulatorContext();
  #worker: SimulatorWorkerPort | null = null;
  #workerFailed = false;
  #queue: Entry[] = [];
  #running: { entry: Entry; on: "worker" | "main_thread" } | null = null;
  readonly #subscriptions = new Map<string, Subscription>();
  #nextId = 1;

  constructor(options: {
    createWorker: () => SimulatorWorkerPort | null;
    /** When the main-thread fallback runs a job. After the next paint by default. */
    schedule?: SimulatorSchedule;
    /** The fallback's job runner. `runSimulatorJob` always, except in tests
     * that need to see whether a job ran at all. */
    runJob?: (job: SimulatorJob, context: SimulatorContext) => unknown;
  }) {
    this.#createWorker = options.createWorker;
    this.#schedule = options.schedule ?? scheduleAfterPaint;
    this.#runJob = options.runJob ?? runSimulatorJob;
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
    this.#abandonWorker();
    const running = this.#running;
    if (running?.on === "worker") this.#runOnMainThread(running.entry);
  }

  #abandonWorker() {
    this.#workerFailed = true;
    try {
      this.#worker?.terminate();
    } catch {
      // Already gone.
    }
    this.#worker = null;
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
