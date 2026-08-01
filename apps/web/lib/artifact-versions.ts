/**
 * Artifact version history, as Studio reads it.
 *
 * Two things here are not obvious and are the reason this is a module rather
 * than inline JSX.
 *
 * 1. `seq` is authoring order, NOT "which version is current". Restoring moves
 *    `artifacts.current_version_id` without writing a row, so the current
 *    version is regularly not the highest seq. Never infer current from
 *    position — read `is_current`.
 * 2. Versions are not interchangeable. A version the user typed in Studio has
 *    no QASM, no exports, no estimates and no verdict, because that is what a
 *    Studio draft is. The server states each row's capabilities and what
 *    restoring it would cost; this module carries those through so the list can
 *    say it out loud instead of the canvas discovering it.
 */

/** Which of the four writers produced a version. `unknown` is a real answer. */
export type VersionOrigin =
  | "agent_run"
  | "studio_draft"
  | "imported_reference"
  | "starter_example"
  | "unknown";

/** What a restore would take away. Codes, so each locale words them itself. */
export type RestoreLoss =
  | "qasm"
  | "export"
  | "resource_estimates"
  | "framework_variants"
  | "verification";

export const RESTORE_LOSSES: readonly RestoreLoss[] = [
  "qasm",
  "export",
  "resource_estimates",
  "framework_variants",
  "verification",
];

/** What a version's code IS, as opposed to who wrote it. */
export type ProgramRole = "circuit" | "program" | "unknown";

export type ArtifactVersionSummary = {
  id: string;
  seq: number;
  isCurrent: boolean;
  createdAt: string | null;
  origin: VersionOrigin;
  programRole: ProgramRole;
  verified: boolean;
  hasQasm: boolean;
  exportable: boolean;
  hasResourceEstimates: boolean;
  hasFrameworkVariants: boolean;
  restoreLosses: RestoreLoss[];
};

export type ArtifactVersionPage = {
  versions: ArtifactVersionSummary[];
  currentVersionId: string | null;
  nextBeforeSeq: number | null;
};

const ORIGINS: readonly VersionOrigin[] = [
  "agent_run",
  "studio_draft",
  "imported_reference",
  "starter_example",
  "unknown",
];

const PROGRAM_ROLES: readonly ProgramRole[] = ["circuit", "program", "unknown"];

function origin(value: unknown): VersionOrigin {
  // An origin the web does not know about is "unknown", never the nearest
  // match: the label sits next to a restore button.
  return ORIGINS.includes(value as VersionOrigin) ? (value as VersionOrigin) : "unknown";
}

function programRole(value: unknown): ProgramRole {
  // Same rule, and it matters more here: "unknown" is a real answer the server
  // sends for source that binds neither name, so an absent field and an
  // unrecognised one land on the honest value rather than on "program". Calling
  // a circuit a program is what made one get executed as a script.
  return PROGRAM_ROLES.includes(value as ProgramRole) ? (value as ProgramRole) : "unknown";
}

function losses(value: unknown): RestoreLoss[] {
  if (!Array.isArray(value)) return [];
  return RESTORE_LOSSES.filter((loss) => value.includes(loss));
}

function version(raw: unknown): ArtifactVersionSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.seq !== "number") return null;
  return {
    id: row.id,
    seq: row.seq,
    isCurrent: row.is_current === true,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    origin: origin(row.origin),
    programRole: programRole(row.program_role),
    // Every capability defaults to absent. A field the server did not send is
    // not a capability the version has, and claiming otherwise is how a canvas
    // is asked to render QASM that is not there.
    verified: row.verified === true,
    hasQasm: row.has_qasm === true,
    exportable: row.exportable === true,
    hasResourceEstimates: row.has_resource_estimates === true,
    hasFrameworkVariants: row.has_framework_variants === true,
    restoreLosses: losses(row.restore_losses),
  };
}

export function versionPageFromResource(payload: unknown): ArtifactVersionPage {
  const body = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const rows = Array.isArray(body.versions) ? body.versions : [];
  return {
    versions: rows.map(version).filter((row): row is ArtifactVersionSummary => row !== null),
    currentVersionId:
      typeof body.current_version_id === "string" ? body.current_version_id : null,
    nextBeforeSeq: typeof body.next_before_seq === "number" ? body.next_before_seq : null,
  };
}

/**
 * The losses named in a 409 from the restore endpoint.
 *
 * Returns null when the body is not that refusal, so a caller cannot mistake a
 * generic failure for "the user only has to confirm".
 */
export function restoreRefusalLosses(payload: unknown): RestoreLoss[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const detail = (payload as Record<string, unknown>).detail;
  if (typeof detail !== "object" || detail === null) return null;
  const body = detail as Record<string, unknown>;
  if (body.reason !== "restore_loses_capabilities") return null;
  return losses(body.losses);
}
