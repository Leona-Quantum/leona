import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scopeMayAdoptLegacyData, storageScopeId } from "./storage-scope-id.ts";

const USER = "user-abc";
const PERSONAL = { id: "ws-personal", isPersonal: true };
const SHARED = { id: "ws-shared", isPersonal: false };

describe("storageScopeId", () => {
  it("leaves the personal workspace on the key every account already uses", () => {
    // If this ever changes, every existing account's chats, folders, pins and
    // artifact mirror move out from under them and need a migration to move back.
    assert.equal(storageScopeId(USER, PERSONAL), "u:user-abc");
    assert.equal(storageScopeId(USER), "u:user-abc");
    assert.equal(storageScopeId(USER, null), "u:user-abc");
  });

  it("gives a shared workspace its own bucket", () => {
    assert.equal(storageScopeId(USER, SHARED), "u:user-abc|w:ws-shared");
  });

  it("separates two shared workspaces from each other", () => {
    const a = storageScopeId(USER, { id: "ws-a", isPersonal: false });
    const b = storageScopeId(USER, { id: "ws-b", isPersonal: false });
    assert.notEqual(a, b);
    assert.notEqual(a, storageScopeId(USER, PERSONAL));
  });

  it("separates two accounts inside the same shared workspace", () => {
    // Colleagues share the workspace's server-side data, never each other's
    // browser storage — the sidebar's local half includes drafts and prompts.
    assert.notEqual(storageScopeId("user-one", SHARED), storageScopeId("user-two", SHARED));
  });

  it("has no scope without a user, on a public page", () => {
    assert.equal(storageScopeId(null, SHARED), null);
    assert.equal(storageScopeId(undefined), null);
    assert.equal(storageScopeId(""), null);
  });
});

describe("scopeMayAdoptLegacyData", () => {
  it("lets the workspace a person owns claim their pre-scoping data", () => {
    assert.equal(scopeMayAdoptLegacyData(PERSONAL), true);
    assert.equal(scopeMayAdoptLegacyData(null), true);
    assert.equal(scopeMayAdoptLegacyData(), true);
  });

  it("never moves one person's history into a shared workspace", () => {
    assert.equal(scopeMayAdoptLegacyData(SHARED), false);
  });
});
