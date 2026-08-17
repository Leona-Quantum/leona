/**
 * The control that gates the `jose@^5.0.0` override in `pnpm-workspace.yaml`.
 *
 * The override's version is deliberately NOT quoted here. It moved 6.2.5 -> 6.2.8
 * and this sentence would not have been updated with it — the same failure the
 * `DEFAULT_ANON_LIMIT` comment in `services/api/.../rate_limit.py` records, where
 * prose under-stated a constant by 5x for as long as it went unread. What this
 * file pins is `MINIMUM_PATCHED_JOSE`, below, which is a floor rather than the
 * override's current value.
 *
 * ## Why this file exists, and why it is not the test that was proposed
 *
 * ai-ops 131 offered to land the jose 5 -> 6 bump "verified only by a synthetic
 * seal/unseal test rather than a real browser sign-in", and the owner took that
 * option. A seal/unseal test would have proved nothing at all.
 *
 * The signed-in cookie is sealed and unsealed by `iron-session`, and
 * `iron-session@8.0.4` declares exactly three dependencies — `cookie`,
 * `iron-webcrypto`, `uncrypto` — **none of which is jose**. So the seal path does
 * not touch jose in either direction, and a passing seal/unseal test under a
 * broken override would have been a green light with no circuit behind it.
 *
 * What actually pulls jose is `@workos-inc/authkit-nextjs`, in three places, all
 * on the ACCESS TOKEN rather than the cookie:
 *
 *   dist/esm/session.js:19   createRemoteJWKSet(...)  — the WorkOS key set
 *   dist/esm/session.js:419  await jwtVerify(accessToken, JWKS())
 *   dist/esm/session.js:*    decodeJwt(session.accessToken)  — 10 call sites
 *   dist/esm/auth.js:2       decodeJwt
 *
 * That is the surface this file exercises: sign -> verify -> decode, plus the
 * two rejections that make a verifier a verifier. If the override ever puts a
 * jose under authkit whose API or behaviour has moved, this fails here rather
 * than on a visitor's sign-in.
 *
 * ## Why it asserts the resolved version first
 *
 * A test that would pass identically on jose 5 does not gate an upgrade to jose
 * 6 — it just runs twice. `resolvedJoseVersion` reads the version out of the
 * package the app actually resolves and compares it against the version the
 * advisory is patched at, so if the override is reverted, dropped in a merge, or
 * quietly outvoted by another override, this file FAILS instead of going green
 * against the version it was written to replace. It is a floor and not an
 * equality check on purpose — see `atLeast`.
 *
 * ## Scope, stated honestly
 *
 * This proves the jose primitives authkit calls behave correctly under whatever
 * jose the override actually resolves
 * against a locally generated key. It does NOT prove a real WorkOS sign-in: that
 * needs a live session cookie on the production domain, which a preview
 * deployment cannot hold because WorkOS redirect URIs are per-domain. That gap
 * is the owner's accepted risk on ai-ops 131 and is covered by a manual walk.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeJwt,
  errors as joseErrors,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from "jose";

const require_ = createRequire(import.meta.url);

/** The version of the jose the app resolves — not the one this file hoped for. */
function resolvedJoseVersion(): string {
  const pkg = require_("jose/package.json") as { version: string };
  return pkg.version;
}

/** AIKIDO-2026-584205 is patched here. Anything below it is still vulnerable. */
const MINIMUM_PATCHED_JOSE = "6.2.5";

/**
 * True when `version` is at least `minimum`, compared numerically per component.
 *
 * Deliberately a floor rather than the exact-equality check the review asked
 * for. Pinning the test to 6.2.5 exactly would go red on a routine Dependabot
 * bump to 6.2.6 — a green-to-red transition caused by taking a NEWER fix, which
 * is how a control gets deleted rather than updated. A floor encodes the thing
 * that actually matters: the advisory is fixed at 6.2.5, so 6.2.4 must fail and
 * 6.3.0 must pass. It still catches the case the review was aimed at, since any
 * 6.0.x or 6.1.x that slipped through would be below the floor.
 */
function atLeast(version: string, minimum: string): boolean {
  const parse = (v: string) => v.split("-")[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(version), parse(minimum)];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const [x, y] = [a[i] ?? 0, b[i] ?? 0];
    if (x !== y) return x > y;
  }
  return true;
}

// WorkOS signs its access tokens RS256, and `createRemoteJWKSet` fetches an RSA
// key set. Matching the algorithm matters: jose 6 tightened algorithm handling,
// so testing under HS256 would exercise a different code path than production.
const ALG = "RS256";

/**
 * A WorkOS access token as authkit destructures it. Every field named here is
 * one `session.js` actually pulls off the token (lines 149, 209, 305, 390), so
 * a claim that stopped surviving the round trip would be a real regression in
 * the signed-in header, roles, or entitlements — not a synthetic one.
 */
