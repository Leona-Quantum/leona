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
  "NODE_ENV",
  "MAJORANA_PUBLIC_DEMO",
  "LEONA_GIT_COMMIT_SHA",
  "NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA",
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
  it("resolves to LEONA_DEPLOY_ENV when set", () => {
    setEnv({ LEONA_DEPLOY_ENV: "production" });
    assert.equal(deployEnv(), "production");
    setEnv({ LEONA_DEPLOY_ENV: "preview" });
    assert.equal(deployEnv(), "preview");
    setEnv({ LEONA_DEPLOY_ENV: "development" });
    assert.equal(deployEnv(), "development");
  });

  it("with the var unset, resolves to undefined (a bare `next dev`/`next build`)", () => {
    setEnv({});
    assert.equal(deployEnv(), undefined);
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

  it("stays off for an empty-string LEONA_DEPLOY_ENV rather than treating it as unset", () => {
    setEnv({ LEONA_DEPLOY_ENV: "", NODE_ENV: "production" });
    // "" matches no allowlist entry, so this fails closed rather than opening
    // anything — an accidentally-empty var is not the same as an unset one,
    // but both land on the same refused-by-default outcome here.
    assert.equal(deployEnv(), "");
    assert.equal(isLabDirectionEnabled(), false);
  });
});

describe("readers respond to LEONA_DEPLOY_ENV", () => {
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
  it("releaseSha(): reads LEONA_GIT_COMMIT_SHA", () => {
    setEnv({ LEONA_GIT_COMMIT_SHA: "def1111" });
    assert.equal(releaseSha(), "def1111");
  });

  it("releaseSha(): undefined when unset", () => {
    setEnv({});
    assert.equal(releaseSha(), undefined);
  });

  it("publicReleaseSha(): reads NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA", () => {
    setEnv({ NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA: "def1111" });
    assert.equal(publicReleaseSha(), "def1111");
  });

  it("publicReleaseSha(): undefined when unset", () => {
    setEnv({});
    assert.equal(publicReleaseSha(), undefined);
  });
});
