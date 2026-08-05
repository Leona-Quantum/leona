import {
  simulationChartData,
  type SimulationChartData,
} from "./simulation-visual.ts";
import type { PublicLocale } from "./public-locale.ts";

export type ResultDistributionKind = "counts" | "probabilities" | "weights";

export interface ResultDistributionView {
  data: SimulationChartData;
  kind: ResultDistributionKind;
  label: string;
  total: number;
}

export interface ResultTracePoint {
  index: number;
  value: number;
}

export interface ResultTraceView {
  label: string;
  points: ResultTracePoint[];
  pointCount: number;
  start: number;
  end: number;
  minimum: number;
  maximum: number;
}

export interface ResultValueView {
  label: string;
  value: string;
}

export interface ResultVisualizationView {
  distribution: ResultDistributionView | null;
  traces: ResultTraceView[];
  values: ResultValueView[];
}

const MAX_RESULT_VALUES = 10;
const MAX_RESULT_TRACES = 3;
const MAX_TRACE_POINTS = 96;
const TRACE_KEY = /(?:history|trace|curve|trajectory|convergence|loss(?:es)?|energies|costs|objectives)/i;
const COUNT_KEY = /(?:counts|samples|histogram)/i;
const PROBABILITY_KEY = /(?:distribution|probabilit)/i;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function basisWidth(length: number): number | null {
  if (length < 2) return null;
  const width = Math.log2(length);
  return Number.isInteger(width) ? width : null;
}

function indexedDistribution(values: readonly number[]): Record<string, number> | null {
  const width = basisWidth(values.length);
  if (width === null) return null;
  return Object.fromEntries(
    values.map((value, index) => [index.toString(2).padStart(width, "0"), value]),
  );
}

function amplitudeProbability(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value * value;
  if (
    Array.isArray(value)
    && value.length === 2
    && value.every((part) => typeof part === "number" && Number.isFinite(part))
  ) {
    return value[0] * value[0] + value[1] * value[1];
  }
  const record = recordValue(value);
  if (!record) return null;
  const real = record.real ?? record.re;
  const imaginary = record.imag ?? record.im;
  if (
    typeof real === "number"
    && Number.isFinite(real)
    && typeof imaginary === "number"
    && Number.isFinite(imaginary)
  ) {
    return real * real + imaginary * imaginary;
  }
  return null;
}

const JAPANESE_RESULT_LABEL: Record<string, string> = {
  best_bitstring: "最良ビット列",
  best_objective: "最良目的関数値",
  converged: "収束",
  cost: "コスト",
  energy: "エネルギー",
  energy_ha: "エネルギー (Ha)",
  estimated_value: "推定値",
  expectation_value: "期待値",
  fidelity: "忠実度",
  iterations: "反復回数",
  loss: "損失",
  notes: "メモ",
  objective: "目的関数値",
  optimization_history: "最適化履歴",
  parameters: "パラメータ",
  return: "リターン",
  risk: "リスク",
  shots: "ショット数",
  success_probability: "成功確率",
};

export function humanizeResultKey(
  value: string,
  locale: PublicLocale = "en",
): string {
  if (locale === "ja") {
    const translated = JAPANESE_RESULT_LABEL[value.toLowerCase()];
    if (translated) return translated;
  }
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatResultNumber(value: number, locale: PublicLocale = "en"): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value) && Math.abs(value) < 1e15) {
    return value.toLocaleString(locale === "ja" ? "ja-JP" : "en-US");
  }
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e6)) {
    return value.toExponential(4);
  }
  return String(Number(value.toFixed(6)));
}

function distributionKind(
  key: string,
  values: readonly number[],
  total: number,
): ResultDistributionKind {
  if (/probabilit/i.test(key)) return "probabilities";
  if (values.every(Number.isInteger)) return "counts";
  if (total > 0 && total <= 1.000001 && values.every((value) => value <= 1)) {
    return "probabilities";
  }
  return "weights";
}

/**
 * Find a bitstring distribution by shape, not by one framework's result key.
 * Semantic key names break ties, but `measurement_counts`, `histogram`, and a
 * researcher's own result key all remain displayable.
 */