function workosShapedClaims() {
  return {
    sub: "user_01J000000000000000000000",
    sid: "session_01J111111111111111111111",
    org_id: "org_01J222222222222222222222",
    role: "member",
    roles: ["member", "billing"],
    permissions: ["widgets:read"],
    entitlements: ["early-access"],
    feature_flags: ["atlas-v2"],
  };
}

async function issuer() {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
  const jwk = await exportJWK(publicKey);
  // `kid` is what lets a key set with more than one key pick the right one,
  // which is the situation on a real WorkOS tenant mid key-rotation.
  jwk.kid = "test-key-1";
  jwk.alg = ALG;
  const jwks = { keys: [jwk] };

  async function sign(claims: Record<string, unknown>, expiresIn = "5m") {
    return await new SignJWT(claims)
      .setProtectedHeader({ alg: ALG, kid: "test-key-1" })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey);
  }

  return { sign, keySet: createLocalJWKSet(jwks), jwks };
}

test("the app resolves a PATCHED jose — otherwise this file tests the wrong library", () => {
  // Self-test the comparator first. Without this the assertion below could pass
  // because `atLeast` always returns true, which is the classic way a version
  // gate silently stops gating.
  assert.equal(atLeast("6.2.5", MINIMUM_PATCHED_JOSE), true, "6.2.5 meets the floor");
  assert.equal(atLeast("6.3.0", MINIMUM_PATCHED_JOSE), true, "a later 6.x meets it");
  assert.equal(atLeast("7.0.0", MINIMUM_PATCHED_JOSE), true, "a later major meets it");
  assert.equal(atLeast("6.2.4", MINIMUM_PATCHED_JOSE), false, "the patch below must fail");
  assert.equal(atLeast("6.1.9", MINIMUM_PATCHED_JOSE), false, "an earlier 6.x must fail");
  assert.equal(atLeast("5.10.0", MINIMUM_PATCHED_JOSE), false, "the vulnerable pin must fail");

  const version = resolvedJoseVersion();
  assert.equal(
    atLeast(version, MINIMUM_PATCHED_JOSE),
    true,
    `expected the pnpm override to resolve jose >= ${MINIMUM_PATCHED_JOSE}, got ${version}. ` +
      "If the override in pnpm-workspace.yaml was reverted or lost in a merge, " +
      "AIKIDO-2026-584205 is open again and every other assertion in this file is " +
      "testing the wrong library.",
  );
});

test("an access token signed with jose 6 verifies against its key set", async () => {
  const { sign, keySet } = await issuer();
  const token = await sign(workosShapedClaims());

  // This is `session.js:419` — `await jwtVerify(accessToken, JWKS())` — with a
  // local key set standing in for the remote one so the test needs no network.
  const { payload } = await jwtVerify(token, keySet);

  assert.equal(payload.sub, "user_01J000000000000000000000");
  assert.equal(payload.sid, "session_01J111111111111111111111");
});

test("every claim authkit destructures survives the round trip", async () => {
  const { sign } = await issuer();
  const claims = workosShapedClaims();
  const token = await sign(claims);

  // `decodeJwt` does not verify — that is exactly how authkit uses it, on a
  // token it has already verified or is about to refresh.
  const decoded = decodeJwt(token);

  for (const [key, expected] of Object.entries(claims)) {
    assert.deepEqual(
      decoded[key as keyof typeof decoded],
      expected,
      `claim '${key}' did not survive sign -> decode under jose ${resolvedJoseVersion()}`,
    );
  }
  assert.equal(typeof decoded.exp, "number", "exp is read at session.js:236 and :438");
  assert.equal(typeof decoded.iat, "number", "iat is read at session.js:438");
});

test("a tampered signature is REJECTED", async () => {
  const { sign, keySet } = await issuer();
  const token = await sign(workosShapedClaims());

  // Mutate the FIRST character of the signature, never the last.
  //
  // An RS256 signature is 256 bytes, and 256 = 3x85 + 1, so base64url encodes
  // the trailing byte in two characters: six significant bits, then two bits
  // plus FOUR UNUSED ONES. Characters differing only in those four bits decode
  // to identical bytes — 'A' and 'B' among them — so flipping the last
  // character leaves the signature unchanged about a quarter of the time, the
  // forged token verifies correctly, and `assert.rejects` fails. That is an
  // intermittent red build caused by the test, on a schedule nobody could
  // reproduce. Verified with Buffer.compare rather than reasoned about.
  //
  // The first character carries six significant bits of byte 0, so changing it
  // always changes the signature. (Caught by CodeRabbit on PR 682.)
  const [header, body, signature] = token.split(".");
  const firstChar = signature.slice(0, 1);
  const forged = `${header}.${body}.${firstChar === "A" ? "B" : "A"}${signature.slice(1)}`;
  assert.notEqual(forged, token, "the mutation must actually change the token");

  await assert.rejects(
    () => jwtVerify(forged, keySet),
    (error: unknown) => error instanceof joseErrors.JOSEError,
    "a forged signature must not verify — this is the whole point of the access token",
  );
});

