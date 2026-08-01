/**
 * Project sharing, from the browser's side (migration 0042, contracts 2.7.0).
 *
 * Two surfaces that never mix:
 *
 * - **Granting** — the workspace that owns a project decides who else may see
 *   it. `/api/workspace/projects/{id}/shares`.
 * - **Using** — a project somebody else granted you. `/api/shared/projects/...`.
 *
 * ## Nothing here is mirrored to localStorage, and that is deliberate
 *
 * `artifact-projects.ts` keeps a localStorage mirror so the rail renders before
 * the first fetch resolves. That mirror is keyed by STORAGE SCOPE — `u:<id>` in
 * a personal workspace, `u:<id>|w:<ws>` in a shared one — and a shared project
 * belongs to neither of those: it lives in a workspace this browser has no scope
 * for. Writing one into the mirror would file another tenant's circuits under
 * this workspace's key, and they would then be read back by `loadArtifactProjects`
 * as if they were the caller's own — which is the sidebar showing rows that a
 * revoke has already taken away.
 *
 * So a shared project is fetched every time and cached nowhere. The cost is a
 * spinner on the "Shared with me" section; the alternative is a stale copy of
 * data whose whole point is that permission to see it can be withdrawn.
 */

export type ShareRole = "viewer" | "editor";

export interface ProjectShare {
  projectId: string;
  granteeUserId: string;
  granteeEmail: string;
  granteeDisplayName: string | null;
  role: ShareRole;
  grantedByEmail: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface SharedProject {
  id: string;
  name: string;
  ownerWorkspaceId: string;
  ownerWorkspaceName: string;
  role: ShareRole;
  sharedByEmail: string | null;
  sharedByDisplayName: string | null;
  expiresAt: string | null;
  sharedAt: string;
  artifactCount: number;
  /** Latest change to the project or anything in it. See `hasMoved` below. */
  revision: string;
}

/** A save was refused because somebody else saved first. */
export class ShareVersionConflict extends Error {
  readonly currentVersionId: string | null;

  constructor(currentVersionId: string | null) {
    super("Somebody else saved this circuit while you were editing it");
    this.name = "ShareVersionConflict";
    this.currentVersionId = currentVersionId;
  }
}

/** The server refused the grant and said why in a sentence worth showing. */
export class ShareRefused extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * Parse one grant, or return null.
 *
 * Null rather than a partially-filled object with empty strings: a share row
 * whose role did not survive the wire would otherwise render as a viewer, and
 * showing somebody the wrong permission is worse than showing them one fewer
 * row and a count that does not match.
 */
export function parseProjectShare(value: unknown): ProjectShare | null {
  if (!isRecord(value)) return null;
  const role = value.role;
  if (role !== "viewer" && role !== "editor") return null;
  if (typeof value.project_id !== "string") return null;
  if (typeof value.grantee_user_id !== "string") return null;
  if (typeof value.grantee_email !== "string" || !value.grantee_email) return null;
  if (typeof value.created_at !== "string") return null;
  return {
    projectId: value.project_id,
    granteeUserId: value.grantee_user_id,
    granteeEmail: value.grantee_email,
    granteeDisplayName: optionalString(value.grantee_display_name),
    role,
    grantedByEmail: optionalString(value.granted_by_email),
    expiresAt: optionalString(value.expires_at),
    createdAt: value.created_at,
  };
}

export function parseSharedProject(value: unknown): SharedProject | null {
  if (!isRecord(value)) return null;
  const role = value.role;
  if (role !== "viewer" && role !== "editor") return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.name !== "string" || !value.name) return null;
  if (typeof value.owner_workspace_id !== "string") return null;
  if (typeof value.owner_workspace_name !== "string") return null;
  if (typeof value.shared_at !== "string") return null;
  if (typeof value.revision !== "string") return null;
  if (typeof value.artifact_count !== "number" || !Number.isFinite(value.artifact_count)) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    ownerWorkspaceId: value.owner_workspace_id,
    ownerWorkspaceName: value.owner_workspace_name,
    role,
    sharedByEmail: optionalString(value.shared_by_email),
    sharedByDisplayName: optionalString(value.shared_by_display_name),
    expiresAt: optionalString(value.expires_at),
    sharedAt: value.shared_at,
    artifactCount: Math.max(0, Math.trunc(value.artifact_count)),
    revision: value.revision,
  };
}

