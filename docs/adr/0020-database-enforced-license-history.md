# ADR-0020: License assertion history is append-only in PostgreSQL

**Date:** 2026-07-19 · **Status:** implemented

> **Status corrected 2026-08-04.** Shipped as migration
> `0018_license_assertions_append_only` — the `BEFORE UPDATE OR DELETE` trigger on
> `license_assertions` described below. Migration `0015` was not edited.

**Context:** Catalog rights decisions are represented as a superseding chain of
`license_assertions`. Repository code appends corrections, but PostgreSQL currently
allows an existing assertion, its evidence, or its reviewer attribution to be updated
or deleted. Application convention alone cannot protect audit history from a future
bug, maintenance script, or accidental ORM mutation.

**Decision:** A new linear, reversible migration installs a PostgreSQL `BEFORE UPDATE
OR DELETE` trigger on `license_assertions`. Every correction remains a new row linked
through `supersedes_assertion_id`; existing rows cannot be rewritten. The trigger uses
a stable database error and is tested against real Postgres. Frozen migration `0015`
is not edited. The migration downgrade removes the trigger and function but never
deletes assertion data.

**Consequences:** Rights and reviewer history remain auditable even if application code
regresses. Operators must append a correcting assertion instead of repairing a row in
place. Emergency alteration requires an explicit privileged database action and audit,
not a normal application transaction. This protects history; it does not by itself
decide whether a license permits publication.
