import assert from "node:assert/strict";
import { test } from "node:test";

import { contentSecurityPolicy } from "./content-security-policy.ts";

test("development permits React's debugging eval without weakening production", () => {
  const development = contentSecurityPolicy({
    controlPlane: "http://localhost:8000",
    development: true,
  });
  const production = contentSecurityPolicy({
    controlPlane: "https://api.example.test",
    development: false,
  });

  assert.match(development, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  assert.doesNotMatch(production, /unsafe-eval/);
  assert.match(production, /upgrade-insecure-requests/);
  assert.doesNotMatch(development, /upgrade-insecure-requests/);
});
