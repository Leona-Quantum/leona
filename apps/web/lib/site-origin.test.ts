import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { siteOrigin } from "./site-origin.ts";
import { majoranaSignInPath, signInFailurePath } from "./sign-in.ts";

test("sign-in starts on this deployment rather than at the provider", () => {
  assert.equal(majoranaSignInPath(), "/auth/sign-in?returnTo=%2Frun");
  assert.equal(
    majoranaSignInPath("/repository?q=qft#result"),
    "/auth/sign-in?returnTo=%2Frepository%3Fq%3Dqft%23result",
  );
});

test("sign-in return paths fail closed against open redirects", () => {
  for (const unsafe of [
    "https://evil.example/collect",
    "//evil.example/collect",
    "/\\evil.example/collect",
    "javascript:alert(1)",
  ]) {
    assert.equal(majoranaSignInPath(unsafe), "/auth/sign-in?returnTo=%2Frun");
  }
});

test("the failure page carries bounded diagnostics and a safe retry target", () => {
  assert.equal(
    signInFailurePath("provider_unavailable", "request-123", "/studio?artifact=abc"),
    "/auth/sign-in/error?reason=provider_unavailable&requestId=request-123&returnTo=%2Fstudio%3Fartifact%3Dabc",
  );
  const path = signInFailurePath("not_configured", "x".repeat(100), "https://evil.example");
  assert.match(path, /requestId=x{64}/);
  assert.match(path, /returnTo=%2Frun/);
});

test("the origin comes off the configured sign-in callback", () => {
  assert.equal(
    siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://leonaqt.com/auth/callback" }),
    "https://leonaqt.com",
  );
});

test("the path is dropped, and only the path", () => {
  // A return_to of ".../auth/callback" would put a signed-out person back on
  // the sign-in callback, which is the one place they should not land.
  assert.equal(
    siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://www.leonaqt.com/auth/callback?x=1" }),
    "https://www.leonaqt.com",
  );
  // A non-default port is part of the origin and must survive.
  assert.equal(
    siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "http://localhost:3000/auth/callback" }),
    "http://localhost:3000",
  );
});

test("the server-only variable is the fallback, not the winner", () => {
  assert.equal(
    siteOrigin({
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://leonaqt.com/auth/callback",
      WORKOS_REDIRECT_URI: "https://stale.example/auth/callback",
    }),
    "https://leonaqt.com",
  );
  assert.equal(
    siteOrigin({ WORKOS_REDIRECT_URI: "https://leonaqt.com/auth/callback" }),
    "https://leonaqt.com",
  );
});

test("nothing configured means nothing claimed", () => {
  assert.equal(siteOrigin({}), null);
});

test("a value that is not a usable origin yields null rather than a bad one", () => {
  assert.equal(siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "not a url" }), null);
  assert.equal(siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "/auth/callback" }), null);
  // Parses fine and has the opaque origin "null" — sending that as return_to
  // would be worse than sending nothing.
  assert.equal(siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "mailto:someone@example.com" }), null);
});

/**
 * `auth.ts` reaches WorkOS through `@workos-inc/authkit-nextjs`, which the bare
 * node runner cannot load, so the one line that actually decides where a
 * signed-out person lands cannot be exercised directly. It is read instead.
 *
 * A relative `returnTo` is not a compile error and not a runtime error — WorkOS
 * quietly ignores it and uses the environment's default sign-out redirect — so
 * reverting this costs nothing at any gate except this one. The assertion is
 * that the call was FOUND and is correct, not merely that a bad pattern is
 * absent: a scan that matches nothing passes forever.
 */
test("sign-out hands WorkOS an absolute origin, not a path", () => {
  const source = readFileSync(fileURLToPath(new URL("./auth.ts", import.meta.url)), "utf8");
  const call = source.match(/await signOut\(\{[^}]*\}\)/);
  assert.ok(call, "expected auth.ts to still call signOut — this guard found nothing to check");
  assert.match(
    call[0],
    /returnTo:\s*siteOrigin\(\)/,
    `signOut must be given the deployment's origin, got: ${call[0]}`,
  );
});
