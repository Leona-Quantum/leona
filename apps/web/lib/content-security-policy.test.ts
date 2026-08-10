import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("Atlas navigation motion is disabled on the authenticated workspace", () => {
  const appLayout = readFileSync(
    new URL("../app/(app)/layout.tsx", import.meta.url),
    "utf8",
  );
  const sharedStyles = readFileSync(
    new URL("../../../packages/ts/ui/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(
    sharedStyles,
    /@view-transition\s*{\s*navigation:\s*auto;\s*}/,
    "the shared Atlas stylesheet no longer declares the opt-in guarded here",
  );
  assert.match(
    appLayout,
    /<style>\{"@view-transition \{ navigation: none; \}"}<\/style>/,
    "authenticated routes must override the document-wide Atlas transition",
  );
});
