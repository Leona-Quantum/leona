# Phase 10 S5 — bounded selected-source normalizer preflight

Date: 2026-08-03 JST  
Status: **offline contract only — no source is materialized or executed**

## Boundary

`phase10_source_normalizer` converts an exact, workspace-scoped S3 quarantine
plan plus already-read source bytes into a digest-only, read-only manifest. It
performs no network, object-store, database, filesystem, archive extraction,
package installation, import, parser, subprocess, publication, or execution
operation.

Before emitting a manifest, it:

1. requires the exact workspace and exact selected-path set from the S3 plan;
2. rechecks every byte length and SHA-256 against the quarantine object;
3. requires strict UTF-8 without BOM or unsafe terminal/control characters;
4. rejects Git LFS pointers, archive/package image suffixes, and common
   credential-file names;
5. preserves the original byte identity rather than rewriting line endings or
   Unicode and potentially changing program semantics;
6. emits only paths, media types, lengths, digests, text encoding, and opaque
   quarantine locators under a canonical outer digest.

The initial release therefore has no archive expansion path. A `.zip`,
`.tar.gz`, wheel, JAR, disk image, or similar selected path fails with the
stable `source_shape_rejected` code even if its bytes happen to decode as text.

## Scientific and operational interpretation

The normalized manifest means only that the exact selected bytes have a safe,
bounded shape for later deterministic static inspection. It does not mean that
the repository is complete, correct, licensed, reproducible, importable, or
safe to execute. It creates no performance result or public claim.

S5 remains incomplete until the owner-approved quarantine adapter supplies the
bytes, the exact deployed normalizer is independently qualified, and hostile
live handoff tests prove that partial, substituted, cross-workspace, and
unreachable quarantine objects cannot be represented as normalized output.