test("an expired token is REJECTED", async () => {
  const { sign, keySet } = await issuer();
  // Negative lifetime: issued and already past its expiry.
  const token = await sign(workosShapedClaims(), "-1s");

  await assert.rejects(
    () => jwtVerify(token, keySet),
    (error: unknown) => error instanceof joseErrors.JWTExpired,
    "an expired access token must not verify, or a stale session never ends",
  );
});

test("a token signed by a DIFFERENT key is REJECTED", async () => {
  // The realistic attack the key set defends against: a well-formed, unexpired,
  // correctly-shaped token that simply was not signed by WorkOS.
  const mine = await issuer();
  const theirs = await issuer();
  const token = await theirs.sign(workosShapedClaims());

  await assert.rejects(
    () => jwtVerify(token, mine.keySet),
    (error: unknown) => error instanceof joseErrors.JOSEError,
    "a token from an unknown key must not verify against our key set",
  );
});

test("createRemoteJWKSet still has the shape session.js:19 constructs", () => {
  // Constructed exactly as authkit does, at module scope, with no fetch: jose 6
  // builds the resolver lazily, so this asserts the constructor survived the
  // major bump without reaching the network from a unit test.
  const remote = createRemoteJWKSet(new URL("https://api.workos.com/sso/jwks/client_test"));
  assert.equal(typeof remote, "function", "jwtVerify is called with this as its key argument");
});

test("authkit resolves the SAME jose install this file just tested", () => {
  // The assertion the version check cannot make on its own, and the reason this
  // test is not merely decorative.
  //
  // `apps/web` declares jose as a devDependency purely so this file can import
  // it — the app's own source imports jose nowhere. That creates a real trap: a
  // devDependency at 6.2.5 would let every assertion above pass against the
  // app's private copy while pnpm quietly handed authkit a nested jose 5, which
  // is the exact arrangement the override exists to prevent. The override would
  // then be cosmetic and the advisory still open, with a green suite over it.
  //
  // Comparing resolved paths is what closes that. pnpm's content-addressed
  // store gives one directory per (name, version), so identical paths means one
  // install, and a nested jose 5 under authkit would resolve somewhere else.
  // `import.meta.resolve`, not `require.resolve`, for authkit: its exports map
  // declares only "types" and "import" conditions, so a CJS-style resolve
  // throws ERR_PACKAGE_PATH_NOT_EXPORTED before it ever reaches jose.
  const authkitEntry = import.meta.resolve("@workos-inc/authkit-nextjs");
  const joseSeenByAuthkit = createRequire(authkitEntry).resolve("jose");
  const joseSeenByTheApp = require_.resolve("jose");

  assert.equal(
    joseSeenByAuthkit,
    joseSeenByTheApp,
    "authkit-nextjs resolved a DIFFERENT jose than this test verified. The " +
      "pnpm override is not reaching the package that actually validates the " +
      "session, so AIKIDO-2026-584205 is still open on the signed-in path.\n" +
      "\n" +
      "The usual cause is a version bump that moved one half of the control " +
      'and not the other. The two halves are the `jose@^5.0.0` override in ' +
      "`pnpm-workspace.yaml` and the `jose` devDependency in " +
      "`apps/web/package.json`. They must name the SAME version. Set both to " +
      "the higher of the two and re-install; do not silence this by relaxing " +
      "the assertion, which is the only thing standing between a split " +
      "resolution and a green suite over an open advisory.",
  );
});

test("a token signed through authkit's jose verifies through the app's jose", async () => {
  // Interop across the boundary the override is responsible for, loaded the way
  // authkit loads it rather than through this file's own import.
  //
  // Deliberately NOT authkit's `generateTestToken`: that helper is real but
  // unexported — `./testing` is absent from the exports map — so reaching it
  // would mean importing an internal dist path that a routine authkit bump can
  // move, and a control that breaks on unrelated upgrades gets deleted rather
  // than fixed. Resolving jose from authkit's own location tests the same thing
  // and only touches public resolution.
  const authkitEntry = import.meta.resolve("@workos-inc/authkit-nextjs");
  const joseForAuthkit = await import(
    pathToFileURL(createRequire(authkitEntry).resolve("jose")).href
  );

  const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "interop-key";
  jwk.alg = ALG;

  // Signed by the module instance authkit would use...
  const token = await new joseForAuthkit.SignJWT(workosShapedClaims())
    .setProtectedHeader({ alg: ALG, kid: "interop-key" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  // ...verified and decoded by this file's, which is the app's.
  const { payload } = await jwtVerify(token, createLocalJWKSet({ keys: [jwk] }));
  assert.equal(payload.sid, "session_01J111111111111111111111");
  assert.equal(decodeJwt(token).org_id, "org_01J222222222222222222222");
});
