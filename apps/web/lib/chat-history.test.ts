import assert from "node:assert/strict";
import test from "node:test";

import {
  collapseConversationChats,
  createChatFolder,
  loadChatFolders,
  replaceChatFolders,
} from "./chat-history.ts";
import { resetStorageScopeForTests, setStorageScope } from "./user-storage.ts";

test("follow-up runs keep one sidebar conversation and preserve its owner-facing identity", () => {
  const chats = collapseConversationChats([
    {
      id: "turn-two",
      conversationId: "conversation-a",
      title: "Follow-up question",
      prompt: "Can you add a measurement?",
      createdAt: "2026-07-23T10:10:00.000Z",
      status: "queued",
    },
    {
      id: "turn-one",
      conversationId: "conversation-a",
      title: "Bell-state work",
      titleOverride: "Bell-state analysis",
      prompt: "Build a Bell state and verify it.",
      createdAt: "2026-07-23T10:00:00.000Z",
      status: "draft",
      folderId: "research",
    },
    {
      id: "separate-chat",
      conversationId: "conversation-b",
      title: "QFT resources",
      prompt: "Estimate a QFT.",
      createdAt: "2026-07-23T10:05:00.000Z",
      status: "verified",
    },
  ]);

  assert.equal(chats.length, 2);
  const conversation = chats.find((chat) => chat.conversationId === "conversation-a");
  assert.ok(conversation);
  assert.equal(conversation.id, "turn-one");
  assert.equal(conversation.title, "Bell-state analysis");
  assert.equal(conversation.prompt, "Build a Bell state and verify it.");
  assert.equal(conversation.folderId, "research");
  assert.equal(conversation.status, "queued");
});

// --- folder order and adoption -------------------------------------------
//
// Both behaviours below are ones a reasonable refactor silently reverses, and
// neither shows up as an error when it does: the folders simply come back in a
// different order, or a deleted folder reappears.

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function withStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = {
    localStorage: storage,
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
  };
  resetStorageScopeForTests();
  setStorageScope(null);
  return storage;
}

const FOLDERS_KEY = "majorana.chat-folders.v1";

test("the folder mirror keeps the workspace's arrangement rather than re-sorting by age", () => {
  withStorage();
  // Deliberately NOT in createdAt order: this is what an arranged workspace
  // looks like after a drag. loadChatFolders used to sort by createdAt, which
  // made every reorder appear to work and then revert on the next render.
  replaceChatFolders([
    { id: "c", name: "gamma", createdAt: "2026-07-03T00:00:00.000Z" },
    { id: "a", name: "alpha", createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "b", name: "beta", createdAt: "2026-07-02T00:00:00.000Z" },
  ]);

  assert.deepEqual(
    loadChatFolders().map((folder) => folder.name),
    ["gamma", "alpha", "beta"],
  );
});

test("a folder created after an arrangement goes to the end of it, not into date order", () => {
  withStorage();
  replaceChatFolders([
    { id: "c", name: "gamma", createdAt: "2026-07-03T00:00:00.000Z" },
    { id: "a", name: "alpha", createdAt: "2026-07-01T00:00:00.000Z" },
  ]);

  createChatFolder("beta");

  assert.deepEqual(
    loadChatFolders().map((folder) => folder.name),
    ["gamma", "alpha", "beta"],
  );
});

test("the stored mirror is the array itself, so order survives a reload", () => {
  const storage = withStorage();
  replaceChatFolders([
    { id: "c", name: "gamma", createdAt: "2026-07-03T00:00:00.000Z" },
    { id: "a", name: "alpha", createdAt: "2026-07-01T00:00:00.000Z" },
  ]);

  const written = JSON.parse(storage.getItem(FOLDERS_KEY) ?? "[]") as Array<{ name: string }>;
  assert.deepEqual(
    written.map((folder) => folder.name),
    ["gamma", "alpha"],
    "a reload reads this array back verbatim; sorting on write loses the arrangement too",
  );
});
