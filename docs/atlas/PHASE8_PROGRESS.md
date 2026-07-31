# Phase 8 progress — deterministic structured extraction

Updated: 2026-07-31

## Current status

The first bounded Phase 8 slice is implemented locally:

- S0 claim boundary and evidence-locator contract: complete;
- S1 `CITATION.cff` deterministic extraction: complete for the allowlisted
  top-level scalar fields;
- S2 `pyproject.toml` deterministic extraction: complete for the allowlisted
  PEP 621 and build-system declarations;
- S3 requirements and lockfile declarations: complete for bounded literal root
  `requirements*` lines and literal package name/version fields in `uv.lock`,
  `poetry.lock`, and `Pipfile.lock`; resolver directives and malformed or
  unsupported structures are explicit issues;
- S4 Dockerfile declarations: complete for bounded `FROM`, `CMD`, and
  `ENTRYPOINT` instructions without build or execution;
- S5 GitHub Actions declarations: complete for workflow name and trigger keys
  without expression evaluation or action execution;
- S6 append-only staging integration: complete through extractor and candidate
  version changes;
- S7 adversarial parser fixtures: complete for aliases, duplicate YAML keys,
  malformed TOML, and invalid declared-value shapes;
- S8 synthetic golden baseline: complete for the current fourteen-fact fixture.

`environment.yml` is not treated as a lockfile, and S9–S12 remain open. No
requirements resolution, container build, workflow execution, Python import, notebook execution, component
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
`atlas.standard-metadata-declared.v3`. The provider candidate adapter changed
from v2 to v3 because its digest payload includes the extractor version. This
prevents an immutable-row conflict when an already staged Phase 7 snapshot is
replayed; all earlier rows remain intact and v3 rows are appended.

## Security and academic controls

- The snapshot boundary still limits selected files to 256 KiB each and 2 MiB
  total.
- YAML aliases and duplicate keys are rejected.
- YAML event count and nesting depth are bounded before construction.
- TOML is parsed with the Python standard library.
- Dependencies stay literal strings; they are never installed or resolved.
- Lockfiles expose only allowlisted literal package names and versions. Sources,
  hashes, markers, dependency graphs, and installer semantics are not inferred.
- JSON duplicate keys and excessive depth/node counts are rejected for
  `Pipfile.lock`; TOML duplicate keys and malformed tables fail closed through
  the standard-library parser.
- Unsupported value shapes become bounded machine issues instead of being
  silently coerced.
- Raw parser exceptions and source content are not copied into issues.
- `authors` and other non-allowlisted CFF structures are not materialized.
- A declared version or dependency is source metadata, not proof of runtime
  compatibility or scientific capability.

## Baseline result

The committed synthetic golden fixture contains fourteen allowlisted declared
facts across `CITATION.cff`, `pyproject.toml`, `requirements.txt`, `Dockerfile`,
one GitHub Actions workflow, and `uv.lock`.

| Metric | Result |
| --- | ---: |
| Fact precision | 1.0 |
| Fact recall | 1.0 |
| Evidence-locator accuracy | 1.0 |

This is a parser contract test, **not** an official-provider corpus score and
not evidence of real-world extraction quality. The official-source dry run in
S9 must be reported separately and may reveal unknowns or unsupported metadata.

## Verification

Completed remote verification for the pre-lockfile S3–S5 slice:

```text
local: 1458 passed, 171 skipped
GitHub CI: https://github.com/EshMis/majorana/actions/runs/30626901144 (success)
production E2E: https://github.com/EshMis/majorana/actions/runs/30626901162 (success)
```

The production E2E is regression evidence for the existing private execution
path; it is not an official-provider extraction score. The new lockfile slice
passed the local release gate with `1464 passed, 171 skipped`, clean Ruff
format/lint, current OpenAPI, all four import contracts kept, a clean raw-query
boundary, and Alembic head `0044`. The database-backed append-only replay and
full remote regression matrix also passed in
https://github.com/EshMis/majorana/actions/runs/30627444700.

GitHub emitted non-blocking deprecation warnings for Node 20-based action
bundles while forcing those actions onto Node 24. No gate failed. Updating the
shared CI action majors remains a separate repository-wide maintenance change,
not part of this extraction result or its scientific evidence.
