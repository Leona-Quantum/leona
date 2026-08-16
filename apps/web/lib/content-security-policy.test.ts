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
  //
  // Sourcery asked on PR 676 (numbered without a hash on purpose — see
  // `check-raw-hex`) for this to be relaxed into per-directive assertions,
  // because an exact string makes "benign reordering" fail. Declined, and the
  // reason is the reason it was written this way before this PR: in a security
  // header there is no benign reordering. `'unsafe-inline'` moving between
  // `style-src` and `style-src-elem`, or a hash appearing beside it, changes
  // what the browser enforces while every per-directive assertion still passes.
  // The parsed-directive helpers below exist for the questions that genuinely
  // are about one directive; this assertion is the control that nothing else
  // moved while they were satisfied.
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

const styleSrcElemOf = (policy: string) =>
  policy.split("; ").find((d) => d.startsWith("style-src-elem ")) ?? "";

test("only production gets the hashed style-src-elem; dev and preview inject unhashable CSS", () => {
  // `next dev` injects CSS as <style> elements for hot reload and the error
  // overlay. Vercel injects `vercel.live/_next-live/feedback/feedback.js` into
  // every PREVIEW deployment — the widget a change gets reviewed with — and it
  // writes its own. Six of them on `/pricing`, measured on a preview of the
  // branch that added this directive, with no toolbar cookie set. Neither set is
  // hashable and neither exists in a production build, so both open the
  // directive and production alone closes it.
  assert.match(styleSrcElemOf(contentSecurityPolicy({ ...PRODUCTION, development: true })), /'unsafe-inline'/);
  assert.match(styleSrcElemOf(contentSecurityPolicy({ ...PRODUCTION, vercelToolbar: true })), /'unsafe-inline'/);
  assert.doesNotMatch(styleSrcElemOf(contentSecurityPolicy(PRODUCTION)), /'unsafe-inline'/);
});

test("wherever style-src-elem opens, it carries no hash — or the 'unsafe-inline' is dead", () => {
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
  for (const [name, environment] of [
    ["development", { ...PRODUCTION, development: true }],
    ["preview", { ...PRODUCTION, vercelToolbar: true }],
  ] as const) {
    const directive = styleSrcElemOf(contentSecurityPolicy(environment));
    assert.ok(directive, `${name} must still emit style-src-elem`);
    assert.ok(
      !directive.includes("sha256-"),
      `${name}'s style-src-elem must carry no hash, or the 'unsafe-inline' beside it does ` +
        `nothing: ${directive}`,
    );
    assert.ok(directive.includes("'unsafe-inline'"));
  }

  // The mirror of it: production carries the hash and no `'unsafe-inline'`, so
  // there is nothing for the hash to cancel there.
  //
  // The corollary is a fact about how to VERIFY this directive, and it is
  // asserted here rather than left in a comment because it is the thing most
  // likely to be got wrong next: since preview opens the directive, a preview
  // URL does not exercise production's `style-src-elem` at all. Checking a
  // change to it means a local production build, not a preview link.
  const produced = styleSrcElemOf(contentSecurityPolicy(PRODUCTION));
  assert.ok(produced.includes("sha256-"));
  assert.ok(!produced.includes("'unsafe-inline'"));
});

test("the hashed stylesheet is the one the 404 page actually renders", () => {
  // The load-bearing check, and the only one that can catch the failure mode
  // that matters here. A hash is taken over exact bytes: if `app/not-found.tsx`
  // ever goes back to defining its own CSS string, the policy keeps hashing this
  // module's copy, the two drift, and the 404 page renders with its
  // language-switching rules refused — showing the reader the English and the
  // Japanese copy stacked. It does not error, and nothing else here loads a 404.
  // Reading the page's SOURCE, rather than importing it and asserting on an
  // exported contract, is deliberate — Sourcery raised the alternative on
  // PR 676 (numbered without a hash, because `check-raw-hex` reads a
  // three-digit hash-number as a colour). The failure this guards is somebody
  // re-inlining a second copy of the CSS into the page, and a copy renders
  // perfectly well through any exported contract you could test against. The
  // text of the file is the only place that divergence is visible.
  // `lib/html-injection-surface.test.ts` reads source by path for the same
  // reason.
  //
  // The import is matched loosely — the constant's NAME and module, not an
  // exact relative path — so moving the page or adding a second named import
  // does not fail this for a reason that has nothing to do with the hash.
  const page = readFileSync(join(webRoot, "app", "not-found.tsx"), "utf8");
  assert.match(
    page,
    /import \{[^}]*\bNOT_FOUND_LOCALE_STYLE\b[^}]*\} from "[^"]*not-found-style\.ts";/,
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
