import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { deployEnv, publicReleaseSha, releaseSha } from "./deploy-env.ts";
import { isLabDirectionEnabled } from "./lab-direction.ts";
import { isPublicDemoEnabled } from "./public-demo.ts";

// Same pattern as lib/lab-direction.test.ts: process.env types most of these
// keys as read-only, and stringifies whatever it is assigned (undefined
// becomes the literal "undefined"), so both setting and restoring go through
// delete on a mutable view of the same object.
const env = process.env as Record<string, string | undefined>;
const KEYS = [
  "LEONA_DEPLOY_ENV",
  "VERCEL_ENV",
  "NODE_ENV",
  "MAJORANA_PUBLIC_DEMO",
  "LEONA_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
] as const;
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

describe("deployEnv()", () => {
  it("on Vercel (no LEONA_DEPLOY_ENV set), resolves to VERCEL_ENV unchanged — production", () => {
    setEnv({ VERCEL_ENV: "production" });
    assert.equal(deployEnv(), "production");
  });

  it("on Vercel, resolves to VERCEL_ENV unchanged — preview", () => {
    setEnv({ VERCEL_ENV: "preview" });
    assert.equal(deployEnv(), "preview");
  });

  it("on Vercel, resolves to VERCEL_ENV unchanged — development", () => {
    setEnv({ VERCEL_ENV: "development" });
    assert.equal(deployEnv(), "development");
  });

  it("with neither var set, resolves to undefined (a bare `next dev`/`next build`)", () => {
    setEnv({});
    assert.equal(deployEnv(), undefined);
  });

  it("LEONA_DEPLOY_ENV overrides VERCEL_ENV when both are set", () => {
    setEnv({ LEONA_DEPLOY_ENV: "preview", VERCEL_ENV: "production" });
    assert.equal(deployEnv(), "preview");
  });

  it("LEONA_DEPLOY_ENV governs alone, with no VERCEL_ENV at all (Cloud Run)", () => {
    setEnv({ LEONA_DEPLOY_ENV: "production" });
    assert.equal(deployEnv(), "production");
  });
});

describe("fail-closed: an unrecognised deploy env reads as neither preview nor development", () => {
  it("isLabDirectionEnabled() stays off for an unrecognised LEONA_DEPLOY_ENV value", () => {
    // "staging" is not "production", "preview" or "development" — nothing in
    // this codebase knows what it means. The allowlist comparisons downstream
    // (=== "preview", === "development") fail closed on it for free, same as
    // an unset var, rather than needing this module to validate the value.
    setEnv({ LEONA_DEPLOY_ENV: "staging", NODE_ENV: "production" });
    assert.equal(isLabDirectionEnabled(), false);
  });

  it("isPublicDemoEnabled() stays off for an unrecognised LEONA_DEPLOY_ENV value, even with the demo flag on", () => {
    setEnv({ LEONA_DEPLOY_ENV: "canary", NODE_ENV: "production", MAJORANA_PUBLIC_DEMO: "true" });
    assert.equal(isPublicDemoEnabled(), false);
  });

  it("stays off for an empty-string LEONA_DEPLOY_ENV rather than treating it as unset-and-fall-through", () => {
    setEnv({ LEONA_DEPLOY_ENV: "", VERCEL_ENV: "preview", NODE_ENV: "production" });
    // "" ?? x only falls through on null/undefined, never on the empty string,
    // so an accidentally-empty var shadows a real VERCEL_ENV instead of
    // deferring to it — and "" matches no allowlist entry either, so this
    // still fails closed rather than opening anything.
    assert.equal(deployEnv(), "");
    assert.equal(isLabDirectionEnabled(), false);
  });
});

describe("readers unchanged on Vercel (VERCEL_ENV alone, LEONA_DEPLOY_ENV never set)", () => {
  it("isLabDirectionEnabled(): on for preview, off for production", () => {
    setEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" });
    assert.equal(isLabDirectionEnabled(), true);
    setEnv({ VERCEL_ENV: "production", NODE_ENV: "production" });
    assert.equal(isLabDirectionEnabled(), false);
  });

  it("isPublicDemoEnabled(): on for preview with the flag set, off for production", () => {
    setEnv({ VERCEL_ENV: "preview", NODE_ENV: "production", MAJORANA_PUBLIC_DEMO: "true" });
    assert.equal(isPublicDemoEnabled(), true);
    setEnv({ VERCEL_ENV: "production", NODE_ENV: "production", MAJORANA_PUBLIC_DEMO: "true" });
    assert.equal(isPublicDemoEnabled(), false);
  });
});

describe("readers respond to LEONA_DEPLOY_ENV with no VERCEL_ENV present (Cloud Run)", () => {
  it("isLabDirectionEnabled(): on for preview, off for production", () => {
    setEnv({ LEONA_DEPLOY_ENV: "preview", NODE_ENV: "production" });
    assert.equal(isLabDirectionEnabled(), true);
    setEnv({ LEONA_DEPLOY_ENV: "production", NODE_ENV: "production" });
    assert.equal(isLabDirectionEnabled(), false);
  });

  it("isPublicDemoEnabled(): on for preview with the flag set, off for production", () => {
    setEnv({ LEONA_DEPLOY_ENV: "preview", NODE_ENV: "production", MAJORANA_PUBLIC_DEMO: "true" });
    assert.equal(isPublicDemoEnabled(), true);
    setEnv({ LEONA_DEPLOY_ENV: "production", NODE_ENV: "production", MAJORANA_PUBLIC_DEMO: "true" });
    assert.equal(isPublicDemoEnabled(), false);
  });
});

describe("releaseSha() / publicReleaseSha()", () => {
  it("releaseSha(): LEONA_GIT_COMMIT_SHA first, VERCEL_GIT_COMMIT_SHA as the Vercel fallback", () => {
    setEnv({ VERCEL_GIT_COMMIT_SHA: "abc0000" });
    assert.equal(releaseSha(), "abc0000");
    setEnv({ LEONA_GIT_COMMIT_SHA: "def1111", VERCEL_GIT_COMMIT_SHA: "abc0000" });
    assert.equal(releaseSha(), "def1111");
  });

  it("releaseSha(): undefined with neither set, same as before this module existed", () => {
    setEnv({});
    assert.equal(releaseSha(), undefined);
  });

  it("publicReleaseSha(): NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA first, the Vercel var as fallback", () => {
    setEnv({ NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: "abc0000" });
    assert.equal(publicReleaseSha(), "abc0000");
    setEnv({
      NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA: "def1111",
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: "abc0000",
    });
    assert.equal(publicReleaseSha(), "def1111");
  });
});
