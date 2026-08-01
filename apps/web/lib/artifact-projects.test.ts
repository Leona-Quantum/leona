/**
 * Studio projects: the mirror's order, and adoption.
 *
 * Adoption is the half worth guarding. The chat-folder version of it ran on
 * every sidebar mount and recreated any local name with no remote match, which
 * was invisible right up until folders could be deleted — and then the deleted
 * folder came straight back. Projects can be deleted from the day they ship, so
 * that bug would be visible immediately, and these tests are what stop it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  hydrateArtifactProjects,
  loadArtifactProjects,
  replaceArtifactProjects,
} from "./artifact-projects.ts";
import { resetStorageScopeForTests, setStorageScope } from "./user-storage.ts";

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

const PROJECTS_KEY = "majorana.artifact-projects.v1";
const LEGACY_PROJECTS_KEY = "majorana.artifact-folders.v1";
const LEGACY_ASSIGNMENTS_KEY = "majorana.artifact-folder-assignments.v1";
const ADOPTED_KEY = "majorana.artifact-projects-adopted.v1";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Record every request and answer from a scripted workspace. */
function withFetch(remote: Array<{ id: string; name: string; created_at: string }>): Call[] {
  const calls: Call[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url === "/api/workspace/projects" && method === "GET") {
      return new Response(JSON.stringify(remote), { status: 200 });
    }
    if (url === "/api/workspace/projects" && method === "POST") {
      // The server is idempotent on the name, so mimic that: a POST for a name
      // already present returns the existing row rather than a second one.
      const name = (body as { name: string }).name;
      const existing = remote.find((project) => project.name.toLowerCase() === name.toLowerCase());
      if (existing) return new Response(JSON.stringify(existing), { status: 201 });
      const created = { id: `remote-${name}`, name, created_at: "2026-08-01T00:00:00.000Z" };
      remote.push(created);
      return new Response(JSON.stringify(created), { status: 201 });
    }
    if (/^\/api\/artifacts\/[^/]+\/project$/.test(url) && method === "PATCH") {
      return new Response(JSON.stringify({ id: "artifact" }), { status: 200 });
    }
    throw new Error(`unscripted request: ${method} ${url}`);
  };
  return calls;
}

test("the mirror keeps the workspace's arrangement rather than re-sorting", () => {
  withStorage();
  // Deliberately NOT in createdAt or alphabetical order: this is what an
  // arranged workspace looks like after the ↑/↓ buttons have been used.
  replaceArtifactProjects([
    { id: "c", name: "gamma", createdAt: "2026-07-03T00:00:00.000Z" },
    { id: "a", name: "alpha", createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "b", name: "beta", createdAt: "2026-07-02T00:00:00.000Z" },
  ]);

  assert.deepEqual(
    loadArtifactProjects().map((project) => project.name),
    ["gamma", "alpha", "beta"],
  );
});

test("the stored mirror is the array itself, so order survives a reload", () => {
  const storage = withStorage();
  replaceArtifactProjects([
    { id: "c", name: "gamma", createdAt: "2026-07-03T00:00:00.000Z" },
    { id: "a", name: "alpha", createdAt: "2026-07-01T00:00:00.000Z" },
  ]);

  const written = JSON.parse(storage.getItem(PROJECTS_KEY) ?? "[]") as Array<{ name: string }>;
  assert.deepEqual(
    written.map((project) => project.name),
    ["gamma", "alpha"],
    "a reload reads this array back verbatim; sorting on write loses the arrangement too",
  );
});

test("the browser's projects are uploaded once, with their artifacts", async () => {
  const storage = withStorage();
  storage.setItem(
    LEGACY_PROJECTS_KEY,
    JSON.stringify([{ id: "local-1", name: "Bell states", createdAt: "2026-07-01T00:00:00.000Z" }]),
  );
  storage.setItem(LEGACY_ASSIGNMENTS_KEY, JSON.stringify({ "artifact-1": "local-1" }));
  const calls = withFetch([]);

  const { projects, localIdMap } = await hydrateArtifactProjects();

  assert.deepEqual(
    projects.map((project) => project.name),
    ["Bell states"],
  );
  assert.equal(localIdMap["local-1"], "remote-Bell states");
  assert.deepEqual(
    calls.filter((call) => call.method === "PATCH").map((call) => [call.url, call.body]),
    [["/api/artifacts/artifact-1/project", { project_id: "remote-Bell states" }]],
    "the artifact's filing has to travel with the project, or the names arrive empty",
  );
  assert.equal(storage.getItem(ADOPTED_KEY), "true");
});

test("a project deleted after adoption is NOT recreated by the next hydrate", async () => {
  const storage = withStorage();
  // The exact state after "adopt, then delete": the legacy list still names the
  // project — nothing rewrites it — and the workspace no longer has it.
  storage.setItem(
    LEGACY_PROJECTS_KEY,
    JSON.stringify([{ id: "local-1", name: "Bell states", createdAt: "2026-07-01T00:00:00.000Z" }]),
  );
  storage.setItem(ADOPTED_KEY, "true");
  const calls = withFetch([]);

  const { projects } = await hydrateArtifactProjects();

  assert.deepEqual(projects, [], "the workspace is the truth once adoption has run");
  assert.deepEqual(
    calls.filter((call) => call.method === "POST"),
    [],
    "recreating it here is exactly the bug that made deleting a chat folder unshippable",
  );
});

test("adoption maps a local project onto the workspace project of the same name", async () => {
  const storage = withStorage();
  storage.setItem(
    LEGACY_PROJECTS_KEY,
    JSON.stringify([{ id: "local-1", name: "bell STATES", createdAt: "2026-07-01T00:00:00.000Z" }]),
  );
  storage.setItem(LEGACY_ASSIGNMENTS_KEY, JSON.stringify({ "artifact-1": "local-1" }));
  const calls = withFetch([
    { id: "server-1", name: "Bell states", created_at: "2026-06-01T00:00:00.000Z" },
  ]);

  const { projects, localIdMap } = await hydrateArtifactProjects();

  assert.deepEqual(
    projects.map((project) => project.id),
    ["server-1"],
    "a second device must land on the workspace's row, not create a duplicate",
  );
  assert.equal(localIdMap["local-1"], "server-1");
  assert.deepEqual(
    calls.filter((call) => call.method === "POST"),
    [],
  );
  assert.deepEqual(
    calls.filter((call) => call.method === "PATCH").map((call) => call.body),
    [{ project_id: "server-1" }],
  );
});

test("an assignment naming a project that no longer exists is dropped, not uploaded", async () => {
  const storage = withStorage();
  // The legacy list is empty but the assignment map still names a project — the
  // browser-era code deleted nothing, so this state is reachable. Sending it
  // would be a PATCH with a project id the workspace has never heard of.
  storage.setItem(LEGACY_PROJECTS_KEY, JSON.stringify([]));
  storage.setItem(LEGACY_ASSIGNMENTS_KEY, JSON.stringify({ "artifact-1": "local-gone" }));
  const calls = withFetch([]);

  await hydrateArtifactProjects();

  assert.deepEqual(
    calls.filter((call) => call.method === "PATCH"),
    [],
  );
});