export function distributionFromResult(
  result: Record<string, unknown> | null,
  locale: PublicLocale = "en",
): ResultDistributionView | null {
  if (!result) return null;

  const candidates: Array<{
    key: string;
    values: Record<string, number>;
    score: number;
    label?: string;
  }> = [];
  for (const [key, raw] of Object.entries(result)) {
    if (Array.isArray(raw) && /probabilit|distribution/i.test(key)) {
      const values = raw.every(
        (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
      ) ? indexedDistribution(raw as number[]) : null;
      if (values && Object.values(values).some((value) => value > 0)) {
        candidates.push({ key, values, score: 8, label: locale === "ja" ? "確率分布" : "Probability distribution" });
      }
    }
    if (Array.isArray(raw) && /statevector|amplitudes?/i.test(key)) {
      const probabilities = raw.map(amplitudeProbability);
      const values = probabilities.every((value): value is number => value !== null)
        ? indexedDistribution(probabilities)
        : null;
      if (values && Object.values(values).some((value) => value > 0)) {
        candidates.push({
          key: "probabilities",
          values,
          score: 3,
          label: locale === "ja" ? "状態確率（振幅から算出）" : "State probabilities · derived from amplitudes",
        });
      }
    }
    const record = recordValue(raw);
    if (!record) continue;
    const entries = Object.entries(record);
    if (!entries.length) continue;
    const valid = entries.every(
      ([outcome, value]) =>
        /^[01]+$/.test(outcome)
        && typeof value === "number"
        && Number.isFinite(value)
        && value >= 0,
    );
    if (!valid) continue;
    const values = Object.fromEntries(entries) as Record<string, number>;
    if (!Object.values(values).some((value) => value > 0)) continue;
    candidates.push({
      key,
      values,
      score: 4
        + (COUNT_KEY.test(key) ? 6 : PROBABILITY_KEY.test(key) ? 4 : 0)
        + (Object.values(values).every(Number.isInteger) ? 1 : 0)
        + Math.min(entries.length, 3) / 10,
    });
  }

  const candidate = candidates.sort(
    (left, right) => right.score - left.score || left.key.localeCompare(right.key),
  )[0];
  if (!candidate) return null;
  const values = Object.values(candidate.values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const data = simulationChartData(candidate.values, total);
  if (!data) return null;
  const kind = distributionKind(candidate.key, values, total);
  const label = kind === "counts"
    ? locale === "ja" ? "測定分布" : "Measured distribution"
    : kind === "probabilities"
      ? candidate.label ?? (locale === "ja" ? "確率分布" : "Probability distribution")
      : locale === "ja"
        ? `${humanizeResultKey(candidate.key, locale)}の分布`
        : `${humanizeResultKey(candidate.key, locale)} distribution`;
  return { data, kind, label, total };
}

function sampledTrace(values: readonly number[]): ResultTracePoint[] {
  if (values.length <= MAX_TRACE_POINTS) {
    return values.map((value, index) => ({ index, value }));
  }

  const selected = new Set<number>([0, values.length - 1]);
  // Reserve two slots for extrema. They are evidence-bearing points that an
  // evenly sampled sparkline can otherwise skip.
  for (let sample = 1; sample < MAX_TRACE_POINTS - 3; sample += 1) {
    selected.add(Math.round((sample * (values.length - 1)) / (MAX_TRACE_POINTS - 3)));
  }
  const minimum = values.reduce(
    (best, value, index) => value < values[best] ? index : best,
    0,
  );
  const maximum = values.reduce(
    (best, value, index) => value > values[best] ? index : best,
    0,
  );
  selected.add(minimum);
  selected.add(maximum);
  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => ({ index, value: values[index] }));
}

/** Numeric iteration series are useful evidence; short parameter vectors are not. */
export function tracesFromResult(
  result: Record<string, unknown> | null,
  locale: PublicLocale = "en",
): ResultTraceView[] {
  if (!result) return [];
  const traces: ResultTraceView[] = [];
  for (const [key, raw] of Object.entries(result)) {
    if (!TRACE_KEY.test(key) || !Array.isArray(raw) || raw.length < 2) continue;
    if (!raw.every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    const values = raw as number[];
    const { minimum, maximum } = values.reduce(
      (range, value) => ({
        minimum: Math.min(range.minimum, value),
        maximum: Math.max(range.maximum, value),
      }),
      { minimum: values[0], maximum: values[0] },
    );
    traces.push({
      label: humanizeResultKey(key, locale),
      points: sampledTrace(values),
      pointCount: values.length,
      start: values[0],
      end: values[values.length - 1],
      minimum,
      maximum,
    });
    if (traces.length === MAX_RESULT_TRACES) break;
  }
  return traces;
}

export function valuesFromResult(
  result: Record<string, unknown> | null,
  expectedKeys: readonly string[] = [],
  locale: PublicLocale = "en",
): ResultValueView[] {
  if (!result) return [];
  const keys = [
    ...expectedKeys.filter((key) => key in result),
    ...Object.keys(result).filter((key) => !expectedKeys.includes(key)),
  ];
  const values: ResultValueView[] = [];
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      values.push({ label: humanizeResultKey(key, locale), value: formatResultNumber(value, locale) });
    } else if (typeof value === "boolean") {
      values.push({ label: humanizeResultKey(key, locale), value: String(value) });
    } else if (typeof value === "string" && value.length <= 200) {
      values.push({ label: humanizeResultKey(key, locale), value });
    } else if (
      Array.isArray(value)
      && value.length <= 8
      && !TRACE_KEY.test(key)
      && value.every((item) => typeof item === "number" && Number.isFinite(item))
    ) {
      values.push({
        label: humanizeResultKey(key, locale),
        value: (value as number[]).map((item) => formatResultNumber(item, locale)).join(", "),
      });
    }
    if (values.length === MAX_RESULT_VALUES) break;
  }
  return values;
}

export function resultVisualizationFromResult(
  result: Record<string, unknown> | null,
  expectedKeys: readonly string[] = [],
  locale: PublicLocale = "en",
): ResultVisualizationView {
  return {
    distribution: distributionFromResult(result, locale),
    traces: tracesFromResult(result, locale),
    values: valuesFromResult(result, expectedKeys, locale),
  };
}
