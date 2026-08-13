import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { isLabDirectionEnabled } from "./lab-direction.ts";

// Next types NODE_ENV as read-only on ProcessEnv, so a test that swaps it has
// to go through a mutable view of the same object. And process.env stringifies
// whatever it is given — assigning undefined stores the literal "undefined" —
// so both setting and restoring delete the key instead.
const env = process.env as Record<string, string | undefined>;
const KEYS = ["VERCEL_ENV", "NODE_ENV"] as const;
const ORIGINAL = new Map(KEYS.map((key) => [key as string, env[key]]));

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of ORIGINAL) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

describe("isLabDirectionEnabled", () => {
  it("is off in a production build, which is what leonaqt.com runs", () => {
    // The whole point of the gate: /lab is an unratified second landing page,
    // nothing links to it, and a signed-in account could reach it by URL.
    setEnv({ NODE_ENV: "production", VERCEL_ENV: "production" });
    assert.equal(isLabDirectionEnabled(), false);
  });

  it("stays off in production even when VERCEL_ENV is absent", () => {
    // A production-mode build outside Vercel (docker, `next start`) must not
    // fall through to enabled just because the platform variable is missing.
    setEnv({ NODE_ENV: "production" });
    assert.equal(isLabDirectionEnabled(), false);
  });

  it("is on for a preview deployment, where the direction gets reviewed", () => {
    setEnv({ NODE_ENV: "production", VERCEL_ENV: "preview" });
    assert.equal(isLabDirectionEnabled(), true);
  });

  it("is on for a local dev server", () => {
    setEnv({ NODE_ENV: "development" });
    assert.equal(isLabDirectionEnabled(), true);
  });
});
