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
  // A FLOOR, not an equality. The equality above already ties `item_count` to the
  // items actually present; a second literal only pinned the corpus size, and the
  // corpus is supposed to grow — so that literal failed on every intake and was
  // updated by whoever was blocked rather than by whoever decided the size. What
  // is worth failing on is the corpus *shrinking*, which is never accidental and
  // never harmless: it means records vanished from /repository.
  assert.ok(
    manifest.item_count >= 283,
    `the committed manifest carries ${manifest.item_count} records, fewer than the 283 this `
      + "guard was written against — records do not disappear by accident. Lower this floor only "
      + "with the deletion that justifies it.",
  );
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
