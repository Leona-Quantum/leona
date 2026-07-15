export type PinnedItemKind = "chat" | "artifact";

type PinnedItems = {
  chats: string[];
  artifacts: string[];
};

const STORAGE_KEY = "majorana.workspace-pins.v1";
export const WORKSPACE_PINS_EVENT = "majorana:workspace-pins";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readPins(): PinnedItems {
  if (!canUseStorage()) return { chats: [], artifacts: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return { chats: [], artifacts: [] };
    const candidate = parsed as Partial<PinnedItems>;
    return {
      chats: Array.isArray(candidate.chats) ? candidate.chats.filter((value): value is string => typeof value === "string") : [],
      artifacts: Array.isArray(candidate.artifacts) ? candidate.artifacts.filter((value): value is string => typeof value === "string") : [],
    };
  } catch {
    return { chats: [], artifacts: [] };
  }
}

function writePins(pins: PinnedItems): PinnedItems {
  if (canUseStorage()) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WORKSPACE_PINS_EVENT));
  return pins;
}

export function isPinned(kind: PinnedItemKind, id: string): boolean {
  const pins = readPins();
  return (kind === "chat" ? pins.chats : pins.artifacts).includes(id);
}

export function setPinned(kind: PinnedItemKind, id: string, pinned: boolean): PinnedItems {
  const pins = readPins();
  const key = kind === "chat" ? "chats" : "artifacts";
  const current = new Set(pins[key]);
  if (pinned) current.add(id);
  else current.delete(id);
  return writePins({ ...pins, [key]: [...current] });
}

export function togglePinned(kind: PinnedItemKind, id: string): boolean {
  const nextPinned = !isPinned(kind, id);
  setPinned(kind, id, nextPinned);
  return nextPinned;
}
