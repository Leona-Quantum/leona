# Runbook: the system catalog (provision, import, attest, publish)

The public `/repository` corpus is not a fixture and not a migration. It is 283 records
staged, reviewed and published through the durable importer by four CLI commands, and
this file is the only written record of how to run them.

Supersedes `neon-system-catalog.md`, archived at
`docs/archive/repository-migration-2026-07/`. That file's temporary-Neon-branch procedure
is dead — the database has been **Cloud SQL for PostgreSQL 17** since 2026-07-27
(ADR-0024) and has no branching. Everything below is the half that is still live,
checked against the code on 2026-08-04.

Decisions this implements: **ADR-0016** (system catalog authority), **ADR-0019** (pinned
bootstrap manifest), **ADR-0020** (append-only license history).

## Safety invariants

- `DATABASE_URL` is what the API, the worker, the tests and every command here read.
  `DATABASE_URL_DIRECT` is Alembic's, and only Alembic's.
- Migrate against a local `postgres:17` before you migrate production. `runbooks/auth-dev.md`
  has the one-container setup; CI's `db` job runs the same image.
- Keep both URLs out of shell history, screenshots, chat, logs, Vercel, and any
  client-side variable.
- Stop on any unexpected row count, identity mismatch, migration error, or scope-test
  failure. The counts below are assertions, not estimates.
- Drain or stop worker instances before a production migration.

## The three identity UUIDs

Generated once, then never changed. They are stable identifiers, not passwords, and
they are plain configuration on both Cloud Run services — a client never supplies them.

```bash
uuidgen   # SYSTEM_CATALOG_WORKSPACE_ID
uuidgen   # SYSTEM_CATALOG_IMPORTER_USER_ID
uuidgen   # SYSTEM_CATALOG_PUBLIC_READER_USER_ID
```

All three must differ, and API and worker must carry identical values —
`catalog_authority.py` refuses to construct an authority with any of them missing when
`SYSTEM_CATALOG_ENABLED` is on. The worker needs them too: it reads `CatalogAuthority`
config for `catalog.import` jobs (`runbooks/deploys.md § Deploy the worker`).

## Migrate and provision

```bash
uv run --package majorana-api alembic -c db/alembic.ini upgrade head
uv run --package majorana-api alembic -c db/alembic.ini downgrade 0012
uv run --package majorana-api alembic -c db/alembic.ini upgrade head
uv run --package majorana-api python -m majorana_api.catalog_admin provision
```

The three Alembic commands read `DATABASE_URL_DIRECT`; `provision` reads `DATABASE_URL`.
Run the up→down→up against local Postgres, not production — it is the reversibility
check, not a deploy step.

**Provisioning is idempotent and must finish with `artifacts=0`.** A second run reports
the same workspace and still zero artifacts. It is the only command here that works with
the feature flag off: it calls `require_configured()` — which asks whether the three IDs
are set, not whether the feature is on — and never enters a scoped repository call.

Do not turn `SYSTEM_CATALOG_ENABLED` on merely because provisioning succeeded.

## The `SYSTEM_CATALOG_ENABLED` trap

**The other three commands need `SYSTEM_CATALOG_ENABLED=true` in their own shell.**

`bootstrap-import`, `attest-bootstrap` and `publish-bootstrap` all go through the catalog
scope checks, and `get_importer_workspace` (`repos/catalog.py`) opens with
`if not authority.enabled or not authority.is_importer_scope(scope)`. With the flag off
they fail immediately on the first clause with `AuthzError: invalid catalog importer
scope` — which reads like a permissions problem and is not one.

```bash
export SYSTEM_CATALOG_ENABLED=true    # this shell only
```

Setting it for a local admin command exposes nothing: no server reads this process's
environment. It is a separate decision from what the deployed services carry.

## Import, attest, publish

Only after `provision` reports `artifacts=0` and the live gates pass. All three read
`DATABASE_URL` and are idempotent — a partial run is resumed by re-running it.

