import { compareMeasuredToIdeal, type IdealComparison } from "./qpu-ideal.ts";
import { backendNameOf, type QpuRunHistoryItem } from "./qpu.ts";
import type { CpuSimulationLimits } from "./studio-simulation.ts";

/**
 * The hardware-runs page's view of `GET /v1/qpu/runs`: a device record.
 *
 * Every number here is computed in the reader's browser from the stored run,
 * the same way Studio's panel computes it (`qpu-ideal.ts`). Nothing is fetched
 * beyond the history itself and nothing is executed.
 */

/** One machine and its runs, newest first. `backend` null = not recorded. */
export type BackendGroup = { backend: string | null; runs: QpuRunHistoryItem[] };

/**
 * Runs grouped by the machine that ran them, so one processor's distances can
 * be read down a column over time.
 *
 * Groups appear in the order of their most recent run, since the history
 * arrives newest first. Runs with no recorded machine go in one group at the
 * END whatever their dates: they were run somewhere, but that group is not a
 * device, and putting it between two real machines would read as though it
 * were one. Nothing is inferred to move a run out of it.
 */
export function groupRunsByBackend(items: readonly QpuRunHistoryItem[]): BackendGroup[] {
  const groups = new Map<string, BackendGroup>();
  const unrecorded: QpuRunHistoryItem[] = [];
  for (const item of items) {
    const backend = backendNameOf(item);
    if (backend === null) {
      unrecorded.push(item);
      continue;
    }
    const group = groups.get(backend);
    if (group) group.runs.push(item);
    else groups.set(backend, { backend, runs: [item] });
  }
  const ordered = [...groups.values()];
  if (unrecorded.length) ordered.push({ backend: null, runs: unrecorded });
  return ordered;
}

/**
 * The next page appended to the ones already shown, without repeating a run.
 *
 * The cursor makes a repeat impossible on a stable history, but not on this
 * page: a reader who presses "show older runs" twice before the first answer
 * lands asks for the same page twice. Keyed on the run id, first copy kept.
 */
export function appendRunPage(
  shown: readonly QpuRunHistoryItem[],
  next: readonly QpuRunHistoryItem[],
): QpuRunHistoryItem[] {
  const seen = new Set(shown.map((item) => item.id));
  const merged = [...shown];
  for (const item of next) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

export type RunReading =
  | { kind: "in_progress" }
  | { kind: "ended_without_counts" }
  | { kind: "compared"; comparison: IdealComparison };

/**
 * What the page can say about one run.
 *
 * Only a finished run is compared. A queued or running one has no counts yet,
 * and an errored or cancelled one may never get any; each gets its own
 * sentence rather than the comparison's generic "no counts".
 *
 * The comparison is made against the run's OWN stored program, not whatever is
 * open in Studio, and `compareMeasuredToIdeal` still checks it against the
 * recorded fingerprint. On this page a mismatch there does not mean "the
 * circuit changed since"; it means the stored program is not the one that was
 * fingerprinted, which the page words separately (`circuit_changed` is the
 * reason code either way).
 */
export function readRun(item: QpuRunHistoryItem, limits: CpuSimulationLimits): RunReading {
  if (item.status === "queued" || item.status === "running") return { kind: "in_progress" };
  if (item.status !== "done") return { kind: "ended_without_counts" };
  return {
    kind: "compared",
    comparison: compareMeasuredToIdeal({
      qasm: item.qasm,
      submittedFingerprint: item.source_fingerprint,
      counts: item.raw_counts,
      limits,
    }),
  };
}
