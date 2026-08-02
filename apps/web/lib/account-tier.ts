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
 * ## The tier ids are not the plan names. Read this before editing one.
 *
 *   `free`      → **Free**          ($0)
 *   `pro`       → **Plus**          ($50 per user per month)
 *   `team`      → **Professional**  ($240 per user per month)
 *   `developer` → internal only; never appears on the pricing page
 *
 * **`pro` is Plus, and `team` is Professional.** A reader who sees `pro` and
 * thinks "Professional" is looking at the wrong plan — the one below it. The
 * ids are deliberately not renamed: `LEONA_TEAM_EMAILS` is set in two
 * deployments and sits in the owner's todo, and this repository already keeps
 * internal ids (`majorana`) that stopped matching the product name (Leona
 * Quantum) on purpose. `ACCOUNT_COPY.tierNames` is the only place a tier gets a
 * human label, and account-tier.test.ts pins this mapping so an edit that
 * "corrects" `pro` to read Professional fails instead of shipping.
 *
 * Enterprise is a pricing card and a sales motion, not a tier: nothing here
 * enforces it and no account resolves to it.
 *
 * `preview` is not a plan either. It is what a request with no identity
 * resolves to — the signed-out fixture surface — and it was called "demo" until
 * the Team plan arrived. The rename is not cosmetic: with a real tier in the
 * list, a name that reads like a plan sitting where the least-capable plan
 * should be is one misreading away from someone treating "signed out" as a tier
 * that can be granted something. `preview` says what it is.
 *
 * Ordered least to most capable. `atLeastTier` is the only place that ordering
 * is read; everything else asks for a capability by name.
 */
export type AccountTier = "preview" | "free" | "pro" | "team" | "developer";

export const ACCOUNT_TIERS: readonly AccountTier[] = [
  "preview",
  "free",
  "pro",
  "team",
  "developer",
] as const;

/**
 * Tokens one advertised run is worth. MEASURED on production 2026-08-03 across
 * twelve full execute runs (14,650 for a GHZ, 19,452 for an H2 VQE, 54,182 for
 * a Grover run that spent its whole repair budget).
 *
 * Mirrors `TOKENS_PER_RUN_EQUIVALENT` in services/api/src/majorana_api/tiers.py,
 * which is the copy that enforces. Change it there.
 */
export const TOKENS_PER_RUN_EQUIVALENT = 30_000;

export type TierLimits = {
  /**
   * What the plan is SOLD as. No longer the gate — `agentTokensPerWeek` below
   * is, since 2026-08-03. Kept because it is the figure /pricing states and the
   * one a customer reasons in.
   *
   * null means unlimited.
   */
  agentRunsPerWeek: number | null;
  /**
   * The ENFORCED weekly allowance: LLM tokens across every stage, per account,
   * on a trailing seven days. Always `agentRunsPerWeek * TOKENS_PER_RUN_EQUIVALENT`
   * — the server pins that derivation in a test that parses this file.
   *
   * null means unlimited.
   */
  agentTokensPerWeek: number | null;
  /** null means unlimited. */
  privateArtifacts: number | null;
  /** Browser statevector lane. A product boundary, not a measurement — see the table below. */
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
   * How many SHARED projects this tier may be in at once, counting both
   * directions: projects it owns that carry a live grant, plus projects granted
   * to it. null means unlimited; 0 for a tier that cannot be granted one at all.
   *
   * **Unshared projects are unlimited on every tier and are not counted here.**
   * That is the owner's rule (2026-08-02): "unlimited non-shared projects can be
   * created". The previous reading counted grants RECEIVED only, which made this
   * a ceiling an account could never reach by sharing its own work.
   *
   * Mirrored from `TierLimits.shared_projects`, which is the copy that enforces:
   * this one is here so the pricing page can state a number that a test ties to
   * the server's.
   */
  sharedProjects: number | null;
};

/**
 * Browser-lane ceilings are 8 / 12 / 18 / 20 (preview shares free's 8), set by
 * the owner on 2026-08-02. **They are product differentiation now, not a
 * capability limit, and that is a change in what this number means.**
 *
 * What the hardware can actually do, measured on the same Float64Array kernel
 * studio-simulation.ts uses (2026-07-23, Apple silicon), at ~1,000 gates:
 *
 *   14 q -> 0.3 MB /   25 ms      18 q ->  4 MB /  311 ms
 *   16 q -> 1.0 MB /   78 ms      20 q -> 16 MB / 1233 ms
 *                                 22 q -> 64 MB / 5021 ms
 *
 * Every tier below Professional now sits well under its own hardware: free was
 * 16 and is 8, Plus was an interpolated 17 and is 12. So do not read a ceiling
 * here as "what the browser can take" and do not re-derive one from the sweep —
 * only Professional's 18 and developer's 20 are still near the measurement.
 *
 * The sweep is kept because it is still the ceiling on how HIGH any of these
 * may go. The lane runs on the main thread, so the real limit is a
 * responsiveness budget rather than a memory one: 22 qubits would freeze the
 * tab for five seconds on fast hardware, which is why nothing is set there.
 */
