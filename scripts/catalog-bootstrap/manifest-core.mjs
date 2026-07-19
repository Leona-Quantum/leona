// Pure core for the pinned catalog bootstrap manifest (ADR-0019, Slice A).
//
// Given the assembled 285 public repository entries at one pinned source
// commit, produce a deterministic, schema-versioned manifest: per-item
// canonical source bytes, a per-item sha256 that matches the Python importer's
// `catalog_hashing.hash_source_blob` (a plain sha256 of the exact bytes), a
// stable slug-ascending ordering, and a whole-manifest checksum.
//
// The canonical source bytes are EMBEDDED per item on purpose: the Slice B
// Python bootstrap connector reads those exact bytes rather than re-serializing
// the entry, so there is no JS-vs-Python JSON canonicalization drift and the
// sha256 the connector computes is guaranteed to equal the one recorded here.
//
// This module is pure (no fs, no network, no DB, no clock) so it is trivially
// testable and deterministic: the same entries + same source commit always
// yield byte-identical output.

import { createHash } from "node:crypto";

export const MANIFEST_SCHEMA_VERSION = 1;
export const GENERATOR_NAME = "generate-catalog-bootstrap-manifest";
export const GENERATOR_VERSION = "1.0.0";
export const SOURCE_BLOB_ENCODING = "canonical-json-utf8";
export const ORDERING = "slug-asc";

/**
 * Deterministic canonical JSON serialization: object keys sorted
 * lexicographically at every depth, `undefined`-valued keys dropped exactly as
 * JSON.stringify would, array order preserved (it is semantically meaningful in
 * these records — circuit operations, wires, outcomes). Primitives go through
 * JSON.stringify, whose output is fixed by the ECMAScript spec.
 */
export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v === undefined ? null : v)).join(",") + "]";
  }
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Build the manifest object from the assembled entries.
 *
 * @param {Array<object>} entries - PUBLIC_REPOSITORY_ENTRIES (each has a unique `slug`).
 * @param {object} opts
 * @param {string} opts.sourceCommit - the pinned commit the entries were read at.
 * @returns {object} the manifest (already ordered; includes `manifest_checksum`).
 */
export function buildManifest(entries, { sourceCommit }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("buildManifest: entries must be a non-empty array");
  }
  if (typeof sourceCommit !== "string" || sourceCommit.trim() === "") {
    throw new Error("buildManifest: sourceCommit is required");
  }

  const seen = new Set();
  const items = entries
    .map((entry) => {
      const slug = entry?.slug;
      if (typeof slug !== "string" || slug.trim() === "") {
        throw new Error("buildManifest: every entry must have a non-empty string slug");
      }
      if (seen.has(slug)) {
        throw new Error(`buildManifest: duplicate slug ${slug}`);
      }
      seen.add(slug);
      const sourceBlob = canonicalize(entry);
      return {
        upstream_identity: slug,
        category: entry.category ?? null,
        title: entry.title ?? null,
        source_blob_encoding: SOURCE_BLOB_ENCODING,
        source_blob_sha256: sha256Hex(sourceBlob),
        source_blob: sourceBlob,
      };
    })
    .sort((a, b) => (a.upstream_identity < b.upstream_identity ? -1 : a.upstream_identity > b.upstream_identity ? 1 : 0));

  const body = {
    manifest_schema_version: MANIFEST_SCHEMA_VERSION,
    generator: { name: GENERATOR_NAME, version: GENERATOR_VERSION },
    source_commit: sourceCommit,
    ordering: ORDERING,
    item_count: items.length,
    items,
  };

  return { ...body, manifest_checksum: sha256Hex(canonicalize(body)) };
}

/**
 * Recompute the checksum over the manifest body (everything except the checksum
 * itself) and compare. Returns { ok, expected, actual }.
 */
export function verifyChecksum(manifest) {
  const { manifest_checksum: actual, ...body } = manifest;
  const expected = sha256Hex(canonicalize(body));
  return { ok: expected === actual, expected, actual: actual ?? null };
}

/**
 * Independently re-verify every per-item hash against its embedded source blob.
 * Returns the list of slugs whose recorded hash does not match sha256(blob).
 */
export function findHashMismatches(manifest) {
  const bad = [];
  for (const item of manifest.items ?? []) {
    if (sha256Hex(item.source_blob) !== item.source_blob_sha256) {
      bad.push(item.upstream_identity);
    }
  }
  return bad;
}

/** Stable, human-diffable serialization for writing the manifest to disk. */
export function serializeManifest(manifest) {
  return JSON.stringify(manifest, null, 2) + "\n";
}
