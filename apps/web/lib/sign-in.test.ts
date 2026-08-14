import assert from "node:assert/strict";
import test from "node:test";

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
 * The failure page lives under the sign-in path on purpose: `public-paths.ts`
 * publishes `/auth/sign-in` and everything beneath it to both matchers, so a
 * page that explains a provider outage is not itself gated behind that
 * provider. If this ever moves out from under `/auth/sign-in/`, it silently
 * falls back into the auth gate.
 */
test("the failure page stays inside the published sign-in subtree", () => {
  const path = signInFailurePath("provider_unavailable", "id", "/run");
  assert.equal(path.startsWith("/auth/sign-in/"), true);
});
