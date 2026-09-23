// How a plan's cost grows: the same cited formulas, evaluated at a range of
// sizes instead of one.
//
// PsiQuantum's Bartiq keeps a resource estimate symbolic so it stays a function
// of problem size rather than one number; this is the same idea on the Atlas's
// terms. Nothing here is a new formula. `costReport` already evaluates what each
// paper states for the chosen construction; a scaling series is that function
// called at several values of one parameter with every other value held where
// the reader left it. So every point carries the same kind (exact, bound,
// leading order, …) and the same source as the single-point table, and a line
// the source states only at particular sizes (Gidney 2025's Table 5) appears
// only at those sizes — the series never interpolates between them.
//
// Pure and synchronous, like the rest of the planner.
import type { Stage } from "./assemble.ts";
import { costReport } from "./costs.ts";
import { problemById } from "./problems.ts";
import { withinSpec } from "./recognise.ts";
import type { CostKind, CostLine, LogicalSummary, ParamKey, ParamSpec, ParamValues, ProblemId } from "./types.ts";

/** Points on a curve. Odd, so the reader's own value sits in the middle. */
export const SWEEP_POINTS = 9;
/** The curve spans this factor either side of the reader's value, where the parameter's range allows. */
export const SWEEP_SPAN = 16;

/** The logical quantities a curve can show, in the order the page draws them. */
export const SERIES_KEYS = ["logicalQubits", "toffolis", "tGates", "queries", "serialDepth"] as const;
export type SeriesKey = (typeof SERIES_KEYS)[number];

export interface SeriesPoint {
  x: number;
  /** Null where the formula needs a value this point lacks. */
  y: number | null;
  kind: CostKind | null;
  source: CostLine["source"];
  label: CostLine["label"] | null;
}

export interface ScalingSeries {
  key: SeriesKey;
  points: SeriesPoint[];
}

export interface PublishedMark {
  /** The published line's own id, e.g. `g2025-qubits`. */
  id: string;
  /** Which logical series the mark belongs beside. */
  series: SeriesKey;
  x: number;
  y: number;
  label: CostLine["label"];
  source: CostLine["source"];
}

export interface Scaling {
  param: ParamKey;
  xs: number[];
  series: ScalingSeries[];
  /** Tabulated values a source states only at some sizes, drawn as marks, never joined. */
  published: PublishedMark[];
  /** The index in `xs` of the reader's own value. */
  current: number;
}

function summaryLine(logical: LogicalSummary, key: SeriesKey): CostLine | null {
  return logical[key] ?? null;
}

/** A line id this module treats as a tabulated counterpart of a logical series. */
const PUBLISHED_SERIES: ReadonlyMap<string, SeriesKey> = new Map([
  ["g2025-qubits", "logicalQubits"],
  ["g2025-toffolis", "toffolis"],
]);

function withValue(params: ParamValues, key: ParamKey, value: number): ParamValues {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => (k === key ? [k, { key, value, origin: "reader" as const }] : [k, v])),
  ) as ParamValues;
}

/** Whether a logical figure in `a` and `b` differs anywhere — the test for "this parameter moves the cost". */
function logicalDiffers(a: LogicalSummary, b: LogicalSummary): boolean {
  return SERIES_KEYS.some((key) => (summaryLine(a, key)?.value ?? null) !== (summaryLine(b, key)?.value ?? null));
}

/**
 * The parameters a curve can be drawn over: the ones with a value that, when
 * moved, move a logical figure. Found by asking the cost model rather than
 * listed by hand, so a parameter added to a problem later is offered exactly
 * when its formula uses it, and one that only feeds a note is never offered.
 */
export function sweepableParams(problem: ProblemId, params: ParamValues, root: Stage | null): ParamKey[] {
  const spec = problemById(problem);
  if (!spec) return [];
  const base = costReport(problem, params, root).logical;
  const out: ParamKey[] = [];
  for (const param of spec.params) {
    const value = params[param.key]?.value;
    if (value === null || value === undefined) continue;
    const moved = nudge(param, value);
    if (moved === null) continue;
    if (logicalDiffers(base, costReport(problem, withValue(params, param.key, moved), root).logical)) out.push(param.key);
  }
  return out;
}

/** A different in-range value, for the "does it move anything" probe. */
function nudge(spec: ParamSpec, value: number): number | null {
  for (const candidate of [value * 2, value / 2, value + 1, value - 1]) {
    const v = spec.integer ? Math.round(candidate) : candidate;
    if (v !== value && withinSpec(spec, v)) return v;
  }
  return null;
}

