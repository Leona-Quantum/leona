# Phase 8 — Deterministic structured extraction

Status: active on `feature/vqe`

## Product and scientific boundary

Phase 8 converts bounded, immutable Phase 7 metadata files into directly
declared facts with exact evidence locators. It does **not** infer scientific
capability, implementation compatibility, maintenance quality, authorship,
license validity, or publication eligibility.

Every extracted fact must retain:

- immutable repository and commit identity from the Phase 7 snapshot;
- source path and content SHA-256;
- a parser-specific semantic pointer;
- extractor version;
- the declared value without provider-specific interpretation.

Malformed or ambiguous metadata produces a bounded machine issue. It never
falls back to README prose, filename inference, an LLM, or partial publication.

## Steps

### S0 — Contract and claim boundary

- Freeze the declared-fact and evidence-locator schema.
- Keep all outputs private and append-only.
- Define deterministic replay and malformed-input behavior.

### S1 — `CITATION.cff`

- Parse UTF-8 YAML without aliases or duplicate mapping keys.
- Extract only an allowlist of top-level declared scalar fields.
- Preserve JSON-pointer evidence; do not infer author identity or citation
  correctness.

### S2 — `pyproject.toml`

- Parse with the Python standard-library TOML parser.
- Extract allowlisted PEP 621/build-system declarations.
- Keep dependency strings literal; do not resolve or install them.

### S3 — requirements and lockfiles

- Record bounded literal requirement declarations and exact line locators.
- Do not contact indexes or resolve dependency graphs.

### S4 — Dockerfile

- Record declared base images and entrypoint metadata without building images.
- Treat every instruction as untrusted text.

### S5 — GitHub Actions

- Parse bounded workflow metadata without evaluating expressions.
- Never execute actions or treat a green workflow as scientific verification.

### S6 — append-only staging integration

- Persist structured facts inside versioned metadata assertions.
- Preserve old extractor rows; never rewrite Phase 7 evidence.

### S7 — adversarial parser fixtures

- Cover invalid UTF-8, YAML aliases, duplicate keys, malformed TOML, oversized
  values, and misleading filenames.

### S8 — golden evaluation corpus

- Measure exact fact precision, recall, and evidence-locator accuracy.
- Label synthetic-fixture results separately from official-provider results.

### S9 — official-provider dry run

- Run only against approved Qiskit, PennyLane, OpenFermion, and HamLib snapshots.
- Keep unknowns and conflicts; do not auto-materialize components.

### S10 — Python AST extractor

- Add a separate pure package for imports, aliases, constructors, literal call
  configuration, and CLI entrypoints.
- Never import or execute target code.

### S11 — notebook sanitizer/extractor

- Never execute notebooks; remove outputs, reject attachments, cap cells and
  tokens, sanitize HTML, and retain cell-index evidence.

### S12 — release gate

- Re-run Python, migration, persistence, and deterministic replay checks.
- Publish only the code and private evidence schema. Public component
  materialization and performance claims remain blocked.

## Initial acceptance target

The first Phase 8 slice is S0–S2 plus S6–S8 for `CITATION.cff` and
`pyproject.toml`. Later formats must not be added until this slice is replayable,
adversarially tested, and measured.
