import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  artifactAllowanceRefusal,
  assessRunAllowance,
  runAllowanceRefusal,
} from "./run-allowance.ts";

const NOW = new Date("2026-07-23T12:00:00Z");

function runAt(daysAgo: number, mode = "execute") {
  return {
    mode,
    created_at: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  };
}

describe("assessRunAllowance", () => {
  it("allows an unmetered tier without reading the runs at all", () => {
    const verdict = assessRunAllowance(null, [runAt(0), runAt(1)], NOW);
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.limit, null);
  });

  it("counts only execute-mode runs inside the trailing week", () => {
    const runs = [
      runAt(0.5),
      runAt(2),
      runAt(3, "chat"), // chat turns are not metered
      runAt(9), // aged out of the window
      { mode: "execute", created_at: null }, // malformed rows never count
    ];
    const verdict = assessRunAllowance(5, runs, NOW);
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.used, 2);
  });

  it("refuses at the limit and names when the oldest counted run ages out", () => {
    const verdict = assessRunAllowance(5, [0.1, 1, 2, 3, 6].map((d) => runAt(d)), NOW);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.used, 5);
    // The 6-days-ago run frees its slot one day from now.
    assert.equal(verdict.resetsAt, new Date("2026-07-24T12:00:00Z").toISOString());
  });

  it("a zero-run tier refuses immediately with no usage", () => {
    const verdict = assessRunAllowance(0, [], NOW);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.used, 0);
  });

  it("a zero-run tier never advertises a reset, even with prior history", () => {
    const verdict = assessRunAllowance(0, [runAt(1), runAt(2)], NOW);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.resetsAt, null);
  });
});

describe("a shared workspace", () => {
  const mine = "user-mine";
  const theirs = "user-theirs";

  function runBy(userId: string, daysAgo: number) {
    return { ...runAt(daysAgo), user_id: userId };
  }

  it("does not spend my allowance on a colleague's runs", () => {
    const runs = [0, 1, 2, 3, 4, 5].map((d) => runBy(theirs, d));
    const verdict = assessRunAllowance(5, runs, NOW, mine);
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.used, 0);
  });

  it("still counts my own runs in a workspace I do not own", () => {
    const runs = [...[0, 1, 2].map((d) => runBy(mine, d)), ...[3, 4].map((d) => runBy(theirs, d))];
    const verdict = assessRunAllowance(3, runs, NOW, mine);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.used, 3);
  });

  it("counts everything when the viewer is unknown, rather than nothing", () => {
    // A failed identity read must not turn the pre-check off. Degrading to the
    // pre-collaboration behaviour is the safe direction; degrading to "allow"
    // would make an unreadable /v1/me a way past the gate.
    const runs = [0, 1, 2].map((d) => runBy(theirs, d));
    assert.equal(assessRunAllowance(3, runs, NOW, null).used, 3);
    assert.equal(assessRunAllowance(3, runs, NOW).used, 3);
  });

  it("counts a run whose author is unknown, whoever is asking", () => {
    // Runs recorded before the resource carried user_id, and any response the
    // control plane trims. Unattributed usage is counted, not waved through.
    const verdict = assessRunAllowance(2, [runAt(0), runAt(1)], NOW, mine);
    assert.equal(verdict.used, 2);
    assert.equal(verdict.allowed, false);
  });
});

describe("refusal payloads", () => {
  it("run refusal carries the typed reason and machine-readable numbers", () => {
    const verdict = assessRunAllowance(5, [0.1, 1, 2, 3, 4].map((d) => runAt(d)), NOW);
    const refusal = runAllowanceRefusal(verdict);
    assert.equal(refusal.reason, "run_allowance_exhausted");
    assert.equal(refusal.limit, 5);
    assert.equal(refusal.used, 5);
    assert.match(refusal.error, /5 verified runs per week/);
    assert.match(refusal.error, /Browser simulation/);
  });

  it("artifact refusal explains the way forward, not just the wall", () => {
    const refusal = artifactAllowanceRefusal(25, 25);
    assert.equal(refusal.reason, "artifact_allowance_exhausted");
    assert.match(refusal.error, /Archive an artifact/);
  });
});
