import { compareMeasuredToIdeal, type IdealComparison, type ParseLimits } from "./qpu-ideal.ts";
import { PreparedCircuitCache, estimateDevice, type DeviceEstimate } from "./qpu-noise.ts";
import type { QpuPublishedNoise } from "./qpu.ts";
import type { ParsedBuilderCircuit } from "./studio-parse.ts";
import { sampleCircuitCounts, type CpuSimulationLimits } from "./studio-simulation.ts";

/**
 * The request/response protocol between the page and the simulator worker
 * (`simulator.worker.ts`), and the one function both sides run.
 *
 * ## Why a worker at all
 *
 * Every heavy number the signed-in pages show is a statevector simulation in
 * the viewer's own tab, and at the tier ceilings (20 qubits, account-tier.ts)
 * one of them is a second or more of uninterrupted main-thread time: about
 * 1.2 s per measured-against-ideal comparison at 1,000 gates on the hardware-
 * runs page, a 912 ms task for Studio's pre-submit noise estimate at 400
 * gates, and longer still for Studio's own CPU run at the 4,000-operation
 * ceiling. Scheduling those after paint (qpu-noise.ts's `scheduleAfterPaint`,
 * qpu-run-history.ts's `workThroughComparisons`) got the placeholder on
 * screen first, but the page still froze while it showed. Moving the work to
 * a worker is the only way the page answers input during it.
 *
 * ## Same numbers, by construction
 *
 * `runSimulatorJob` calls the SAME pure functions the page called before —
 * `compareMeasuredToIdeal`, `PreparedCircuitCache` + `estimateDevice`,
 * `sampleCircuitCounts` — imported, never re-implemented. The worker runs it;
 * so does the page itself wherever a worker is unavailable (SSR, `node
 * --test`, a browser that refuses one), which is what makes the fallback
 * return exactly what the worker would have. `simulator-protocol.test.ts`
 * checks that on several circuits by comparing both against direct calls.
 *
 * This module has no side effects at module scope and touches no browser
 * API, so it loads the same in a worker, on the page, and in Node.
 */

export const SIMULATOR_PROTOCOL_VERSION = 1;

export type SimulatorJob =
  | {
      kind: "compare_ideal";
      qasm: string;
      submittedFingerprint: string;
      counts: Record<string, number> | null;
      limits: CpuSimulationLimits;
      maxRows?: number;
    }
  | { kind: "noise_estimate"; qasm: string; limits: ParseLimits; noise: QpuPublishedNoise }
  | { kind: "cpu_counts"; circuit: ParsedBuilderCircuit; shots: number; seed: number };

export type SimulatorJobKind = SimulatorJob["kind"];

export type SimulatorResults = {
  compare_ideal: IdealComparison;
  noise_estimate: DeviceEstimate;
  cpu_counts: Record<string, number>;
};

export type SimulatorResultOf<J extends SimulatorJob> = SimulatorResults[J["kind"]];

export type SimulatorRequest = { protocol: typeof SIMULATOR_PROTOCOL_VERSION; id: number; job: SimulatorJob };

export type SimulatorResponse =
  | { protocol: typeof SIMULATOR_PROTOCOL_VERSION; id: number; ok: true; result: SimulatorResults[SimulatorJobKind] }
  | { protocol: typeof SIMULATOR_PROTOCOL_VERSION; id: number; ok: false; error: string };

/**
 * State one simulator keeps between jobs. The prepared-circuit cache is the
 * point: it holds each recent circuit's ideal distribution, so a person
 * switching between devices for one circuit pays for the simulation once, as
 * they did when it lived on the page (qpu-noisy-preview.tsx's
 * `PREPARED_CIRCUITS`). Three entries, 8 MB each at the 20-qubit tier.
 */
export type SimulatorContext = { prepared: PreparedCircuitCache };

export function createSimulatorContext(): SimulatorContext {
  return { prepared: new PreparedCircuitCache(3) };
}

