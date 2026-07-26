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
 * gate that does not exist. It binds callers who go through the BFF; the
 * control plane is a *separate service*, and a script holding a valid access
 * token can call `POST /v1/runs` on it directly and never pass through here.
 * That path is bounded by a flat per-workspace ceiling in the API itself
 * (`_enforce_execute_backstop` in services/api/.../routes/runs.py), which is an
 * abuse backstop far above every tier — deliberately not a second copy of this
 * policy. Real per-tier enforcement has to move server-side before multi-user
 * signup ships; see DECISIONS.md 2026-07-26.
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
): RunAllowanceVerdict {
  if (limit === null) return { allowed: true, used: 0, limit: null, resetsAt: null };
  const windowStart = now.getTime() - WEEK_MS;
  const counted: number[] = [];
  for (const run of runs) {
    if (run.mode !== "execute" || !run.created_at) continue;
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
      `Your Vault holds ${used} of ${limit} artifacts on this plan. ` +
      "Archive an artifact you no longer need, or rerun against an existing one, " +
      "and the submission will go through.",
    reason: "artifact_allowance_exhausted",
    used,
    limit,
  };
}
