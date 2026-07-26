import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  DEVICE_STORAGE_KEYS,
  SCOPED_STORAGE_KEYS,
  STORAGE_CLAIM_KEY,
  currentStorageScope,
  resetStorageScopeForTests,
  scopedStorage,
  scopedStorageKey,
  setStorageScope,
} from "./user-storage.ts";

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()].sort();
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  resetStorageScopeForTests();
});

const CHATS = "majorana.chat-history.v1";

test("no scope reads and writes the unscoped key, as the single-user lock relies on", () => {
  setStorageScope(null);
  scopedStorage.setItem(CHATS, "[1]");
  assert.equal(currentStorageScope(), null);
  assert.equal(scopedStorageKey(CHATS), CHATS);
  assert.deepEqual(storage.keys(), [CHATS]);
});

test("a scope suffixes every read and write", () => {
  setStorageScope("u:user_a");
  scopedStorage.setItem(CHATS, "[1]");
  assert.equal(scopedStorage.getItem(CHATS), "[1]");
  assert.deepEqual(storage.keys(), [`${CHATS}::u:user_a`, STORAGE_CLAIM_KEY].sort());
});

test("the first account to sign in adopts the pre-scoping data, and it MOVES", () => {
  storage.setItem(CHATS, '[{"id":"owner-chat"}]');
  storage.setItem("majorana.workspace-pins.v1", '{"chats":["owner-chat"]}');

  setStorageScope("u:owner");

  assert.equal(scopedStorage.getItem(CHATS), '[{"id":"owner-chat"}]');
  // Moved, not copied — a copy left behind is the leak this exists to close.
  assert.equal(storage.getItem(CHATS), null);
  assert.equal(storage.getItem("majorana.workspace-pins.v1"), null);
  assert.equal(storage.getItem(STORAGE_CLAIM_KEY), "u:owner");
});

test("a second account on the same browser starts empty rather than inheriting", () => {
  storage.setItem(CHATS, '[{"id":"owner-chat"}]');
  setStorageScope("u:owner");
  assert.equal(scopedStorage.getItem(CHATS), '[{"id":"owner-chat"}]');

  resetStorageScopeForTests();
  setStorageScope("u:stranger");

  assert.equal(scopedStorage.getItem(CHATS), null);
  assert.equal(storage.getItem(`${CHATS}::u:owner`), '[{"id":"owner-chat"}]');
});

test("adoption never overwrites data the account has already written", () => {
  storage.setItem(CHATS, '["legacy"]');
  storage.setItem(`${CHATS}::u:owner`, '["mine"]');

  setStorageScope("u:owner");

  assert.equal(scopedStorage.getItem(CHATS), '["mine"]');
  assert.equal(storage.getItem(CHATS), null);
});

test("re-setting the same scope is a no-op, so a render-time call is safe", () => {
  storage.setItem(CHATS, '["legacy"]');
  setStorageScope("u:owner");
  scopedStorage.setItem(CHATS, '["edited"]');

  setStorageScope("u:owner");
  setStorageScope("u:owner");

  assert.equal(scopedStorage.getItem(CHATS), '["edited"]');
});

test("switching back to no scope does not resurrect the adopted data", () => {
  storage.setItem(CHATS, '["legacy"]');
  setStorageScope("u:owner");
  setStorageScope(null);

  assert.equal(scopedStorage.getItem(CHATS), null);
});

test("a write that does not land is reported, not swallowed", () => {
  // saveStoredCircuit and saveCpuSimulationRecord return this straight to the
  // UI. Swallowing a quota error would turn a failed save into a silent one.
  const full = new MemoryStorage();
  full.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  (globalThis as { window?: unknown }).window = { localStorage: full };

  assert.equal(scopedStorage.setItem(CHATS, "[]"), false);
});

test("an adoption that fails partway retries on the next load", () => {
  storage.setItem(CHATS, '["legacy"]');
  storage.setItem("majorana.library.v1", '["artifacts"]');
  const realSetItem = storage.setItem.bind(storage);
  let calls = 0;
  storage.setItem = (key: string, value: string) => {
    // Fail once, after the first key has moved.
    if (++calls === 2) throw new Error("QuotaExceededError");
    realSetItem(key, value);
  };

  setStorageScope("u:owner");

  // The claim is written last, so a partial move leaves it unwritten.
  assert.equal(storage.getItem(STORAGE_CLAIM_KEY), null);

  storage.setItem = realSetItem;
  resetStorageScopeForTests();
  setStorageScope("u:owner");

  assert.equal(scopedStorage.getItem(CHATS), '["legacy"]');
  assert.equal(scopedStorage.getItem("majorana.library.v1"), '["artifacts"]');
  assert.equal(storage.getItem(STORAGE_CLAIM_KEY), "u:owner");
});

test("storage that throws is reported unavailable instead of crashing a render", () => {
  (globalThis as { window?: unknown }).window = {
    get localStorage(): never {
      throw new Error("blocked");
    },
  };
  assert.equal(scopedStorage.available(), false);
  assert.equal(scopedStorage.getItem(CHATS), null);
  assert.doesNotThrow(() => scopedStorage.setItem(CHATS, "[]"));
});

test("no key is classified as both per-account and device-level", () => {
  const device = new Set<string>(DEVICE_STORAGE_KEYS);
  const overlap = SCOPED_STORAGE_KEYS.filter((key) => device.has(key));
  assert.deepEqual(overlap, []);
});
