# Phase 2 corpus validator

The actual validator logic lives in `packages/py/vqe/src/majorana_vqe/corpus_validation.py`
(it needs `majorana_vqe.models.ComponentType` for enum validation, so it is a
module in that package rather than a standalone script here). This directory
holds the parts that don't belong in the pure VQE domain package.

## Offline validation (normal CI, every commit)

```bash
uv run python -m majorana_vqe.corpus_validation
uv run pytest packages/py/vqe/tests/test_corpus_validation.py -q
```

Checks JSON syntax, required/unexpected fields, `annotation_schema_version`,
filename-to-ID matching, ID uniqueness, DOI/arXiv-ID duplicates,
`method_family`/`component_type`/`relation` enum validity, paper<->repository
cross-reference integrity, `sources_verified` URL shape, evidence-locator
presence, `validation_state` internal consistency, and per-`relation` count
reporting. Never makes a network call, so it cannot be made flaky by a
network blip -- this is deliberate, see `ANNOTATION_GUIDELINE.md` §7.

To (re)compute and write `validation_state` into every record after editing
the corpus:

```python
from majorana_vqe.corpus_validation import update_validation_state
update_validation_state()  # writes machine_validated/validation_failed + timestamps
```

## Online URL-reachability audit (manual/separate job only)

`online_url_audit.py` in this directory fetches every `sources_verified` /
`repository_url` / `evidence_locators` URL across the corpus with a
HEAD/GET request and reports which ones no longer resolve (papers get
paywalled, repos get renamed or deleted, etc.). This is **not** part of
normal CI -- it makes real network requests, so a transient network problem
or a paper's temporary publisher outage must never fail the standard test
suite. Run it manually or from a separate, non-blocking scheduled job:

```bash
python3 docs/atlas/corpus/validator/online_url_audit.py
```

It only reports; it never edits corpus files or fails hard on an
unreachable URL (that could be transient) -- treat its output as an audit
report for a human to act on, not a gate.
