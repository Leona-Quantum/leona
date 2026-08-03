/**
 * Studio's projects — the workspace's artifact grouping (migration 0041).
 *
 * This replaces `artifact-folders.ts`, which kept both the project list and the
 * artifact→project assignments in localStorage and nowhere else. Under that
 * design a person's grouping did not survive a second device or a cleared
 * browser, and three people in one workspace each saw a different arrangement
 * over the same artifacts.
 *
 * The server is authoritative. localStorage stays as a mirror so the rail
 * renders before the first fetch resolves and keeps working while the control
 * plane is unreachable — the same role it plays for chat folders.
 */

import { clearArtifactProjectLocally, setArtifactProjectLocally } from "./library-data.ts";
// The problem+json readers, imported rather than re-written. A second parser
// for the same document is a second thing to disagree about which field holds
// the sentence — and this route now returns exactly the shape sharing does.
import { refusalReason, refusalSentence } from "./project-shares.ts";
import { scopedStorage } from "./user-storage.ts";

export interface ArtifactProject {
  id: string;
  name: string;
  createdAt: string;
}

const PROJECTS_STORAGE_KEY = "majorana.artifact-projects.v1";
export const ARTIFACT_PROJECTS_EVENT = "majorana:artifact-projects";

/**
 * The browser-era keys, read once by the adoption below and never written.
 *
 * They stay in `SCOPED_STORAGE_KEYS` so that a browser whose data predates
 * account scoping still has them moved under the signing-in account BEFORE
 * adoption looks for them — otherwise adoption would find nothing and quietly
 * drop the person's projects on exactly the machine that had them.
 */
const LEGACY_PROJECTS_KEY = "majorana.artifact-folders.v1";
const LEGACY_ASSIGNMENTS_KEY = "majorana.artifact-folder-assignments.v1";

function canUseStorage(): boolean {
  return scopedStorage.available();
}

function emitChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ARTIFACT_PROJECTS_EVENT));
}

export function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 80);
}

function isArtifactProject(value: unknown): value is ArtifactProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ArtifactProject>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.createdAt === "string";
}

/**
 * The mirror, in the order it was written.
 *
 * Deliberately NOT sorted. The API returns projects in the user's arrangement
 * (`projects.position`), and re-sorting here is precisely the bug that made
 * every chat-folder drag appear to work and then revert on the next render.
 */
export function loadArtifactProjects(): ArtifactProject[] {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(scopedStorage.getItem(PROJECTS_STORAGE_KEY) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isArtifactProject);
  } catch {
    return [];
  }
}

export function replaceArtifactProjects(projects: ArtifactProject[]): ArtifactProject[] {
  if (canUseStorage()) scopedStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  emitChange();
  return projects;
}

interface RemoteProject {
  id: string;
  name: string;
  created_at: string;
}

function isRemoteProject(value: unknown): value is RemoteProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RemoteProject>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.created_at === "string";
}

function toArtifactProject(project: RemoteProject): ArtifactProject {
  return { id: project.id, name: project.name, createdAt: project.created_at };
}

export async function createRemoteArtifactProject(name: string): Promise<ArtifactProject> {
  const response = await fetch("/api/workspace/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: normalizeProjectName(name) }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Project could not be saved");
  const payload = (await response.json()) as unknown;
  if (!isRemoteProject(payload)) throw new Error("Project response was invalid");
  const project = toArtifactProject(payload);
  // Appended, not inserted: a new project lands at the end of the arrangement
  // server-side, and the mirror has to agree or the row jumps on next load.
  // Filtered first because create is idempotent on the name — the server may
  // have answered with a project this browser already knows.
  replaceArtifactProjects([...loadArtifactProjects().filter((item) => item.id !== project.id), project]);
  return project;
}

export async function renameRemoteArtifactProject(projectId: string, name: string): Promise<ArtifactProject[]> {
  const response = await fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: normalizeProjectName(name) }),
    cache: "no-store",
  });
  // 409 is the server refusing a name another project already holds. The
  // refusal is the answer, not a failure to reach anything — surface it as
  // itself so the caller can say which half went wrong.
  if (response.status === 409) throw new Error("A project with that name already exists");
  if (!response.ok) throw new Error("Project could not be renamed");
  const payload = (await response.json()) as unknown;
  if (!isRemoteProject(payload)) throw new Error("Project response was invalid");
  const renamed = toArtifactProject(payload);
  return replaceArtifactProjects(
    loadArtifactProjects().map((project) => (project.id === renamed.id ? renamed : project)),
  );
}

