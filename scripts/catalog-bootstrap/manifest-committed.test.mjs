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
  // Shrinkage is checked by IDENTITY, not by count — see the test below. A count
  // floor cannot see it: drop one record from 295 and `item_count` is 294, which
  // clears any floor written before the intake that added it. Every other count
  // assertion in this file and its neighbours derives from this same manifest, so
  // a deleted record takes its own expected value down with it and they all stay
  // green together.
  assert.ok(manifest.item_count > 0, "the committed manifest carries no records at all");
  assert.match(manifest.source_commit, /^[0-9a-f]{40}$/);
});

test("every identity the corpus has ever published is still in the manifest", () => {
  // The guard the count assertions cannot be: identities, not totals. `corpus-baseline.json`
  // grows on intake and only ever loses a line in the same commit that removes the record,
  // where a reviewer sees the deletion and the justification together.
  const baseline = JSON.parse(
    readFileSync(join(root, "scripts/catalog-bootstrap/corpus-baseline.json"), "utf8"),
  );
  assert.equal(baseline.identityCount, baseline.identities.length);
  const present = new Set(manifest.items.map((item) => item.upstream_identity));
  const missing = baseline.identities.filter((identity) => !present.has(identity));
  assert.deepEqual(
    missing,
    [],
    "these records were published and are no longer in the manifest — if the removal is "
      + "deliberate, delete them from corpus-baseline.json in the same commit",
  );
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