```bash
uv run --package majorana-api python -m majorana_api.catalog_admin bootstrap-import
uv run --package majorana-api python -m majorana_api.catalog_admin attest-bootstrap  --attested-by "<your user id>"
uv run --package majorana-api python -m majorana_api.catalog_admin publish-bootstrap --attested-by "<your user id>"
```

**`bootstrap-import`** must report `accepted=283 rejected=0 dead=0`. Anything else means
the pinned manifest and the database disagree — stop rather than re-running. It submits
`services/api/catalog_bootstrap/manifest.json` through the unchanged durable importer as
`ImportProvider.CATALOG_BOOTSTRAP`, re-verifying the whole-manifest checksum and every
per-item sha256 fail-closed at construction. Records stage with
`execution_state=template_only` and framework version `unknown` — honest, because the
manifest is catalog metadata, not executed circuits.

**`--attested-by` is the owner's own user id** — a real, already-provisioned human
account. It cannot be a service identity: `attest-bootstrap` grants that account ADMIN on
the catalog workspace and then uses it as the reviewer, and both the CLI and the
repository layer refuse the importer and public-reader identities. That separation is the
point of ADR-0016 — the importer stages content, a named person approves it. Look the id
up (`select id from users where email = '<you>'`); it is not a secret.

**`attest-bootstrap`** applies the committed attestation policy
(`services/api/catalog_bootstrap/attestation-policy.json`) to the staged corpus, writing a
provenance row, a declared license carrying the policy's SPDX id, an approved reviewer
decision, and review acceptance for each covered record. The policy's statement and
checksum are recorded on every audited row, so a published record traces back to the exact
sentence that was signed. **It publishes nothing.** Expect `attested=283 excluded=0`.

**The policy is fail-closed, in both directions.** A record it neither includes nor
explicitly excludes aborts the run — if you regenerate the manifest and a record appears
whose `source.kind` the policy never considered, that abort is correct. Extend the policy
deliberately; do not loosen it. An `excluded_identities` entry naming a record the
manifest no longer contains also aborts. The corpus once carried two community submissions
the first-party CC-BY-4.0 grant could not reach; they were removed from the source corpus
outright (owner decision, 2026-07-19), so the policy now carries no exclusions and the
grant covers every record that exists.

**`publish-bootstrap`** re-evaluates readiness per record and refuses any that is missing
a binding, so an unattested record cannot ride along — it is reported as blocked and left
private. Expect `published=283 blocked=0`.

Changing the license, or attesting records the current policy excludes, is a policy-file
edit plus a normal review. Never a flag and never a command-line override.

### When `attest-bootstrap` refuses — `--re-attest`, and why it names identities

A record whose **provenance claim moved** is refused rather than re-signed: the grant on
file was given about a stated origin, and that origin is now a different sentence. The run
prints them under `needs_signature` and writes nothing. This is `AttestedRecord.grant_carries_forward`
doing its job, and the most common cause is a corrected citation — a source whose title
was wrong and has been fixed.

Until session 101 the refusal had **no escape hatch**: the message said to re-attest them
deliberately and there was no flag, no subcommand, and no way to do it. Re-running produced
the identical refusal forever. `--re-attest` is that hatch, and it is deliberately *not*
`--force`:

```bash
uv run --package majorana-api python -m majorana_api.catalog_admin attest-bootstrap \
  --attested-by-email "<you>" --re-attest "<identity>,<identity>,…"
```

**The named set must equal the refused set in both directions**, or nothing is written:

- *named but not refused* — the list was written against an earlier state, so whatever was
  examined is not what this run is doing. **A successful re-attest run lands here on the
  second run**: it left nothing refused, so repeating the identical command is now a stale
  list. Drop the flag on later runs.
- *refused but not named* — a refusal appeared after the list was written. Continuing would
  attest it on the strength of a decision taken about other records. A `--force` cannot
  express this direction at all, which is the reason the flag takes identities.