/**
 * Is this grant within `days` of running out?
 *
 * A grant that expires is only useful if somebody is told before it does — an
 * access that disappears silently reads as a bug in the product rather than as
 * the decision it was. `false` for a grant with no expiry, which is not "expiring
 * very far in the future".
 */
export function expiresSoon(share: { expiresAt: string | null }, now: Date, days = 7): boolean {
  if (!share.expiresAt) return false;
  const at = Date.parse(share.expiresAt);
  if (Number.isNaN(at)) return false;
  const remaining = at - now.getTime();
  return remaining > 0 && remaining <= days * 24 * 60 * 60 * 1000;
}

export function hasExpired(share: { expiresAt: string | null }, now: Date): boolean {
  if (!share.expiresAt) return false;
  const at = Date.parse(share.expiresAt);
  if (Number.isNaN(at)) return false;
  return at <= now.getTime();
}

/**
 * Has anything in the project changed since the client last looked?
 *
 * Compared as INSTANTS, not as strings. The two stamps come from the same
 * database clock but not necessarily with the same textual formatting, and
 * `"2026-08-01T10:00:00+00:00" !== "2026-08-01T10:00:00Z"` describes the same
 * moment — a string compare would report a change on every poll and teach the
 * user to ignore the notice.
 */
export function hasMoved(seen: string | null | undefined, current: string): boolean {
  if (!seen) return false;
  const before = Date.parse(seen);
  const after = Date.parse(current);
  if (Number.isNaN(before) || Number.isNaN(after)) return false;
  return after > before;
}

/**
 * The control plane's refusals are RFC 7807 problem documents.
 *
 * `services/api/app._problem` turns EVERY `HTTPException` into
 * `{type, title, status, code, ...extensions}` — the sentence is `title`, and a
 * typed refusal's fields (`reason`, and whatever that reason carries) are
 * SIBLINGS of it, not nested under `detail`.
 *
 * This function read `detail` in its first draft, because that is FastAPI's
 * default and the route handlers raise `HTTPException(detail=...)`. Nothing
 * failed: `refusalMessage` returned null, every refusal fell back to its generic
 * sentence, and `parseConflict` never found a version id — so the conflict
 * dialog's "open theirs" button would have been permanently dead. Found by
 * asserting the real body in `test_project_shares_http_live.py` rather than by
 * reading the handler.
 *
 * `detail` is still read as a fallback: a 502/504 from the BFF's own
 * `controlPlaneUnavailable` is not a problem document, and neither is whatever
 * a future proxy layer inserts.
 */
export function refusalSentence(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.title === "string" && payload.title) return payload.title;
  if (typeof payload.detail === "string" && payload.detail) return payload.detail;
  if (isRecord(payload.detail) && typeof payload.detail.error === "string") {
    return payload.detail.error;
  }
  if (typeof payload.error === "string" && payload.error) return payload.error;
  return null;
}

/** The version that won a conflict, out of the problem document that refused. */
export function conflictVersionId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (payload.reason !== "version_conflict") return null;
  return optionalString(payload.current_version_id);
}

