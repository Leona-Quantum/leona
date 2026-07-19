// Tests for the pinned catalog bootstrap manifest core (ADR-0019, Slice A).
// Run: node --test scripts/catalog-bootstrap/
//
// These cover the invariants the Slice B importer and CI rely on: determinism,
// checksum integrity, per-item hash parity (a plain sha256 of the embedded
// bytes, matching the Python `catalog_hashing.hash_source_blob`), stable
// slug-ascending ordering, and duplicate/empty-slug rejection. No fs, no
// network, no DB — the core is pure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildManifest,
  canonicalize,
  verifyChecksum,
  findHashMismatches,
  MANIFEST_SCHEMA_VERSION,
  ORDERING,
} from "./manifest-core.mjs";

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");

// A small, representative fixture set (variety of shapes: nested objects,
// arrays whose order matters, optional/undefined fields, unicode).
function sampleEntries() {
  return [
    {
      slug: "zeta-gate",
      title: "Zeta",
      category: "gates",
      tags: ["b", "a"], // order preserved, NOT sorted
      visualization: { wires: ["q0"], operations: [{ label: "H", qubits: [0], tone: "accent" }] },
      note: undefined, // dropped like JSON.stringify
    },
    {
      slug: "alpha-state",
      title: "α state",
      category: "states",
      descriptionJa: "説明",
      resources: [{ label: "x", value: "1" }],
    },
    {
      slug: "mu-algorithm",
      title: "Mu",
      category: "algorithms",
      nested: { z: 1, a: { d: 4, c: 3 } },
    },
  ];
}

const OPTS = { sourceCommit: "test000000000000000000000000000000000000" };

test("canonicalize sorts object keys at every depth but preserves array order", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({ x: { d: 4, c: 3 } }), '{"x":{"c":3,"d":4}}');
  assert.equal(canonicalize(["b", "a"]), '["b","a"]'); // array order kept
  assert.equal(canonicalize({ k: undefined, j: 1 }), '{"j":1}'); // undefined dropped
  assert.equal(canonicalize("α"), '"α"');
});

test("canonicalize mirrors JSON.stringify for toJSON objects and sparse arrays", () => {
  // toJSON hook (Date) → serialized value, not "{}".
  const d = new Date("2026-07-19T00:00:00.000Z");
  assert.equal(canonicalize(d), JSON.stringify(d));
  assert.equal(canonicalize({ at: d }), JSON.stringify({ at: d }));
  // Sparse-array holes become null (as JSON.stringify does), not skipped.
  const sparse = [1, , 2]; // eslint-disable-line no-sparse-arrays
  assert.equal(canonicalize(sparse), JSON.stringify(sparse));
  assert.equal(canonicalize(sparse), "[1,null,2]");
});

test("buildManifest is deterministic: same input → byte-identical output", () => {
  const a = buildManifest(sampleEntries(), OPTS);
  const b = buildManifest(sampleEntries(), OPTS);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.manifest_checksum, b.manifest_checksum);
});

test("input order does not affect the manifest (items sorted slug-asc)", () => {
  const forward = buildManifest(sampleEntries(), OPTS);
  const shuffled = buildManifest([...sampleEntries()].reverse(), OPTS);
  assert.equal(forward.manifest_checksum, shuffled.manifest_checksum);
  const slugs = forward.items.map((i) => i.upstream_identity);
  assert.deepEqual(slugs, ["alpha-state", "mu-algorithm", "zeta-gate"]);
  assert.equal(forward.ordering, ORDERING);
});

test("schema/version/count fields are populated", () => {
  const m = buildManifest(sampleEntries(), OPTS);
  assert.equal(m.manifest_schema_version, MANIFEST_SCHEMA_VERSION);
  assert.equal(m.generator.name, "generate-catalog-bootstrap-manifest");
  assert.match(m.generator.version, /^\d+\.\d+\.\d+$/);
  assert.equal(m.source_commit, OPTS.sourceCommit);
  assert.equal(m.item_count, 3);
  assert.equal(m.items.length, 3);
});

test("each item hash is a plain sha256 of its embedded canonical blob (Python-parity)", () => {
  const m = buildManifest(sampleEntries(), OPTS);
  for (const item of m.items) {
    assert.equal(item.source_blob_sha256, sha256(item.source_blob));
    assert.equal(item.source_blob_encoding, "canonical-json-utf8");
  }
  assert.deepEqual(findHashMismatches(m), []);
});

test("whole-manifest checksum verifies and detects tampering", () => {
  const m = buildManifest(sampleEntries(), OPTS);
  assert.equal(verifyChecksum(m).ok, true);

  const tamperedBlob = structuredClone(m);
  tamperedBlob.items[0].source_blob = tamperedBlob.items[0].source_blob + " ";
  assert.equal(verifyChecksum(tamperedBlob).ok, false);

  const tamperedCommit = structuredClone(m);
  tamperedCommit.source_commit = "deadbeef";
  assert.equal(verifyChecksum(tamperedCommit).ok, false);

  const droppedItem = structuredClone(m);
  droppedItem.items.pop();
  assert.equal(verifyChecksum(droppedItem).ok, false);
});

test("findHashMismatches flags a corrupted per-item hash", () => {
  const m = buildManifest(sampleEntries(), OPTS);
  m.items[1].source_blob_sha256 = "0".repeat(64);
  assert.deepEqual(findHashMismatches(m), [m.items[1].upstream_identity]);
});

test("rejects empty input, missing slugs, and duplicate slugs", () => {
  assert.throws(() => buildManifest([], OPTS), /non-empty/);
  assert.throws(() => buildManifest([{ title: "no slug" }], OPTS), /slug/);
  assert.throws(() => buildManifest([{ slug: "dup" }, { slug: "dup" }], OPTS), /duplicate slug dup/);
  assert.throws(() => buildManifest(sampleEntries(), { sourceCommit: "" }), /sourceCommit/);
});
