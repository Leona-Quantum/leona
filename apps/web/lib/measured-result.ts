/**
 * The measured distribution a saved artifact carries, read off its version metadata.
 *
 * The Run surface has always shown these numbers, but it reads them from the run's
 * event stream. An artifact reopened from Vault has no event stream — so a saved
 * Bell state showed three passing checks, a resource table and the code, and not one
 * number the program actually measured. The worker now stores a bounded projection
 * (`metadata.measured_result`); this parses it back.
 *
 * Nothing is trusted: the stored object originates in sandbox output produced by
 * model-authored code. Every field is re-checked here, because the shape that was
 * bounded on write is not the shape this code is guaranteed to read — older
 * artifacts predate the field entirely, and a stored artifact outlives the writer
 * that produced it.
 */

export interface MeasuredResultValue {
  label: string;
  value: number;
}

export interface MeasuredResult {
  /** Bitstring -> shots, already the heaviest slice when `truncated`. */
  counts: Record<string, number> | null;
  /** Shots across the WHOLE distribution, including outcomes not in `counts`. */
  shots: number;
  /** Distinct outcomes across the whole distribution. */
  outcomeCount: number;
  /** True when `counts` holds only the heaviest outcomes. */
  truncated: boolean;
  values: MeasuredResultValue[];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Parse `metadata.measured_result`; null when the artifact carries no measurement. */
export function measuredResultFromMetadata(metadata: unknown): MeasuredResult | null {
  if (!metadata || typeof metadata !== "object") return null;
  const stored = (metadata as Record<string, unknown>).measured_result;
  if (!stored || typeof stored !== "object") return null;
  const record = stored as Record<string, unknown>;

  let counts: Record<string, number> | null = null;
  if (record.counts && typeof record.counts === "object") {
    const parsed: Record<string, number> = {};
    for (const [bitstring, raw] of Object.entries(record.counts as Record<string, unknown>)) {
      const count = finiteNumber(raw);
      if (count !== null && count >= 0) parsed[bitstring] = count;
    }
    if (Object.keys(parsed).length) counts = parsed;
  }

  const values: MeasuredResultValue[] = [];
  if (record.values && typeof record.values === "object") {
    for (const [label, raw] of Object.entries(record.values as Record<string, unknown>)) {
      const value = finiteNumber(raw);
      if (value !== null) values.push({ label: label.replaceAll("_", " "), value });
    }
  }

  if (!counts && !values.length) return null;

  const storedShots = finiteNumber(record.shots);
  const summed = counts ? Object.values(counts).reduce((total, count) => total + count, 0) : 0;
  // The stored total covers outcomes that were truncated away, so it is the one to
  // believe. Fall back to the visible sum only when it is absent or nonsensical —
  // never report fewer shots than the bars already on screen add up to.
  const shots = storedShots !== null && storedShots >= summed ? storedShots : summed;
  const storedOutcomes = finiteNumber(record.outcomeCount ?? record.outcome_count);
  const visibleOutcomes = counts ? Object.keys(counts).length : 0;
  const outcomeCount =
    storedOutcomes !== null && storedOutcomes >= visibleOutcomes ? storedOutcomes : visibleOutcomes;

  return {
    counts,
    shots,
    outcomeCount,
    // Trust the observable relationship over the stored flag: if more outcomes
    // exist than are stored, the histogram IS partial however it was labelled.
    truncated: record.truncated === true || outcomeCount > visibleOutcomes,
    values,
  };
}
