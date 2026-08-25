import assert from "node:assert/strict";
import test from "node:test";

import { rangeSmokeNotice, type RangeSmoke } from "./qapp-range-smoke.ts";

const report = (status: RangeSmoke["status"], detail = "d"): RangeSmoke =>
  ({ status, detail, duration_ms: 1 } as RangeSmoke);

/**
 * The arm that decides whether this whole feature was worth building. A Qapp
 * that breaks at its declared maximum has to SAY so, in words a creator can act
 * on, and the sentence has to be about the visitor rather than about the
 * creator: since ai-ops 181 the sandbox is sized by whoever opens the page, and
 * the top-end run is deliberately made at the free lane's 2048 MB.
 */
test("a Qapp that fails at its largest inputs warns, and warns about the visitor", () => {
  const notice = rangeSmokeNotice(report("failed", "MemoryError: statevector"));
  assert.equal(notice?.tone, "warn");
  assert.match(notice.text, /visitor/);
  assert.match(notice.text, /smallest inputs but not at its largest/);
  // The sandbox's own diagnostic survives into what the creator reads. A notice
  // that swallowed it would tell them something is wrong and not what.
  assert.match(notice.text, /MemoryError: statevector/);
});

/**
 * The ruling was *"warn the creator, publish either way"*, so there is no branch
 * of this function that can block anything — it returns a sentence or nothing.
 * Pinned as a property over every status rather than as one case, because the
 * way this regresses is somebody adding a sixth status with a `blocked` tone.
 */
test("no status can produce anything other than a sentence", () => {
  for (const status of ["passed", "failed", "not_applicable", "unreachable"] as const) {
    const notice = rangeSmokeNotice(report(status));
    if (notice === null) continue;
    assert.ok(notice.tone === "warn" || notice.tone === "ok", `${status} produced tone ${notice.tone}`);
    assert.equal(typeof notice.text, "string");
  }
});

/**
 * **The trap, and the reason this file exists rather than an inline ternary.**
 *
 * `range_smoke` is `null` on every version generated before this shipped, and
 * none will ever be backfilled — the answer costs a sandbox and nobody is
 * waiting on it for a Qapp that already exists. So `null` means *nobody ever
 * asked*, which is a THIRD thing from `not_applicable` (asked; the schema
 * declares no upper bound) and from `passed` (asked; it worked).
 *
 * Rendering nothing is right for all three. What must never happen is `null`
 * reaching the `passed` branch and telling a creator their Qapp was "checked at
 * both ends" when it was not — which is exactly what a `smoke?.status !==
 * "failed"` shape would do.
 */
test("a version nobody measured is not reported as one that passed", () => {
  assert.equal(rangeSmokeNotice(null), null);
  assert.equal(rangeSmokeNotice(undefined), null);
  // The distinction being pinned: `passed` DOES say something, so a null that
  // silently took that branch would be visible only as a wrong sentence.
  assert.equal(rangeSmokeNotice(report("passed"))?.tone, "ok");
});

/**
 * `not_applicable` is a measurement — it says the top of the range was checked
 * and found to be the bottom — but it is the ordinary case, and a permanent line
 * saying "your inputs have no upper bound" on most Qapps is noise the creator
 * cannot act on.
 */
test("a schema with no declared ceiling says nothing to the creator", () => {
  assert.equal(rangeSmokeNotice(report("not_applicable")), null);
});

/**
 * `unreachable` covers two different things — a schema whose own maxima exceed
 * the 16 KB input cap, and a provider that would not start — and its `detail`
 * already says which. Passed through unwrapped so the creator reads the specific
 * one rather than a generic lead-in that fits neither.
 */
test("an unreachable top of range is passed through unwrapped", () => {
  const notice = rangeSmokeNotice(report("unreachable", "the sandbox provider was unavailable"));
  assert.equal(notice?.tone, "warn");
  assert.equal(notice.text, "the sandbox provider was unavailable");
});
