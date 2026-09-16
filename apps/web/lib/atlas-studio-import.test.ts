import assert from "node:assert/strict";
import test from "node:test";

import { atlasStudioImportHref, atlasStudioSignInHref, importedArtifactHref } from "./atlas-studio-import.ts";

test("a signed-in reader's import lands on the new artifact, and the import route carries the slug", () => {
  assert.equal(importedArtifactHref("01a0ab5c"), "/studio?artifact=01a0ab5c");
  assert.equal(atlasStudioImportHref("grover-unstructured-search"), "/studio?atlas=grover-unstructured-search");
  const odd = "a b&c=d";
  const parsed = new URL(atlasStudioImportHref(odd), "https://leonaqt.test");
  assert.equal(parsed.pathname, "/studio");
  assert.equal(parsed.searchParams.get("atlas"), odd);
});

// Asserts on where the link GOES, decoded, rather than on a substring: the bug
// this guards against rendered a real sign-in link to the wrong place, which a
// presence check would have passed (PR 896 had the same shape).
test("a signed-out reader signs in and comes back to the import, not to /run", () => {
  for (const slug of ["grover-unstructured-search", "shor-order-finding", "a b&c=d"]) {
    const href = atlasStudioSignInHref(slug);
    const url = new URL(href, "https://leonaqt.test");
    assert.equal(url.pathname, "/auth/sign-in", href);
    const returnTo = url.searchParams.get("returnTo");
    assert.notEqual(returnTo, "/run", `returnTo fell back to /run for ${slug}`);
    assert.equal(returnTo, atlasStudioImportHref(slug), `returnTo must be exactly the import link for ${slug}`);
    assert.equal(new URL(returnTo ?? "", "https://leonaqt.test").searchParams.get("atlas"), slug);
  }
});