`--re-attest ""` is an error rather than a synonym for omitting it: an operator who believes
they authorised something and did not should not get a run that prints `re_signed=0` under a
command line that says otherwise. A repeated identity is an error too — the list is a
hand-assembled decision record, and a repeat is the signature of one assembled from two
sources, where the second is the stale list this reconciliation exists to catch.
`parse_re_attest` and `plan_re_attestation` are pinned without a database in
`services/api/tests/test_catalog_attestation.py`.

Because the attest step *exits* on a refusal, `publish-bootstrap` never runs either — so the
visible symptom is a live corpus stuck at the old count, not an error page. Session 101 read
`x-catalog-total: 274` against a manifest of 283 for exactly this reason.

## Running these against **production**

Everything above assumes a shell that already holds `DATABASE_URL`. Production's lives in
Secret Manager and is mounted only into the Cloud Run services, so there is no laptop shell
that can reach the instance without first copying a production credential onto a laptop.
Don't. Run the command *inside* the deployment boundary instead, as a throwaway job:

```bash
gcloud run jobs create leona-admin-oneshot \
  --project=majorana-core --region=us-west1 \
  --image="$(gcloud run services describe majorana-api --project=majorana-core \
      --region=us-west1 --format='value(spec.template.spec.containers[0].image)')" \
  --service-account=639400385957-compute@developer.gserviceaccount.com \
  --set-cloudsql-instances=majorana-core:us-west1:majorana-pg \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --set-env-vars="MAJORANA_ENV=production,SYSTEM_CATALOG_ENABLED=true,\
SYSTEM_CATALOG_WORKSPACE_ID=41599712-a347-494f-a556-c2ced8387408,\
SYSTEM_CATALOG_IMPORTER_USER_ID=13a0d9bb-b4fd-4ff2-9a16-f0cff72e9f87,\
SYSTEM_CATALOG_PUBLIC_READER_USER_ID=bb0a3564-598e-463e-9256-425ae2d7dba9" \
  --memory=2Gi --cpu=2 --max-retries=0 --task-timeout=3600s \
  --command=python \
  --args="^~^-m~majorana_api.catalog_admin~sync-bootstrap~--attested-by~<your-user-id>"

gcloud run jobs execute leona-admin-oneshot --project=majorana-core --region=us-west1 --wait
```

The job's stdout goes to Cloud Logging, not to the terminal — read it back with
`gcloud logging read` filtered on
`labels."run.googleapis.com/execution_name"="<execution>"`. A whole `sync-bootstrap` over
283 records takes well under a minute.

**Delete the job when you are done.** `gcloud run jobs delete leona-admin-oneshot`. Left in
place it is a standing, re-runnable handle on the production database that anyone with
`run.jobs.run` can fire, which is a larger grant than the task needed.

**The `^~^` in `--args` is a gcloud delimiter override**, not a typo: the default separator
is a comma and `--attested-by` values are fine, but any argument containing a comma would be
silently split into two.

### Finding the reviewer — use `--attested-by-email`, not a hand-copied UUID

**`--attested-by-email <you>` resolves the row and refuses if it is ambiguous.** Prefer it.
The alternative is running an ad-hoc query against production, reading the rule below
correctly, and pasting a UUID into a shell — three steps that each have to go right, to
reach a decision the code can make. It prints the id it chose before using it.

```bash
  --args="^~^-m~majorana_api.catalog_admin~sync-bootstrap~--attested-by-email~<you>"
```

Two *live* rows for one email refuses rather than choosing, names both ids, and points at
`--attested-by` — that case is a decision nobody has made, and making it silently is how a
grant lands somewhere nobody looked. `pick_live_reviewer` is the rule and
`services/api/tests/test_catalog_admin_reviewer.py` pins it without a database.

