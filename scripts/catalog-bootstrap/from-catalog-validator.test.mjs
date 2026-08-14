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
const READ_MODEL_SOURCE = readFileSync(
  join(root, "services/api/src/majorana_api/catalog_read_model.py"),
  "utf8",
);

/**
 * One named `frozenset[str]` literal out of the Python read model, as a Set.
 *
 * `minMembers` is not decoration. A parse that silently returned nothing would
 * make every assertion built on it vacuous — passing whether the set has 24
 * members or 2 — which is the same class of blindness as the API's own
 * `issubset` checks that this file exists to compensate for.
 */
function pythonFrozenset(name, minMembers) {
  const marker = `${name}: frozenset[str] = frozenset(`;
  const start = READ_MODEL_SOURCE.indexOf(marker);
  assert.notEqual(start, -1, `${marker} not found — the constant moved or was renamed`);
  // Comments are stripped BEFORE the braces are located, not after. A `#` line
  // inside the literal that quotes a route template — `/v1/catalog/entries/` and
  // a braced slug — puts a closing brace in front of the real one, and the body
  // is then truncated mid-list. Found the honest way: the min-member guard below
  // failed at 18 of 23 the first time this file grew such a comment.
  const source = READ_MODEL_SOURCE.slice(start)
    .split("\n")
    .map((line) => line.split("#")[0])
    .join("\n");
  const open = source.indexOf("{");
  const close = source.indexOf("}", open);
  assert.ok(open !== -1 && close > open, `could not find ${name}'s frozenset braces`);
  const members = [...source.slice(open + 1, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(
    members.length >= minMembers,
    `parsed only ${members.length} members out of ${name} — the extraction is broken, not the constant`,
  );
  return new Set(members);
}

// This corpus has ~24 list fields; anything under 20 means the extraction broke,
// not that the allowlist shrank by half.
const apiListViewFields = () => pythonFrozenset("LIST_VIEW_RECORD_FIELDS", 20);

/**
 * `project_record_for_list_view` as the API actually performs it, mirrored here.
 *
 * The intersection alone is NOT what production sends, and testing the
 * intersection was a real gap: two fields are projected a level deeper than the
 * allowlist reaches, and a record that survives the outer trim can still be
 * rejected by the inner one. Every inner allowlist is read out of the same
 * Python source as the outer one rather than restated, so this mirror cannot
 * drift from the projection it claims to reproduce without failing above.
 */
function projectForListView(record) {
  const fields = apiListViewFields();
  const variantKeys = pythonFrozenset("LIST_VIEW_CODE_VARIANT_FIELDS", 2);
  const resourceLabels = pythonFrozenset("LIST_VIEW_RESOURCE_LABELS", 1);
  const projected = Object.fromEntries(
    Object.entries(record).filter(([key]) => fields.has(key)),
  );
  if (Array.isArray(projected.codeVariants)) {
    projected.codeVariants = projected.codeVariants.map((variant) =>
      variant && typeof variant === "object"
        ? Object.fromEntries(Object.entries(variant).filter(([key]) => variantKeys.has(key)))
        : variant,
    );
  }
  if (Array.isArray(projected.resources)) {
    projected.resources = projected.resources.filter(
      (row) => row && typeof row === "object" && resourceLabels.has(row.label),
    );
  }
  if (projected.visualization && typeof projected.visualization === "object") {
    // Reads a SECOND field of the record — `category` — and reads it off the
    // source rather than the projection, exactly as the Python does.
    const vizKeys =
      record.category === "gates"
        ? pythonFrozenset("LIST_VIEW_GATE_VISUALIZATION_FIELDS", 2)
        : pythonFrozenset("LIST_VIEW_VISUALIZATION_FIELDS", 1);
    projected.visualization = Object.fromEntries(
      Object.entries(projected.visualization).filter(([key]) => vizKeys.has(key)),
    );
  }
  return projected;
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
  const projected = manifest.items.map((item) => ({
    slug: item.upstream_identity,
    // Exactly what project_record_for_list_view does: intersection, never
    // filling in defaults — an absent key stays absent rather than arriving
    // null — and then the two inner trims, which the intersection alone misses.
    record: projectForListView(JSON.parse(item.source_blob)),
  }));

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
  // Against the input, not against a literal: what this test is about is that
  // nothing was dropped on the way through, and a constant says that only until
  // the corpus next grows.
  assert.equal(parsed.entries.length, projected.length);
});

/**
 * The inner trims are projections, not behaviour changes — asserted over the
 * real corpus rather than argued.
 *
 * A browse card's qubit chip is `resources.find((r) => r.label === "Qubits")
 * ?.value` (`app/repository/repository-browser.tsx:786`). The filter here uses
 * the same literal, so the claim to check is the strong one: every record that
 * renders a chip before the projection renders the SAME chip after, and every
 * record that renders none still renders none.
 */
test("the resource projection preserves every browse card's qubit chip", () => {
  const qubitsOf = (record) =>
    (Array.isArray(record.resources) ? record.resources : []).find((row) => row?.label === "Qubits")
      ?.value ?? null;

  let withChip = 0;
  for (const item of manifest.items) {
    const full = JSON.parse(item.source_blob);
    const before = qubitsOf(full);
    const after = qubitsOf(projectForListView(full));
    assert.equal(after, before, `${item.upstream_identity}'s qubit chip changed under projection`);
    if (before !== null) withChip += 1;
  }
  // A corpus where no record carried the row would make the assertion above
  // true and empty. The chip is common, not rare.
  assert.ok(withChip > 50, `only ${withChip} records carry a Qubits row — the lookup label moved`);
});

/**
 * The gate sidebar still has a circuit to draw, and nothing else carries one.
 *
 * `visualization.operations` is 138,156 of the field's 171,410 bytes and the
 * browse list draws exactly one circuit: `selectedGateEntry`
 * (`repository-browser.tsx:1053`, drawn at `:1562`), on a tab whose entries are
 * `category === "gates" ? ordered : []`. So the projection keeps `operations`
 * for that category and drops it everywhere else — and both halves of that
 * sentence are worth asserting, because the failure modes are opposite: a gate
 * without operations draws an empty circuit, and a non-gate with them is 138 KB
 * nobody reads.
 */
test("every gate keeps a drawable circuit and nothing else carries one", () => {
  let gates = 0;
  let others = 0;
  for (const item of manifest.items) {
    const full = JSON.parse(item.source_blob);
    const projected = projectForListView(full);
    if (!projected.visualization) continue;
    if (full.category === "gates") {
      gates += 1;
      assert.deepEqual(
        projected.visualization.operations,
        full.visualization.operations,
        `${item.upstream_identity} is a gate whose circuit was projected away`,
      );
    } else {
      others += 1;
      assert.equal(
        "operations" in projected.visualization,
        false,
        `${item.upstream_identity} is not a gate and still carries operations`,
      );
    }
    // Every record keeps its register: `deriveInterface` reads its length, and a
    // record whose width silently became 0 reclassifies rather than blanks.
    assert.deepEqual(projected.visualization.wires, full.visualization.wires);
    assert.equal("outcomes" in projected.visualization, false);
  }
  // Neither branch may be empty, or half this test is vacuous.
  assert.ok(gates > 0, "no gate-category record in the manifest — the category value moved");
  assert.ok(others > 0, "every record is a gate, so the drop branch was never exercised");
});

test("the list guard rejects a corrupted closed-vocabulary field", () => {
  // Proves the guard above can fail. A validator that accepts everything would
  // pass the projection test forever.
  const good = projectForListView(JSON.parse(manifest.items[0].source_blob));
  assert.notEqual(parseCatalogListRecord(good), null);
  assert.equal(parseCatalogListRecord({ ...good, category: "not-a-category" }), null);
  assert.equal(parseCatalogListRecord({ ...good, topics: "optimization" }), null);
});

test("the validator accepts every record in the pinned manifest", () => {
  assert.equal(manifest.items.length, manifest.item_count);
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
  assert.equal(entries.length, payload.length);
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
  const disagreed = [];
  for (const item of manifest.items) {
    const record = JSON.parse(item.source_blob);
    const full = stanceOf(record);
    const listed = stanceOf(projectForListView(record));
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
  const CEILING = 2 * 1024 * 1024;
  // Well under the ceiling, so this fails while there is still room to decide
  // what to do rather than on the deploy that breaks the page.
  const BUDGET = Math.floor(CEILING * 0.75);
  const projected = manifest.items.reduce(
    (bytes, item) =>
      bytes + Buffer.byteLength(JSON.stringify(projectForListView(JSON.parse(item.source_blob))), "utf8"),
    0,
  );
  assert.ok(
    projected < BUDGET,
    `the projected list payload is ${projected} bytes, over the ${BUDGET}-byte budget (75% of the ` +
      `${CEILING}-byte ceiling). Either drop a field from the allowlist or stop projecting prose.`,
  );
});
