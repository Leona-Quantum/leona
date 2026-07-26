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

// The worker's own bounds, restated. The write path caps these, but a stored
// artifact outlives the writer that produced it, so a blob that reaches here
// unbounded — older schema, hand-edited row, a future writer — must not be able
// to make the chart sort an unbounded histogram or the panel render an unbounded
// list. Keep these in step with simple_ports.MAX_* if those ever move.
const MAX_OUTCOMES = 64;
const MAX_VALUES = 16;
const MAX_KEY_CHARS = 64;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Reject arrays and exotic objects; only a plain record can carry these fields. */
function plainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Parse `metadata.measured_result`; null when the artifact carries no measurement. */
export function measuredResultFromMetadata(metadata: unknown): MeasuredResult | null {
  const outer = plainRecord(metadata);
  if (!outer) return null;
  const record = plainRecord(outer.measured_result);
  if (!record) return null;

  let counts: Record<string, number> | null = null;
  let acceptedOutcomes = 0;
  const storedCounts = plainRecord(record.counts);
  if (storedCounts) {
    const accepted: Array<[string, number]> = [];
    for (const [bitstring, raw] of Object.entries(storedCounts)) {
      // Overlong keys are rejected, never truncated — truncation would collide
      // two distinct outcomes onto one bar.
      if (bitstring.length > MAX_KEY_CHARS) continue;
      const count = finiteNumber(raw);
      if (count !== null && count >= 0) accepted.push([bitstring, count]);
    }
    acceptedOutcomes = accepted.length;
    if (accepted.length) {
      accepted.sort(([leftKey, left], [rightKey, right]) => right - left || leftKey.localeCompare(rightKey));
      counts = Object.fromEntries(accepted.slice(0, MAX_OUTCOMES));
    }
  }

  const values: MeasuredResultValue[] = [];
  const storedValues = plainRecord(record.values);
  if (storedValues) {
    for (const [label, raw] of Object.entries(storedValues)) {
      if (label.length > MAX_KEY_CHARS) continue;
      const value = finiteNumber(raw);
      if (value !== null) values.push({ label: label.replaceAll("_", " "), value });
      if (values.length === MAX_VALUES) break;
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
  // Floor at what this parser itself accepted before capping, not at what
  // survived the cap. Otherwise a blob holding 100 outcomes and no
  // `outcome_count` would cap to 64 and then report 64 as the whole truth.
  const outcomeCount = Math.max(storedOutcomes ?? 0, acceptedOutcomes, visibleOutcomes);

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
