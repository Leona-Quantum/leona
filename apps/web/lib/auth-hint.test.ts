import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AUTH_HINT_COOKIE,
  AUTH_HINT_MAX_AGE_SECONDS,
  AUTH_HINT_SIGNED_IN,
  authHintCookieOptions,
} from "./auth-hint.ts";

/**
 * The auth hint is a contract between five files that cannot import each other's
 * intent (ai-ops issue 114):
 *
 *   - `app/layout.tsx` reads the cookie in an inline string of JavaScript, before
 *     any module system exists,
 *   - `app/auth/callback/route.ts` writes it when the session is created,
 *   - `app/api/auth/session/route.ts` writes it on every static page after that,
 *   - `app/auth/sign-out/route.ts` clears it,
 *   - `packages/ts/ui/styles.css` decides what the reader sees from it.
 *
 * Break the agreement in any one of them and nothing throws. The header simply
 * goes back to showing "Sign in" to signed-in readers on every page, which is
 * the bug this replaced and which no other test in this suite would notice —
 * the flash is correct HTML, correct CSS, and correct JavaScript that happen to
 * disagree about one string. So these assertions are deliberately literal.
 */

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(webRoot));

function read(...segments: string[]): string {
  return readFileSync(join(...segments), "utf8");
}

const layout = read(webRoot, "app", "layout.tsx");
const sessionRoute = read(webRoot, "app", "api", "auth", "session", "route.ts");
const signOutRoute = read(webRoot, "app", "auth", "sign-out", "route.ts");
const callbackRoute = read(webRoot, "app", "auth", "callback", "route.ts");
const authStatus = read(webRoot, "components", "auth-status.tsx");
const middleware = read(webRoot, "middleware.ts");
const styles = read(repoRoot, "packages", "ts", "ui", "styles.css");

test("the pre-paint script reads the same cookie the session route writes", () => {
  // The script is built by interpolating the constants, so what this really
  // catches is the interpolation being replaced by a hand-typed literal that
  // then drifts.
  assert.equal(AUTH_HINT_COOKIE, "mj_auth");
  assert.equal(AUTH_HINT_SIGNED_IN, "1");
  assert.match(layout, /authHintScript/);
  assert.match(layout, /AUTH_HINT_COOKIE/);
  assert.match(layout, /AUTH_HINT_SIGNED_IN/);
  assert.match(
    layout,
    /document\.documentElement\.dataset\.auth = signedIn \? "in" : "out"/,
  );
});

test("the script is rendered into <head>, where it runs before the first paint", () => {
  // Correct content in the wrong place is the failure mode with no symptom
  // other than the flash coming back: a script in <body> runs after the header
  // above it has already been painted from the wrong branch.
  const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
  assert.ok(
    head.includes("authHintScript"),
    "authHintScript must be inside <head>, not merely present in the layout",
  );
});

