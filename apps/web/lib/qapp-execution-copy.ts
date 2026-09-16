/**
 * What a visitor is told when a Qapp run does not produce a result.
 *
 * The worker records a machine code on the execution row — `qapp_program_failed`,
 * `qapp_result_missing`, `qapp_execution_failed`, `job_dead_letter` — and the
 * runtime used to hand that string straight to the generated interface and to
 * the status line under it. A visitor read "qapp_program_failed" beside a
 * button they had just pressed. This maps each code to a sentence, and keeps
 * an unknown code visible rather than hiding it, because a code nobody mapped
 * is the one somebody will need to report.
 *
 * Lives in `lib/` rather than beside the component so the required CI job
 * (`node --test`, which cannot parse JSX) covers it — the same reason
 * `qapp-range-smoke.ts` is here.
 */
const EXECUTION_ERROR_COPY: Record<string, string> = {
  qapp_program_failed: "The quantum program stopped with an error before it produced a result.",
  qapp_result_missing: "The quantum program finished without producing a result.",
  qapp_execution_failed: "The run could not be completed. Try again in a moment.",
  job_dead_letter: "The run was abandoned after repeated failures. Try again later.",
};

export function executionErrorSentence(code: string | null | undefined): string {
  if (!code) return "Execution failed.";
  return EXECUTION_ERROR_COPY[code] ?? `Execution failed (${code}).`;
}
