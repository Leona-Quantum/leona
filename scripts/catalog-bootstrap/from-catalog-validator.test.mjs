// Slice D guard: the web-side validation boundary must accept every record the
// API can actually serve.
// Run: node --test scripts/catalog-bootstrap/from-catalog-validator.test.mjs
//
// apps/web/lib/repository/from-catalog.ts narrows the untyped
// `PublicCatalogEntry.record` blob before /repository renders it. If it is
// stricter than the corpus, the public site silently empties the moment
// MAJORANA_PUBLIC_CATALOG_API flips on — a failure that no type check can catch,
// because `record` is `dict[str, Any]` by contract on the API side.
//
// The committed manifest's `source_blob` is the canonical JSON of each entry, and
// the API decodes exactly those bytes back into `record` (see
// services/api/src/majorana_api/catalog_read_model.py). Validating the blobs here
// therefore tests the real production payload, not a fixture.
//
// esbuild is required because Node cannot import .ts directly — same trick, and
// the same borrowed resolution root, as the generator.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(root, "services/api/catalog_bootstrap/manifest.json"), "utf8"));

async function loadValidator() {
  const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
  const esbuild = require("esbuild");
  const outDir = mkdtempSync(join(tmpdir(), "from-catalog-"));
  const outFile = join(outDir, "from-catalog.mjs");
  try {
    await esbuild.build({
      entryPoints: [join(root, "apps/web/lib/repository/from-catalog.ts")],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: outFile,
      logLevel: "silent",
    });
    return await import(pathToFileURL(outFile).href);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const { parseCatalogRecord, parseCatalogEntries } = await loadValidator();

test("the validator accepts every record in the pinned manifest", () => {
  assert.equal(manifest.items.length, 283);
  const rejected = manifest.items
    .filter((item) => parseCatalogRecord(JSON.parse(item.source_blob)) === null)
    .map((item) => item.upstream_identity);
  assert.deepEqual(rejected, [], "these records would vanish from /repository once the flag flips");
});

test("parseCatalogEntries handles a full API-shaped payload", () => {
  const payload = manifest.items.map((item) => ({
    slug: item.upstream_identity,
    record: JSON.parse(item.source_blob),
  }));
  const { entries, rejected } = parseCatalogEntries(payload);
  assert.deepEqual(rejected, []);
  assert.equal(entries.length, 283);
});

test("a null record is rejected rather than rendered", () => {
  // The API declares `record` nullable and returns null for an absent,
  // oversized, or unparseable blob — that must not reach the UI as an entry.
  const { entries, rejected } = parseCatalogEntries([{ slug: "nulled", record: null }]);
  assert.deepEqual(entries, []);
  assert.deepEqual(rejected, ["nulled"]);
});

test("a record with a corrupted closed-vocabulary field is rejected", () => {
  const good = JSON.parse(manifest.items[0].source_blob);
  assert.equal(parseCatalogRecord({ ...good, category: "not-a-category" }), null);
  assert.equal(parseCatalogRecord({ ...good, framework: "NotAFramework" }), null);
  assert.notEqual(parseCatalogRecord(good), null);
});
