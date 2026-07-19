// Integrity guard for the COMMITTED bootstrap manifest (ADR-0019, Slice A).
// Run: node --test scripts/catalog-bootstrap/manifest-committed.test.mjs
//
// This does not regenerate from the TS source (that is the generator's
// `--check` mode, which needs esbuild); it asserts the committed artifact is
// self-consistent, so a hand-edit or a corrupt row is caught in CI regardless
// of the source tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyChecksum, findHashMismatches } from "./manifest-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST_PATH = join(root, "services/api/catalog_bootstrap/manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

test("committed manifest has the expected shape and pinned count", () => {
  assert.equal(manifest.manifest_schema_version, 1);
  assert.equal(manifest.ordering, "slug-asc");
  assert.equal(manifest.item_count, manifest.items.length);
  // The validated public catalog is 285 records (scripts/check-repository-data.mjs).
  assert.equal(manifest.item_count, 285);
  assert.match(manifest.source_commit, /^[0-9a-f]{40}$/);
});

test("committed manifest whole-checksum verifies", () => {
  assert.equal(verifyChecksum(manifest).ok, true);
});

test("every committed item hash matches its embedded blob (no drift/corruption)", () => {
  assert.deepEqual(findHashMismatches(manifest), []);
});

test("committed items are unique and slug-ascending", () => {
  const slugs = manifest.items.map((i) => i.upstream_identity);
  assert.equal(new Set(slugs).size, slugs.length, "slugs must be unique");
  const sorted = [...slugs].sort();
  assert.deepEqual(slugs, sorted, "items must be stored slug-ascending");
});
