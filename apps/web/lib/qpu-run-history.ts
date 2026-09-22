import { compareMeasuredToIdeal, type IdealComparison } from "./qpu-ideal.ts";
import { mitigatedReadings, type MitigatedReadings } from "./qpu-mitigation.ts";
import { backendNameOf, isUnfinishedRun, type QpuRunHistoryItem, type QpuRunRecord } from "./qpu.ts";
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
  | { kind: "working_out" }
  | { kind: "compared"; comparison: IdealComparison };

/**
 * What the page can say about one run, given the comparisons worked out so far.
 *
 * Only a finished run is compared. A queued or running one has no counts yet,
 * and an errored or cancelled one may never get any; each gets its own
 * sentence rather than the comparison's generic "no counts". A finished run
 * whose comparison has not been computed yet reads `working_out`: this never
 * computes one itself, because it runs during render (see
 * `workThroughComparisons`).
 */
export function readRun(
  item: QpuRunHistoryItem,
  comparisons: ReadonlyMap<string, IdealComparison>,
): RunReading {
  if (item.status === "queued" || item.status === "running") return { kind: "in_progress" };
  if (item.status !== "done") return { kind: "ended_without_counts" };
  const comparison = comparisons.get(item.id);
  return comparison ? { kind: "compared", comparison } : { kind: "working_out" };
}

/**
 * The measured-against-ideal comparison for one finished run. EXPENSIVE: a
 * statevector simulation of the stored program, up to the tier's qubit and
 * operation limits. Call it only through `workThroughComparisons`.
 *
 * The comparison is made against the run's OWN stored program, not whatever is
 * open in Studio, and `compareMeasuredToIdeal` still checks it against the
 * recorded fingerprint. On this page a mismatch there does not mean "the
 * circuit changed since"; it means the stored program is not the one that was
 * fingerprinted, which the page words separately (`circuit_changed` is the
 * reason code either way).
 */
export function compareRun(item: QpuRunHistoryItem, limits: CpuSimulationLimits): IdealComparison {
  return compareMeasuredToIdeal({
    qasm: item.qasm,
    submittedFingerprint: item.source_fingerprint,
    counts: item.raw_counts,
    limits,
  });
}

/**
 * The mitigated readings for one finished run (proposal 5, increment 4), from
 * the comparison `compareRun` already made, or null when there is no computed
 * comparison to measure them against.
 *
 * Not free: readout correction touches every one of the 2^n outcomes once per
 * qubit, and the projection sorts them. So the page works it out in the same
 * scheduled task as the comparison (the `onResult` of `workThroughComparisons`),
 * never during render. It needs no second simulation, because it reuses the
 * comparison's ideal distribution.
 */
export function mitigateRun(item: QpuRunHistoryItem, comparison: IdealComparison): MitigatedReadings | null {
  if (comparison.status !== "computed" || !item.raw_counts) return null;
  return mitigatedReadings({
    ideal: comparison.ideal,
    qubitCount: comparison.qubitCount,
    rawCounts: item.raw_counts,
    mitigation: item.mitigation,
  });
}

/** Schedules one task and returns a function that cancels it if it has not run. */
export type ScheduleTask = (task: () => void) => () => void;

/**
 * The next macrotask, preferring the browser's idle time.
 *
 * `requestIdleCallback` where it exists, with a timeout so a page that never
 * goes idle still makes progress; `setTimeout(0)` where it does not (Safari has
 * shipped without it). Either way the task runs after the browser has had a
 * chance to paint and handle input, which is the whole point.
 */
export const nextMacrotask: ScheduleTask = (task) => {
  const idle = globalThis as {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof idle.requestIdleCallback === "function") {
    const handle = idle.requestIdleCallback(task, { timeout: 250 });
    return () => idle.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(task, 0);
  return () => clearTimeout(handle);
};

/**
 * Works out the comparisons for `order`'s finished runs, ONE per scheduled task,
 * and reports each through `onResult`. Returns a function that stops it.
 *
 * Why it exists: one comparison is a statevector simulation, which at the free
 * tier's ceiling is on the order of a second of main-thread time. Computing a
 * page of them during render froze the page for all of them before anything
 * could be clicked. Here nothing is computed synchronously, the browser gets a
 * turn between every two simulations, and a reader can scroll, open details or
 * leave while the rest are still being worked out.
 *
 * `isCached` is asked at the moment each task runs, not when the work is
 * planned, so a run that was worked out in the meantime (by an earlier worker
 * this one replaced) is skipped instead of simulated twice. Skipping costs no
 * task: a task goes on past cached runs until it has computed exactly one.
 *
 * Caching by run id is sound because only finished runs are compared, and a
 * finished run never changes: `qpu_runs_repo.transition` refuses to rewrite a
 * terminal record, and its counts are written once.
 */
export function workThroughComparisons(options: {
  order: readonly QpuRunHistoryItem[];
  isCached: (id: string) => boolean;
  compute: (item: QpuRunHistoryItem) => IdealComparison;
  onResult: (id: string, comparison: IdealComparison) => void;
  schedule: ScheduleTask;
}): () => void {
  const { order, isCached, compute, onResult, schedule } = options;
  const seen = new Set<string>();
  const queue = order.filter((item) => {
    if (item.status !== "done" || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  let position = 0;
  let stopped = false;
  let cancelPending: (() => void) | null = null;

  const planNext = () => {
    while (position < queue.length && isCached(queue[position].id)) position += 1;
    if (stopped || position >= queue.length) {
      cancelPending = null;
      return;
    }
    cancelPending = schedule(() => {
      cancelPending = null;
      if (stopped) return;
      while (position < queue.length && isCached(queue[position].id)) position += 1;
      if (position >= queue.length) return;
      const item = queue[position];
      position += 1;
      onResult(item.id, compute(item));
      planNext();
    });
  };
  planNext();

  return () => {
    stopped = true;
    cancelPending?.();
    cancelPending = null;
  };
}

/** Ids of the listed runs the provider can still change, in list order. */
export function unfinishedRunIds(items: readonly QpuRunHistoryItem[]): string[] {
  return items.filter(isUnfinishedRun).map((item) => item.id);
}

/**
 * The listed runs with fresh records laid over them.
 *
 * A refresh reads each unfinished run through the single-record endpoint, which
 * does not carry the program. So the program is kept from the listed item, and
 * every other field is taken from the fresh record. A record for a run that is
 * not listed is ignored rather than added: this refreshes what is on the page,
 * it does not page. Returns the same array when nothing changed, so an answer
 * that changed nothing does not re-render the page.
 */
export function applyRunUpdates(
  items: readonly QpuRunHistoryItem[],
  records: readonly QpuRunRecord[],
): readonly QpuRunHistoryItem[] {
  if (records.length === 0) return items;
  const byId = new Map(records.map((record) => [record.id, record]));
  let changed = false;
  const next = items.map((item) => {
    const record = byId.get(item.id);
    if (!record) return item;
    const merged: QpuRunHistoryItem = { ...item, ...record, qasm: item.qasm };
    if (JSON.stringify(merged) === JSON.stringify(item)) return item;
    changed = true;
    return merged;
  });
  return changed ? next : items;
}
