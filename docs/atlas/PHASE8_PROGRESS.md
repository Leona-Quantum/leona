# Phase 8 progress — deterministic structured extraction

State: **S0–S12 complete at their stated private evidence levels. Public
component materialization and scientific/performance claims remain blocked.**

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
- S8 synthetic golden baseline: complete for the current fourteen-fact fixture;
- S9 official-provider dry run: complete for the six enabled GitHub sources in
  the owner-approved Qiskit, PennyLane, OpenFermion, and HamLib source families;
- S10 Python AST extractor: complete as the pure
  `majorana-research-extraction` package with no target imports or execution;
- S11 notebook sanitizer/extractor: complete for bounded Jupyter v4 JSON with
  separate sanitized code/markdown channels and no notebook execution;
- S12 release gate: complete locally and in the remote CI matrix.

`environment.yml` is not treated as a lockfile. No
requirements resolution, container build, workflow execution, target Python
import, notebook execution, component materialization, or public publication
was enabled.

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
not evidence of real-world extraction quality.

## S9 official-provider dry run

The bounded live dry run resolved each enabled official/provider-linked source
to an immutable commit and replayed extractor v3 twice. The committed redacted
evidence is
`docs/atlas/evidence/phase8/official_provider_dry_run_2026-07-31.json`
(`sha256:60b094d56675fa1441cddaaef18d869a8e44e4ba3259638dc697250610f00daa`).
It contains paths, sizes, content digests, field counts, and bounded issue
identities, but no raw third-party bytes or declared fact values.

| Source | Immutable commit | Selected files | Declared facts | Issues | Oversized skipped |
| --- | --- | ---: | ---: | ---: | ---: |
| Qiskit | `56147f83f0b463115ab55a838238944b9191e5a2` | 27 | 56 | 0 | 0 |
| Qiskit Nature | `478b26e1992d66582cf15bcb1c90df702a3b8f97` | 9 | 43 | 0 | 0 |
| Qiskit Algorithms | `23187def78b8012e4bbf326811b33676b075c8f4` | 8 | 34 | 0 | 0 |
| PennyLane | `21ec2dfba1071f8da3121aca340f087598009469` | 30 | 57 | 1 | 1 |
| OpenFermion | `2871f099ecc3f8990a514763b86587d988f67d48` | 8 | 17 | 0 | 0 |
| HamLib helper functions | `b8d847e96c70cfc1dacbbae89551e57c055a3c38` | 1 | 0 | 0 | 0 |

All six snapshots completed without connector failure and yielded 207
allowlisted declared facts in total. This count is an extraction inventory,
not a precision, recall, capability, compatibility, quality, or performance
metric.

PennyLane's `.github/workflows/unit-test.yml` contains a tab character where
strict YAML rejects it; Atlas records only the bounded `github-actions:invalid_yaml`
issue and the source content digest. Its root `uv.lock` exceeded the existing
per-file acquisition cap and was deliberately skipped. Neither condition was
silently relaxed. HamLib's paper-linked helper repository exposed only one
selected metadata file and no allowlisted declared facts. That result remains
an explicit zero, not an inferred absence of dataset functionality and not a
failure of the separate HamLib dataset provider.

The source registry now names Qiskit core explicitly in addition to Qiskit
Nature and the historically pinned Qiskit Algorithms repository. Registry
membership permits bounded acquisition only; it does not establish a VQE
capability or runtime compatibility. No S9 result was auto-materialized as a
component.

## S10 Python AST extractor

`packages/py/research-extraction` is a separate standard-library-only package.
It parses bounded UTF-8 `.py` bytes with `ast.parse`; it never imports, compiles
to runnable bytecode, evaluates, or executes the target module. A dedicated
import-linter contract prevents this package from acquiring framework,
control-plane, database, network-client, or subprocess dependencies.

The v1 schema records exact syntactic evidence for imports, import aliases,
simple symbol aliases, imported-call sites, keyword names, bounded literal
keyword configuration, and exact `if __name__ == "__main__"` entrypoint calls.
Each fact contains the source SHA-256 and line/UTF-8-byte-column span. Source
bytes, AST nodes/depth, fact count, literal depth/items/string length, and
integer digits are bounded. Invalid paths, UTF-8, Python syntax, or resource
limits fail closed with stable codes and no raw exception text.

The synthetic fixture suite covers Qiskit, PennyLane, OpenFermion, OpenVQE,
Tangelo, unused imports, lexical shadowing, conditional rebinding, oversized
input, malformed syntax, non-literal configuration, and code that would create
a file if executed. The latter leaves no file and records
`execution_performed=false`. These are parser-contract tests, not real-provider
precision/recall results. `imported_call` means only that the callee is
syntactically resolved to an imported name; it is not proof of constructor
semantics, execution, compatibility, or scientific capability.

## S11 notebook sanitizer/extractor

The notebook extractor accepts bounded UTF-8 Jupyter v4 JSON and never invokes
a notebook kernel, imports cell code, compiles it, or evaluates it. It rejects
duplicate JSON keys, non-finite JSON numbers, unsupported notebook versions and
cell types, NUL bytes, attachment payloads, base64 data URLs, malformed output
containers, and configured size, cell, JSON-node/depth, and deterministic
lexical-token limits. Any such issue fails the entire notebook closed without
returning partially sanitized cells or raw parser messages.

Outputs, execution counts, and notebook metadata are excluded from the result.
Markdown is reduced to text-only content with active HTML content removed; code
remains an inert private evidence channel. Each accepted cell retains its
original source SHA-256, notebook SHA-256, path, type, and zero-based cell
index. The returned model explicitly records `execution_performed=false` and
`publication_eligible=false`.

The fourteen synthetic tests cover output and execution-count removal, active
HTML stripping, attachments, base64 data URLs, invalid paths/UTF-8/JSON,
duplicate keys, non-finite JSON numbers, unsupported formats and raw cells,
resource ceilings, deterministic replay, and hostile code that would create a
file if executed. The marker file is not created. These tests establish the
sanitizer contract only; they are not an official-provider notebook quality or
scientific-capability score.

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

The documentation-only lockfile follow-up also passed the full remote CI matrix:
https://github.com/EshMis/majorana/actions/runs/30627566881.

## S12 release gate

The final local gate completed on commit `bbe48df` with:

```text
pytest: 1496 passed, 171 skipped
Ruff lint: clean
Ruff format: 384 files already formatted
OpenAPI and all H2 registry/generated fixtures: current
import-linter: 5 contracts kept, 0 broken
raw-query boundary: clean
Alembic: one head, 0044
```

The corresponding remote CI matrix passed at
https://github.com/EshMis/majorana/actions/runs/30631592957. Its disposable
Postgres job completed migration up→down→up, seed, authz, pipeline E2E, and
repository concurrency/integrity checks. TypeScript build/tests, authenticated
browser contracts, accessibility checks, Python tests, generation checks,
import boundaries, and raw-query checks also passed.

The CI run skipped the separately triggered Phase 7.7 Linux/amd64 interchange
job because this commit did not carry its explicit qualification tag; the
Phase 8 extractor neither changes nor claims that runtime boundary. GitHub
again emitted non-blocking Node 20 action deprecation warnings while running
those actions under Node 24. That repository-wide action-major maintenance
remains separate from Phase 8 and did not weaken an extraction gate.

Phase 8 closes with code and private evidence schemas only. No extracted fact,
AST call, or notebook cell was promoted to a canonical component, treated as a
verified implementation, published publicly, or used to make a performance
claim.
