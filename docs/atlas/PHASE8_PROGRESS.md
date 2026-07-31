# Phase 8 progress — deterministic structured extraction

Updated: 2026-07-31

## Current status

The first bounded Phase 8 slice is implemented locally:

- S0 claim boundary and evidence-locator contract: complete;
- S1 `CITATION.cff` deterministic extraction: complete for the allowlisted
  top-level scalar fields;
- S2 `pyproject.toml` deterministic extraction: complete for the allowlisted
  PEP 621 and build-system declarations;
- S6 append-only staging integration: complete through extractor and candidate
  version changes;
- S7 adversarial parser fixtures: complete for aliases, duplicate YAML keys,
  malformed TOML, and invalid declared-value shapes;
- S8 synthetic golden baseline: complete for the initial six-fact fixture.

S3–S5 and S9–S12 remain open. No requirements resolution, container build,
workflow execution, Python import, notebook execution, component
materialization, or public publication was enabled.

## Data boundary

Structured facts are nested inside the existing append-only
`github_metadata_assertions.assertion_json`. The database predicate remains the
Phase 7 file-class predicate, so this slice requires no destructive schema
change. Each fact includes:

```text
field
literal declared value
source path
semantic JSON pointer
source content SHA-256
extractor version
```

The extractor changed from
`atlas.standard-metadata-presence.v1` to
`atlas.standard-metadata-declared.v2`. The provider candidate adapter changed
from v1 to v2 because its digest payload includes the extractor version. This
prevents an immutable-row conflict when an already staged Phase 7 snapshot is
replayed; v1 rows remain intact and v2 rows are appended.

## Security and academic controls

- The snapshot boundary still limits selected files to 256 KiB each and 2 MiB
  total.
- YAML aliases and duplicate keys are rejected.
- YAML event count and nesting depth are bounded before construction.
- TOML is parsed with the Python standard library.
- Dependencies stay literal strings; they are never installed or resolved.
- Unsupported value shapes become bounded machine issues instead of being
  silently coerced.
- Raw parser exceptions and source content are not copied into issues.
- `authors` and other non-allowlisted CFF structures are not materialized.
- A declared version or dependency is source metadata, not proof of runtime
  compatibility or scientific capability.

## Baseline result

The committed synthetic golden fixture contains six allowlisted declared facts
across one `CITATION.cff` and one `pyproject.toml`.

| Metric | Result |
| --- | ---: |
| Fact precision | 1.0 |
| Fact recall | 1.0 |
| Evidence-locator accuracy | 1.0 |

This is a parser contract test, **not** an official-provider corpus score and
not evidence of real-world extraction quality. The official-source dry run in
S9 must be reported separately and may reveal unknowns or unsupported metadata.

## Verification

Initial focused verification:

```text
10 passed
```

The release gate requires the full Python suite, lint/import boundaries, and
the database-backed append-only replay test before this slice may be marked
complete.
