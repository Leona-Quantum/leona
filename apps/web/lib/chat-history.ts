export type ChatStatus = "queued" | "running" | "verified" | "failed" | "draft";

export interface ChatSummary {
  id: string;
  conversationId?: string;
  title: string;
  prompt: string;
  createdAt: string;
  status: ChatStatus;
  framework?: string;
  folderId?: string;
  archivedAt?: string;
  demo?: boolean;
}

export interface ChatFolder {
  id: string;
  name: string;
  createdAt: string;
}

const STORAGE_KEY = "majorana.chat-history.v1";
const FOLDERS_STORAGE_KEY = "majorana.chat-folders.v1";
const DELETED_STORAGE_KEY = "majorana.deleted-chats.v1";
export const CHAT_ARCHIVE_RETENTION_DAYS = 14;
export const CHAT_HISTORY_EVENT = "majorana:chat-history";
export const CHAT_FOLDERS_EVENT = "majorana:chat-folders";

type HistoryOptions = { includeDemo?: boolean; includeArchived?: boolean };

const DEFAULT_CHATS: ChatSummary[] = [
  {
    id: "demo-verified",
    title: "MaxCut on a 5-node ring",
    prompt: "Use QAOA to solve MaxCut on a 5-node ring and verify the cut value.",
    createdAt: "2026-07-12T12:04:00.000Z",
    status: "verified",
    framework: "Qiskit",
    demo: true,
  },
  {
    id: "demo-midrun",
    title: "Estimate T-count for QFT",
    prompt: "Estimate the resources for a QFT circuit on eight qubits.",
    createdAt: "2026-07-11T09:30:00.000Z",
    status: "running",
    framework: "Qiskit",
    demo: true,
  },
  {
    id: "demo-failed",
    title: "Bell state verification",
    prompt: "Build a Bell state and verify the measured distribution.",
    createdAt: "2026-07-10T15:10:00.000Z",
    status: "failed",
    framework: "Qiskit",
    demo: true,
  },
];

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function emitChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHAT_HISTORY_EVENT));
}

function emitFoldersChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHAT_FOLDERS_EVENT));
}

function normalizeFolderName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 80);
}

function persist(chats: ChatSummary[]): ChatSummary[] {
  if (canUseStorage()) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  emitChange();
  return chats;
}

function persistSilently(chats: ChatSummary[]): void {
  if (canUseStorage()) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

function loadDeletedIds(): Set<string> {
  if (!canUseStorage()) return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DELETED_STORAGE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function persistDeletedIds(ids: Set<string>): void {
  if (canUseStorage()) window.localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...ids]));
}

export function loadChatHistory({ includeDemo = true, includeArchived = false }: HistoryOptions = {}): ChatSummary[] {
  if (!canUseStorage()) return includeDemo ? DEFAULT_CHATS : [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return includeDemo ? DEFAULT_CHATS : [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return includeDemo ? DEFAULT_CHATS : [];
    const deletedIds = loadDeletedIds();
    const valid = parsed
      .filter(isChatSummary)
      .filter((chat) => !deletedIds.has(chat.id))
      .filter((chat) => includeDemo || !chat.demo)
      .sort(sortNewestFirst);
    const retained = valid.filter((chat) => !chat.archivedAt || !isArchiveExpired(chat.archivedAt));
    if (retained.length !== valid.length) persistSilently(retained);
    const visible = includeArchived ? retained : retained.filter((chat) => !chat.archivedAt);
    return visible.length || !includeDemo ? visible : DEFAULT_CHATS;
  } catch {
    return includeDemo ? DEFAULT_CHATS : [];
  }
}

export function rememberChat(chat: ChatSummary): ChatSummary[] {
  const deletedIds = loadDeletedIds();
  deletedIds.delete(chat.id);
  persistDeletedIds(deletedIds);
  const current = loadChatHistory({ includeDemo: false, includeArchived: true }).filter((item) => item.id !== chat.id);
  const activeChat = { ...chat };
  delete activeChat.archivedAt;
  return persist([activeChat, ...current].sort(sortNewestFirst));
}

export function updateChat(
  id: string,
  patch: Partial<Pick<ChatSummary, "title" | "status" | "framework" | "folderId" | "archivedAt">>,
): ChatSummary[] {
  return persist(
    loadChatHistory({ includeDemo: false, includeArchived: true }).map((chat) => (chat.id === id ? { ...chat, ...patch } : chat)),
  );
}

export function archiveChat(id: string, fallback?: ChatSummary): ChatSummary[] {
  const current = loadChatHistory({ includeDemo: false, includeArchived: true });
  const archivedAt = new Date().toISOString();
  const existing = current.find((chat) => chat.id === id);
  if (existing) return persist(current.map((chat) => (chat.id === id ? { ...chat, archivedAt } : chat)));
  if (!fallback) return current;
  return persist([{ ...fallback, archivedAt }, ...current].sort(sortNewestFirst));
}

export function restoreChat(id: string): ChatSummary[] {
  return persist(
    loadChatHistory({ includeDemo: false, includeArchived: true }).map((chat) => {
      if (chat.id !== id) return chat;
      const restored = { ...chat };
      delete restored.archivedAt;
      return restored;
    }),
  );
}

export function deleteChat(id: string): ChatSummary[] {
  const deletedIds = loadDeletedIds();
  deletedIds.add(id);
  persistDeletedIds(deletedIds);
  return persist(loadChatHistory({ includeDemo: false, includeArchived: true }).filter((chat) => chat.id !== id));
}

export function daysUntilArchiveDeletion(archivedAt: string, now = new Date()): number {
  const expiresAt = new Date(archivedAt).valueOf() + CHAT_ARCHIVE_RETENTION_DAYS * 86_400_000;
  return Math.max(0, Math.ceil((expiresAt - now.valueOf()) / 86_400_000));
}

function isArchiveExpired(archivedAt: string): boolean {
  return daysUntilArchiveDeletion(archivedAt) <= 0;
}

export function loadChatFolders(): ChatFolder[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChatFolder).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

function persistFolders(folders: ChatFolder[]): ChatFolder[] {
  if (canUseStorage()) window.localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  emitFoldersChange();
  return folders;
}

export function replaceChatFolders(folders: ChatFolder[]): ChatFolder[] {
  return persistFolders(
    [...folders].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  );
}

export function createChatFolder(name: string): ChatFolder[] {
  const normalized = normalizeFolderName(name);
  if (!normalized) return loadChatFolders();
  const current = loadChatFolders();
  if (current.some((folder) => folder.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
    return current;
  }
  const folder: ChatFolder = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `folder-${Date.now()}`,
    name: normalized.slice(0, 80),
    createdAt: new Date().toISOString(),
  };
  const next = [...current, folder];
  return persistFolders(next);
}

export function assignChatToFolder(chatId: string, folderId?: string): ChatSummary[] {
  return updateChat(chatId, { folderId: folderId || undefined });
}

type RemoteFolder = {
  id: string;
  name: string;
  created_at: string;
};

function isRemoteFolder(value: unknown): value is RemoteFolder {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RemoteFolder>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.created_at === "string"
  );
}

