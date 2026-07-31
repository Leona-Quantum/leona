# AGENTS.md — majorana-research-extraction

Pure, non-executing source inspection for research metadata. Authority:
`docs/atlas/PHASE8_DETERMINISTIC_EXTRACTION_PLAN.md`.

- Never import, compile, evaluate, or execute target repository code.
- Use only bounded standard-library parsers. Reject oversized, malformed, or
  ambiguous input with stable issue codes and without raw exception text.
- Every extracted fact retains a source digest and exact syntactic span.
- Syntactic imports/calls are evidence, not proof of scientific capability,
  compatibility, or runtime behavior.
- Keep this package free of control-plane, database, network, framework, and
  notebook-runtime dependencies.
