import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ShareRefused,
  canContribute,
  loadProjectArtifactLimit,
  setProjectArtifactLimit,
  expiresSoon,
  hasExpired,
  hasMoved,
  parseProjectShare,
  parseSharedProject,
  refusalSentence,
  conflictVersionId,
} from "./project-shares.ts";

const SHARE = {
  project_id: "p-1",
  grantee_user_id: "u-2",
  grantee_email: "bob@example.test",
  grantee_display_name: "Bob",
  role: "editor",
  granted_by_user_id: "u-1",
  granted_by_email: "alice@example.test",
  expires_at: null,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

const SHARED_PROJECT = {
  id: "p-1",
  name: "Bell states",
  owner_workspace_id: "w-1",
  owner_workspace_name: "Alice's Lab",
  role: "viewer",
  shared_by_email: "alice@example.test",
  shared_by_display_name: "Alice",
  expires_at: null,
  shared_at: "2026-08-01T10:00:00Z",
  artifact_count: 3,
  revision: "2026-08-01T12:00:00Z",
};

describe("parseProjectShare", () => {
  it("reads a well-formed grant", () => {
    assert.deepEqual(parseProjectShare(SHARE), {
      projectId: "p-1",
      granteeUserId: "u-2",
      granteeEmail: "bob@example.test",
      granteeDisplayName: "Bob",
      role: "editor",
      grantedByEmail: "alice@example.test",
      expiresAt: null,
      createdAt: "2026-08-01T10:00:00Z",
    });
  });

  it("drops a row whose role is not one of the two", () => {
    // The one field that must never be guessed. A grant arriving with a role
    // this build does not know about would otherwise render as whichever
    // default the parser picked, and telling somebody they have read access
    // when the server says editor — or the reverse — is the worst answer here.
    assert.equal(parseProjectShare({ ...SHARE, role: "owner" }), null);
    assert.equal(parseProjectShare({ ...SHARE, role: undefined }), null);
  });

  it("drops a row with no address, because that row cannot be shown to anyone", () => {
    assert.equal(parseProjectShare({ ...SHARE, grantee_email: "" }), null);
    assert.equal(parseProjectShare({ ...SHARE, grantee_email: 42 }), null);
  });

  it("keeps a grant whose granter has been deleted", () => {
    // Nullable on purpose: an account can go while the grants it made stay
    // live, and "who has access" must not disappear with "who let them in".
    const share = parseProjectShare({ ...SHARE, granted_by_email: null });
    assert.equal(share?.granteeEmail, "bob@example.test");
    assert.equal(share?.grantedByEmail, null);
  });

  it("returns null rather than throwing on nonsense", () => {
    assert.equal(parseProjectShare(null), null);
    assert.equal(parseProjectShare("share"), null);
    assert.equal(parseProjectShare([]), null);
  });
});

describe("parseSharedProject", () => {
  it("reads a well-formed shared project", () => {
    const project = parseSharedProject(SHARED_PROJECT);
    assert.equal(project?.name, "Bell states");
    assert.equal(project?.ownerWorkspaceName, "Alice's Lab");
    assert.equal(project?.artifactCount, 3);
    assert.equal(project?.role, "viewer");
  });

  it("refuses a count it cannot render, and clamps one it can", () => {
    assert.equal(parseSharedProject({ ...SHARED_PROJECT, artifact_count: -1 })?.artifactCount, 0);
    assert.equal(parseSharedProject({ ...SHARED_PROJECT, artifact_count: Number.NaN }), null);
    assert.equal(parseSharedProject({ ...SHARED_PROJECT, artifact_count: "3" }), null);
  });

  it("requires the revision, because a section that polls without one never updates", () => {
    assert.equal(parseSharedProject({ ...SHARED_PROJECT, revision: undefined }), null);
  });

  it("requires the owning workspace's name, which is the only context the reader gets", () => {
    assert.equal(parseSharedProject({ ...SHARED_PROJECT, owner_workspace_name: 7 }), null);
  });
});

describe("expiry", () => {
  const now = new Date("2026-08-01T00:00:00Z");

  it("says nothing about a grant that does not expire", () => {
    // Not "expires very far away" — a permanent grant has no deadline to warn
    // about, and a warning that never fires is not the same as one that fires
    // in the year 9999.
    assert.equal(expiresSoon({ expiresAt: null }, now), false);
    assert.equal(hasExpired({ expiresAt: null }, now), false);
  });

  it("warns inside the window and not outside it", () => {
    assert.equal(expiresSoon({ expiresAt: "2026-08-05T00:00:00Z" }, now), true);
    assert.equal(expiresSoon({ expiresAt: "2026-09-01T00:00:00Z" }, now), false);
  });

  it("does not warn about a grant that has already gone", () => {
    // Expired is a different state with a different sentence. Reporting it as
    // "expiring soon" would offer to extend something that is already closed.
    assert.equal(expiresSoon({ expiresAt: "2026-07-30T00:00:00Z" }, now), false);
    assert.equal(hasExpired({ expiresAt: "2026-07-30T00:00:00Z" }, now), true);
  });

  it("treats the exact moment of expiry as expired", () => {
    assert.equal(hasExpired({ expiresAt: "2026-08-01T00:00:00Z" }, now), true);
    assert.equal(expiresSoon({ expiresAt: "2026-08-01T00:00:00Z" }, now), false);
  });

  it("says nothing on an unparseable stamp", () => {
    assert.equal(expiresSoon({ expiresAt: "soon" }, now), false);
    assert.equal(hasExpired({ expiresAt: "soon" }, now), false);
  });
});

describe("hasMoved", () => {
  it("reports a later revision", () => {
    assert.equal(hasMoved("2026-08-01T10:00:00Z", "2026-08-01T12:00:00Z"), true);
  });

  it("reports nothing when the revision is unchanged", () => {
    assert.equal(hasMoved("2026-08-01T10:00:00Z", "2026-08-01T10:00:00Z"), false);
  });

  it("compares instants, not strings", () => {
    // Same moment, two spellings. A string compare would report a change on
    // every poll and teach the user to ignore the notice.
    assert.equal(hasMoved("2026-08-01T10:00:00Z", "2026-08-01T10:00:00+00:00"), false);
    assert.equal(hasMoved("2026-08-01T10:00:00+00:00", "2026-08-01T11:00:00Z"), true);
  });

  it("reports nothing before the first observation", () => {
    // Nothing has "changed" on the render that first shows it.
    assert.equal(hasMoved(null, "2026-08-01T12:00:00Z"), false);
    assert.equal(hasMoved(undefined, "2026-08-01T12:00:00Z"), false);
  });

  it("never reports a change backwards", () => {
    assert.equal(hasMoved("2026-08-01T12:00:00Z", "2026-08-01T10:00:00Z"), false);
  });
});

describe("refusals arrive as RFC 7807 problem documents", () => {
  // These bodies are the SHAPE `services/api/app._problem` actually emits,
  // copied from what `test_project_shares_http_live.py` asserts against a live
  // app. The first draft of this module read `payload.detail` — FastAPI's
  // default, and what the route handlers raise — so every refusal fell back to
  // a generic sentence and the conflict dialog's "open theirs" button was dead.
  // Nothing failed; the parser simply never found anything.
  const CONFLICT = {
    type: "about:blank",
    title: "Somebody else saved this circuit while you were editing it. Open what they saved before replacing it.",
    status: 409,
    code: "http_error",
    reason: "version_conflict",
    current_version_id: "v-9",
  };

  const ALREADY_A_MEMBER = {
    type: "about:blank",
    title: "that person is already a member of this workspace",
    status: 409,
    code: "http_error",
  };

  it("reads the sentence out of `title`", () => {
    assert.equal(refusalSentence(ALREADY_A_MEMBER), "that person is already a member of this workspace");
    assert.ok(refusalSentence(CONFLICT)?.startsWith("Somebody else saved"));
  });

  it("still reads a plain FastAPI `detail`, which the BFF's own errors use", () => {
    assert.equal(refusalSentence({ detail: "control plane unavailable" }), "control plane unavailable");
    assert.equal(refusalSentence({ detail: { error: "nested" } }), "nested");
    assert.equal(refusalSentence({ error: "control plane timed out" }), "control plane timed out");
  });

  it("says nothing rather than inventing a sentence", () => {
    assert.equal(refusalSentence(null), null);
    assert.equal(refusalSentence({}), null);
    assert.equal(refusalSentence({ title: "" }), null);
    assert.equal(refusalSentence("refused"), null);
  });

  it("finds the winning version at the TOP level, not under `detail`", () => {
    assert.equal(conflictVersionId(CONFLICT), "v-9");
  });

  it("refuses to read a version id off a refusal that is not a conflict", () => {
    // A 409 for "already a member" carries no version, and treating some other
    // field as one would make the dialog offer to open a version that is not
    // there.
    assert.equal(conflictVersionId(ALREADY_A_MEMBER), null);
    assert.equal(conflictVersionId({ reason: "version_conflict" }), null);
    assert.equal(conflictVersionId({ current_version_id: "v-9" }), null);
  });
});


describe("the contribution limit (contracts 2.8.0)", () => {
  const SHARED = {
    id: "p-1",
    name: "Shared work",
    owner_workspace_id: "w-1",
    owner_workspace_name: "Alice's workspace",
    role: "editor",
    shared_at: "2026-08-01T09:00:00Z",
    revision: "2026-08-01T10:00:00Z",
    artifact_count: 2,
    artifact_limit: 5,
  };

  it("parses the limit off the header", () => {
    assert.equal(parseSharedProject(SHARED)?.artifactLimit, 5);
  });

  it("treats an ABSENT limit as zero rather than as a bad payload", () => {
    // The two services deploy separately and in either order. A web build that
    // lands first sees no `artifact_limit`, and the whole "Shared with me" page
    // must not become "no longer available" over a number that only enables one
    // button. Zero hides the button, which is right: the old API has no route
    // behind it.
    const { artifact_limit: _omitted, ...withoutLimit } = SHARED;
    const parsed = parseSharedProject(withoutLimit);
    assert.ok(parsed, "an older payload must still parse");
    assert.equal(parsed.artifactLimit, 0);
    assert.equal(canContribute(parsed), false);
  });

  it("still refuses a payload missing a field that predates the limit", () => {
    // The positive control for the tolerance above: `artifact_count` has been
    // there since sharing shipped, so its absence means this is not a shared
    // project at all, and reading THAT defensively would hide a real problem.
    const { artifact_count: _omitted, ...withoutCount } = SHARED;
    assert.equal(parseSharedProject(withoutCount), null);
  });

  it("clamps a nonsense limit instead of trusting it", () => {
    assert.equal(parseSharedProject({ ...SHARED, artifact_limit: -3 })?.artifactLimit, 0);
    assert.equal(parseSharedProject({ ...SHARED, artifact_limit: 7.9 })?.artifactLimit, 7);
    assert.equal(parseSharedProject({ ...SHARED, artifact_limit: Number.NaN })?.artifactLimit, 0);
  });

  it("lets an editor contribute only while there is room", () => {
    const room = parseSharedProject(SHARED);
    assert.ok(room);
    assert.equal(canContribute(room), true);

    const full = parseSharedProject({ ...SHARED, artifact_count: 5 });
    assert.ok(full);
    assert.equal(canContribute(full), false, "at the limit is full, not one short of it");

    const over = parseSharedProject({ ...SHARED, artifact_count: 9 });
    assert.ok(over);
    assert.equal(canContribute(over), false, "the owner can lower the limit below the count");
  });

  it("never lets a VIEWER contribute, whatever the room says", () => {
    const viewer = parseSharedProject({ ...SHARED, role: "viewer", artifact_limit: 500 });
    assert.ok(viewer);
    assert.equal(canContribute(viewer), false);
  });

  it("treats a zero limit as the owner saying no, not as missing data", () => {
    const none = parseSharedProject({ ...SHARED, artifact_count: 0, artifact_limit: 0 });
    assert.ok(none);
    assert.equal(canContribute(none), false);
  });
});

describe("the client functions the limit control depends on", () => {
  const originalFetch = globalThis.fetch;
  const stub = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
    globalThis.fetch = ((url: string, init?: RequestInit) => impl(String(url), init)) as typeof fetch;
  };
  const restore = () => {
    globalThis.fetch = originalFetch;
  };
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  it("reads the limit off the caller's own project", async () => {
    stub(() => json([{ id: "p-1", max_artifacts: 12 }, { id: "p-2", max_artifacts: 3 }]));
    try {
      assert.equal(await loadProjectArtifactLimit("p-2"), 3);
    } finally {
      restore();
    }
  });

  it("returns null rather than a guess when the field is absent", async () => {
    // An API predating contracts 2.8.0. The control is HIDDEN on null — guessing
    // a default here would render a number that saving then makes real, silently
    // changing the project's limit to something nobody chose.
    stub(() => json([{ id: "p-1" }]));
    try {
      assert.equal(await loadProjectArtifactLimit("p-1"), null);
    } finally {
      restore();
    }
  });

  it("returns null for an unknown project and for a refused request", async () => {
    stub(() => json([{ id: "other", max_artifacts: 9 }]));
    try {
      assert.equal(await loadProjectArtifactLimit("p-1"), null);
    } finally {
      restore();
    }
    stub(() => json({ error: "nope" }, 403));
    try {
      assert.equal(await loadProjectArtifactLimit("p-1"), null);
    } finally {
      restore();
    }
  });

  it("REJECTS on a network failure, which is why the effect needs a catch", async () => {
    // The component's `useEffect` had no `.catch`. A non-OK response resolves to
    // null, but a network-level failure rejects — and this asserts that really is
    // the shape, rather than the catch being defensive decoration.
    stub(() => Promise.reject(new TypeError("Failed to fetch")));
    try {
      await assert.rejects(() => loadProjectArtifactLimit("p-1"));
    } finally {
      restore();
    }
  });

  it("returns the number the server committed, not the one that was sent", async () => {
    // The server clamps and normalises; echoing the request back would show a
    // limit the project does not have.
    stub(() => json({ id: "p-1", max_artifacts: 7 }));
    try {
      assert.equal(await setProjectArtifactLimit("p-1", 500), 7);
    } finally {
      restore();
    }
  });

  it("surfaces a refusal as a sentence the dialog can show", async () => {
    stub(() => json({ title: "an artifact limit must be between 0 and 500" }, 409));
    try {
      await assert.rejects(
        () => setProjectArtifactLimit("p-1", 900),
        (error: unknown) =>
          error instanceof ShareRefused && /between 0 and 500/.test((error as Error).message),
      );
    } finally {
      restore();
    }
  });

  it("refuses a malformed success rather than reporting a limit it did not get", async () => {
    stub(() => json({ id: "p-1" }));
    try {
      await assert.rejects(() => setProjectArtifactLimit("p-1", 5));
    } finally {
      restore();
    }
  });
});