/**
 * Delete the project. Its artifacts survive, ungrouped.
 *
 * The local artifacts are unfiled too, and that is not cosmetic: the sidebar
 * groups from `artifact.projectId`, so an artifact still pointing at a deleted
 * project would vanish from both the project list (no project) and the
 * ungrouped list (has a projectId) — present in the workspace and on no screen.
 */
export async function deleteRemoteArtifactProject(projectId: string): Promise<ArtifactProject[]> {
  const response = await fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404) throw new Error("Project could not be deleted");
  clearArtifactProjectLocally(projectId);
  return replaceArtifactProjects(loadArtifactProjects().filter((project) => project.id !== projectId));
}

/**
 * Persist the whole arrangement, optimistically.
 *
 * The mirror is written first so a moved project stays where it was put rather
 * than snapping back for the length of a round trip. On failure the server's
 * answer wins: an order the server refused must not survive locally, or the
 * next reload shows a third order that nobody chose.
 */
export async function reorderArtifactProjects(projects: ArtifactProject[]): Promise<ArtifactProject[]> {
  const previous = loadArtifactProjects();
  replaceArtifactProjects(projects);
  try {
    const response = await fetch("/api/workspace/projects/order", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: projects.map((project) => project.id) }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Project order could not be saved");
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) throw new Error("Project order response was invalid");
    return replaceArtifactProjects(payload.filter(isRemoteProject).map(toArtifactProject));
  } catch (error) {
    replaceArtifactProjects(previous);
    throw error;
  }
}

/**
 * The artifact does not exist in this workspace.
 *
 * Distinguished from every other failure because adoption treats them
 * differently: a 404 is settled and must not hold the migration open, while a
 * 5xx or a dropped connection means the assignment is still true and simply did
 * not land.
 */
export class ArtifactGoneError extends Error {}

/**
 * The move was understood and refused, and the sentence says why.
 *
 * Distinct from `ArtifactGoneError` and from a generic failure, because a
 * refusal is the one case where there is something true to put on screen. Since
 * 2026-08-02 this route has two of them: **409** when the target project is at
 * its own artifact limit, and **429** when moving OUT of a shared project would
 * put the workspace past its plan allowance. Neither existed when the drag
 * handler was written, so both fell through to "could not be saved" — a
 * sentence that reads as a bug for a rule the person could act on.
 */
export class ArtifactAssignmentRefused extends Error {
  /** The control plane's machine-readable reason, when it sent one. */
  readonly reason: string | null;

  constructor(message: string, reason: string | null = null) {
    super(message);
    this.name = "ArtifactAssignmentRefused";
    this.reason = reason;
  }
}

