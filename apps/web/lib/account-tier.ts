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

/**
 * `preview` is not a plan. It is what a request with no identity resolves to —
 * the signed-out fixture surface — and it was called "demo" until the Team plan
 * arrived. The rename is not cosmetic: with a real tier in the list, a name
 * that reads like a plan sitting where the least-capable plan should be is one
 * misreading away from someone treating "signed out" as a tier that can be
 * granted something. `preview` says what it is.
 *
 * Ordered least to most capable. `atLeastTier` is the only place that ordering
 * is read; everything else asks for a capability by name.
 */
export type AccountTier = "preview" | "free" | "team" | "developer";

export const ACCOUNT_TIERS: readonly AccountTier[] = [
  "preview",
  "free",
  "team",
  "developer",
] as const;

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
  persistentArtifacts: boolean;
  /**
   * Whether the tier may share a project with somebody outside the workspace
   * that owns it.
   *
   * A capability rather than an allowance: it refuses an operation outright
   * instead of counting one. Mirrored from `TierLimits.project_sharing` in
   * services/api/src/majorana_api/tiers.py, which is the copy that ENFORCES —
   * this one only decides whether the button is offered. A browser that lies
   * about it gets a 403 from the control plane.
   */
  projectSharing: boolean;
  /**
   * How many of somebody else's projects this tier may be a member of at once.
   * null means unlimited; 0 for a tier that cannot be granted one at all.
   *
   * Counts grants RECEIVED, not projects owned — a paying account is not
   * capped at four of its own projects while a free one may create them
   * without bound. Mirrored from `TierLimits.shared_projects`, which is again
   * the copy that enforces: this one is here so the pricing page can state a
   * number that a test ties to the server's.
   */
  sharedProjects: number | null;
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
  preview: {
    agentRunsPerWeek: 0,
    privateArtifacts: 0,
    cpuSimQubits: 16,
    cpuSimOperations: 2_000,
    cpuSimShots: 8_192,
    cpuSimRunsPer10Min: 10,
    qpuEstimates: true,
    persistentArtifacts: false,
    projectSharing: false,
    sharedProjects: 0,
  },
  free: {
    agentRunsPerWeek: 5,
    privateArtifacts: 25,
    cpuSimQubits: 16,
    cpuSimOperations: 2_000,
    cpuSimShots: 16_384,
    cpuSimRunsPer10Min: 10,
    qpuEstimates: true,
    persistentArtifacts: true,
    projectSharing: false,
    sharedProjects: 0,
  },
  // The collaboration plan. The artifact allowance is the owner's number; the
  // browser-lane ceilings sit between free and developer because they bound the
  // user's own hardware and cost the platform nothing.
  //
  // `privateArtifacts` mirrors `TIER_LIMITS["team"].private_artifacts` on the
  // server. If the two ever disagree the smaller wins in practice and the user
  // sees the server's refusal, which is the correct direction for a divergence.
  team: {
    agentRunsPerWeek: 50,
    privateArtifacts: 150,
    cpuSimQubits: 18,
    cpuSimOperations: 3_000,
    cpuSimShots: 32_768,
    cpuSimRunsPer10Min: 20,
    qpuEstimates: true,
    persistentArtifacts: true,
    projectSharing: true,
    sharedProjects: 4,
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
    persistentArtifacts: true,
    projectSharing: true,
    sharedProjects: null,
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

function parseEmailList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map(normalizeEmail)
    .filter((entry) => entry.includes("@"));
}

/**
 * Addresses granted the developer tier, from LEONA_DEVELOPER_EMAILS
 * (comma- or whitespace-separated). Empty by default and never hardcoded.
 */
export function developerEmails(
  raw: string | undefined = process.env.LEONA_DEVELOPER_EMAILS,
): string[] {
  return parseEmailList(raw);
}

/**
 * Addresses granted the team tier, from LEONA_TEAM_EMAILS. Same parsing, same
 * empty default, and the same variable the control plane reads — one value set
 * in two places rather than two values in two places.
 */
export function teamEmails(raw: string | undefined = process.env.LEONA_TEAM_EMAILS): string[] {
  return parseEmailList(raw);
}

export function resolveAccountTier(
  email: string | null | undefined,
  options: {
    isPreviewSurface?: boolean;
    allowlist?: string[];
    teamAllowlist?: string[];
  } = {},
): AccountTier {
  // The preview surface is a property of the request, not of the person: it
  // serves fixtures and writes nothing, so it stays "preview" even if a
  // developer opens it. Checked first for that reason.
  if (options.isPreviewSurface) return "preview";
  const normalized = normalizeEmail(email);
  if (!normalized) return "preview";
  if (OPERATOR_IDENTITIES.has(normalized)) return "developer";
  // Highest first: an address on both lists resolves to the more capable tier
  // rather than to whichever check happened to be written first.
  if ((options.allowlist ?? developerEmails()).includes(normalized)) return "developer";
  if ((options.teamAllowlist ?? teamEmails()).includes(normalized)) return "team";
  return "free";
}

/**
 * Whether `tier` sits at or above `floor`.
 *
 * The only place tiers are ordered. Everything else asks for a capability by
 * name — `limitsForTier(tier).projectSharing` — because a comparison written at
 * a call site has to be revisited every time a tier is added between two
 * others, and the one that gets missed fails open or closed silently.
 */
export function atLeastTier(tier: AccountTier, floor: AccountTier): boolean {
  return ACCOUNT_TIERS.indexOf(tier) >= ACCOUNT_TIERS.indexOf(floor);
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
