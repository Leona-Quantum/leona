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
  /**
   * How far a contributor may grow this project (contracts 2.8.0).
   *
   * Read defensively — see `parseSharedProject`. A web build that lands before
   * the API's sees no such field, and the whole page must not fail to parse over
   * a number that only enables one button.
   */
  artifactLimit: number;
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
export class ShareRefused extends Error {
  /**
   * The control plane's machine-readable reason, when it sent one.
   *
   * Carried beside the sentence rather than instead of it: a caller that knows
   * the code renders its own translated copy, and one that does not still has
   * something true to show.
   */
  readonly reason: string | null;

  constructor(message: string, reason: string | null = null) {
    super(message);
    this.reason = reason;
  }
}

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
    // Absent is NOT a parse failure, unlike every field above it.
    //
    // The two services deploy separately and in either order. Every other field
    // here has existed since sharing shipped, so its absence means the payload is
    // not a shared project at all — but `artifact_limit` arrived in contracts
    // 2.8.0, and a web deploy landing before the API's would otherwise turn a
    // perfectly good "Shared with me" page into "no longer available".
    //
    // The fallback is 0, not the platform default: 0 hides the Add button, and an
    // old API has no contribution route behind that button anyway. Guessing 50
    // would render an action that 404s.
    artifactLimit:
      typeof value.artifact_limit === "number" && Number.isFinite(value.artifact_limit)
        ? Math.max(0, Math.trunc(value.artifact_limit))
        : 0,
    revision: value.revision,
  };
}

/** May this person add a circuit to this project right now? */
export function canContribute(project: SharedProject): boolean {
  return project.role === "editor" && project.artifactCount < project.artifactLimit;
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

/**
 * The machine-readable `reason` on a refusal, when it carries one.
 *
 * The `title` beside it is an English sentence written by the control plane,
 * and this app renders Japanese. A reason code is the only part of a refusal
 * that can be translated — everything keyed off the sentence would either read
 * English to a Japanese reader or match on prose that changes.
 */
export function refusalReason(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return typeof payload.reason === "string" && payload.reason ? payload.reason : null;
}

async function refusalMessage(response: Response): Promise<string | null> {
  try {
    return refusalSentence((await response.json()) as unknown);
  } catch {
    return null;
  }
}

async function refusal(response: Response): Promise<ShareRefused> {
  let payload: unknown = null;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    payload = null;
  }
  return new ShareRefused(
    refusalSentence(payload) ?? "That share was refused",
    refusalReason(payload),
  );
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
  // sharing with yourself, the recipient's plan, past the cap. 403 is the
  // caller's own plan not including sharing at all. 404 is an address with no
  // account. All three are answers, not failures, so they arrive as sentences.
  //
  // 403 was not handled here when sharing shipped, because nothing could
  // produce one: every refusal the route had was a 409. It fell through to the
  // generic "could not be shared", which is the sentence a person sees when
  // there is nothing they can do — the opposite of what a plan refusal means.
  if (response.status === 403 || response.status === 409 || response.status === 422) {
    throw await refusal(response);
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

/**
 * Give up a grant somebody made to you.
 *
 * Takes no user id, unlike `revokeProjectShare` above: the control plane keys
 * the removal on the caller's own identity, so there is nothing here to aim at
 * a different person. A 404 is treated as success for the same reason revoking
 * does — the grant being gone already is what was asked for, and the likeliest
 * way to see one is a second click.
 */
export async function leaveSharedProject(projectId: string): Promise<void> {
  const response = await fetch(`/api/shared/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404) throw new Error("You could not leave this project");
}

export async function revokeAllProjectShares(projectId: string): Promise<void> {
  const response = await fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}/shares`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404) throw new Error("Sharing could not be stopped");
}

/**
 * How many circuits people you share this project with may add to it.
 *
 * Read off the owner's own project resource rather than off a share row: the
 * limit is a property of the container, so it is the same number whether the
 * project is shared with nobody or with fifty people.
 */
export async function loadProjectArtifactLimit(projectId: string): Promise<number | null> {
  const response = await fetch("/api/workspace/projects", { cache: "no-store" });
  if (!response.ok) return null;
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) return null;
  const row = payload.find((item) => isRecord(item) && item.id === projectId);
  if (!isRecord(row)) return null;
  // Absent means an API that predates contracts 2.8.0. Null, not a guessed
  // default: the control that would be rendered from a guess writes a real
  // number back, so guessing here would silently CHANGE the project's limit.
  return typeof row.max_artifacts === "number" && Number.isFinite(row.max_artifacts)
    ? Math.max(0, Math.trunc(row.max_artifacts))
    : null;
}

export async function setProjectArtifactLimit(
  projectId: string,
  maxArtifacts: number,
): Promise<number> {
  const response = await fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_artifacts: maxArtifacts }),
    cache: "no-store",
  });
  if (response.status === 409 || response.status === 422) {
    throw new ShareRefused((await refusalMessage(response)) ?? "That limit was refused");
  }
  if (!response.ok) throw new Error("That limit could not be saved");
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || typeof payload.max_artifacts !== "number") {
    throw new Error("That limit could not be saved");
  }
  return payload.max_artifacts;
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

/**
 * Add a new circuit to a project somebody else owns.
 *
 * The 409 sentence is shown verbatim. The control plane writes two different
 * ones — the project is full, or the owner's plan is — and only one of those is
 * something the contributor can ask to have changed, so collapsing them into a
 * single local string would send people at the wrong wall.
 */
export async function contributeSharedArtifact(
  projectId: string,
  input: { title: string; code: string; framework: string; family?: string },
): Promise<unknown> {
  const response = await fetch(`/api/shared/projects/${encodeURIComponent(projectId)}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title.trim(),
      family: input.family || "other",
      framework: input.framework,
      code: input.code,
      code_lang: "python",
    }),
    cache: "no-store",
  });
  if (response.status === 409 || response.status === 422) {
    throw new ShareRefused((await refusalMessage(response)) ?? "That circuit could not be added");
  }
  if (response.status === 403) throw new ShareRefused("This project is shared with you read-only");
  if (!response.ok) throw new Error("That circuit could not be added");
  return (await response.json()) as unknown;
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
