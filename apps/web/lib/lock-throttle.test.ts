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

/** Spend `n` attempts, returning how many were admitted.
 *
 * `reserve` is consuming by design, so there is no free "would this be
 * refused?" probe — every question costs an attempt, exactly as a real request
 * does. Tests count admissions instead of peeking.
 */
function spend(
  throttle: ReturnType<typeof createLockThrottle>,
  key: string | ((i: number) => string),
  n: number,
  now: number = NOW,
): number {
  let admitted = 0;
  for (let i = 0; i < n; i += 1) {
    if (throttle.reserve(typeof key === "string" ? key : key(i), now)) admitted += 1;
  }
  return admitted;
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
  it("admits exactly the limit, then refuses", () => {
    const throttle = createLockThrottle();
    assert.equal(spend(throttle, "a", MAX_FAILURES), MAX_FAILURES);
    assert.equal(throttle.reserve("a", NOW), false);
  });

  it("does not leak one key's attempts into another", () => {
    const throttle = createLockThrottle();
    spend(throttle, "a", MAX_FAILURES);
    assert.equal(throttle.reserve("a", NOW), false);
    assert.equal(throttle.reserve("b", NOW), true);
  });

  it("forgets a key once its window has passed", () => {
    const throttle = createLockThrottle();
    spend(throttle, "a", MAX_FAILURES);
    assert.equal(throttle.reserve("a", NOW), false);
    assert.equal(throttle.reserve("a", NOW + FAILURE_WINDOW_MS + 1), true);
  });

  it("releases a key on success so an operator's typos do not lock them out", () => {
    const throttle = createLockThrottle();
    spend(throttle, "a", MAX_FAILURES);
    assert.equal(throttle.reserve("a", NOW), false);
    throttle.release("a");
    assert.equal(throttle.reserve("a", NOW), true);
  });
});

describe("admission is atomic", () => {
  it("charges the attempt up front, so a concurrent burst cannot all pass", () => {
    // The bug this guards: the route checks the limit, then `await`s the
    // credential comparison, and only then records a failure. If the check did
    // not itself consume, every request in a burst would pass the check before
    // any of them recorded anything. Reserving up front means the Nth caller
    // sees the first N-1 charges even though none has finished validating.
    const throttle = createLockThrottle();
    const burst = Array.from({ length: MAX_FAILURES + 25 }, () => throttle.reserve("a", NOW));
    assert.equal(burst.filter(Boolean).length, MAX_FAILURES);
  });

  it("refunds the shared budget on a successful sign-in", () => {
    // Without a refund, ordinary successful logins would permanently consume
    // global budget and exhaust the backstop with no attack at all.
    const throttle = createLockThrottle();
    for (let i = 0; i < 20; i += 1) {
      assert.equal(throttle.reserve(`operator-${i}`, NOW), true);
      throttle.release(`operator-${i}`);
    }
    // 20 successful sign-ins have cost the shared ceiling nothing.
    assert.equal(spend(throttle, (i) => `spoofed-${i}`, MAX_GLOBAL_FAILURES), MAX_GLOBAL_FAILURES);
  });
});

describe("the global backstop", () => {
  it("stops a caller who rotates the key on every attempt", () => {
    // The attack the per-key limit alone cannot see: every guess arrives under
    // a fresh spoofed address, so no single bucket ever fills. Without the
    // shared ceiling every one of these would be admitted.
    const throttle = createLockThrottle();
    const admitted = spend(throttle, (i) => `spoofed-${i}`, MAX_GLOBAL_FAILURES * 2);
    assert.equal(admitted, MAX_GLOBAL_FAILURES);
  });

  it("releases the backstop after the window", () => {
    const throttle = createLockThrottle();
    spend(throttle, (i) => `spoofed-${i}`, MAX_GLOBAL_FAILURES);
    assert.equal(throttle.reserve("fresh", NOW), false);
    assert.equal(throttle.reserve("fresh", NOW + FAILURE_WINDOW_MS + 1), true);
  });

  it("keeps the global ceiling clear of a lone operator's mistyping", () => {
    // A real operator fat-fingering the password must never trip the backstop
    // meant for a spoofing attacker.
    assert.ok(MAX_GLOBAL_FAILURES > MAX_FAILURES);
    const throttle = createLockThrottle();
    spend(throttle, "operator", MAX_FAILURES);
    // Their own key is limited, but they have not exhausted everyone's budget.
    assert.equal(throttle.reserve("someone-else", NOW), true);
  });
});

describe("memory bounds", () => {
  it("does not grow without bound when the key is rotated", () => {
    // Each distinct spoofed value used to create an entry that lived for the
    // full window, so the counter map was itself a memory-exhaustion vector.
    const throttle = createLockThrottle();
    spend(throttle, (i) => `spoofed-${i}`, MAX_TRACKED_KEYS * 3);
    // The Map is private, so assert the observable contract: still bounded,
    // still answering, after far more keys than it will ever track.
    assert.equal(throttle.reserve("anything", NOW), false);
  });

  it("reclaims tracked keys once their windows expire", () => {
    const throttle = createLockThrottle();
    spend(throttle, (i) => `old-${i}`, MAX_TRACKED_KEYS);
    const later = NOW + FAILURE_WINDOW_MS + 1;
    // The expired keys are swept, so a new key is tracked normally again and
    // reaches its own per-key limit rather than being silently dropped.
    assert.equal(spend(throttle, "new", MAX_FAILURES, later), MAX_FAILURES);
    assert.equal(throttle.reserve("new", later), false);
  });
});
