/**
 * Qiskit HumanEval scores, as published on `/benchmarks` (ai-ops 372).
 *
 * Every field on every completed run is copied from that run's own report
 * JSON (`majorana_evals.public_benchmarks.schema.PublicBenchmarkReport`,
 * `evals/harness/src/majorana_evals/public_benchmarks/schema.py`) or from the
 * write-up built directly from it — never estimated, never rounded from a
 * different source. See
 * `~/Developer/ai-ops/desk/leona/plans/strategy-20260921/benchmark-runs-20260923/README.md`
 * (the first run) and `.../REVIEW-REJECTS-DIAGNOSIS.md` §8-11 (what the
 * review-step fix in PR 1010 changed).
 *
 * A run that has not finished yet is entered with `pending: true` and every
 * number field `null`. `qiskit-humaneval-view.ts` refuses to show a number
 * for a pending run — it renders a fixed "in progress" status instead — so a
 * placeholder here can never be mistaken for a measurement, and the page
 * component never has a live number to invent for it.
 */

export interface QiskitHumanEvalRun {
  /** ISO date the run's window started, e.g. "2026-09-23". */
  date: string;
  /** One line naming this run, shown as the history table's row label. */
  label: string;
  /** `generate_model` from the report — the model actually serving every Nala stage. */
  model: string | null;
  /** `pipeline_commit_sha` from the report: the exact worktree HEAD that produced it. */
  pipelineCommit: string | null;
  /** `dataset_commit_sha` from the report. */
  datasetCommit: string | null;
  /** `passed` from the report — out of `total`. */
  passed: number | null;
  /** `total` from the report (151 for the full benchmark). */
  total: number | null;
  /** The sandbox ceiling this run was scored against (106 — see `QISKIT_HUMANEVAL_CEILING`). */
  gradable: number | null;
  /** How many of `passed` fall inside the `gradable` set. */
  passedOfGradable: number | null;
  /** Real spend in USD, from the budget tracker at run time. */
  spendUsd: number | null;
  /** `total_wall_time_s` from the report, converted to hours. */
  wallTimeHours: number | null;
  /** One or two sentences of plain context for this specific run. */
  notes: string;
  /** True while the run has not finished. No other field may carry a number when this is true. */
  pending: boolean;
}

/**
 * Why 106, not 151: the sandbox that executes generated code has no internet
 * access, on purpose (majorana AGENTS.md's sandbox invariant — a sandbox that
 * can reach the internet is a release-blocking bug). 45 of the 151 tasks'
 * own reference solutions need something that sandbox blocks, so those 45
 * cannot pass no matter how good the generated code is:
 *
 * - 44 need `qiskit_ibm_runtime` (43 tasks) or `qiskit_ibm_transpiler` /
 *   `inspect` / `importlib` (1 task) in their own scaffold or canonical
 *   solution — all of it reaches IBM's cloud runtime, which needs network
 *   access.
 * - 1 (`qiskitHumanEval/82`) needs to write a file to disk.
 *
 * Computed the same way the harness's own test suite computes it: parsing
 * each task's scaffold and canonical solution with `ast` and checking every
 * import against `majorana_sandbox.guard.ALLOWED_IMPORTS`
 * (`test_dry_run_canonical_control_passes_on_gradable_qiskit_human_eval_tasks`).
 *
 * A model can still work around one of the 44 network-blocked tasks — three
 * of the four instances of that seen so far did it by calling `AerSimulator`
 * directly instead of importing `qiskit_ibm_runtime` — so a real run's total
 * pass count can land a few tasks above 106 even though the ceiling itself
 * does not move.
 */
export const QISKIT_HUMANEVAL_CEILING = {
  totalTasks: 151,
  gradableTasks: 106,
  blockedTasks: 45,
  blockedNeedsIbmCloud: 44,
  blockedNeedsFileWrite: 1,
} as const;

/**
 * Zero-spend controls run before every live attempt, to confirm the harness
 * itself had not drifted before spending anything: a canonical (correct)
 * solution submitted verbatim, and a garbage (deliberately wrong) one.
 */
export const QISKIT_HUMANEVAL_CONTROLS = {
  stubCanonical: { passed: 106, total: 151 },
  stubGarbage: { passed: 0, total: 151 },
} as const;

export const QISKIT_HUMANEVAL_RUNS: QiskitHumanEvalRun[] = [
  {
    date: "2026-09-23",
    label: "First run, before the review-step fix",
    model: "deepseek-v4-pro",
    pipelineCommit: "2228a86e82b9977f2606ca71115b0798aa676e9e",
    datasetCommit: "c98ba538239fcfd554aa89627ee8026f4b5de450",
    passed: 68,
    total: 151,
    gradable: 106,
    passedOfGradable: 64,
    spendUsd: 6.474,
    wallTimeHours: 2.46,
    notes:
      "Nala's review step was rejecting some code that had already passed the benchmark's own test, before it ever reached a user. PR 1010 fixes that.",
    pending: false,
  },
  {
    date: "2026-09-25",
    label: "Re-run, after the review-step fix (PR 1010)",
    model: "deepseek-v4-pro",
    pipelineCommit: null,
    datasetCommit: null,
    passed: null,
    total: null,
    gradable: null,
    passedOfGradable: null,
    spendUsd: null,
    wallTimeHours: null,
    notes: "Started 2026-09-25 at 10:05 UTC on PR 1010's merged code. Expected to take about 2.5 hours.",
    pending: true,
  },
];
