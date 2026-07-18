# Repository Step 4 — provenance, rights, citations, and review

Date: 2026-07-18
Branch: `feature/repository`
State: implementation and local up→down→up validation complete; CODEOWNER review pending

## User outcome

The catalog can now record where staged content came from, what license claim
applies to it, who reviewed it, and why — before any of it is publishable. Nothing
becomes public in this step; publication itself remains a later step's audited human
action.

## Implemented

- Migration `0015`: `artifact_sources` (one pinned source per version, UNIQUE on
  `artifact_version_id`), `license_assertions` (append-only ledger — a correction is a
  new row with `supersedes_assertion_id` set, never an `UPDATE`), `artifact_citations`
  (requires at least one of doi/arXiv/URL/spec ref), `artifact_tags` (controlled
  lowercase-hyphen vocabulary, `(artifact_id, tag)` primary key). All CHECK-constrained
  to closed enums; hash columns validated by the same sha256-hex format as migration
  `0014`.
- `catalog_publication.py`: `evaluate_publication_readiness`, a pure function (no
  sqlalchemy import, so it can't violate the DB-access-only-in-repos boundary) that
  reports every missing precondition — review acceptance, a pinned source, an approved
  license, and the exact hash/framework binding — without mutating anything.
- `majorana_contracts.lifecycle` gained `assert_review_transition` /
  `IllegalReviewTransition`, mirroring the existing `RunStatus` transition guard:
  `draft → pending_review` (importer) and `{pending_review, quarantined} → {accepted,
  rejected}` (reviewer) are the only legal moves; quarantine itself is reached
  automatically, not through this table.
- `repos/catalog.py` additions, all under the same three-principal model as Step 2/3:
  - `record_artifact_source`, `record_citation`, `tag_artifact` — importer-only.
  - `record_license_assertion` — importer-only. An unknown (`spdx_id=None`) or
    explicitly `conflicting=True` claim sets the artifact's `review_state` to
    `quarantined` **in the same transaction**, only when the assertion targets the
    artifact's current version — automatic, fail-closed, no human step required first.
  - `decide_license_assertion`, `decide_review` — reviewer-only. `_get_reviewer_workspace`
    requires a persisted **ADMIN** membership on the catalog workspace and explicitly
    rejects the importer's and public-reader's user IDs even if some future
    misconfiguration ever granted either an ADMIN row. A real reviewer is provisioned by
    the importer's OWNER scope calling the existing `repos/workspaces.add_member` — no
    new membership machinery was added.
  - `submit_for_review` — importer-only, `draft → pending_review` through
    `assert_review_transition`.
  - `get_publication_readiness` — read-only, importer or reviewer scope.
  - `stage_artifact_version` now resets `review_state` to `draft` whenever the artifact
    was `accepted`/`rejected` before the new version lands, so a new revision can never
    inherit a stale acceptance made about different content.

## Deferred deliberately (later steps)

- durable importer jobs, external fetcher, SSRF/quarantine hardening (Step 5);
- any public route, actual publication transition, or web surface (Step 6+);
- 285-record bootstrap import;
- two-person review policy, publication/quarantine-release UI.

## Local validation (no Neon touched)

Reused the throwaway-local-Postgres-14 pattern from Step 3 (fresh cluster, stopped and
deleted after — no Neon branch created or touched):

- `alembic upgrade head` reached `0015` cleanly from `0014`; full `downgrade base` →
  `upgrade head` round trip passed;
- downgrade fail-closed guard verified directly against a real `artifact_tags` row
  (FK-chained through a real workspace/artifact): `alembic downgrade 0014` raised
  `cannot downgrade 0015 while provenance/rights/citation/tag rows exist` (rows removed
  afterward);
- live-DB suite (`test_catalog_provenance_live.py`, 7 tests, `requires_db`-gated) passed
  twice in a row against the same database:
  - provenance/rights round-trip: stored `content_hash`/`evidence_hash` unchanged on
    reload;
  - unknown-license auto-quarantine, then reviewer `decide_license_assertion` +
    `decide_review` → `accepted`, then `get_publication_readiness` reports ready;
  - staging a new version after acceptance resets `review_state` to `draft`;
  - the importer's own scope is rejected by `decide_review` (`AuthzError`) — importer
    and reviewer are structurally different principals;
  - a reviewer scope is rejected by `stage_artifact`;
  - Step 3's global duplicate-hash rejection still fires with provenance/rights data
    present (regression guard);
  - citation + tag persist.
  - Note: the two live-DB test modules (Step 3's and Step 4's) must resolve to the
    *same* deterministic system-catalog-authority UUIDs — `ensure_system_catalog_authority`'s
    service identities (`system:catalog-importer`, `system:catalog-public-reader`) are
    global fixed constants, so two different workspace UUIDs across test modules
    collide on `users.workos_user_id` the moment both run against one database. This
    matches production: there is exactly one system catalog authority per database, ever.
- full local suite: 188 passed / 1 skipped (DB present, live-LLM test skipped); 275
  passed / 20 skipped (no `DATABASE_URL`);
- Ruff check/format: passed; import-linter: 3 kept, 0 broken; raw-query gate: clean;
  `python -m majorana_contracts.export --check`: `openapi.json` unchanged (no route or
  response-model field touched).

## Neon gate

A real Neon branch (`step3-4-catalog-provenance-20260718`) confirmed the same results
against Postgres 17 — see `docs/repository-step3-4-neon-gate.md`.

## Required gate

CODEOWNER review remains required before Step 5 for the migration, contracts, and
repository-layer changes. `SYSTEM_CATALOG_ENABLED` stays `false`; no public catalog data
exists.
