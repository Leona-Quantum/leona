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
  });
  const production = contentSecurityPolicy({
    controlPlane: "https://api.example.test",
    development: false,
    errorReporting: null,
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

test("no DSN adds no host, and a malformed DSN does not fail the build", () => {
  assert.equal(errorReportingOrigin(undefined), null);
  assert.equal(errorReportingOrigin(""), null);
  assert.equal(errorReportingOrigin("not a url"), null);

  const withoutSentry = contentSecurityPolicy({
    controlPlane: "https://api.example.test",
    development: false,
    errorReporting: errorReportingOrigin(undefined),
  });
  assert.match(withoutSentry, /connect-src 'self' https:\/\/api\.example\.test;/);
  assert.doesNotMatch(withoutSentry, /sentry\.io/);
});
