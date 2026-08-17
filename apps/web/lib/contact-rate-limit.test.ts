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
  // The finding that changed this: x-forwarded-for is written by the CALLER, so
  // preferring it let a script defeat the limiter from one machine by varying one
  // header. The platform headers cannot be forged by a client.
  it("prefers the platform header over anything the caller can write", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-forwarded-for": "10.0.0.1, 10.0.0.2",
      "x-real-ip": "198.51.100.4",
    });
    assert.equal(contactAddress(headers), "203.0.113.7");
  });

  it("ignores a forged x-forwarded-for whenever a platform header is present", () => {
    const forged = new Headers({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "1.2.3.4" });
    assert.equal(contactAddress(forged), "198.51.100.4");
  });

  it("falls back to x-forwarded-for only when no platform header exists", () => {
    // Local development, and anywhere else the edge is not in front of us.
    // Metering something beats metering nothing.
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 130.211.0.1" });
    assert.equal(contactAddress(headers), "203.0.113.7");
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

describe("cf-connecting-ip, once leonaqt.com is proxied through Cloudflare (ai-ops 141)", () => {
  it("prefers cf-connecting-ip when Vercel's own witness confirms Cloudflare made the connection", () => {
    // 104.20.1.1 is inside Cloudflare's published 104.16.0.0/13 — i.e. this is
    // what x-vercel-forwarded-for looks like for every visitor once the zone is
    // proxied, and it is what makes the Cloudflare header worth believing.
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "x-vercel-forwarded-for": "104.20.1.1",
    });
    assert.equal(contactAddress(headers), "203.0.113.7");
  });

  it("ignores a forged cf-connecting-ip when the connection did not come from Cloudflare", () => {
    // The bypass this closes: a request that reached this deployment by some
    // route other than the proxied domain (its `*.vercel.app` alias, for one)
    // carries whatever cf-connecting-ip a caller cares to write, and
    // x-vercel-forwarded-for shows their real address rather than a Cloudflare
    // one. The forged header must be ignored, and metering must fall back to
    // the address Vercel itself witnessed — never to "unknown", which would
    // exempt this path from the limiter entirely.
    const headers = new Headers({
      "cf-connecting-ip": "198.51.100.4", // forged
      "x-vercel-forwarded-for": "203.0.113.7", // the real caller, not a Cloudflare address
    });
    assert.equal(contactAddress(headers), "203.0.113.7");
  });

  it("behaves exactly as before when cf-connecting-ip is absent", () => {
    // No Cloudflare in front of this request (local dev, or before ai-ops 141) —
    // the platform header alone still governs, unchanged.
    const headers = new Headers({ "x-vercel-forwarded-for": "203.0.113.7" });
    assert.equal(contactAddress(headers), "203.0.113.7");
  });

  it("falls back past a Cloudflare address with no cf-connecting-ip to go with it", () => {
    // x-vercel-forwarded-for being a Cloudflare address with no cf-connecting-ip
    // present is not a state Cloudflare actually produces, but the function
    // must not throw or invent an address for it — it meters the Cloudflare
    // address itself rather than crashing or returning "unknown".
    const headers = new Headers({ "x-vercel-forwarded-for": "104.20.1.1" });
    assert.equal(contactAddress(headers), "104.20.1.1");
  });
});
