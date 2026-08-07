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

async function loadModule(relPath) {
  const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
  const esbuild = require("esbuild");
  const outDir = mkdtempSync(join(tmpdir(), "from-catalog-"));
  const outFile = join(outDir, "bundle.mjs");
  try {
    await esbuild.build({
      entryPoints: [join(root, relPath)],
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

const loadValidator = () => loadModule("apps/web/lib/repository/from-catalog.ts");

const { parseCatalogRecord, parseCatalogEntries, parseCatalogListRecord, parseCatalogListEntries } =
  await loadValidator();

// The web side's list-field tuple, read as a VALUE. `PublicRepositoryListEntry`
// is a `Pick<>` derived from it, and a Pick union does not survive to runtime —
// which is exactly why the two copies of this list could never be compared
// before it was reified.
const { PUBLIC_REPOSITORY_LIST_FIELDS: listFields } = await loadModule(
  "apps/web/lib/repository/types.ts",
);
assert.ok(
  Array.isArray(listFields) && listFields.length >= 20,
  "PUBLIC_REPOSITORY_LIST_FIELDS did not load as a populated array",
);

// The list-projection field set, read out of the Python source that actually
// performs the projection. Parsed rather than duplicated: a copy kept here by
// hand would be a THIRD copy, and would agree with whichever one it was typed
// from forever.
function apiListViewFields() {
  const source = readFileSync(
    join(root, "services/api/src/majorana_api/catalog_read_model.py"),
    "utf8",
  );
  const marker = "LIST_VIEW_RECORD_FIELDS: frozenset[str] = frozenset(";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} not found — the allowlist moved or was renamed`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  assert.ok(open !== -1 && close > open, "could not find the frozenset literal's braces");
  // Strip Python comments before extracting literals, so a `#` line that
  // happens to quote something cannot be read as a member.
  const body = source
    .slice(open + 1, close)
    .split("\n")
    .map((line) => line.split("#")[0])
    .join("\n");
  const fields = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  // A parse that silently returns nothing would make every assertion below
  // vacuous. This corpus has ~24 list fields; anything under 20 means the
  // extraction broke, not that the allowlist shrank by half.
  assert.ok(
    fields.length >= 20,
    `parsed only ${fields.length} fields out of the Python allowlist — the extraction is broken, not the allowlist`,
  );
  return new Set(fields);
}

// THE GUARD. apps/web/lib/repository/types.ts's PUBLIC_REPOSITORY_LIST_FIELDS
// and the API's LIST_VIEW_RECORD_FIELDS are the same list written twice, in two
// languages, in two services. Nothing else compares them.
//
// Both of the API's own assertions are SUBSET checks —
// `set(projected).issubset(LIST_VIEW_RECORD_FIELDS)` and `<=` — so they are
// structurally incapable of reporting a field that is missing from the
// allowlist. They pass whether the set has 24 members or 2.
//
// And the failure they cannot see is invisible in every environment a developer
// looks at: with MAJORANA_PUBLIC_CATALOG_API off, getRepositoryListEntries
// returns the full static corpus, so local dev, preview and manual QA all
// render the field correctly. The detail page fetches `view=full` and is never
// projected, so entry pages render it too. The ONLY surface that loses it is
// the production browse list against a HEALTHY API.
//
// `topics` is the precedent: it had to be added here in PR 264 and its absence
// would have removed the topic filter and every role chip with nothing in the
// payload saying so.
test("the web's list projection and the API's allowlist are the same set", () => {
  const web = new Set(listFields);
  const api = apiListViewFields();

  const missingFromApi = [...web].filter((f) => !api.has(f)).sort();
  const missingFromWeb = [...api].filter((f) => !web.has(f)).sort();

  assert.deepEqual(
    missingFromApi,
    [],
    "PublicRepositoryListEntry picks these, and LIST_VIEW_RECORD_FIELDS drops them: " +
      "the production browse list will not carry them, and no other check will say so",
  );
  assert.deepEqual(
    missingFromWeb,
    [],
    "the API serves these on the browse list and PublicRepositoryListEntry does not pick them: " +
      "bytes over the 2 MB data-cache ceiling for nothing",
  );
});

// The live guard, exercised against real records for the first time.
//
// parseCatalogListRecord — not parseCatalogRecord — is what stands between the
// API and every visitor to /repository. It was previously tested against no
// real record anywhere: the tests above import only the full parser, which
// guards getRepositoryEntries, and that function has no callers at all.
test("the list guard accepts every real record after projection", () => {
  const api = apiListViewFields();
  const projected = manifest.items.map((item) => {
    const record = JSON.parse(item.source_blob);
    // Exactly what project_record_for_list_view does: intersection, never
    // filling in defaults — an absent key stays absent rather than arriving null.
    return {
      slug: item.upstream_identity,
      record: Object.fromEntries(Object.entries(record).filter(([key]) => api.has(key))),
    };
  });

  const rejected = projected
    .filter((row) => parseCatalogListRecord(row.record) === null)
    .map((row) => row.slug);
  assert.deepEqual(
    rejected,
    [],
    "these records would vanish from the browse list while their detail pages still render",
  );

  const parsed = parseCatalogListEntries(projected);
  assert.deepEqual(parsed.rejected, []);
  assert.equal(parsed.entries.length, 283);
});

test("the list guard rejects a corrupted closed-vocabulary field", () => {
  // Proves the guard above can fail. A validator that accepts everything would
  // pass the projection test forever.
  const api = apiListViewFields();
  const good = Object.fromEntries(
    Object.entries(JSON.parse(manifest.items[0].source_blob)).filter(([key]) => api.has(key)),
  );
  assert.notEqual(parseCatalogListRecord(good), null);
  assert.equal(parseCatalogListRecord({ ...good, category: "not-a-category" }), null);
  assert.equal(parseCatalogListRecord({ ...good, topics: "optimization" }), null);
});

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

// --- What the browse list must still be able to derive ----------------------

const { deriveInterface } = await loadModule("apps/web/lib/repository/interface.ts");

/** Exactly what `project_record_for_list_view` does: intersection, no defaults. */
function projectForList(record, allowed) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowed.has(key)));
}