/** Runs one job. Throws where the underlying function throws. */
export function runSimulatorJob<J extends SimulatorJob>(job: J, context: SimulatorContext): SimulatorResultOf<J>;
export function runSimulatorJob(job: SimulatorJob, context: SimulatorContext): SimulatorResults[SimulatorJobKind] {
  switch (job.kind) {
    case "compare_ideal":
      return compareMeasuredToIdeal({
        qasm: job.qasm,
        submittedFingerprint: job.submittedFingerprint,
        counts: job.counts,
        limits: job.limits,
        maxRows: job.maxRows,
      });
    case "noise_estimate":
      // Exactly what the preview did on the page: prepare (or reuse) the
      // circuit, then estimate the device. Not `deviceEstimateFor`, whose
      // cache is keyed by the noise object's identity, which a structured
      // clone never preserves across messages; the page caches the result
      // instead (qpu-noise.ts's `DeviceEstimateCache`).
      return estimateDevice({ prepared: context.prepared.getOrPrepare(job.qasm, job.limits), noise: job.noise });
    case "cpu_counts":
      return sampleCircuitCounts(job.circuit, job.shots, job.seed);
  }
}

export function isSimulatorRequest(value: unknown): value is SimulatorRequest {
  if (!isObject(value) || value.protocol !== SIMULATOR_PROTOCOL_VERSION || !Number.isInteger(value.id)) return false;
  const job = value.job;
  return isObject(job) && (job.kind === "compare_ideal" || job.kind === "noise_estimate" || job.kind === "cpu_counts");
}

export function isSimulatorResponse(value: unknown): value is SimulatorResponse {
  if (!isObject(value) || value.protocol !== SIMULATOR_PROTOCOL_VERSION || !Number.isInteger(value.id)) return false;
  return value.ok === true ? "result" in value : value.ok === false && typeof value.error === "string";
}

/**
 * The worker's whole message handler, minus `postMessage` itself: validate,
 * run, and say which buffers can be moved rather than copied. Null for a
 * message that is not a request, which the worker ignores.
 *
 * A job that throws becomes an `ok: false` response carrying the message,
 * never an uncaught error: an uncaught error in a worker fires `error` on the
 * page's Worker object, which the client reads as "the worker is broken" and
 * falls back to the main thread for good.
 */
export function handleSimulatorRequest(
  message: unknown,
  context: SimulatorContext,
): { response: SimulatorResponse; transfer: ArrayBuffer[] } | null {
  if (!isSimulatorRequest(message)) return null;
  const { id, job } = message;
  try {
    const result = runSimulatorJob(job, context);
    const { transferable, transfer } = transferableResult(job.kind, result);
    return { response: { protocol: SIMULATOR_PROTOCOL_VERSION, id, ok: true, result: transferable }, transfer };
  } catch (cause) {
    return {
      response: { protocol: SIMULATOR_PROTOCOL_VERSION, id, ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      transfer: [],
    };
  }
}

/**
 * A noise estimate carries the whole ideal distribution (2^n doubles, 8 MB at
 * 20 qubits), which the page needs for the shot-noise step. Transferring its
 * buffer moves it without a copy on the receiving side, but a transferred
 * buffer is DETACHED in the sender, and this one is also held by the worker's
 * prepared-circuit cache. So the worker transfers a copy and keeps the
 * original; the copy is made off the main thread, which is the side that
 * matters.
 */
function transferableResult(
  kind: SimulatorJobKind,
  result: SimulatorResults[SimulatorJobKind],
): { transferable: SimulatorResults[SimulatorJobKind]; transfer: ArrayBuffer[] } {
  if (kind !== "noise_estimate") return { transferable: result, transfer: [] };
  const estimate = result as DeviceEstimate;
  if (estimate.status !== "computed") return { transferable: result, transfer: [] };
  const ideal = estimate.ideal.slice();
  return { transferable: { ...estimate, ideal }, transfer: [ideal.buffer] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
