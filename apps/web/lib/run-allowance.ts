/**
 * Server-side run metering for the weekly agent-run allowance.
 *
 * Pure functions over data the BFF already has (the account's recent runs from
 * `GET /v1/runs`), so the policy is unit-testable without any network. The BFF
 * run route applies the verdict before a submission reaches the control plane.
 *
 * SCOPE OF THAT GUARANTEE — this file used to claim a client "cannot skip it
 * without also skipping its own session cookie", which is not true and was
 * worth correcting because it invited later sessions to trust a server-side
 * gate that did not exist. It binds callers who go through the BFF; the control
 * plane is a *separate service*, and a script holding a valid access token can
 * call `POST /v1/runs` on it directly and never pass through here.
 *
 * That gap is now closed on the server. `majorana_api.tiers` holds the control
 * plane's own copy of the tier decision, `routes/runs.py` refuses an explicit
 * execute submission over the weekly limit, and the worker refuses an AUTO run
 * at the moment it resolves to EXECUTE — the one place the default-mode bypass
 * can be caught. The flat abuse ceiling stays above both.
 *
 * So this file is now the *fast* refusal rather than the only one: it answers
 * without a round trip and words the message for the user, and the server
 * enforces the same numbers whether or not anyone came through here. Keep the
 * two in step — the API's TIER_LIMITS mirrors the free-tier numbers below.
 *
 * Only `mode: "execute"` submissions are metered: those are the agent-pipeline
 * runs the published "runs per week" allowance describes. Chat turns are not
 * counted against it (they also create run rows, and counting them would make
 * a 5-run week unusable for conversation). If chat metering is ever wanted it
 * is a separate owner decision, not a widening of this one.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type MeteredRun = {
  mode?: string | null;
  created_at?: string | null;
  user_id?: string | null;
};

export type RunAllowanceVerdict = {
  allowed: boolean;
  /** Execute-mode runs counted inside the trailing week. */
  used: number;
  /** null means the tier is unmetered. */
  limit: number | null;
  /** When the oldest counted run leaves the window; null while allowed. */
  resetsAt: string | null;
};

export function assessRunAllowance(
  limit: number | null,
  runs: readonly MeteredRun[],
  now: Date = new Date(),
  /**
   * The viewer's own user id. When given, runs created by anyone else are not
   * counted.
   *
   * This matters only in a shared workspace, and it matters in the direction
   * that is worst to get wrong: `GET /v1/runs` lists the WORKSPACE's runs, so
   * without this a collaborator is refused here for runs a colleague submitted,
   * under a message that says "your plan". The control plane counts the
   * account's own runs across every workspace, which this cannot see; that is
   * the authoritative number, and this stays the fast pre-check that must never
   * refuse someone for somebody else's usage.
   *
   * Undefined means "not known" and counts everything — the pre-metering
   * behaviour, and the same failure direction the rest of this route takes when
   * a usage read fails.
   */
  viewerUserId?: string | null,
): RunAllowanceVerdict {
  if (limit === null) return { allowed: true, used: 0, limit: null, resetsAt: null };
  const windowStart = now.getTime() - WEEK_MS;
  const counted: number[] = [];
  for (const run of runs) {
    if (run.mode !== "execute" || !run.created_at) continue;
    if (viewerUserId && run.user_id && run.user_id !== viewerUserId) continue;
    const at = Date.parse(run.created_at);
    if (Number.isFinite(at) && at > windowStart && at <= now.getTime()) counted.push(at);
  }
  const used = counted.length;
  if (used < limit) return { allowed: true, used, limit, resetsAt: null };
  // The oldest run inside the window is the first to age out; the allowance
  // frees one slot exactly a week after it was consumed. A zero-run tier
  // stays refused however old its history gets, so promising a reset there
  // would be false.
  const resetsAt =
    limit > 0 && counted.length
      ? new Date(Math.min(...counted) + WEEK_MS).toISOString()
      : null;
  return { allowed: false, used, limit, resetsAt };
}

export type AllowanceRefusal = {
  error: string;
  reason: "run_allowance_exhausted" | "artifact_allowance_exhausted";
  used: number;
  limit: number;
  resets_at?: string | null;
};

export function runAllowanceRefusal(verdict: RunAllowanceVerdict): AllowanceRefusal {
  // Pinned to UTC: the BFF host's timezone must not shift the named day.
  const resetDate = verdict.resetsAt
    ? new Date(verdict.resetsAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;
  return {
    error:
      `Your plan includes ${verdict.limit} verified runs per week and all ` +
      `${verdict.limit} are used.` +
      (resetDate ? ` The next slot opens on ${resetDate}.` : "") +
      " Browser simulation in Studio stays available.",
    reason: "run_allowance_exhausted",
    used: verdict.used,
    limit: verdict.limit ?? 0,
    resets_at: verdict.resetsAt,
  };
}

export function artifactAllowanceRefusal(used: number, limit: number): AllowanceRefusal {
  return {
    error:
      `Your workspace holds ${used} of ${limit} artifacts on this plan. ` +
      "Archive an artifact you no longer need, or rerun against an existing one, " +
      "and the submission will go through.",
    reason: "artifact_allowance_exhausted",
    used,
    limit,
  };
}