function stanceOf(record) {
  return deriveInterface({
    slug: record.slug,
    topics: record.topics ?? [],
    category: record.category,
    wireCount: record.visualization?.wires?.length ?? 0,
    portableCircuit: record.portableCircuit,
    knownGaps: record.knownGaps,
  }).stance;
}

// The invariant lib/repository/interface.ts's header claims and nothing checked:
// "every input this module reads is already in the browse-list projection".
//
// It is not a claim about a list of field names — it is a claim about behaviour,
// so it is tested as one: derive every record's stance twice, once from the full
// record and once from the projected one, and require the two censuses to be
// identical. A field the derivation reads and the allowlist drops shows up here
// as a stance that changes, whatever the field is called and whichever of the
// two allowlists lost it. A name-list assertion would be a third hand-maintained
// copy and would pass if both allowlists were edited together.
//
// `knownGaps` is why this exists now. It decides `declared-hole` vs
// `undeclared`, and dropping it does not blank a chip — it silently reclassifies
// every record that names a hole in its source as one that never described an
// interface, in the one view a reader uses to find them, and only in production
// against a healthy API.
test("the browse list derives the same interface stance as the entry page", () => {
  const allowed = apiListViewFields();
  const disagreed = [];
  for (const item of manifest.items) {
    const record = JSON.parse(item.source_blob);
    const full = stanceOf(record);
    const listed = stanceOf(projectForList(record, allowed));
    if (full !== listed) disagreed.push(`${item.upstream_identity}: ${full} → ${listed}`);
  }
  assert.deepEqual(
    disagreed,
    [],
    "the list projection drops a field deriveInterface reads: these records take one stance on " +
      "their entry page and another in the browse list, in production only",
  );

  // Not vacuous: the corpus must actually exercise the field this guards. If
  // every record derived the same stance either way for want of any gap data,
  // the assertion above would hold forever while proving nothing.
  const holes = manifest.items.filter(
    (item) => stanceOf(JSON.parse(item.source_blob)) === "declared-hole",
  );
  assert.ok(
    holes.length > 0,
    "no record derives to `declared-hole`, so this test cannot see the field it exists to protect",
  );
});

// The 2 MB Next.js data-cache ceiling, measured rather than remembered.
//
// Every comment about it in this repo quotes a number, and every one of those
// numbers has gone stale at least once. This asserts the real projection over
// the real corpus, and it is here rather than in a comment because the two
// fields §3.6 added are the first prose-bearing, unbounded-per-record entries on
// the allowlist: `knownGaps` costs ~1 KB per record that carries one, and one
// record carries one today.
test("the projected browse payload stays under the data-cache ceiling", () => {
  const allowed = apiListViewFields();
  const CEILING = 2 * 1024 * 1024;
  // Well under the ceiling, so this fails while there is still room to decide
  // what to do rather than on the deploy that breaks the page.
  const BUDGET = Math.floor(CEILING * 0.75);
  const projected = manifest.items.reduce(
    (bytes, item) =>
      bytes + Buffer.byteLength(JSON.stringify(projectForList(JSON.parse(item.source_blob), allowed)), "utf8"),
    0,
  );
  assert.ok(
    projected < BUDGET,
    `the projected list payload is ${projected} bytes, over the ${BUDGET}-byte budget (75% of the ` +
      `${CEILING}-byte ceiling). Either drop a field from the allowlist or stop projecting prose.`,
  );
});
