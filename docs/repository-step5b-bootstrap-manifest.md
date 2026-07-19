# Repository Step 5b (Slice A) — pinned bootstrap manifest generator

Date: 2026-07-19
State: implementation + tests complete; local-only, no network, no DB, no TS source mutation
Implements: [ADR-0019](adr/0019-pinned-catalog-bootstrap.md) (the pinned 285-record snapshot bootstraps
Neon through the importer)

## User outcome

The validated 285-record public catalog can now be captured as a deterministic, schema-versioned,
integrity-checked **bootstrap manifest** — the auditable index a later local connector (Slice B) submits
through the durable import pipeline so Neon becomes the catalog authority reproducibly. This slice touches
no database and no network, and never modifies the TypeScript catalog source (ADR-0019).

## Why this is off the network critical path

ADR-0019's bootstrap uses a **local, codebase-pinned** manifest, not an outbound fetch. So the 285-record
import does **not** depend on Step 5b's real network fetcher (MQT Bench / QASMBench / SSRF hardening) — that
remains a separate, larger-surface slice for *future* sources. This slice only serializes records the repo
already ships.

## Implemented

- `scripts/catalog-bootstrap/manifest-core.mjs` — pure core (no fs/network/DB/clock):
  - `canonicalize(value)` — deterministic canonical JSON: object keys sorted at every depth,
    `undefined`-valued keys dropped (as `JSON.stringify` does), **array order preserved** (circuit
    operations/wires/outcomes are order-significant), UTF-8.
  - `buildManifest(entries, { sourceCommit })` — one item per entry: `upstream_identity` = `slug` (the
    importer's per-item unique key), the canonical bytes embedded as `source_blob`, and
    `source_blob_sha256` = **plain sha256 of those exact bytes**, matching the Python importer's
    `catalog_hashing.hash_source_blob`. Items are sorted slug-ascending; a whole-manifest checksum
    (`manifest_checksum`) is computed over the canonical body.
  - `verifyChecksum`, `findHashMismatches`, `serializeManifest` — integrity + stable on-disk form.
- `scripts/generate-catalog-bootstrap-manifest.mjs` — CLI. Bundles `apps/web/lib/public-repository.ts` with
  esbuild (same mechanism as `scripts/check-repository-data.mjs`; Node cannot import the `.ts` directly),
  reads `PUBLIC_REPOSITORY_ENTRIES`, and writes the manifest. `--check` regenerates in-memory and fails on
  any drift (CI). `--source-commit` defaults to `git rev-parse HEAD`.
- `services/api/catalog_bootstrap/manifest.json` — the committed 285-item manifest (~2 MB; it is the pinned
  catalog snapshot with per-item provenance hashes). **Generated — do not hand-edit;** regenerate instead.
- Tests (`node:test`): `manifest-core.test.mjs` (determinism, input-order independence, canonicalization,
  per-item sha256 parity, checksum tamper-detection, duplicate/empty-slug rejection) and
  `manifest-committed.test.mjs` (the committed artifact self-verifies: 285 items, checksum, no hash drift,
  unique + slug-ascending).
- CI: the `ts` job runs the unit tests and `--check` drift guard.

## Why the source bytes are embedded (cross-language parity)

Each item embeds its canonical `source_blob` string, and Slice B's Python connector reads **those exact
bytes** rather than re-serializing the entry. This removes any JS-vs-Python JSON canonicalization drift: the
sha256 the connector computes equals the recorded `source_blob_sha256` by construction. Verified: Python
`hashlib.sha256(item["source_blob"].encode("utf-8")).hexdigest()` matches all 285 recorded hashes.

## Regenerate

```bash
node scripts/generate-catalog-bootstrap-manifest.mjs         # write services/api/catalog_bootstrap/manifest.json
node scripts/generate-catalog-bootstrap-manifest.mjs --check # CI drift guard
node --test 'scripts/catalog-bootstrap/*.test.mjs'           # unit + committed-artifact tests
```

## Deliberately NOT in this slice

- The **local bootstrap connector** (a new `ImportProvider` that submits the manifest through
  `repos/catalog_import.py`) and the full 285-item reconciliation run — Slice B.
- Any public read route, review/publish transition, or `apps/web` cutover — Slices C/D.
- All production Neon provisioning, migration, import, and the `SYSTEM_CATALOG_ENABLED` flip — owner-only
  credential operations (see `docs/runbooks/neon-system-catalog.md` and
  `~/Documents/Projects/Majorana/plans/neon-cutover-readiness.md`).

`SYSTEM_CATALOG_ENABLED` stays `false`; no catalog data is imported, published, or exposed by this slice.
