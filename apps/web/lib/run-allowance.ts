/**
 * Server-side artifact-cap metering for the BFF run route.
 *
 * WHAT USED TO BE HERE, and why it is not. This file also held
 * `assessRunAllowance` / `runAllowanceRefusal`: a fast pre-check that refused a
 * submission over the weekly agent-RUN count before it reached the control
 * plane. On 2026-08-03 the control plane stopped metering runs and started
 * metering tokens — `agent_runs_per_week` became what a plan is sold as and
 * gates nothing — and this pre-check was not moved with it.
 *
 * That left the BFF as the STRICTER of the two gates, enforcing a limit the
 * server had abandoned. A free account doing cheap work, which is precisely the
 * case metering tokens exists to serve, was refused at its 6th run of the week
 * by Next.js and never reached the server that would have admitted it.
 *
 * Both functions are deleted rather than left unwired. A tested,
 * plausible-looking gate sitting one import away from the route it used to
 * guard is how it comes back.
 *
 * The artifact cap below stays: the control plane enforces the same number, and
 * refusing early saves a user a pipeline run they cannot keep the output of.
 */

export type AllowanceRefusal = {
  error: string;
  /**
   * `run_allowance_exhausted` stays in the union although nothing in this file
   * produces it any more: it is the wire value the CONTROL PLANE sends, and the
   * client code that reads a 429 body still has to name it.
   */
  reason: "run_allowance_exhausted" | "artifact_allowance_exhausted";
  used: number;
  limit: number;
  resets_at?: string | null;
};

export function artifactAllowanceRefusal(used: number, limit: number): AllowanceRefusal {
  return {
    error:
      `Your Studio holds ${used} of ${limit} artifacts on this plan. ` +
      "Archive an artifact you no longer need, or rerun against an existing one, " +
      "and the submission will go through.",
    reason: "artifact_allowance_exhausted",
    used,
    limit,
  };
}
