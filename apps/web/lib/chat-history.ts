export type ChatStatus = "queued" | "running" | "verified" | "failed" | "draft";

export interface ChatSummary {
  id: string;
  title: string;
  prompt: string;
  createdAt: string;
  status: ChatStatus;
  framework?: string;
  folderId?: string;
  demo?: boolean;
}

export interface ChatFolder {
  id: string;
  name: string;
  createdAt: string;
}

const STORAGE_KEY = "majorana.chat-history.v1";
const FOLDERS_STORAGE_KEY = "majorana.chat-folders.v1";
export const CHAT_HISTORY_EVENT = "majorana:chat-history";
export const CHAT_FOLDERS_EVENT = "majorana:chat-folders";

type HistoryOptions = { includeDemo?: boolean };

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

function persist(chats: ChatSummary[]): ChatSummary[] {
  if (canUseStorage()) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  emitChange();
  return chats;
}

export function loadChatHistory({ includeDemo = true }: HistoryOptions = {}): ChatSummary[] {
  if (!canUseStorage()) return includeDemo ? DEFAULT_CHATS : [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return includeDemo ? DEFAULT_CHATS : [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return includeDemo ? DEFAULT_CHATS : [];
    const valid = parsed
      .filter(isChatSummary)
      .filter((chat) => includeDemo || !chat.demo)
      .sort(sortNewestFirst);
    return valid.length || !includeDemo ? valid : DEFAULT_CHATS;
  } catch {
    return includeDemo ? DEFAULT_CHATS : [];
  }
}

export function rememberChat(chat: ChatSummary): ChatSummary[] {
  const current = loadChatHistory({ includeDemo: false }).filter((item) => item.id !== chat.id);
  return persist([chat, ...current].sort(sortNewestFirst));
}

export function updateChat(
  id: string,
  patch: Partial<Pick<ChatSummary, "title" | "status" | "framework" | "folderId">>,
): ChatSummary[] {
  return persist(
    loadChatHistory({ includeDemo: false }).map((chat) => (chat.id === id ? { ...chat, ...patch } : chat)),
  );
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

export function createChatFolder(name: string): ChatFolder[] {
  const normalized = name.trim().replace(/\s+/g, " ");
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
  if (canUseStorage()) window.localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(next));
  emitFoldersChange();
  return next;
}

export function assignChatToFolder(chatId: string, folderId?: string): ChatSummary[] {
  return updateChat(chatId, { folderId: folderId || undefined });
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
