import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  contentSecurityPolicy,
  errorReportingOrigin,
  inlineHash,
} from "./content-security-policy.ts";
import { NOT_FOUND_LOCALE_STYLE } from "./not-found-style.ts";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const PRODUCTION = {
  controlPlane: "https://api.example.test",
  development: false,
  errorReporting: null,
  vercelToolbar: false,
} as const;

const DSN =
  "https://3465b040eb85179bc9ab59e3a775516c@o4511708586901504.ingest.us.sentry.io/4511711999164416";

test("development permits React's debugging eval without weakening production", () => {
  const development = contentSecurityPolicy({
    controlPlane: "http://localhost:8000",
    development: true,
    errorReporting: null,
    vercelToolbar: false,
  });
  const production = contentSecurityPolicy({
    controlPlane: "https://api.example.test",
    development: false,
    errorReporting: null,
    vercelToolbar: false,
  });

  assert.match(development, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  assert.doesNotMatch(production, /unsafe-eval/);
  assert.match(production, /upgrade-insecure-requests/);
  assert.doesNotMatch(development, /upgrade-insecure-requests/);
});

test("connect-src names the Sentry ingest origin, or the browser SDK reports nothing", () => {
  const origin = errorReportingOrigin(DSN);
  assert.equal(origin, "https://o4511708586901504.ingest.us.sentry.io");

  const withSentry = contentSecurityPolicy({
    controlPlane: "https://api.example.test",
    development: false,
    errorReporting: origin,
    vercelToolbar: false,
  });

  // The failing arm: without this the browser refuses every envelope POST with
  // a CSP violation and Sentry stays empty, which looks exactly like no errors.
  assert.match(
    withSentry,
    /connect-src 'self' https:\/\/api\.example\.test https:\/\/o4511708586901504\.ingest\.us\.sentry\.io;/,
  );

  // The control: nothing else in the policy loosened to get there, and the DSN's
  // public key never reaches a response header.
  assert.doesNotMatch(withSentry, /3465b040eb85179bc9ab59e3a775516c/);
  assert.match(withSentry, /default-src 'self';/);
  assert.match(withSentry, /object-src 'none';/);
});

test("a mis-set DSN cannot widen connect-src to an arbitrary host", () => {
  // Each of these parses as a URL, so the only thing stopping it becoming an
  // allowed exfiltration target is the scheme and host check.
  assert.equal(errorReportingOrigin("https://key@evil.example.com/1"), null);
  assert.equal(errorReportingOrigin("http://key@o1.ingest.us.sentry.io/1"), null);
  assert.equal(errorReportingOrigin("https://key@notsentry.io/1"), null);
  assert.equal(errorReportingOrigin("https://key@sentry.io.evil.com/1"), null);
  // …and the shapes that must still work.
  assert.equal(errorReportingOrigin(DSN), "https://o4511708586901504.ingest.us.sentry.io");
  assert.equal(errorReportingOrigin("https://k@sentry.io/1"), "https://sentry.io");
});

test("no DSN adds no host, and a malformed DSN does not fail the build", () => {
  assert.equal(errorReportingOrigin(undefined), null);
  assert.equal(errorReportingOrigin(""), null);
  assert.equal(errorReportingOrigin("not a url"), null);

  const withoutSentry = contentSecurityPolicy({
    controlPlane: "https://api.example.test",
    development: false,
    errorReporting: errorReportingOrigin(undefined),
    vercelToolbar: false,
  });
  assert.match(withoutSentry, /connect-src 'self' https:\/\/api\.example\.test;/);
  assert.doesNotMatch(withoutSentry, /sentry\.io/);
});

test("the Vercel Toolbar's six origins reach preview and never production", () => {
  const base = { controlPlane: "https://api.example.test", development: false, errorReporting: null };
  const preview = contentSecurityPolicy({ ...base, vercelToolbar: true });
  const production = contentSecurityPolicy({ ...base, vercelToolbar: false });

  // Preview gets every directive the toolbar documents. Anything short of all
  // six and the toolbar half-loads, which is worse than declining it outright:
  // the console fills with a *different* violation and the feature still fails.
  assert.match(preview, /script-src [^;]*https:\/\/vercel\.live/);
  assert.match(preview, /connect-src [^;]*https:\/\/vercel\.live wss:\/\/ws-us3\.pusher\.com/);
  assert.match(preview, /img-src [^;]*https:\/\/vercel\.live https:\/\/vercel\.com/);
  assert.match(preview, /font-src [^;]*https:\/\/vercel\.live https:\/\/assets\.vercel\.com/);
  assert.match(preview, /style-src [^;]*https:\/\/vercel\.live/);
  assert.match(preview, /frame-src https:\/\/vercel\.live/);

  // The one that actually matters. `vercel.live` must not appear anywhere in the
  // production policy — not in one directive, not in six. This is the assertion
  // that fails if someone later "fixes" the owner's console message by widening
  // production instead of clearing the cookie that triggers it.
  assert.doesNotMatch(production, /vercel\.live/);
  assert.doesNotMatch(production, /pusher\.com/);
  assert.doesNotMatch(production, /frame-src/);

  // The production policy in full, pinned as an exact string so that any change
  // to it is a decision somebody wrote down rather than a side effect.
  //
  // It last changed when `script-src-attr`, `style-src-elem` and `style-src-attr`
  // were added. The toolbar widening remains additive to this — additive or it
  // is a regression.
  assert.equal(
    production,
    "default-src 'self'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "style-src-elem 'self' 'sha256-hl9qK6CxELuy3YEmCQFOW8oFkndsA/kDC9kyF0oQVXw='; " +
      "style-src-attr 'unsafe-inline'; " +
      "img-src 'self' data: blob:; font-src 'self' data:; " +
      "connect-src 'self' https://api.example.test; object-src 'none'; base-uri 'self'; " +
      "form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  );

  // Clickjacking protection is not a thing the toolbar gets to relax.
  assert.match(preview, /frame-ancestors 'none'/);
});

test("inline event handler attributes are refused on every environment", () => {
  // `script-src-attr` does NOT inherit from `script-src` when it is present, so
  // this is enforced even though `script-src` still carries `'unsafe-inline'`
  // for Next's streaming payload. That is the whole point of the directive being
  // here: `<img onerror=…>` is refused on a page whose `script-src` would
  // otherwise admit it.
  //
  // Every environment, deliberately. React attaches listeners from the bundle
  // and emits no handler attributes, so there is no arm — development, preview
  // or production — that needs this open, and an exception is how one arrives.
  for (const environment of [
    PRODUCTION,
    { ...PRODUCTION, development: true },
    { ...PRODUCTION, vercelToolbar: true },
  ]) {
    assert.match(contentSecurityPolicy(environment), /script-src-attr 'none'/);
  }
});

test("an injected <style> element is refused, while inline style attributes still work", () => {
  const production = contentSecurityPolicy(PRODUCTION);

  // The one inline stylesheet this app serves, named by its hash. Asserted with
  // a substring rather than a regex on purpose: a base64 digest contains `/` and
  // `+`, and escaping those into a pattern is a way to write a test that passes
  // for the wrong reason.
  assert.ok(
    production.includes(`style-src-elem 'self' ${inlineHash(NOT_FOUND_LOCALE_STYLE)};`),
    `style-src-elem must name the 404 stylesheet by hash; policy was: ${production}`,
  );
  // The failing arm, and the reason the directive is worth adding at all: an
  // inline <style> that is NOT that one has nothing to match. A browser ignores
  // `'unsafe-inline'` in a directive that also carries a hash, but this policy
  // does not rely on that subtlety — the token is simply absent.
  assert.doesNotMatch(production, /style-src-elem [^;]*'unsafe-inline'/);

  // Inline style ATTRIBUTES stay open. 72 components position with `style={{…}}`
  // and KaTeX emits one per glyph; closing this blanks the Atlas map and
  // scrambles every rendered formula.
  assert.match(production, /style-src-attr 'unsafe-inline'/);

  // And the legacy fallback is untouched, so a browser that knows neither of the
  // two directives above gets exactly the policy that shipped before them rather
  // than a broken page.
  assert.match(production, /style-src 'self' 'unsafe-inline';/);
});

test("the dev server's hot-reload stylesheets are admitted, and only there", () => {
  // `next dev` injects CSS as <style> elements for hot reload and for the error
  // overlay. Neither is hashable and neither exists in a production build, so
  // development opens `style-src-elem` and nothing else does.
  const development = contentSecurityPolicy({ ...PRODUCTION, development: true });
  assert.match(development, /style-src-elem [^;]*'unsafe-inline'/);
  assert.doesNotMatch(contentSecurityPolicy(PRODUCTION), /style-src-elem [^;]*'unsafe-inline'/);
  assert.doesNotMatch(
    contentSecurityPolicy({ ...PRODUCTION, vercelToolbar: true }),
    /style-src-elem [^;]*'unsafe-inline'/,
  );
});

test("development's style-src-elem carries no hash, or its 'unsafe-inline' is dead", () => {
  // The trap this pins, which is a CSP rule and not a preference: a directive
  // that lists a hash IGNORES `'unsafe-inline'` entirely. So `'self' <hash>
  // 'unsafe-inline'` is not the permissive union it reads as — it is the hash,
  // alone, and every other inline stylesheet is refused.
  //
  // This is a regression test rather than a precaution. That exact list was
  // written first, and Chrome refused the dev server's own stylesheet on
  // `next dev` with "Note that 'unsafe-inline' is ignored if either a hash or
  // nonce value is present in the source list". A developer would have seen
  // hot reload stop applying CSS and had nothing pointing here.
  const development = contentSecurityPolicy({ ...PRODUCTION, development: true });
  const styleSrcElem = development.split("; ").find((d) => d.startsWith("style-src-elem "));

  assert.ok(styleSrcElem, "development must still emit style-src-elem");
  assert.ok(
    !styleSrcElem.includes("sha256-"),
    `development's style-src-elem must carry no hash, or the 'unsafe-inline' beside it does ` +
      `nothing: ${styleSrcElem}`,
  );
  assert.ok(styleSrcElem.includes("'unsafe-inline'"));

  // The mirror of it: production carries the hash and no `'unsafe-inline'`, so
  // there is nothing for the hash to cancel there.
  const styleSrcElemProd = contentSecurityPolicy(PRODUCTION)
    .split("; ")
    .find((d) => d.startsWith("style-src-elem "));
  assert.ok(styleSrcElemProd?.includes("sha256-"));
  assert.ok(!styleSrcElemProd?.includes("'unsafe-inline'"));
});

test("the hashed stylesheet is the one the 404 page actually renders", () => {
  // The load-bearing check, and the only one that can catch the failure mode
  // that matters here. A hash is taken over exact bytes: if `app/not-found.tsx`
  // ever goes back to defining its own CSS string, the policy keeps hashing this
  // module's copy, the two drift, and the 404 page renders with its
  // language-switching rules refused — showing the reader the English and the
  // Japanese copy stacked. It does not error, and nothing else here loads a 404.
  const page = readFileSync(join(webRoot, "app", "not-found.tsx"), "utf8");
  assert.match(
    page,
    /import \{ NOT_FOUND_LOCALE_STYLE \} from "\.\.\/lib\/not-found-style\.ts";/,
    "app/not-found.tsx must import the constant the CSP hashes, not carry its own copy",
  );
  assert.match(
    page,
    /dangerouslySetInnerHTML=\{\{ __html: NOT_FOUND_LOCALE_STYLE \}\}/,
    "the inline <style> must render exactly the hashed constant",
  );

  // The digest itself, pinned against the bytes leonaqt.com served on
  // 2026-08-16 — hashing the live page's <style> body gave this same value, so
  // the derivation matches what a browser computes rather than merely being
  // self-consistent.
  assert.equal(inlineHash(NOT_FOUND_LOCALE_STYLE), "'sha256-hl9qK6CxELuy3YEmCQFOW8oFkndsA/kDC9kyF0oQVXw='");
});
