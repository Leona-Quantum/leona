import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contentSecurityPolicy,
  errorReportingOrigin,
} from "./content-security-policy.ts";

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

  // Production is byte-identical to the policy that shipped before the toolbar
  // parameter existed — the widening is additive or it is a regression.
  assert.equal(
    production,
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; font-src 'self' data:; " +
      "connect-src 'self' https://api.example.test; object-src 'none'; base-uri 'self'; " +
      "form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  );

  // Clickjacking protection is not a thing the toolbar gets to relax.
  assert.match(preview, /frame-ancestors 'none'/);
});