test("only uncacheable routes write the hint, and middleware never does", () => {
  // The load-bearing one. Vercel will not store a response carrying Set-Cookie,
  // so writing this cookie from middleware or a page render would drop every
  // public page out of the CDN — trading the cache for the flash rather than
  // fixing it. See the comment in `lib/auth-hint.ts`.
  assert.ok(
    !middleware.includes(AUTH_HINT_COOKIE) && !middleware.includes("auth-hint"),
    "middleware.ts must not touch the auth hint — a Set-Cookie there makes every public page uncacheable",
  );
  assert.match(sessionRoute, /export const dynamic = "force-dynamic"/);
  assert.match(sessionRoute, /Cache-Control": "private, no-store/);
  assert.match(sessionRoute, /cookies\.set\(\s*AUTH_HINT_COOKIE/);
  assert.match(sessionRoute, /cookies\.delete\(AUTH_HINT_COOKIE\)/);
});

test("the hint is readable by the pre-paint script and scoped to the whole site", () => {
  // httpOnly would make the cookie invisible to the one consumer it exists for.
  const options = authHintCookieOptions();
  assert.equal(options.httpOnly, false);
  assert.equal(options.path, "/");
  assert.equal(options.sameSite, "lax");
  assert.equal(options.maxAge, AUTH_HINT_MAX_AGE_SECONDS);
  assert.ok(AUTH_HINT_MAX_AGE_SECONDS > 0);
});

test("both writers go through the shared options, so they cannot drift apart", () => {
  // Two routes set this cookie now. Spelled out separately, a `path` that
  // differs between them yields TWO `mj_auth` cookies and the pre-paint script
  // reads whichever the browser happens to hand over first — a bug that appears
  // only for readers who have signed in twice, and never in a fresh profile.
  for (const [name, source] of [
    ["callback", callbackRoute],
    ["session", sessionRoute],
  ] as const) {
    assert.match(
      source,
      /authHintCookieOptions\(\)/,
      `${name} route must use the shared options rather than its own literals`,
    );
    assert.ok(
      !/httpOnly:\s*false/.test(source),
      `${name} route must not respell the cookie attributes`,
    );
  }
});

test("the callback writes the hint only on the success path", () => {
  // `onSuccess` is awaited only after `authenticateWithCode` returns tokens. A
  // callback that fails on a missing code, an unverifiable PKCE cookie or a
  // state mismatch returns through AuthKit's error path without reaching it.
  // Writing the hint anywhere less conditional would paint "Sign out" at a
  // reader who is not signed in — this bug inverted, and worse than the flash.
  assert.match(callbackRoute, /onSuccess:/);
  assert.match(callbackRoute, /cookies\(\)\)\.set\(AUTH_HINT_COOKIE, AUTH_HINT_SIGNED_IN/);
  const onSuccessAt = callbackRoute.indexOf("onSuccess:");
  const setAt = callbackRoute.indexOf("set(AUTH_HINT_COOKIE");
  assert.ok(
    onSuccessAt !== -1 && setAt > onSuccessAt,
    "the write must be inside onSuccess, not at module scope or on the response",
  );
  // The hint is a paint hint, never a gate: nothing in this route may read it
  // back to decide anything.
  assert.ok(
    !/cookies\(\)[\s\S]*\.get\(AUTH_HINT_COOKIE/.test(callbackRoute),
    "the callback must never read the hint — it authorises nothing",
  );
});

test("signing out clears the hint on both of its paths", () => {
  // Including the early return for a reader who is already signed out — that is
  // precisely the visitor holding a stale hint.
  assert.match(signOutRoute, /cookies\(\)\)\.delete\(AUTH_HINT_COOKIE\)/);
  const deleteAt = signOutRoute.indexOf("delete(AUTH_HINT_COOKIE)");
  const earlyReturnAt = signOutRoute.indexOf('if (!user) redirect("/")');
  assert.ok(deleteAt !== -1 && earlyReturnAt !== -1);
  assert.ok(
    deleteAt < earlyReturnAt,
    "the hint must be cleared before the early return, or a signed-out revisit keeps it",
  );
});

test("both controls are in the markup, so the cached HTML can serve either reader", () => {
  assert.match(authStatus, /data-auth-slot="in"/);
  assert.match(authStatus, /data-auth-slot="out"/);
  assert.match(authStatus, /href="\/auth\/sign-out"/);
  assert.match(authStatus, /href="\/run"/);
});

test("the stylesheet defaults to the signed-out control when the attribute is absent", () => {
  // JavaScript off, cookies refused, or the script not yet run all land here,
  // and all three must see what the server actually rendered rather than a
  // header with both controls in it or none.
  assert.match(styles, /\.mj-auth-slot\s*\{\s*display: contents;\s*\}/);
  assert.match(
    styles,
    /html\[data-auth="in"\] \.mj-auth-slot\[data-auth-slot="out"\]/,
  );
  assert.match(
    styles,
    /html:not\(\[data-auth="in"\]\) \.mj-auth-slot\[data-auth-slot="in"\]/,
  );
});
