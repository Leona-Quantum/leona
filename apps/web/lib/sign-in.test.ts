import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { isPublicPath, isUnauthenticatedForAuthKit } from "./public-paths.ts";
import { majoranaSignInPath, signInFailurePath } from "./sign-in.ts";

test("sign-in starts on this deployment rather than at the provider", () => {
  assert.equal(majoranaSignInPath(), "/auth/sign-in?returnTo=%2Frun");
  assert.equal(
    majoranaSignInPath("/repository?q=qft#result"),
    "/auth/sign-in?returnTo=%2Frepository%3Fq%3Dqft%23result",
  );
});

/**
 * The retry link on the failure page is built from a query parameter that
 * whoever sent the visitor there controls, so it is the one link on that page
 * that could be turned into an open redirect.
 */
test("sign-in return paths fail closed against open redirects", () => {
  for (const unsafe of [
    "https://evil.example/collect",
    "//evil.example/collect",
    "/\\evil.example/collect",
    "javascript:alert(1)",
    "https://leonaqt.com.evil.example/",
  ]) {
    assert.equal(
      majoranaSignInPath(unsafe),
      "/auth/sign-in?returnTo=%2Frun",
      `${unsafe} should have collapsed to /run`,
    );
  }
});

test("the failure page carries bounded diagnostics and a safe retry target", () => {
  assert.equal(
    signInFailurePath("provider_unavailable", "request-123", "/studio?artifact=abc"),
    "/auth/sign-in/error?reason=provider_unavailable&requestId=request-123&returnTo=%2Fstudio%3Fartifact%3Dabc",
  );
  // An over-long request id is truncated rather than reflected whole, and an
  // unsafe returnTo is still collapsed on this path too.
  const path = signInFailurePath("not_configured", "x".repeat(100), "https://evil.example");
  assert.match(path, /requestId=x{64}(&|$)/);
  assert.match(path, /returnTo=%2Frun/);
  assert.doesNotMatch(path, /evil\.example/);
});

/**
 * The whole point of the page, asserted against the real gate rather than
 * against a remembered string.
 *
 * A visitor reaches this page precisely because the identity provider did not
 * answer. If the auth gate covers it, they are redirected to that provider to
 * sign in before being allowed to read why signing in failed — and nothing about
 * that failure announces itself, because the page renders fine in isolation.
 *
 * So this drives `isUnauthenticatedForAuthKit()` and `isPublicPath()` — the
 * actual functions `middleware.ts` decides with — using the actual URL
 * `signInFailurePath()` emits, rather than asserting that some pattern is in
 * some list.
 */
test("the failure page is reachable without a session", () => {
  const { pathname } = new URL(
    signInFailurePath("provider_unavailable", "req-1", "/run"),
    "https://leonaqt.com",
  );
  assert.equal(pathname, "/auth/sign-in/error");
  assert.equal(isPublicPath(pathname), true, "our own gate would require a session");
  assert.equal(
    isUnauthenticatedForAuthKit(pathname),
    true,
    "AuthKit would 307 this page to the provider that just failed",
  );
});

/**
 * And the page is really there. The reachability assertion above is only worth
 * something if a route answers that path — a published path with nothing behind
 * it proves nothing.
 */
test("a page actually answers the failure path", () => {
  const appDir = fileURLToPath(new URL("../app/", import.meta.url));
  const { pathname } = new URL(
    signInFailurePath("provider_unavailable", "req-1", "/run"),
    "https://leonaqt.com",
  );
  const dir = join(appDir, pathname.slice(1));
  const entries = readdirSync(dir, { withFileTypes: true });
  assert.equal(
    entries.some((entry) => entry.isFile() && /^page\.(tsx?|jsx?)$/.test(entry.name)),
    true,
    `nothing under app/${pathname.slice(1)} answers ${pathname}`,
  );
});
