# ADR-0019: The pinned 285-record snapshot bootstraps Neon through the importer

**Date:** 2026-07-18 · **Status:** implemented (executed 2026-07-19; live in production)

> **Status corrected 2026-08-04.** Fully executed. The pinned manifest is committed at
> `services/api/catalog_bootstrap/manifest.json` (2.0 MB, 283 items) and the corpus was
> imported, attested and published through `catalog_admin bootstrap-import` →
> `attest-bootstrap` → `publish-bootstrap` (`ImportProvider.CATALOG_BOOTSTRAP`,
> migration `0019_catalog_bootstrap_provider`). The operator procedure lives in
> `docs/runbooks/system-catalog.md`. "Neon" throughout the text below means the
> catalog database, which has been **Cloud SQL for PostgreSQL 17** since 2026-07-27
> (ADR-0024); nothing about the mechanism changed with the move.
>
> **How to read the body below.** It is the decision as written on 2026-07-18 plus the
> Slice A/B build log, and the mechanism it describes is exactly what shipped. Two
> classes of statement in it are no longer current facts and are marked inline as
> *[As of …]*: the **285**-record figures (the corpus is **283** — see the amendment
> below) and the **inert/feature-disabled** state (`SYSTEM_CATALOG_ENABLED` is now
> **true**, and the corpus is imported, attested and published). What has *not* changed:
> bootstrap is still never automatic — Alembic and application startup still insert and
> publish nothing, and production publication is still an owner-run, approval-gated CLI
> action.

> **Amendment, 2026-07-19.** The corpus is now **283 records**, not 285. The owner removed
> `grover-4bit-search` and `simon-query-circuit` — the two community submissions the
> first-party license grant of ADR-0016 could not reach — from the source corpus outright,
> rather than carrying them as permanently-private records. Nothing about the mechanism below
> changes: the manifest is still generated from the assembled TypeScript entries at a pinned
> commit, and the count is derived, never asserted. The category breakdown becomes 29 gates,
> 60 operators, 13 states, and **181** algorithms — both removed records were `algorithms`.
> The figures in the body are the numbers as of the original decision; they are left as
> written and each is marked inline with the current count.