**The rule it implements, because it is the opposite of the obvious one.**
`select id from users where email = '<you>'` can return **two** rows. The environment switch
(see `plans/` and `memory/DECISIONS.md`) minted new user rows, and the reattachment moved the
live WorkOS id back onto the *original* row while renaming the duplicate's to
`retired-workos-env:<timestamp>:<original-id>`. **The live account is the one whose
`workos_user_id` has no `retired-workos-env:` prefix** — which is the older row, not the
newer one. Picking by `created_at` gets it backwards, and `attest-bootstrap` grants that
account ADMIN on the catalog workspace, so the wrong pick is a real grant on a dead row.

```sql
select id, workos_user_id, created_at from users where email = '<you>' order by created_at;
```

### `--attested-by-standing` — the form with nobody at the keyboard

The deploy pipeline cannot type an email, and inventing a principal for it would be a grant
made by nobody. So it passes `--attested-by-standing`, which does not *name* an account: it
**continues** the one that already holds ADMIN on the catalog workspace.

That is a deliberately narrow power. `catalog.grant_catalog_reviewer` is the only path to
that role and it runs only inside an explicit `attest-bootstrap`, so the set this can choose
from is exactly the set some human already created by hand. **An unattended run can re-use a
grant; it can never widen who holds one.**

It refuses rather than guessing in every other case: nobody holds the grant (a fresh
environment — make the first attestation by hand with `--attested-by-email`), or two *live*
accounts do (it names both and points at `--attested-by`). Retired rows are excluded by the
same rule as above, which matters here because a workspace attested both before and after the
WorkOS reattachment carries **two** ADMIN memberships for one person — a duplicate, not an
ambiguity, and the pipeline resolves it instead of stopping. `pick_standing_reviewer` is the
rule; `services/api/tests/test_catalog_admin_standing_reviewer.py` pins it without a database.

Use it by hand only to check what the pipeline would do. For a real hand-run, name yourself.

### `reviewers` — who holds the grant, and what each has signed

```bash
uv run --package majorana-api python -m majorana_api.catalog_admin reviewers
```

Read-only: it writes nothing and attests nothing. Prints every ADMIN membership of the catalog
workspace with the number of `license_assertions` that account has actually signed, and marks any
that is a service identity or carries a retired WorkOS id.

**This is the command that answers a `--attested-by-standing` refusal.** A membership says an
account *may* review; a signature count says one *did*, and the account with the signatures is the
standing reviewer the flag continues. One eligible signatory means the flag can resolve the
workspace on its own; two, or none, is a decision a person has to make.

It prints **no email addresses** — deliberately, because it also runs in the deploy pipeline, whose
logs are retained. Which account signed is the fact the decision needs, and a UUID is what gets
passed back to `--attested-by`.

The parked branch of `deploy.yml`'s catalog step runs it on every deploy, so the run that reports a
stale catalog also reports why and who could fix it.

## Live gates

```bash
uv run pytest services/api/tests/authz -q
uv run --all-extras pytest services/api/tests/test_pipeline_e2e.py -q
```

If `uv run` stops before executing because an untracked directory under `packages/py/`
matches the uv workspace glob without a `pyproject.toml`, that is a local workspace
discovery problem, not a database failure. Run in a clean checkout or CI, or fall back to
the existing `.venv` with `PYTHONPATH` set across the `packages/py/*/src` and
`services/*/src` trees.

## Updating the published corpus

The catalog is authoritative once published. **A change to
`apps/web/lib/repository/entries-*.ts` does not reach the public site** while
`MAJORANA_PUBLIC_CATALOG_API` is on — see `deploys.md § The public catalog flag`. The
loop is: edit the entries → regenerate the manifest
(`node scripts/generate-catalog-bootstrap-manifest.mjs`) → `bootstrap-import` →
`attest-bootstrap` → `publish-bootstrap`.

**Since 2026-08-12 the deploy pipeline can run the last three for you — but it is PARKED
as of its first run.** `deploy.yml`'s step `sync the published catalog` runs
`sync-bootstrap --attested-by-standing` against production on every deploy, and is gated on
the repository variable `CATALOG_SYNC_ENABLED` being `true`. It is currently not set.