async function refusalMessage(response: Response): Promise<string | null> {
  try {
    return refusalSentence((await response.json()) as unknown);
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Granting
// --------------------------------------------------------------------------

export async function loadProjectShares(projectId: string): Promise<ProjectShare[]> {
  const response = await fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}/shares`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Sharing could not be loaded");
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) throw new Error("Sharing response was invalid");
  return payload.map(parseProjectShare).filter((share): share is ProjectShare => share !== null);
}

export async function grantProjectShare(
  projectId: string,
  input: { email: string; role: ShareRole; expiresAt?: string | null },
): Promise<ProjectShare> {
  const response = await fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}/shares`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email.trim(),
      role: input.role,
      expires_at: input.expiresAt || null,
    }),
    cache: "no-store",
  });
  // 409 is the server refusing for a reason it can name — already a member,
  // sharing with yourself, past the cap. 404 is an address with no account.
  // Both are answers, not failures, so they arrive as sentences.
  if (response.status === 409 || response.status === 422) {
    throw new ShareRefused((await refusalMessage(response)) ?? "That share was refused");
  }
  if (response.status === 404) {
    throw new ShareRefused("Nobody with that email address has a Leona account yet");
  }
  if (!response.ok) throw new Error("The project could not be shared");
  const share = parseProjectShare((await response.json()) as unknown);
  if (!share) throw new Error("Sharing response was invalid");
  return share;
}

export async function revokeProjectShare(projectId: string, granteeUserId: string): Promise<void> {
  const response = await fetch(
    `/api/workspace/projects/${encodeURIComponent(projectId)}/shares/${encodeURIComponent(granteeUserId)}`,
    { method: "DELETE", cache: "no-store" },
  );
  // A 404 means it is already gone, which is what was asked for.
  if (!response.ok && response.status !== 404) throw new Error("Access could not be revoked");
}

export async function revokeAllProjectShares(projectId: string): Promise<void> {
  const response = await fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}/shares`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404) throw new Error("Sharing could not be stopped");
}

// --------------------------------------------------------------------------
// Using a grant
// --------------------------------------------------------------------------

export async function loadSharedProjects(): Promise<SharedProject[]> {
  const response = await fetch("/api/shared/projects", { cache: "no-store" });
  if (!response.ok) throw new Error("Shared projects could not be loaded");
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) throw new Error("Shared projects response was invalid");
  return payload
    .map(parseSharedProject)
    .filter((project): project is SharedProject => project !== null);
}

export async function loadSharedProject(projectId: string): Promise<SharedProject> {
  const response = await fetch(`/api/shared/projects/${encodeURIComponent(projectId)}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("That shared project is no longer available");
  const project = parseSharedProject((await response.json()) as unknown);
  if (!project) throw new Error("Shared project response was invalid");
  return project;
}

export async function loadSharedProjectArtifacts(projectId: string): Promise<unknown[]> {
  const response = await fetch(
    `/api/shared/projects/${encodeURIComponent(projectId)}/artifacts`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("That shared project is no longer available");
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? payload : [];
}

export async function saveSharedVersion(
  projectId: string,
  artifactId: string,
  input: { expectedCurrentVersionId: string | null; code: string; codeLang: string },
): Promise<void> {
  const response = await fetch(
    `/api/shared/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_current_version_id: input.expectedCurrentVersionId,
        code: input.code,
        code_lang: input.codeLang,
      }),
      cache: "no-store",
    },
  );
  if (response.status === 409) {
    // Read the winner out of the refusal. Without it the only thing the UI can
    // say is "try again", and trying again with the same stale id fails
    // identically forever.
    let currentVersionId: string | null = null;
    try {
      currentVersionId = conflictVersionId((await response.json()) as unknown);
    } catch {
      currentVersionId = null;
    }
    throw new ShareVersionConflict(currentVersionId);
  }
  if (response.status === 403) throw new ShareRefused("This project is shared with you read-only");
  if (!response.ok) throw new Error("That edit could not be saved");
}

export async function copySharedArtifact(
  projectId: string,
  artifactId: string,
  targetProjectId?: string,
): Promise<unknown> {
  const response = await fetch(
    `/api/shared/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/copy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_project_id: targetProjectId || null }),
      cache: "no-store",
    },
  );
  if (response.status === 429) {
    throw new ShareRefused(
      (await refusalMessage(response)) ?? "Your Studio is full — archive something first",
    );
  }
  if (response.status === 409) {
    throw new ShareRefused((await refusalMessage(response)) ?? "That circuit could not be copied");
  }
  if (!response.ok) throw new Error("That circuit could not be copied");
  return (await response.json()) as unknown;
}