export async function assignArtifactToRemoteProject(artifactId: string, projectId?: string): Promise<void> {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/project`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId || null }),
    cache: "no-store",
  });
  if (response.status === 404) throw new ArtifactGoneError("Artifact is not in this workspace");
  if (response.status === 409 || response.status === 429) {
    // RFC 9457: the sentence is `title` and the reason is its sibling. Read
    // through the same helpers the sharing client uses so one refusal shape is
    // parsed one way across the app.
    let payload: unknown = null;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      payload = null;
    }
    throw new ArtifactAssignmentRefused(
      refusalSentence(payload) ?? "That circuit could not be filed there",
      refusalReason(payload),
    );
  }
  if (!response.ok) throw new Error("Artifact project assignment could not be saved");
}

/**
 * Set once this browser's local projects have been adopted into the workspace.
 *
 * The chat-folder version of this ran on EVERY sidebar mount and recreated any
 * local name with no remote match, which was invisible only until folders could
 * be deleted — at which point the deleted folder came straight back. Adoption is
 * a one-time migration, so it is recorded like one.
 *
 * "Once" means once per storage scope, not once per account, and that is already
 * correct: `scopedStorage` prefixes every key with the storage scope, which is
 * `u:<id>` in a personal workspace and `u:<id>|w:<ws>` in a shared one. A shared
 * workspace therefore carries its own flag and adopts its own mirror rather than
 * skipping the upload because the person had already adopted somewhere else.
 */
const PROJECTS_ADOPTED_KEY = "majorana.artifact-projects-adopted.v1";

function projectsAlreadyAdopted(): boolean {
  if (!canUseStorage()) return false;
  return scopedStorage.getItem(PROJECTS_ADOPTED_KEY) === "true";
}

function markProjectsAdopted(): void {
  if (canUseStorage()) scopedStorage.setItem(PROJECTS_ADOPTED_KEY, "true");
}

/** The browser-era project list, read for adoption only. */
export function loadLegacyArtifactProjects(): ArtifactProject[] {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(scopedStorage.getItem(LEGACY_PROJECTS_KEY) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isArtifactProject);
  } catch {
    return [];
  }
}

/** The browser-era `artifactId -> localProjectId` map, read for adoption only. */
export function loadLegacyArtifactAssignments(): Record<string, string> {
  if (!canUseStorage()) return {};
  try {
    const parsed = JSON.parse(scopedStorage.getItem(LEGACY_ASSIGNMENTS_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Read the workspace's projects, adopting this browser's on the first run.
 *
 * Returns the projects in the server's order and a map from each legacy local
 * project id to the workspace project it became, so the caller can migrate the
 * assignments it holds.
 */
export async function hydrateArtifactProjects(): Promise<{
  projects: ArtifactProject[];
  localIdMap: Record<string, string>;
}> {
  const response = await fetch("/api/workspace/projects", { cache: "no-store" });
  if (!response.ok) throw new Error("Projects could not be loaded");
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) throw new Error("Project response was invalid");

  const remote = payload.filter(isRemoteProject).map(toArtifactProject);
  const byName = new Map(remote.map((project) => [project.name.toLocaleLowerCase(), project]));
  const localIdMap: Record<string, string> = {};
  const created: ArtifactProject[] = [];
  const adopted = projectsAlreadyAdopted();

  for (const local of loadLegacyArtifactProjects()) {
    const existing = byName.get(local.name.toLocaleLowerCase());
    if (existing) {
      localIdMap[local.id] = existing.id;
      continue;
    }
    // A local project with no remote match is one of two things, and which one
    // depends entirely on whether adoption has run: before, it is a project the
    // user made when this was a browser-only feature and it should be uploaded.
    // After, it is one they DELETED, and uploading it un-deletes it.
    if (adopted) continue;
    const project = await createRemoteArtifactProject(local.name);
    byName.set(project.name.toLocaleLowerCase(), project);
    localIdMap[local.id] = project.id;
    created.push(project);
  }

  const projects = [...remote, ...created].filter(
    (project, index, all) => all.findIndex((item) => item.id === project.id) === index,
  );
  replaceArtifactProjects(projects);

  if (!adopted) {
    // Upload the browser-era assignments, mapped onto the workspace's project
    // ids. One artifact must not strand the other forty, so a failure is per
    // artifact rather than an abort — but WHICH failure decides whether this
    // ever runs again, and the two cases are not the same:
    //
    //   404  the artifact is gone server-side. Nothing to retry; the workspace
    //        is right and this browser is stale.
    //   any  5xx, a network error, an offline control plane. The assignment is
    //   else still true and simply did not land.
    //
    // Marking adoption complete after the second kind loses the person's whole
    // grouping to one flaky minute — the projects would exist and be empty, with
    // no path back. So the flag is withheld and the next mount retries; the
    // create is idempotent on the name, so nothing is duplicated by that retry.
    const known = new Set(projects.map((project) => project.id));
    const outcomes = await Promise.all(
      Object.entries(loadLegacyArtifactAssignments()).map(async ([artifactId, localProjectId]) => {
        const projectId = localIdMap[localProjectId] ?? localProjectId;
        if (!known.has(projectId)) return true;
        try {
          await assignArtifactToRemoteProject(artifactId, projectId);
          setArtifactProjectLocally(artifactId, projectId);
          return true;
        } catch (error) {
          return error instanceof ArtifactGoneError;
        }
      }),
    );
    if (outcomes.every(Boolean)) markProjectsAdopted();
  }

  return { projects, localIdMap };
}