/**
 * Artifacts one project holds when its owner has not set a number, for every
 * tier. Mirrors `_project_limits.DEFAULT_PROJECT_ARTIFACT_LIMIT` on the server,
 * which is the copy that enforces.
 *
 * Not a field on `TierLimits`, because it is not one: the limit belongs to the
 * project and the owner can change it per project. It lives here so the pricing
 * page can state it and a test can tie that sentence to a number.
 *
 * Together with `sharedProjects` this is the whole bound on artifacts that
 * escape `privateArtifacts` — 4 shared projects x 50 for the Team plan.
 */
export const DEFAULT_PROJECT_ARTIFACT_LIMIT = 50;

export const TIER_LIMITS: Record<AccountTier, TierLimits> = {
  // Signed-out fixture preview. Nothing is persisted server-side by design, so
  // the limits here describe a walkthrough, not an allowance.
  preview: {
    agentRunsPerWeek: 0,
    agentTokensPerWeek: 0,
    privateArtifacts: 0,
    cpuSimQubits: 8,
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
    agentTokensPerWeek: 150000,
    privateArtifacts: 10,
    cpuSimQubits: 8,
    cpuSimOperations: 2_000,
    cpuSimShots: 16_384,
    cpuSimRunsPer10Min: 10,
    qpuEstimates: true,
    persistentArtifacts: true,
    projectSharing: false,
    sharedProjects: 0,
  },
  // **Plus** on the pricing page. Expanded allowances and nothing else:
  // `projectSharing` stays false — sharing is what Professional (`team`) is —
  // and `sharedProjects` is 0 rather than null for the reason that field
  // documents.
  //
  // All three numbers are the owner's table of 2026-08-02, not a derivation.
  // 12 qubits is well inside what the browser can do (free's measured 16 was
  // comfortable); see the note above TIER_LIMITS for why these stopped being
  // capability numbers.
  pro: {
    agentRunsPerWeek: 75,
    agentTokensPerWeek: 2250000,
    privateArtifacts: 75,
    cpuSimQubits: 12,
    cpuSimOperations: 2_500,
    cpuSimShots: 24_576,
    cpuSimRunsPer10Min: 15,
    qpuEstimates: true,
    persistentArtifacts: true,
    projectSharing: false,
    sharedProjects: 0,
  },
  // **Professional** on the pricing page — the collaboration plan, and the one
  // whose id reads like the tier below it. Runs, artifacts and the 18-qubit
  // lane are the owner's table of 2026-08-02; `sharedProjects` is the one
  // number that table did not restate and it keeps its earlier value.
  //
  // `privateArtifacts` mirrors `TIER_LIMITS["team"].private_artifacts` on the
  // server. If the two ever disagree the smaller wins in practice and the user
  // sees the server's refusal, which is the correct direction for a divergence.
  team: {
    agentRunsPerWeek: 250,
    agentTokensPerWeek: 7500000,
    privateArtifacts: 250,
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
    agentTokensPerWeek: null,
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

/**
 * Addresses granted the PRO tier — the plan the pricing page calls **Plus** —
 * from LEONA_PRO_EMAILS. Same parsing, same empty default, same variable the
 * control plane reads.
 *
 * The variable keeps the internal id rather than the public label for the
 * reason the tier ids do: it is set in deployment environments and read by two
 * services, and a rename would take effect in whichever of them was redeployed
 * first, resolving those accounts as free in the other.
 */
export function proEmails(raw: string | undefined = process.env.LEONA_PRO_EMAILS): string[] {
  return parseEmailList(raw);
}

export function resolveAccountTier(
  email: string | null | undefined,
  options: {
    isPreviewSurface?: boolean;
    allowlist?: string[];
    teamAllowlist?: string[];
    proAllowlist?: string[];
  } = {},
): AccountTier {
  // The preview surface is a property of the request, not of the person: it
  // serves fixtures and writes nothing, so it stays "preview" even if a
  // developer opens it. Checked first for that reason.
  if (options.isPreviewSurface) return "preview";
  const normalized = normalizeEmail(email);
  if (!normalized) return "preview";
  if (OPERATOR_IDENTITIES.has(normalized)) return "developer";
  // Highest first: an address on two lists resolves to the more capable tier
  // rather than to whichever check happened to be written first. Same order as
  // `resolve_tier` in services/api/src/majorana_api/tiers.py, which is the copy
  // that enforces — a different order here would offer a button the control
  // plane then refuses.
  if ((options.allowlist ?? developerEmails()).includes(normalized)) return "developer";
  if ((options.teamAllowlist ?? teamEmails()).includes(normalized)) return "team";
  if ((options.proAllowlist ?? proEmails()).includes(normalized)) return "pro";
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
