import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTACT_MAX_PER_WINDOW,
  CONTACT_MAX_TRACKED,
  CONTACT_WINDOW_MS,
  admitContact,
  contactAddress,
  sweepExpired,
  type RateLimitStore,
} from "./contact-rate-limit.ts";

const T0 = 1_700_000_000_000;

function store(): RateLimitStore {
  return new Map();
}

describe("the contact form's per-address bound", () => {
  it("admits a person writing in, and the second message they forgot to include", () => {
    const s = store();
    for (let i = 0; i < CONTACT_MAX_PER_WINDOW; i += 1) {
      assert.deepEqual(admitContact(s, "203.0.113.7", T0 + i * 1000), { allowed: true }, `submission ${i + 1}`);
    }
  });

  it("refuses the one past the limit, and says how long to wait", () => {
    const s = store();
    for (let i = 0; i < CONTACT_MAX_PER_WINDOW; i += 1) admitContact(s, "203.0.113.7", T0);
    const decision = admitContact(s, "203.0.113.7", T0);
    assert.equal(decision.allowed, false);
    assert.ok(decision.allowed === false && decision.retryAfterSeconds > 0);
    assert.ok(
      decision.allowed === false && decision.retryAfterSeconds <= CONTACT_WINDOW_MS / 1000,
      "never asks the caller to wait longer than one window",
    );
  });

  it("never answers Retry-After: 0, which invites the retry it is bounding", () => {
    const s = store();
    for (let i = 0; i < CONTACT_MAX_PER_WINDOW; i += 1) admitContact(s, "203.0.113.7", T0);
    // One millisecond before the window closes: the true remainder rounds to
    // zero seconds, and the floor is what stops it being reported that way.
    const decision = admitContact(s, "203.0.113.7", T0 + CONTACT_WINDOW_MS - 1);
    assert.equal(decision.allowed, false);
    assert.equal(decision.allowed === false && decision.retryAfterSeconds, 1);
  });

  it("opens a fresh window once the old one elapses", () => {
    const s = store();
    for (let i = 0; i < CONTACT_MAX_PER_WINDOW; i += 1) admitContact(s, "203.0.113.7", T0);
    assert.equal(admitContact(s, "203.0.113.7", T0).allowed, false);
    assert.deepEqual(admitContact(s, "203.0.113.7", T0 + CONTACT_WINDOW_MS), { allowed: true });
  });

  it("meters each address separately, so one flood does not refuse everyone else", () => {
    const s = store();
    for (let i = 0; i < CONTACT_MAX_PER_WINDOW; i += 1) admitContact(s, "203.0.113.7", T0);
    assert.equal(admitContact(s, "203.0.113.7", T0).allowed, false);
    assert.deepEqual(admitContact(s, "198.51.100.4", T0), { allowed: true }, "an unrelated visitor is unaffected");
  });

  // The documented degradation. This is the test that would have caught the
  // opposite choice, which is the tempting one: refusing on saturation reads as
  // "safer" and would hand any attacker a way to take the contact form down for
  // everybody by rotating addresses.
  it("degrades to OFF, not to REFUSE, when the table is saturated", () => {
    const s = store();
    for (let i = 0; i < CONTACT_MAX_TRACKED; i += 1) {
      // Long windows, so nothing is sweepable and the table stays genuinely full.
      s.set(`10.0.${Math.floor(i / 256)}.${i % 256}`, { count: 1, resetAt: T0 + CONTACT_WINDOW_MS * 10 });
    }
    assert.equal(s.size, CONTACT_MAX_TRACKED);
    assert.deepEqual(admitContact(s, "203.0.113.99", T0), { allowed: true }, "a new address is admitted, not refused");
    assert.equal(s.size, CONTACT_MAX_TRACKED, "and is not recorded, so the rotation cannot evict real entries");
  });

  it("sweeps elapsed windows before declaring itself full", () => {
    const s = store();
    for (let i = 0; i < CONTACT_MAX_TRACKED; i += 1) {
      s.set(`10.0.${Math.floor(i / 256)}.${i % 256}`, { count: 1, resetAt: T0 });
    }
    // Every entry above has already elapsed, so room exists and the newcomer is
    // tracked properly rather than waved through.
    assert.deepEqual(admitContact(s, "203.0.113.99", T0 + 1), { allowed: true });
    assert.ok(s.has("203.0.113.99"), "the newcomer is metered, not silently exempted");
  });

  it("sweepExpired keeps live windows and drops elapsed ones", () => {
    const s = store();
    s.set("live", { count: 1, resetAt: T0 + 5000 });
    s.set("elapsed", { count: 1, resetAt: T0 - 1 });
    sweepExpired(s, T0);
    assert.deepEqual([...s.keys()], ["live"]);
  });
});

describe("which address the contact form meters", () => {
  it("takes the first x-forwarded-for entry, as services/api does", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 130.211.0.1" });
    assert.equal(contactAddress(headers), "203.0.113.7");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    assert.equal(contactAddress(new Headers({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
    assert.equal(contactAddress(new Headers()), "unknown");
  });

  it("does not treat an empty or whitespace-only header as an address", () => {
    // A blank first entry would otherwise become the shared key "", quietly
    // metering every such caller as one visitor.
    assert.equal(contactAddress(new Headers({ "x-forwarded-for": "" })), "unknown");
    assert.equal(contactAddress(new Headers({ "x-forwarded-for": "   ,  " })), "unknown");
    assert.equal(contactAddress(new Headers({ "x-forwarded-for": " , 203.0.113.7" })), "unknown");
  });
});
