/**
 * Account tiers and what each one may do.
 *
 * Deliberately identity-source-agnostic. Production signs in through WorkOS;
 * local development mints its own synthetic identity, and so does the deploy
 * probe. A resolver keyed on the *email* is the only shape that stays correct
 * across all of them, which is why adding or removing an identity source has
 * never required revisiting this file.
 *
 * The developer allowlist is read from the environment and is EMPTY by default.
 * This repository is public, so collaborator addresses must not be committed to
 * it — see LEONA_DEVELOPER_EMAILS in .env.local.example.
 */

export type AccountTier = "demo" | "free" | "developer";

export const ACCOUNT_TIERS: readonly AccountTier[] = ["demo", "free", "developer"] as const;

export type TierLimits = {
  /** null means unlimited. */
  agentRunsPerWeek: number | null;
  /** null means unlimited. */
  privateArtifacts: number | null;
  /** Browser statevector lane. Measured, not guessed — see the table below. */
  cpuSimQubits: number;
  cpuSimOperations: number;
  cpuSimShots: number;
  /**
   * Browser CPU simulations allowed per trailing 10 minutes. The lane runs on
   * the user's own hardware, so this is a pacing boundary, not a cost one.
   */
  cpuSimRunsPer10Min: number;
  /** Whether the tier may read QPU cost/resource estimates at all. */
  qpuEstimates: boolean;
  /** Whether saved artifacts persist beyond the browser session. */
  persistentVault: boolean;
};

/**
 * Browser-lane ceilings come from a measured sweep of the same Float64Array
 * kernel studio-simulation.ts uses (2026-07-23, Apple silicon), at ~1,000 gates:
 *
 *   14 q -> 0.3 MB /   25 ms      18 q ->  4 MB /  311 ms
 *   16 q -> 1.0 MB /   78 ms      20 q -> 16 MB / 1233 ms
 *                                 22 q -> 64 MB / 5021 ms
 *
 * The lane runs on the main thread, so the ceiling is a responsiveness budget
 * rather than a memory one: 22 qubits would freeze the tab for five seconds on
 * fast hardware, which is why nothing is set there. The previous cap of 6 for
 * everyone was roughly a thousand times more conservative than the measurement
 * justifies, and it was the reason no researcher-scale circuit could be run
 * anywhere in the product.
 */
export const TIER_LIMITS: Record<AccountTier, TierLimits> = {
  // Signed-out fixture preview. Nothing is persisted server-side by design, so
  // the limits here describe a walkthrough, not an allowance.
  demo: {
    agentRunsPerWeek: 0,
    privateArtifacts: 0,
    cpuSimQubits: 16,
    cpuSimOperations: 2_000,
    cpuSimShots: 8_192,
    cpuSimRunsPer10Min: 10,
    qpuEstimates: true,
    persistentVault: false,
  },
  free: {
    agentRunsPerWeek: 5,
    privateArtifacts: 25,
    cpuSimQubits: 16,
    cpuSimOperations: 2_000,
    cpuSimShots: 16_384,
    cpuSimRunsPer10Min: 10,
    qpuEstimates: true,
    persistentVault: true,
  },
  // Collaborators and the owner. "Unlimited" here means unlimited *product*
  // allowances. It is NOT a security tier: see grantsQpuSubmission below.
  developer: {
    agentRunsPerWeek: null,
    privateArtifacts: null,
    cpuSimQubits: 20,
    cpuSimOperations: 4_000,
    cpuSimShots: 65_536,
    cpuSimRunsPer10Min: 30,
    qpuEstimates: true,
    persistentVault: true,
  },
};

/** Identities minted by a non-WorkOS auth mode — the operator, or the operator's
 * own infrastructure. Kept in step with OPERATOR_IDENTITIES in
 * services/api/src/majorana_api/tiers.py, which is the copy that enforces. The
 * deploy probe never reaches this file — it holds an API credential and calls
 * the control plane directly — but the two sets are stated identically so a
 * reader comparing them does not have to work out which entries are missing on
 * purpose. */
const OPERATOR_IDENTITIES = new Set([
  "local-dev@majorana.test", // MAJORANA_LOCAL_DEV_AUTH
  "deploy-probe@leonaquantum.com", // DEPLOY_PROBE_TOKEN (post-deploy gate)
]);

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Addresses granted the developer tier, from LEONA_DEVELOPER_EMAILS
 * (comma- or whitespace-separated). Empty by default and never hardcoded.
 */
export function developerEmails(
  raw: string | undefined = process.env.LEONA_DEVELOPER_EMAILS,
): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map(normalizeEmail)
    .filter((entry) => entry.includes("@"));
}

export function resolveAccountTier(
  email: string | null | undefined,
  options: { isDemoSurface?: boolean; allowlist?: string[] } = {},
): AccountTier {
  // The demo surface is a property of the request, not of the person: it serves
  // fixtures and writes nothing, so it stays "demo" even if a developer opens
  // it. Checked first for that reason.
  if (options.isDemoSurface) return "demo";
  const normalized = normalizeEmail(email);
  if (!normalized) return "demo";
  if (OPERATOR_IDENTITIES.has(normalized)) return "developer";
  const allowlist = options.allowlist ?? developerEmails();
  return allowlist.includes(normalized) ? "developer" : "free";
}

export function limitsForTier(tier: AccountTier): TierLimits {
  return TIER_LIMITS[tier];
}

export function isUnlimited(tier: AccountTier): boolean {
  const limits = TIER_LIMITS[tier];
  return limits.agentRunsPerWeek === null && limits.privateArtifacts === null;
}

/**
 * The one thing a tier may never do.
 *
 * Real hardware submission is fail-closed behind three separate deployment
 * decisions (MAJORANA_QPU_SUBMIT_ENABLED, an IBM token, the runtime package).
 * Those are safety and spend gates owned by the operator, not product
 * allowances, and NEXT.md is explicit that a gate must not be weakened to
 * demonstrate something. So "unlimited" stops here: a developer-tier account
 * gets no submission capability that a free account does not have, and this
 * function exists so that the intent is testable rather than merely commented.
 */
export function grantsQpuSubmission(_tier: AccountTier): false {
  return false;
}
