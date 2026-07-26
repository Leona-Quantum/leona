import { scopedStorage } from "./user-storage.ts";

export interface ArtifactFolder {
  id: string;
  name: string;
  createdAt: string;
}

const FOLDERS_STORAGE_KEY = "majorana.artifact-folders.v1";
const ASSIGNMENTS_STORAGE_KEY = "majorana.artifact-folder-assignments.v1";
export const ARTIFACT_FOLDERS_EVENT = "majorana:artifact-folders";

// Per-account storage (lib/user-storage.ts): folder names are the user's words.
function canUseStorage(): boolean {
  return scopedStorage.available();
}

function emitChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ARTIFACT_FOLDERS_EVENT));
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function loadArtifactFolders(): ArtifactFolder[] {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(scopedStorage.getItem(FOLDERS_STORAGE_KEY) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isArtifactFolder).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export function createArtifactFolder(name: string): ArtifactFolder[] {
  const normalized = normalizeName(name);
  if (!normalized) return loadArtifactFolders();
  const current = loadArtifactFolders();
  if (current.some((folder) => folder.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) return current;
  const folder: ArtifactFolder = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `artifact-folder-${Date.now()}`,
    name: normalized,
    createdAt: new Date().toISOString(),
  };
  const next = [...current, folder];
  writeFolders(next);
  return next;
}

export function getArtifactFolderId(artifactId: string): string | undefined {
  if (!canUseStorage()) return undefined;
  try {
    const parsed = JSON.parse(scopedStorage.getItem(ASSIGNMENTS_STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const value = (parsed as Record<string, unknown>)[artifactId];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function assignArtifactToFolder(artifactId: string, folderId?: string): void {
  if (!canUseStorage()) return;
  try {
    const parsed = JSON.parse(scopedStorage.getItem(ASSIGNMENTS_STORAGE_KEY) ?? "{}") as unknown;
    const assignments = parsed && typeof parsed === "object" ? { ...(parsed as Record<string, unknown>) } : {};
    if (folderId) assignments[artifactId] = folderId;
    else delete assignments[artifactId];
    scopedStorage.setItem(ASSIGNMENTS_STORAGE_KEY, JSON.stringify(assignments));
    emitChange();
  } catch {
    // Storage is a convenience layer; the artifact remains available without it.
  }
}

function writeFolders(folders: ArtifactFolder[]): void {
  if (canUseStorage()) scopedStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  emitChange();
}

function isArtifactFolder(value: unknown): value is ArtifactFolder {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ArtifactFolder>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.createdAt === "string";
}
