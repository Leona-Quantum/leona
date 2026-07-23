/**
 * Pure presentation math for a recorded CPU simulation. Everything here is
 * computed from the sampled counts themselves — the artifact family only
 * selects which *phrasing* of the computed facts to lead with, it never
 * asserts an outcome the sample does not show.
 */

export type SimulationBar = {
  bitstring: string;
  count: number;
  /** Fraction of all shots, 0..1. */
  share: number;
  peak: boolean;
};

export type SimulationChartData = {
  bars: SimulationBar[];
  /** Shots aggregated beyond the displayed bars. */
  otherShots: number;
  /** Distinct states aggregated beyond the displayed bars. */
  otherStates: number;
  distinctStates: number;
  peak: SimulationBar;
};

export const MAX_SIMULATION_BARS = 12;

export function simulationChartData(
  counts: Record<string, number>,
  shots: number,
  maxBars: number = MAX_SIMULATION_BARS,
): SimulationChartData | null {
  if (shots < 1) return null;
  const sorted = Object.entries(counts)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort(([leftBits, left], [rightBits, right]) => right - left || leftBits.localeCompare(rightBits));
  if (!sorted.length) return null;
  const shown = sorted.slice(0, maxBars);
  const rest = sorted.slice(maxBars);
  const bars = shown.map(([bitstring, count], index) => ({
    bitstring,
    count,
    share: count / shots,
    peak: index === 0,
  }));
  return {
    bars,
    otherShots: rest.reduce((sum, [, count]) => sum + count, 0),
    otherStates: rest.length,
    distinctStates: sorted.length,
    peak: bars[0],
  };
}

export type SimulationReading =
  | { kind: "concentrated"; peak: SimulationBar }
  | { kind: "paired"; first: SimulationBar; second: SimulationBar; combinedShare: number }
  | { kind: "spread"; distinctStates: number; peak: SimulationBar };

/**
 * Choose which computed fact leads the record's headline. Search-style
 * families lead with the dominant state; entangled-pair families lead with
 * the top two correlated outcomes; everything else describes the shape the
 * sample actually has.
 */
export function simulationReading(family: string | null | undefined, data: SimulationChartData): SimulationReading {
  const normalized = (family ?? "").toLowerCase();
  const paired = data.bars.length >= 2
    ? { kind: "paired" as const, first: data.bars[0], second: data.bars[1], combinedShare: data.bars[0].share + data.bars[1].share }
    : null;
  if ((normalized.includes("bell") || normalized.includes("ghz")) && paired) return paired;
  if (normalized.includes("grover") || normalized.includes("search")) return { kind: "concentrated", peak: data.peak };
  if (data.peak.share >= 0.5) return { kind: "concentrated", peak: data.peak };
  return { kind: "spread", distinctStates: data.distinctStates, peak: data.peak };
}

export function formatShare(share: number, locale: string): string {
  const percent = share * 100;
  const digits = percent >= 99.95 || percent < 0.05 ? 1 : percent >= 10 ? 1 : 2;
  return `${percent.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
}