**Owner decision, 2026-08-12 (ai-ops#13): keep the step, and switch it on when someone can
watch a deploy through.** The alternatives on the table were leaving it off indefinitely and
taking it back out in favour of the hand step; both were declined. So the pipeline step is
permanent and the only open question is when the variable moves — which is what the two
blockers below answer. It is not "on hold pending a design decision"; it is finished code
waiting on data.

**Why it was parked.** On its first production run the step refused:

```
2 accounts hold the catalog reviewer grant
(019f5b84-d1ab-72a3-9c68-41416325b3f4, 019fb3ae-39f8-78b6-a04a-dfdfb847952f)
— an unattended run will not choose between them. Pass --attested-by explicitly.
```

Neither carries the `retired-workos-env:` marker, so this was **not** the environment-switch
duplicate that `pick_standing_reviewer` already resolves: two live accounts held ADMIN on
the catalog workspace.

**That half is settled, and the deploy is what settled it.** `pick_standing_reviewer` now
asks the stronger question — not who *may* review but who actually *has* — and the read-only
`reviewers` report has printed the same answer on every deploy since:

```
catalog reviewer grants: 2 ADMIN membership(s)
  019f5b84-d1ab-72a3-9c68-41416325b3f4  signed=1153
  019fb3ae-39f8-78b6-a04a-dfdfb847952f  signed=0
VERDICT: exactly one eligible account has signed
```

One of the two grants was never used, so there is nothing to choose between. Revoking the
unused one is tidying, not a precondition. Do not read the older instruction "resolve which
is the real reviewer, revoke the other" as still blocking — it is not.

**What is still blocking, and it is not the reviewer.** Records whose provenance claim moved
refuse to inherit the grant made about the old claim, and a person has to look at each and
re-sign it by name (*When `attest-bootstrap` refuses*, above). Until that happens the
variable must stay off, and the reason is sharper than "the deploy goes red":

- `bootstrap-import` stages the new content, which resets a changed record's `review_state`
  from ACCEPTED to DRAFT and takes it **off** `/repository`;
- `attest-bootstrap` then exits on the refusal, so `publish-bootstrap` never runs and the
  newly-imported records are never published.

So flipping the variable before the signature leaves the corpus staged and unpublished —
worse for a reader than the staleness the feature exists to fix, and red for every other
lane merging at that moment. **Signature first, variable second.** Once the refusals are
cleared, `gh variable set CATALOG_SYNC_ENABLED --body true` re-arms it in one command, with
no code change.

Until then every deploy prints a warning naming the parked state, so a stale catalog cannot
be silent.

### `attest-plan` — which records are waiting for a signature

```bash
uv run --package majorana-api python -m majorana_api.catalog_admin attest-plan
```

**Read-only: it writes nothing, grants nothing and attests nothing**, and it takes no
reviewer — there is no principal to name because nothing is signed. It reports what an
attest run *would* do: how many records take a first signature (and how many of those are
not imported yet), how many carry their grant forward, and **every** identity that needs a
fresh one, unsliced.

It exists because the refused set was otherwise unknowable without causing the refusal.
`attest-bootstrap` computes it, prints it and exits having already written every record it
did not refuse; `sync-bootstrap` does that in the middle of a production deploy. The one
question a person must answer before the variable can move could only be answered by running
the thing that is blocked on the answer.

Two properties worth knowing before acting on its output:

- **It works before the current manifest has been imported.** It resolves records by
  `upstream_identity` rather than through the import ledger. That is not a second
  reconciliation rule — `_advance_item` sets `resulting_artifact_id` from the same lookup, so
  for an already-staged record both paths name one artifact.
- **Its answer is stable across an import.** `latest_license_claim_hash` reads assertions
  across all versions and staging writes no assertion, so importing does not change which
  records refuse. Only an attest run does.

The parked branch of `deploy.yml`'s catalog step runs it on every deploy, next to
`reviewers`. Between them the two reports answer both halves of "can this be switched on
yet": who would sign, and whether anything would refuse.

It deliberately prints the identities one per line rather than as a ready-to-paste
`--re-attest` argument, and it deliberately does not accept `--re-attest` itself. The flag
exists to buy a look at each record; a pasteable string makes not looking the cheapest path,
and a dry-run that took the list would let an operator rehearse against the reconciliation
until it went green.

While parked, the loop below is still yours to run by hand, and a corpus content change does
NOT reach `/repository/<slug>` on merge. So the loop you are responsible for is: **edit the entries,
regenerate the manifest, commit both in the same PR, merge.** The manifest regeneration is
still yours — CI refuses the PR without it — and it is still what pins the release the
importer imports (ADR-0019, amended 2026-08-12).

Run the commands by hand when you are working against a **non-production** database, when
the pipeline step has refused and you are resolving it, or when you are making the **first**
attestation on a fresh environment — that one cannot be automated, because
`--attested-by-standing` continues an existing grant and a fresh workspace has none.

**When the pipeline step goes red, the deploy still succeeded.** It runs last, after the
stack has been verified live, so a refusal means the new revision is serving and only the
corpus content did not land. The usual cause is a moved provenance claim — see *When
`attest-bootstrap` refuses* above, resolve it with an explicit `--re-attest` run, and the
next deploy converges.

**Nothing is partially published, and the listing still gets shorter.** Both are true, and
the second one is the surprise. No record serves half-attested content — but the refusal
happens *after* the import, and staging a new version resets `review_state` to DRAFT, so
every record whose content changed in that deploy drops out of the browse listing until it
is attested. The public predicate is ACCEPTED **and** PUBLIC; a DRAFT record fails the first
half. Direct links to those records keep working, because the listing query is what filters
them, so the symptom is a `/repository` count that falls rather than an error anywhere.

This is not hypothetical and it is the state production has been in: a run refused 25
records and `x-catalog-total` went from 283 to 258. Read a falling count after a refusal as
the refusal, not as a second failure.

The step runs on **every** deploy rather than only when `manifest.json` changed. A no-change
run writes nothing (the importer compares hashes; publishing an already-public record is a
no-op), and a sync gated on "did this push touch the manifest" would be stale forever the
first time an event was missed.

**Check the manifest is current before running any of it**, or the import faithfully ships
the last generation's content and reports success:

```bash
node scripts/generate-catalog-bootstrap-manifest.mjs --check
```

**`manifest.source_commit` is not a commit you can look up.** It records the HEAD at
generation time, and every PR here lands squash-merged, so the sha it names stops existing
the moment the branch is squashed — the current manifest's `1d22cfab` resolves to
`fatal: bad object`. Content integrity does not depend on it (the whole-manifest checksum
and the per-item sha256 do), but do not read it as a pointer into this repository's history.

## Failure and rollback

- Migration fails → stop. Do not retry against production. Diagnose against local
  Postgres.
- `provision` reports an identity mismatch or nonzero artifacts → stop. Do not delete or
  alter rows until the conflicting ownership is understood.
- Live tests fail → keep `SYSTEM_CATALOG_ENABLED=false` on the deployed services.
- **Migration 0013 refuses downgrade while a system workspace exists.** This prevents an
  operator from silently orphaning or reclassifying catalog data. Deprovisioning is a
  separate reviewed action after proving the workspace is empty.
- **License history cannot be repaired in place.** Migration 0018 installs a
  `BEFORE UPDATE OR DELETE` trigger on `license_assertions` (ADR-0020); a correction is a
  new row linked through `supersedes_assertion_id`. Emergency alteration requires an
  explicit privileged database action and an audit, not an application transaction.

Record the Alembic revision, the up→down→up result, test counts and the four command
counts in the PR. Record no connection strings or credentials.