/**
 * Points from `value / SWEEP_SPAN` to `value × SWEEP_SPAN`, clipped to the
 * parameter's range, with the reader's value always one of them.
 *
 * A parameter that counts something steps by powers of two: those are the
 * sizes papers tabulate (Gidney 2025's Table 5 is 1024…8192 bits), so a
 * published figure lands on the curve's own x rather than between two of its
 * points, and a count is never a fraction. Anything else steps geometrically,
 * rounded to three significant figures so the table reads as numbers a person
 * would write.
 */
export function sweepValues(spec: ParamSpec, value: number, count = SWEEP_POINTS): number[] {
  if (!withinSpec(spec, value) || value <= 0) return [value];
  const lo = Math.max(spec.min, value / SWEEP_SPAN);
  const hi = Math.min(spec.max, value * SWEEP_SPAN);
  const values = new Set<number>([value]);
  if (spec.integer) {
    for (let e = Math.ceil(Math.log2(Math.max(lo, 1))); 2 ** e <= hi; e += 1) {
      if (withinSpec(spec, 2 ** e)) values.add(2 ** e);
    }
  } else if (hi > lo) {
    for (let i = 0; i < count; i += 1) {
      const v = Number((lo * (hi / lo) ** (i / (count - 1))).toPrecision(3));
      if (withinSpec(spec, v)) values.add(v);
    }
  }
  return [...values].sort((a, b) => a - b);
}

export function scalingSeries(
  problem: ProblemId,
  params: ParamValues,
  root: Stage | null,
  param: ParamKey,
  xs?: number[],
): Scaling | null {
  const spec = problemById(problem)?.params.find((p) => p.key === param);
  const value = params[param]?.value;
  if (!spec || value === null || value === undefined) return null;
  const points = xs ?? sweepValues(spec, value);
  const reports = points.map((x) => costReport(problem, withValue(params, param, x), root));

  const series: ScalingSeries[] = [];
  for (const key of SERIES_KEYS) {
    const linePoints = reports.map((report, i): SeriesPoint => {
      const line = summaryLine(report.logical, key);
      // A "scaling" line carries a magnitude with no constant, not a count, so
      // it is not plotted as one.
      const y = line && line.kind !== "scaling" && line.value !== null && Number.isFinite(line.value) ? line.value : null;
      return { x: points[i], y, kind: line?.kind ?? null, source: line?.source ?? null, label: line?.label ?? null };
    });
    if (linePoints.some((p) => p.y !== null)) series.push({ key, points: linePoints });
  }

  const published: PublishedMark[] = [];
  reports.forEach((report, i) => {
    for (const line of report.lines) {
      const target = PUBLISHED_SERIES.get(line.id);
      if (!target || line.value === null) continue;
      published.push({ id: line.id, series: target, x: points[i], y: line.value, label: line.label, source: line.source });
    }
  });

  return { param, xs: points, series, published, current: points.indexOf(value) };
}

// ---------------------------------------------------------------------------
// The body `POST /v1/estimates/logical` takes (services/api routes/estimates.py).

/** The route's own bounds (`MAX_LOGICAL_QUBITS`, `MAX_GATE_COUNT`); a point past them is left out, not sent to be refused. */
export const MAX_LOGICAL_QUBITS = 1e8;
export const MAX_GATE_COUNT = 1e20;

export interface LogicalPointBody {
  label: string;
  parameter_value: number;
  logical_qubits: number;
  toffoli_count: number;
  t_count: number;
  non_clifford_depth: number;
}

function count(series: ScalingSeries | undefined, i: number): number | null {
  const y = series?.points[i]?.y;
  return y === null || y === undefined ? null : y;
}

/**
 * The points the physical estimate can cost: those with a logical qubit count
 * and at least one magic-state count. A point missing either is left out rather
 * than sent as zero — a zero Toffoli count is a claim that the algorithm needs
 * none, and the line was merely unstated.
 */
export function physicalRequestPoints(scaling: Scaling, label: (x: number) => string): LogicalPointBody[] {
  const find = (key: SeriesKey) => scaling.series.find((s) => s.key === key);
  const qubits = find("logicalQubits");
  const toffolis = find("toffolis");
  const tGates = find("tGates");
  const depth = find("serialDepth");
  const out: LogicalPointBody[] = [];
  scaling.xs.forEach((x, i) => {
    const q = count(qubits, i);
    const toffoli = count(toffolis, i);
    const t = count(tGates, i);
    if (q === null || (toffoli === null && t === null)) return;
    const d = count(depth, i);
    if (q > MAX_LOGICAL_QUBITS || [toffoli, t, d].some((v) => v !== null && v > MAX_GATE_COUNT)) return;
    out.push({
      label: label(x),
      parameter_value: x,
      logical_qubits: Math.ceil(q),
      toffoli_count: Math.round(toffoli ?? 0),
      t_count: Math.round(t ?? 0),
      non_clifford_depth: Math.round(count(depth, i) ?? 0),
    });
  });
  return out;
}
