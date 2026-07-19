# catalog_bootstrap

`manifest.json` is the **pinned bootstrap manifest** for the Neon system catalog (ADR-0019): a
deterministic, schema-versioned, integrity-checked snapshot of the validated 285-record public catalog,
generated from `apps/web/lib/public-repository.ts`.

**It is generated — do not hand-edit.** Regenerate with `source_commit` pinned to the `dev` baseline the
catalog data came from (so the value is stable and meaningful, not the ephemeral branch HEAD):

```bash
node scripts/generate-catalog-bootstrap-manifest.mjs --source-commit "$(git rev-parse origin/dev)"
```

CI's drift guard (`--check`) compares item hashes and ignores `source_commit`, so a stale commit line never
fails CI on its own — but pin it anyway when the data actually changes.

Each item embeds its canonical `source_blob` bytes and a `source_blob_sha256` that equals a plain
`sha256` of those bytes (matching `majorana_api.catalog_hashing.hash_source_blob`), so the Step 5b Slice B
Python bootstrap connector can read the exact bytes and submit them through the durable importer without any
cross-language canonicalization drift. See `docs/repository-step5b-bootstrap-manifest.md`.

The manifest is inert data: nothing here imports, publishes, or exposes catalog records, and
`SYSTEM_CATALOG_ENABLED` stays `false`.
