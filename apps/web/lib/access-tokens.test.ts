import assert from "node:assert/strict";
import test from "node:test";

import {
  type AccessTokenRecord,
  daysUntilExpiry,
  featureIsAbsent,
  formatTokenTail,
  sortTokens,
  tokenState,
} from "./access-tokens.ts";

const NOW = new Date("2026-10-01T12:00:00.000Z");

function record(overrides: Partial<AccessTokenRecord> = {}): AccessTokenRecord {
  return {
    id: "01930000-0000-7000-8000-000000000001",
    tail: "aB3d",
    name: "editor plugin",
    workspace_id: "01930000-0000-7000-8000-0000000000ff",
    scopes: ["read"],
    created_at: "2026-09-01T12:00:00.000Z",
    expires_at: "2026-11-30T12:00:00.000Z",
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

test("a token is active until its expiry instant, and expired strictly after", () => {
  const expiring = record({ expires_at: NOW.toISOString() });
  assert.equal(tokenState(expiring, new Date(NOW.getTime() - 1)), "active");
  // The instant itself is still live, matching the server's `expires_at > now`.
  assert.equal(tokenState(expiring, NOW), "expired");
  assert.equal(tokenState(record(), NOW), "active");
});

test("revoked outranks expired, so a killed token does not read as merely lapsed", () => {
  const both = record({
    expires_at: "2026-09-15T12:00:00.000Z",
    revoked_at: "2026-09-10T12:00:00.000Z",
  });
  assert.equal(tokenState(both, NOW), "revoked");
});

test("the tail is shown with the prefix and an ellipsis, never a whole token", () => {
  const shown = formatTokenTail("aB3d");
  assert.equal(shown, "lq_pat_…aB3d");
  // The guard that matters: what is rendered is four characters long after the
  // ellipsis, so this helper can never be the thing that puts a secret on a page.
  assert.equal(shown.split("…")[1]?.length, 4);
});

test("days to expiry round up, and go negative once past", () => {
  assert.equal(daysUntilExpiry(record({ expires_at: "2026-10-31T12:00:00.000Z" }), NOW), 30);
  assert.equal(daysUntilExpiry(record({ expires_at: "2026-10-01T18:00:00.000Z" }), NOW), 1);
  assert.ok(daysUntilExpiry(record({ expires_at: "2026-09-01T12:00:00.000Z" }), NOW) < 0);
});

test("live tokens sort above dead ones, and each group newest first", () => {
  const liveOld = record({ id: "a", created_at: "2026-09-01T00:00:00.000Z" });
  const liveNew = record({ id: "b", created_at: "2026-09-20T00:00:00.000Z" });
  const revokedNewest = record({
    id: "c",
    created_at: "2026-09-30T00:00:00.000Z",
    revoked_at: "2026-09-30T01:00:00.000Z",
  });

  const order = sortTokens([liveOld, revokedNewest, liveNew], NOW).map((row) => row.id);
  // `c` is the newest of the three and still goes last: the question this list
  // answers is "what can currently act as me".
  assert.deepEqual(order, ["b", "a", "c"]);
});

test("sorting does not mutate the array it was given", () => {
  const given = [record({ id: "a" }), record({ id: "b", created_at: "2026-09-20T00:00:00.000Z" })];
  const before = given.map((row) => row.id);
  sortTokens(given, NOW);
  assert.deepEqual(given.map((row) => row.id), before);
});

test("only a 404 means the deployment has no tokens feature", () => {
  assert.equal(featureIsAbsent(404), true);
  // Everything else is an outage, not an absence — and the distinction is what keeps
  // the pane on screen when the API is misbehaving. The pane is the only place a token
  // can be REVOKED, so hiding it on a 401, a 429 or a 5xx takes the revoke button away
  // from somebody who may be reaching for it precisely because something is wrong.
  for (const status of [200, 401, 403, 429, 500, 502, 0]) {
    assert.equal(featureIsAbsent(status), false, `status ${status}`);
  }
});

test("403 is not treated as absence, which is the case most likely to be got wrong", () => {
  // Singled out because it is the plausible mistake: a token route answering 403 reads
  // like "you may not have this", and collapsing it into 404 would hide the pane from
  // an account whose session had merely gone stale. 404 is a statement about the
  // DEPLOYMENT; 403 is a statement about the caller, and only the first hides anything.
  assert.equal(featureIsAbsent(403), false);
  assert.notEqual(featureIsAbsent(403), featureIsAbsent(404));
});
