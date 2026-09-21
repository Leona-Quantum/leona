# Qiskit HumanEval — provenance

- **Source**: https://github.com/qiskit-community/qiskit-human-eval
- **Pinned commit**: `c98ba538239fcfd554aa89627ee8026f4b5de450` (branch `main`, authored 2026-08-26)
- **License**: Apache License 2.0 (`LICENSE` in this directory, copied verbatim from the
  pinned commit; `Apache-2.0` per the GitHub API's own classification)
- **Paper**: Vishwakarma et al., "Qiskit HumanEval: An Evaluation Benchmark For Quantum
  Code Generative Models", arXiv:2406.14712
- **Fetched**: 2026-09-20, via `raw.githubusercontent.com` at the pinned commit (not `main`,
  so a later push cannot silently change what this repo scores against)

## Vendored file

`dataset_qiskit_test_human_eval.json` — 151 tasks, OpenAI-HumanEval-style records:
`task_id`, `prompt` (signature + docstring), `canonical_solution` (body only), `test`
(defines `check(candidate)`), `entry_point`, `difficulty_scale`.

```
sha256(dataset_qiskit_test_human_eval.json) = c9c87bd30bb600821f1385c9f8fc31205302823385f84966d32afd5d82c6e0f0
```

The loader (`majorana_evals.public_benchmarks.qiskit_human_eval`) recomputes this hash at
load time from the bytes it actually reads and raises if it does not match the constant
above — so a corrupted or hand-edited copy fails loudly instead of silently scoring against
a dataset that is not the one this file documents.

## Not vendored

`dataset_qiskit_test_human_eval_hard.json` (same 151 task IDs, prompts stripped of imports
and signatures — "hard mode") exists in the upstream repo but is not used or vendored here.
Its sha256 at the pinned commit, for the record: `f4f055882ba65a2decb5c34629357a083fe04546f8ea25f58a302249397a15a9`.

## License note

Apache-2.0 permits vendoring with attribution and license retention, both done here (this
file plus `LICENSE`). No modification was made to the vendored JSON beyond the copy itself.