> **Amendment, 2026-08-12 — the sync is now run by the deploy pipeline, not by hand.**
> *(Status, end of day: **LIVE**. `CATALOG_SYNC_ENABLED` is `true` and the step ran
> unattended on deploy 31599927661 at 13:22:43Z — it resolved its own reviewer through the
> standing grant, imported, attested and published the whole manifest with nothing refused.
> The published corpus went **258 → 342**. It spent most of the day parked behind that
> variable after its first run refused on two live reviewer grants; that refusal was the
> guard working, and what cleared it is recorded below and in `desk/decisions/Leona.md`.)*
>
> **Owner ruling, 2026-08-12 (ai-ops#13) — the step stays, and switches on when someone can
> watch a deploy through.** The question put to the owner was whether every deploy should copy
> the corpus into the live database at all, with three options: keep it and switch it on under
> supervision, keep it but leave it off indefinitely, or take the step back out and return to
> copying by hand. The answer was the first. So *whether* is closed and only *when* is open —
> and "when" is a data condition, not a further decision: the sync switches on once no record
> is refusing its attestation, and the flip is `gh variable set CATALOG_SYNC_ENABLED --body
> true` with no code change.
>
> **Two blockers stood in the way; one is now gone.** The reviewer ambiguity that parked the
> step is resolved — `pick_standing_reviewer` gained a signature-count narrowing, and the
> read-only `reviewers` report has printed `VERDICT: exactly one eligible account has signed`
> on every deploy since (one of the two grants was never used, so there is nothing to choose
> between). What remains is the records whose provenance claim moved, which need a human
> signature by name; `catalog_admin attest-plan` names them off a deploy log.
>
> **The order is signature first, variable second, and that is not merely caution.** Flipping
> the variable while records are refusing runs the import — which resets a changed record's
> `review_state` to DRAFT and takes it off `/repository` — and then exits at the attest step
> before `publish-bootstrap` runs. The corpus would be left staged and unpublished, which is a
> worse state for a reader than the staleness this amendment exists to end.
> This narrows one sentence in the status note above ("production publication is still an
> owner-run, approval-gated CLI action") and nothing else. `deploy.yml`'s final step,
> `sync the published catalog`, runs `catalog_admin sync-bootstrap --attested-by-standing`
> against production on every deploy, through the Cloud SQL Auth Proxy the migrate step
> already starts.
>
> **Why the original rule had to move.** "Later TypeScript changes require a new pinned
> manifest release and explicit import job rather than automatic sync" was written to keep
> the *runtime* from reading the TypeScript corpus — and it still does. What it also did,
> unintentionally, was make every corpus content change depend on a human remembering to
> create a throwaway Cloud Run job against the production database. That step was skipped:
> two corrected author names (`Matthew J. O'Rourke`, `David C. McKay`) shipped to the map on
> 2026-08-03 and were still absent from the catalog rows on 2026-08-11, with the site
> serving the wrong names for eight days and no signal anywhere that it was doing so. A gate
> whose safe path is "someone will run the command" is not a gate; it is an unwritten brief.
>
> **What is unchanged, and deliberately so.** Alembic and application startup still insert
> and publish nothing — this is a pipeline step, not a runtime or migration behaviour, which
> is the distinction the original decision actually protects. What is imported is still a
> **pinned manifest release**: CI's drift guard refuses any PR whose regenerated
> `manifest.json` is not committed alongside the corpus edit, so the manifest at the merged
> commit is the pinned artifact, and `BootstrapManifestSource` re-verifies its whole-manifest
> checksum and every per-item sha256 before staging. The import job is still **explicit** —
> it is a named step running the same CLI, not a background reconciler.
>
> **Approval gating is preserved rather than automated away.** `--attested-by-standing`
> cannot name a principal: it resolves to the account that *already* holds ADMIN on the
> catalog workspace, which only a human running `attest-bootstrap` by hand can create
> (`grant_catalog_reviewer` is the sole path to that role). So an unattended run can continue
> an existing grant and can never widen who holds one. It refuses when nobody holds the
> grant and when two live accounts do. And `plan_re_attestation` is untouched: a record whose
> **provenance claim** moved still refuses outright, keeps its previous version live, and
> waits for a person to look at it and name it with `--re-attest`. The standing grant it
> applies is the owner's committed statement in `catalog_bootstrap/attestation-policy.json`,
> reviewed like any other file.
>
> **Reversal.** Delete the `sync the published catalog` step from `.github/workflows/deploy.yml`.
> Nothing else depends on it; the CLI keeps working by hand exactly as documented. Doing so
> restores the eight-day staleness failure above, so restore the hand step in the same breath.

**Context:** The latest integrated `dev` baseline validates 285 TypeScript Atlas
records: 29 gates, 60 operators, 13 states, and 183 algorithms *[figures as of
2026-07-18; the corpus is 283 records — 29/60/13/181 — since the 2026-07-19 amendment
above, and the committed manifest holds 283 items]*. Neon must become the
default catalog authority without losing this work, but copying rows in a migration,
reading TypeScript at runtime, or trusting legacy verification/license strings would
create dual sources of truth and bypass the new acceptance contract.
**Decision:** Generate a deterministic, schema-versioned bootstrap manifest from the
285 *[read: 283]* records at one pinned source commit. The manifest stores source commit, generator
version, deterministic ordering, per-item source hashes, and a whole-manifest checksum.
A dedicated local bootstrap connector submits it through the normal durable importer;
every item receives provenance, rights, classification, deduplication, review, and
evidence states. Automatic bootstrap is deferred and is not enabled by this PR:
*[as of 2026-07-18: "`SYSTEM_CATALOG_ENABLED` remains false" — it is **true** on both
live Cloud Run services since the 2026-07-19 cutover]*, and no bootstrap command or
startup hook runs implicitly *(still true)*. A later reviewed step may let fresh
development and preview Neon branches
run an explicit idempotent post-migration bootstrap command behind a separate operator
flag. Alembic and application startup never insert or publish catalog data. Production
bootstrap/publication remains approval
gated. All 285 *[read: 283]* items remain auditable even when an item is quarantined or rejected;
only accepted/public records appear in anonymous reads. Existing `verified` labels,
tiers, prose, and license descriptions are source claims, not passing run evidence or
legal approval. After import, Neon is authoritative; later TypeScript changes require
a new pinned manifest release and explicit import job rather than automatic sync.
**Consequences:** Existing catalog work can populate new Neon environments
reproducibly while the runtime and public API remain single-source. The cost is a
manifest generator, schema/version policy, per-item import outcomes, checksum and
idempotency tests, a 20-item proof, full 285-item *[read: 283-item]* reconciliation, and a deliberate UI
cutover. The TypeScript source files remain untouched by backend importer PRs. A failed
bootstrap cannot partially publish: accepted state is per reviewed item, and the job
report accounts for every manifest item. Reversal trigger: once the TypeScript surface
is retired, future bootstrap releases may be exported from Neon itself, but the pinned
manifest and its import evidence remain immutable historical provenance.

**Implementation status.** *Slice A and Slice B below are the build log as written at the
time each slice landed; both are superseded by the executed state in the status
correction at the top of this file.*
- *Slice A (landed, PR #73):* deterministic manifest generator + committed
  `services/api/catalog_bootstrap/manifest.json` (285 items at the time, per-item +
  whole-manifest hashes; **283 items** since the 2026-07-19 amendment).
- *Slice B (this change):* the local bootstrap connector. The importer is now provider-agnostic
  (`catalog_import_sources.ImportSource`); `catalog_bootstrap_manifest.BootstrapManifestSource`
  loads the pinned manifest, re-verifies the whole-manifest checksum and every per-item sha256
  fail-closed at construction, and submits the embedded bytes through the unchanged durable
  importer. `ImportProvider.CATALOG_BOOTSTRAP` (DB CHECK extended in migration 0019) records the
  distinct provenance. `catalog_admin bootstrap-import` runs it in-process (idempotent via a
  checksum-derived key); a full manifest reconciliation test asserts DB-stored hashes equal the
  manifest's. *[As of Slice B: "still inert to users: records stage `private`/`draft`, nothing
  publishes, and `SYSTEM_CATALOG_ENABLED` stays false." That describes the end of Slice B only.
  The corpus was imported, attested and published on 2026-07-19 —
  `catalog_admin bootstrap-import` → `attest-bootstrap` → `publish-bootstrap` — and
  `SYSTEM_CATALOG_ENABLED` is true in production; the records are accepted/public and serve
  `/repository`.]* Bootstrap records stage with `execution_state=template_only`
  / framework version `unknown` (honest — the manifest is catalog metadata, not executed circuits);
  mapping the manifest's richer fields into the read model is Slice C's concern.
