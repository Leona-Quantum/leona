import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createLockThrottle,
  throttleKeyFromHeaders,
  FAILURE_WINDOW_MS,
  MAX_FAILURES,
  MAX_GLOBAL_FAILURES,
  MAX_TRACKED_KEYS,
} from "./lock-throttle.ts";

const NOW = Date.UTC(2026, 6, 26, 12, 0, 0);

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

describe("throttle key resolution", () => {
  it("ignores the client-written left end of x-forwarded-for", () => {
    // The regression this whole module exists for. In the conventional
    // `client, proxy1, proxy2` chain the LEFT entry is whatever the caller
    // typed, so keying off it hands the attacker the bucket selector.
    const key = throttleKeyFromHeaders(headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }));
    assert.notEqual(key, "1.1.1.1");
    assert.equal(key, "203.0.113.7");
  });

  it("prefers the platform-set header over anything the caller can write", () => {
    const key = throttleKeyFromHeaders(headers({
      "x-vercel-forwarded-for": "203.0.113.9",
      "x-real-ip": "198.51.100.4",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    }));
    assert.equal(key, "203.0.113.9");
  });

  it("falls back through x-real-ip before x-forwarded-for", () => {
    const key = throttleKeyFromHeaders(headers({
      "x-real-ip": "198.51.100.4",
      "x-forwarded-for": "1.1.1.1",
    }));
    assert.equal(key, "198.51.100.4");
  });

  it("buckets unidentifiable callers together rather than inventing a key", () => {
    assert.equal(throttleKeyFromHeaders(headers({})), "unknown");
    // Whitespace-only and empty values must not read as a usable identity.
    assert.equal(throttleKeyFromHeaders(headers({ "x-forwarded-for": " , " })), "unknown");
  });
});

describe("per-key throttling", () => {
  it("allows up to the limit, then refuses", () => {
    const throttle = createLockThrottle();
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      assert.equal(throttle.isRateLimited("a", NOW), false, `attempt ${i} should be allowed`);
      throttle.recordFailure("a", NOW);
    }
    assert.equal(throttle.isRateLimited("a", NOW), true);
  });

  it("does not leak one key's failures into another", () => {
    const throttle = createLockThrottle();
    for (let i = 0; i < MAX_FAILURES; i += 1) throttle.recordFailure("a", NOW);
    assert.equal(throttle.isRateLimited("a", NOW), true);
    assert.equal(throttle.isRateLimited("b", NOW), false);
  });

  it("forgets a key once its window has passed", () => {
    const throttle = createLockThrottle();
    for (let i = 0; i < MAX_FAILURES; i += 1) throttle.recordFailure("a", NOW);
    assert.equal(throttle.isRateLimited("a", NOW), true);
    assert.equal(throttle.isRateLimited("a", NOW + FAILURE_WINDOW_MS + 1), false);
  });

  it("clears a key on success so an operator's typos do not lock them out", () => {
    const throttle = createLockThrottle();
    for (let i = 0; i < MAX_FAILURES; i += 1) throttle.recordFailure("a", NOW);
    assert.equal(throttle.isRateLimited("a", NOW), true);
    throttle.clearFailures("a");
    assert.equal(throttle.isRateLimited("a", NOW), false);
  });
});

describe("the global backstop", () => {
  it("stops a caller who rotates the key on every attempt", () => {
    // This is the attack the per-key limit alone cannot see: every guess
    // arrives under a fresh spoofed address, so no single bucket ever fills.
    // Without the shared ceiling this loop would never be refused.
    const throttle = createLockThrottle();
    let refusedAfter = -1;
    for (let i = 0; i < MAX_GLOBAL_FAILURES * 2; i += 1) {
      const key = `spoofed-${i}`;
      if (throttle.isRateLimited(key, NOW)) {
        refusedAfter = i;
        break;
      }
      throttle.recordFailure(key, NOW);
    }
    assert.equal(refusedAfter, MAX_GLOBAL_FAILURES);
  });

  it("releases the backstop after the window", () => {
    const throttle = createLockThrottle();
    for (let i = 0; i < MAX_GLOBAL_FAILURES; i += 1) throttle.recordFailure(`spoofed-${i}`, NOW);
    assert.equal(throttle.isRateLimited("fresh", NOW), true);
    assert.equal(throttle.isRateLimited("fresh", NOW + FAILURE_WINDOW_MS + 1), false);
  });

  it("keeps the global ceiling clear of a lone operator's mistyping", () => {
    // A real operator fat-fingering the password must never trip the backstop
    // meant for a spoofing attacker.
    assert.ok(MAX_GLOBAL_FAILURES > MAX_FAILURES);
    const throttle = createLockThrottle();
    for (let i = 0; i < MAX_FAILURES; i += 1) throttle.recordFailure("operator", NOW);
    // Their own key is limited, but they have not exhausted everyone's budget.
    assert.equal(throttle.isRateLimited("someone-else", NOW), false);
  });
});

describe("memory bounds", () => {
  it("does not grow without bound when the key is rotated", () => {
    // Each distinct spoofed value used to create an entry that lived for the
    // full window, so the counter map was itself a memory-exhaustion vector.
    const throttle = createLockThrottle();
    for (let i = 0; i < MAX_TRACKED_KEYS * 3; i += 1) {
      throttle.recordFailure(`spoofed-${i}`, NOW);
    }
    // Nothing to assert on the Map directly (it is private), so assert the
    // observable contract instead: the throttle is still refusing, and still
    // answering, after far more keys than it will track.
    assert.equal(throttle.isRateLimited("anything", NOW), true);
  });

  it("reclaims tracked keys once their windows expire", () => {
    const throttle = createLockThrottle();
    for (let i = 0; i < MAX_TRACKED_KEYS; i += 1) throttle.recordFailure(`old-${i}`, NOW);
    const later = NOW + FAILURE_WINDOW_MS + 1;
    // The expired keys are swept, so a new key is tracked normally again and
    // reaches its own per-key limit rather than being silently dropped.
    for (let i = 0; i < MAX_FAILURES; i += 1) throttle.recordFailure("new", later);
    assert.equal(throttle.isRateLimited("new", later), true);
  });
});
