import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CATALOG_COOLDOWN_BASE_MS,
  CATALOG_COOLDOWN_MAX_MS,
  createCatalogCooldown,
  isOverloadStatus,
  parseRetryAfterSeconds,
} from "./catalog-cooldown.ts";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("isOverloadStatus", () => {
  it("is true for 429 and every 5xx, false for success and client errors", () => {
    for (const status of [429, 500, 502, 503, 504]) assert.equal(isOverloadStatus(status), true, String(status));
    // A 404 for an unknown slug is an answer about the request, not about capacity.
    for (const status of [200, 204, 400, 401, 403, 404, 422]) assert.equal(isOverloadStatus(status), false, String(status));
  });
});

describe("parseRetryAfterSeconds", () => {
  it("reads delta-seconds", () => {
    assert.equal(parseRetryAfterSeconds("30", 0), 30);
    assert.equal(parseRetryAfterSeconds(" 5 ", 0), 5);
  });

  it("reads an HTTP-date relative to now, never negative", () => {
    const now = Date.parse("Tue, 15 Sep 2026 10:00:00 GMT");
    assert.equal(parseRetryAfterSeconds("Tue, 15 Sep 2026 10:00:45 GMT", now), 45);
    assert.equal(parseRetryAfterSeconds("Tue, 15 Sep 2026 09:59:00 GMT", now), 0);
  });

  it("is null when absent or unreadable, including a negative number", () => {
    for (const header of [null, undefined, "", "soon", "-5", "1.5"]) {
      assert.equal(parseRetryAfterSeconds(header, 0), null, String(header));
    }
  });
});

describe("createCatalogCooldown", () => {
  it("does not skip before any failure", () => {
    const c = clock();
    const cooldown = createCatalogCooldown({ now: c.now });
    assert.equal(cooldown.shouldSkip(), false);
    assert.equal(cooldown.remainingMs(), 0);
  });

  it("skips for the base window after a refusal with no Retry-After, then stops", () => {
    const c = clock();
    const cooldown = createCatalogCooldown({ now: c.now });
    cooldown.recordFailure();
    assert.equal(cooldown.shouldSkip(), true);
    c.advance(CATALOG_COOLDOWN_BASE_MS - 1);
    assert.equal(cooldown.shouldSkip(), true);
    c.advance(1);
    assert.equal(cooldown.shouldSkip(), false);
  });

  it("honours a Retry-After longer than the base, capped at the maximum", () => {
    const c = clock();
    const cooldown = createCatalogCooldown({ now: c.now });
    cooldown.recordFailure(40);
    assert.equal(cooldown.remainingMs(), 40_000);

    const d = clock();
    const capped = createCatalogCooldown({ now: d.now });
    capped.recordFailure(3600);
    assert.equal(capped.remainingMs(), CATALOG_COOLDOWN_MAX_MS);
  });

  it("never waits less than the base, even when Retry-After asks for less", () => {
    const c = clock();
    const cooldown = createCatalogCooldown({ now: c.now });
    cooldown.recordFailure(1);
    assert.equal(cooldown.remainingMs(), CATALOG_COOLDOWN_BASE_MS);
  });

  it("a later short refusal does not cut a longer cooldown already running", () => {
    const c = clock();
    const cooldown = createCatalogCooldown({ now: c.now });
    cooldown.recordFailure(55);
    c.advance(5_000);
    cooldown.recordFailure();
    assert.equal(cooldown.remainingMs(), 50_000);
  });

  it("a successful read ends the cooldown", () => {
    const c = clock();
    const cooldown = createCatalogCooldown({ now: c.now });
    cooldown.recordFailure();
    cooldown.recordSuccess();
    assert.equal(cooldown.shouldSkip(), false);
  });

  it("asks for one log line per cooldown window, not one per skipped fetch", () => {
    const c = clock();
    const cooldown = createCatalogCooldown({ now: c.now });
    assert.equal(cooldown.shouldLogSkip(), false, "nothing to log with no cooldown");
    cooldown.recordFailure();
    assert.equal(cooldown.shouldLogSkip(), true);
    assert.equal(cooldown.shouldLogSkip(), false);
    assert.equal(cooldown.shouldLogSkip(), false);
    c.advance(CATALOG_COOLDOWN_BASE_MS);
    cooldown.recordFailure();
    assert.equal(cooldown.shouldLogSkip(), true, "a new window logs once again");
  });
});

// repository-source.ts imports the whole static corpus, which this runner cannot
// load, so its wiring is checked as text. The cooldown module alone proves
// nothing if the fetch path never starts or ends a cooldown: the first version of
// this change skipped correctly and recorded nothing, so the cooldown could never
// begin, and every test above still passed.
describe("fetchCatalogPage wiring (repository-source.ts, read as text)", () => {
  const source = readFileSync(new URL("./repository-source.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function fetchCatalogPage(");
  const end = source.indexOf("\nasync function ", start + 1);
  const body = source.slice(start, end);

  it("finds the function it is checking", () => {
    assert.ok(start >= 0 && end > start, "fetchCatalogPage not found; update this test if it moved");
  });

  it("checks the cooldown before it fetches", () => {
    const skip = body.indexOf("catalogCooldown.shouldSkip()");
    const fetchCall = body.indexOf("await fetch(");
    assert.ok(skip >= 0, "no shouldSkip() check");
    assert.ok(fetchCall > skip, "shouldSkip() must come before the fetch");
  });

  // Every search below is BOUNDED to its own branch. The first version searched
  // for "a recordFailure somewhere after the overload check", and deleting the
  // overload branch's call still passed, because the catch block's call further
  // down satisfied the unbounded search. A mutation run caught it.
  it("records a failure inside the overload branch, before that branch returns", () => {
    const overload = body.indexOf("isOverloadStatus(upstream.status)");
    assert.ok(overload >= 0, "no overload-status branch");
    const branchReturn = body.indexOf("return null;", overload);
    assert.ok(branchReturn > overload, "overload branch has no return null after it");
    const branch = body.slice(overload, branchReturn);
    assert.ok(branch.includes("catalogCooldown.recordFailure("), "overload branch does not record a failure");
  });

  it("records a failure inside the catch block", () => {
    const catchAt = body.indexOf("} catch");
    assert.ok(catchAt >= 0, "no catch block");
    const catchReturn = body.indexOf("return null;", catchAt);
    assert.ok(catchReturn > catchAt, "catch block has no return null");
    assert.ok(body.slice(catchAt, catchReturn).includes("catalogCooldown.recordFailure("), "catch does not record a failure");
  });

  it("ends the cooldown on a successful read, after the failure branch and before the successful return", () => {
    const failureBranchEnd = body.indexOf("return null;", body.indexOf("if (!upstream.ok)"));
    const payloadReturn = body.indexOf("return { payload:");
    assert.ok(failureBranchEnd >= 0 && payloadReturn > failureBranchEnd, "could not locate the success path");
    assert.ok(body.slice(failureBranchEnd, payloadReturn).includes("catalogCooldown.recordSuccess()"), "recordSuccess() is not on the success path");
  });
});
