/**
 * Pure derivations over `QISKIT_HUMANEVAL_RUNS` — no copy, no JSX.
 *
 * Split out from the page component so `qiskit-humaneval-view.test.ts` can
 * exercise the exact arithmetic and the exact pending/completed branching the
 * page renders, under plain `node --test` (the page itself is an async
 * Server Component and cannot load there — see `public-title.test.ts`'s
 * header for why this repository's pages generally push logic out to a
 * sibling `lib/` module instead of testing JSX directly).
 *
 * The rule this file exists to enforce: a pending run (`pending: true`) never
 * produces a number. Every function below either returns `null`/a fixed
 * status for a pending run, or returns a value computed directly from a
 * completed run's own fields — nothing here is a second, hand-typed copy of
 * a figure that already lives in `qiskit-humaneval.ts`.
 */
import type { QiskitHumanEvalRun } from "./qiskit-humaneval.ts";

/**
 * The most recent run that has actually finished, or `null` if none has.
 * `QISKIT_HUMANEVAL_RUNS` is kept in chronological order (oldest first), so
 * this scans from the end and returns the first non-pending entry — the
 * newest completed run, skipping over any run still in progress after it.
 */
export function latestCompletedRun(runs: readonly QiskitHumanEvalRun[]): QiskitHumanEvalRun | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (!run.pending) return run;
  }
  return null;
}

export interface CompletedRunFacts {
  passed: number;
  total: number;
  gradable: number;
  passedOfGradable: number;
  /** `passed / total`, as a percentage rounded to one decimal place. */
  passRatePct: number;
  /** `passedOfGradable / gradable`, as a percentage rounded to one decimal place. */
  gradableRatePct: number;
}

/**
 * The headline figures for a completed run, computed from its own fields.
 * Returns `null` for a pending run or one missing a required count —
 * deliberately: a caller that does not check for `null` gets no numbers to
 * mis-render rather than a `NaN` slipping into the page.
 */
export function completedRunFacts(run: QiskitHumanEvalRun): CompletedRunFacts | null {
  if (run.pending) return null;
  const { passed, total, gradable, passedOfGradable } = run;
  if (passed === null || total === null || gradable === null || passedOfGradable === null) return null;
  if (total <= 0 || gradable <= 0) return null;
  return {
    passed,
    total,
    gradable,
    passedOfGradable,
    passRatePct: Math.round((passed / total) * 1000) / 10,
    gradableRatePct: Math.round((passedOfGradable / gradable) * 1000) / 10,
  };
}

/** The headline facts for the most recent completed run, or `null` if every run is still pending. */
export function headlineFacts(runs: readonly QiskitHumanEvalRun[]): CompletedRunFacts | null {
  const run = latestCompletedRun(runs);
  return run ? completedRunFacts(run) : null;
}

/**
 * Whether a single row of the history table must show the fixed "in
 * progress" status instead of a score. True whenever the run is flagged
 * pending, or — belt and braces — whenever its own fields do not actually
 * add up to a real score, so a future data-entry mistake (a `pending: false`
 * row with a null count left over from copy-pasting the pending template)
 * fails toward "no number shown" rather than toward a rendered `null`.
 */
export function isRunPendingForDisplay(run: QiskitHumanEvalRun): boolean {
  return run.pending || completedRunFacts(run) === null;
}

/**
 * Fills `{token}` placeholders in a copy string with real values — the same
 * pattern `about-copy.ts`'s `portraitAlt.replace("{name}", member.name)`
 * already uses on this site, generalized to more than one token so a
 * template can carry a whole sentence's worth of numbers at once.
 */
export function formatTemplate(template: string, values: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{${key}}`).join(String(value));
  }
  return result;
}