function toChatFolder(folder: RemoteFolder): ChatFolder {
  return {
    id: folder.id,
    name: folder.name,
    createdAt: folder.created_at,
  };
}

export async function createRemoteChatFolder(name: string): Promise<ChatFolder> {
  const normalized = normalizeFolderName(name);
  const response = await fetch("/api/workspace/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: normalized }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Workspace folder could not be saved");
  const payload = (await response.json()) as unknown;
  if (!isRemoteFolder(payload)) throw new Error("Workspace folder response was invalid");
  const folder = toChatFolder(payload);
  replaceChatFolders([...loadChatFolders().filter((item) => item.id !== folder.id), folder]);
  return folder;
}

export async function assignChatToRemoteFolder(
  chatId: string,
  folderId?: string,
): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(chatId)}/folder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_id: folderId || null }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Chat folder assignment could not be saved");
}

export async function hydrateChatFolders(chats: ChatSummary[]): Promise<{
  folders: ChatFolder[];
  localIdMap: Record<string, string>;
}> {
  const response = await fetch("/api/workspace/folders", { cache: "no-store" });
  if (!response.ok) throw new Error("Workspace folders could not be loaded");
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) throw new Error("Workspace folder response was invalid");

  const remote = payload.filter(isRemoteFolder).map(toChatFolder);
  const byName = new Map(remote.map((folder) => [folder.name.toLocaleLowerCase(), folder]));
  const localIdMap: Record<string, string> = {};
  const created: ChatFolder[] = [];

  for (const local of loadChatFolders()) {
    const existing = byName.get(local.name.toLocaleLowerCase());
    if (existing) {
      localIdMap[local.id] = existing.id;
      continue;
    }
    const folder = await createRemoteChatFolder(local.name);
    byName.set(folder.name.toLocaleLowerCase(), folder);
    localIdMap[local.id] = folder.id;
    created.push(folder);
  }

  const folders = [...remote, ...created].filter(
    (folder, index, all) => all.findIndex((item) => item.id === folder.id) === index,
  );
  replaceChatFolders(folders);

  const currentChats = loadChatHistory({ includeDemo: false });
  const migratedChats = currentChats.map((chat) => {
    if (!chat.folderId || !localIdMap[chat.folderId]) return chat;
    return { ...chat, folderId: localIdMap[chat.folderId] };
  });
  if (migratedChats.some((chat, index) => chat.folderId !== currentChats[index]?.folderId)) {
    persist(migratedChats);
  }

  await Promise.all(
    chats.flatMap((chat) => {
      const folderId = chat.folderId ? localIdMap[chat.folderId] ?? chat.folderId : undefined;
      if (!folderId || chat.demo) return [];
      return [assignChatToRemoteFolder(chat.id, folderId).catch(() => undefined)];
    }),
  );

  return { folders, localIdMap };
}

function sortNewestFirst(a: ChatSummary, b: ChatSummary): number {
  return b.createdAt.localeCompare(a.createdAt);
}

function isChatSummary(value: unknown): value is ChatSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatSummary>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.prompt === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.status === "string"
  );
}

function isChatFolder(value: unknown): value is ChatFolder {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatFolder>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "string"
  );
}
