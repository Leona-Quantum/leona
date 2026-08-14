# Runbook: security and availability incidents

`plans/rebuild/05-security.md` §3 names this file as an in-repo deliverable —
"severity ladder, kill switches, evidence preservation, rotation order, and a
post-incident ADR requirement". It did not exist. This is that document.

**Read the two warnings before using it.**

1. **Every `TODO(owner)` below is a decision only Eshaan can make** — who is
   woken, which channel, what counts as Sev-1. They are left empty on purpose. A
   runbook with invented contacts is worse than no runbook, because it is trusted
   in the one moment nobody has time to check it.
2. **The levers in §4 are the ones that exist today**, verified against the code
   on 2026-08-14. Where `05-security.md` names a control that was never built,
   this file says so rather than describing it.

---

## 1. Severity ladder

Severity decides who is woken and how fast, so the thresholds are the owner's to
set. The *shape* below is a proposal; the numbers are not filled in.

| Sev | Meaning | Examples |
|---|---|---|
| **1** | Confirmed cross-tenant data exposure, credential compromise, or sandbox escape | One workspace's artifacts served to another; a live provider key in a public place; code escaping the microVM |
| **2** | The product is down or unusable for most users | API 5xx across the board; every run failing; sign-in broken for everyone |
| **3** | A subset is affected, or a control is degraded but nothing is exposed | One framework lane broken; the catalog stale; rate limiting off |
| **4** | Cosmetic or latent — worth a ticket, not a page | A gate check red for a known reason; a stale doc |

- TODO(owner): response-time expectation per severity, if any.
- TODO(owner): who is woken at Sev-1 and Sev-2, and by what channel.
- TODO(owner): who declares an incident, and who declares it over.

**One rule that is not the owner's to set, because it follows from the threat
model:** *suspected* cross-tenant exposure is handled at Sev-1 until it is ruled
out. `05-security.md` §0 ranks it third of six, and it is the one failure mode
that gets worse silently while you decide whether it is real.

## 2. First five minutes

Do these in order. The first three cost nothing and are reversible.

1. **Write down the time and what you saw**, before you touch anything. It
   becomes the incident record and it is the thing nobody reconstructs later.
2. **Do not fix it yet.** If tenant data or a credential may be involved,
   preserve evidence first (§5) — several of the kill switches in §4 restart
   processes, and in-process state is gone when they do.
3. **Decide the severity** from §1. If unsure, treat it as the higher one.
4. **Reach for the narrowest lever in §4 that stops the bleeding.** Whole-service
   levers are listed last for a reason.
5. TODO(owner): where the incident is announced, if anywhere.

## 3. Where to look first

Two minutes here before reaching for a lever in §4 — the two deploy pipelines
are independent, and treating them as one wastes the first move in most
incidents.

### Which pipeline actually broke

`apps/web` (Vercel, self-deploys from `dev`) and `services/api` / `services/worker`
(Cloud Run, shipped by `.github/workflows/deploy.yml` on merge to `dev`) are two
independent deploys that share a trigger, not one. A bad push to `dev` can break
either, both, or neither, and the failure mode tells you which:

- **Web looks broken** (page errors, blank screens, stale content) — check
  https://vercel.com/majoranaq/web/deployments first. Confirm what is actually
  *live* by reading `data-dpl-id` out of the served HTML rather than trusting
  the commit status, which misreports in both directions:
  ```
  curl -s https://leonaqt.com/ | grep -o 'data-dpl-id="[^"]*"'
  ```
- **API/worker looks broken** (runs not starting, 5xx from the API, catalog
  stale) — check https://console.cloud.google.com/run?project=majorana-core,
  or directly:
  ```
  gcloud run services describe majorana-api --project majorana-core \
    --region us-west1 --format='value(status.latestReadyRevisionName,status.traffic)'
  ```
- **Both** is a coincidence of timing, not a shared cause — they ship through
  unrelated infra from the same merge event. Diagnose each independently.
- **The GitHub Actions run is the fastest single signal for the Cloud Run
  side**: `gh run list --repo EshMis/majorana --workflow=deploy.yml --limit 5`
  — red there implicates the api/worker deploy; green clears it as the cause
  and points you at Vercel or at something that isn't a deploy at all.

### The database is lost or corrupted

Stop before touching anything. The restore procedure and the measured RTO live
in `docs/runbooks/database.md` § Backups and the restore drill — do not copy
the commands here, follow them there, and see § Rolling back → Database below
for the pointer.

### The worker is wedged, or the queue is not draining

Symptoms: runs stay `queued` past their expected start; `jobs` rows are not
advancing; no fresh lines in Cloud Run logs for `majorana-worker`.

1. **Confirm it's the worker, not the queue logic** — a crash-looping revision
   (repeated restarts) is a different problem than a healthy revision that
   simply isn't claiming jobs:
   ```
   gcloud run services describe majorana-worker --project majorana-core \
     --region us-west1 --format='value(status.conditions)'
   ```
2. **A stuck lease is not itself a bug.** A worker that died mid-job holds its
   `jobs` row until `recover_stale_jobs`'s heartbeat timeout reclaims it — see
   `docs/runbooks/database.md` § Why N workers are safe for the mechanism.
3. **The fastest lever, because there is exactly one worker today:**
   `WORKER_INSTANCES=1` in `infra/fleet.env` (`docs/runbooks/database.md` §
   Changing the worker count). One wedged instance is the whole fleet, and
   raising the count is one edit and one push:
   ```bash
   # infra/fleet.env
   WORKER_INSTANCES=1    # bump to 2 or 3 temporarily; 4 does not fit the
                          # connection budget — read that section first
   ```
   A fresh instance starts claiming jobs immediately — `claim_job` is
   `FOR UPDATE SKIP LOCKED`, so this is safe mid-incident. Revert the same way
   once resolved.
   - To restart the single instance without changing the count or shipping
     code: `gcloud run services update majorana-worker --project majorana-core
     --region us-west1 --update-env-vars INCIDENT_RESTART=$(date +%s)` forces a
     new revision immediately.
4. If the worker is healthy and claiming jobs but they aren't finishing, the
   wedge is downstream — an LLM provider or the sandbox provider — not ours;
   check their status pages before assuming otherwise.

### The API is down or erroring

1. `curl -sI https://<api-host>/health` — distinguishes "not responding" from
   "responding with errors" (`EXEMPT_PATHS` in `rate_limit.py`, so this call is
   never itself rate-limited).
2. `gcloud run services describe majorana-api --project majorana-core --region
   us-west1 --format='value(status.conditions)'` — crash-looping vs.
   serving-but-wrong.
3. Read the actual error rather than guessing:
   ```
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="majorana-api" AND severity>=ERROR' \
     --project majorana-core --freshness=15m --format=json --limit=50
   ```
4. Check Sentry — live on api+worker with real DSNs and `MAJORANA_ENV=production`
   as of the `observability` lane's latest check (superseding the "written but
   switched off" state `docs/runbooks/observability.md` records as of
   2026-08-14 — confirm that doc's current wording before trusting this line,
   since it may already have been updated). It carries the stack trace that
   logs alone won't.
5. Likeliest causes, roughly in order: a bad env var from the last deploy (the
   `--update-env-vars` vs. `--set-env-vars` trap, `docs/runbooks/deploys.md`),
   the connection budget exhausted (`docs/runbooks/database.md` § Connection
   budget), or a downstream dependency — database or LLM provider — down rather
   than the API itself.

### Consoles, first stop

| System | URL | Check first |
|---|---|---|
| Cloud Run (api, worker) | console.cloud.google.com/run?project=majorana-core | Revision status, traffic split |
| Cloud SQL | console.cloud.google.com/sql/instances/majorana-pg/overview?project=majorana-core | CPU/connections/storage, backup status |
| Cloud Logging | console.cloud.google.com/logs/query?project=majorana-core | Filter on `resource.labels.service_name` |
| Vercel | vercel.com/majoranaq/web | Deployments tab — which one is Promoted |
| GitHub Actions | github.com/EshMis/majorana/actions/workflows/deploy.yml | Which deploy ran, and whether it was green |
| WorkOS | dashboard.workos.com | Session/user lookup, revocation (§4) |
| Sentry (once armed) | org `majorana-ms`, projects `python` / `web` | Stack traces — `docs/runbooks/observability.md` |

## 4. Kill switches — what actually exists

Every environment variable below is set on the **api** and/or **worker** Cloud
Run services. Changing one is a new revision: it takes effect in about a minute
and is reverted the same way. `docs/runbooks/deploys.md` §Environment has the
exact `gcloud run services update` shape.

### Stop hardware submission (narrowest, instant)

```
MAJORANA_QPU_SUBMIT_ENABLED=false      # api AND worker
```

`POST /v1/qpu/submissions` then refuses with `blocked_reason=submission_disabled`
on every account, no tier exempt. Already the default; only set otherwise
deliberately. Hardware runs spend the **user's own** IBM credential, so this is
about protecting users and the platform's standing with IBM, not our bill.

### Stop the public catalog / demo surfaces

The anonymous surface is what an attacker reaches without an account. **Two
different flags, on two different services, and only one of them actually closes
the API** — getting these the wrong way round would leave the surface open while
looking like it had been shut.

```
SYSTEM_CATALOG_ENABLED=false           # api    — closes /v1/catalog/*: every
                                       #          route 404s (catalog_authority
                                       #          .public_scope raises, and
                                       #          auth/catalog_deps turns that
                                       #          into a 404)
MAJORANA_PUBLIC_CATALOG_API=false      # VERCEL  — does NOT close anything. It
                                       #          switches the web app from the
                                       #          live API to the bundled static
                                       #          corpus, so the site keeps
                                       #          working and the API stays open
MAJORANA_PUBLIC_DEMO=false             # VERCEL  — the /demo page
```

Setting the Vercel flag alongside the API one is what keeps the public pages
serving during the incident instead of erroring. See `docs/runbooks/deploys.md`
§"The public catalog flag". Turning the API one off has a visible product cost,
so it is a Sev-1/2 lever, not a first resort.

### Throttle anonymous traffic instead of stopping it

```
ANON_RATE_LIMIT_PER_MINUTE=<n>         # api; default 1200, per instance
```

**Read `services/api/src/majorana_api/rate_limit.py` before trusting this.** The
counter is in process memory, so the effective fleet ceiling is `n ×
API_MAX_INSTANCES` (`infra/fleet.env` — read it live, it has moved more than
once), it resets on cold start, and an
attacker rotating more than 20,000 source addresses inside one window fills the
table and the limiter admits everything by design. It is a backstop against one
hammering script, not against a botnet. `0` disables it entirely — that is the
escape hatch for when it is refusing real readers, and it is the wrong direction
during an abuse incident.

### Stop all run execution

**There is no feature flag for this.** `05-security.md` §3 names a "disable runs
feature flag"; it was never built, and this runbook does not pretend otherwise.

What exists instead — scale the worker to zero:

```
gcloud run services update majorana-worker --region us-west1 \
  --min-instances 0 --max-instances 0
```

Runs already submitted stay queued in `jobs` and resume when the worker comes
back; the queue is `FOR UPDATE SKIP LOCKED` with leases and heartbeats, so this
is safe to do mid-flight. Users see submissions accepted and never progressing,
which is a worse experience than an honest refusal — hence the TODO below.

- TODO(owner): whether a real `RUNS_ENABLED=false` flag is worth building. It is
  the difference between "your run is stuck" and "runs are paused, try later",
  and it is the one kill switch the gate asks for that does not exist.

### Revoke sessions / lock out a user

WorkOS AuthKit owns sessions. There is no in-product revocation endpoint.

- Revoke a session or ban a user from the **WorkOS dashboard** (User Management →
  the user → Sessions).
- Access to a *workspace* is revoked in-product: remove the membership. It takes
  effect on that user's **next request**, not their next sign-in —
  `resolve_active_workspace` re-reads the membership row on every request
  (`repos/system.py`). As of the audit-log change, that removal writes a
  `workspace.member_removed` row.
- A revoked WorkOS session's JWT stays valid until it expires. TODO(owner):
  confirm the access-token lifetime configured in WorkOS, because it is the
  actual upper bound on "how long after revocation can they still call the API".

### Stop the whole API

Last resort — it takes the product down.

```
gcloud run services update majorana-api --region us-west1 --max-instances 0
```

Prefer routing traffic to a known-good revision instead (§7).

### Cut off a provider's spend

Rotate or revoke the key at the provider (OpenAI / DeepSeek / Anthropic), then
update the secret. Names, never values, are in `docs/runbooks/secrets.md`.
There is no in-product spend cap; the per-user weekly allowance
(`reserve_execute_run_slot`) is the only bound, and it is per account.

## 5. Evidence preservation — before you restart anything

Several levers above replace the running revision. Do this first.

1. **`audit_log`** — append-only at the database (migration 0050 revokes UPDATE
   and DELETE from `app_rw` and adds triggers), so it cannot be tampered with by
   the application. It records catalog actions, project-share actions, and — as
   of the audit-log change — deletions, member removal, role changes and
   ownership transfer. **It does not record auth events**; do not go looking for
   sign-ins here.
2. **`run_events` and `usage_events`** — also append-only, same migration. The
   run timeline and the spend record.
3. **Cloud Run request and container logs** — these expire. Export the window
   before it rolls off:
   ```
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name="majorana-api"' \
     --freshness=2h --format=json > incident-<date>-api.json
   ```
   Note the asynchronous-ingestion trap recorded in
   `docs/gates/sandbox-egress-2026-08-07.md`: a log queried immediately after an
   event may not contain it yet, and that produced a security gate that passed
   for the wrong reason. Wait, then re-read.
4. **The served page's deployment id** — `data-dpl-id` in the HTML says which
   Vercel deployment a user actually got, which the commit status does not
   reliably report.
5. TODO(owner): where exported evidence is stored. Not in this repository — it is
   public.

## 6. Rotation order

If a credential may be exposed, rotate in this order. It is dependency order, not
importance order: rotating out of order locks you out of the thing you need next.

1. **The founder accounts first if any could be compromised** — GitHub, Vercel,
   GCP, Neon/Cloud SQL, WorkOS, Anthropic/OpenAI. Everything else is reachable
   from these, so rotating a leaf key while the root is compromised buys nothing.
2. **`MAJORANA_CREDENTIAL_KEYS`** — the Fernet keys for stored user IBM
   credentials. **Prepend the new key, never replace the list**; replacing it
   makes every stored credential undecryptable at once. Full procedure:
   `docs/runbooks/secrets.md` §"Rotating MAJORANA_CREDENTIAL_KEYS".
3. **LLM provider keys** — `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`,
   `ANTHROPIC_API_KEY`. Set on api and worker.
4. **`DEPLOY_PROBE_TOKEN`** — can create a run and read it back. Must be 32+
   chars and must differ from `TRUSTED_CALLER_TOKEN`; the API refuses to start
   otherwise.
5. **`TRUSTED_CALLER_TOKEN`** — must be set in **two** places or it silently buys
   nothing: `TRUSTED_CALLER_TOKEN` on the api service and
   `MAJORANA_TRUSTED_CALLER_TOKEN` on Vercel. Verify afterwards, because the
   failure is silent:
   ```
   curl -sI https://<api>/v1/catalog/entries -H "X-Majorana-Trusted-Caller: $TOKEN" \
     | grep -i x-majorana-caller-trust      # expect: trusted
   ```
6. **Database credentials** — last, because a rotation here interrupts the
   running services and Alembic.

TODO(owner): whether user-facing notification is required, and by when. That is a
legal question as much as a technical one.

## 7. Rolling back

The web app and the API deploy independently, so establish **which** is broken
first — §3 above has the diagnostic.

- **API / worker (Cloud Run):** every deploy tags a revision, and a tag is a
  durable URL that outlives the deploy. Route traffic back:
  ```
  gcloud run services update-traffic majorana-api --region us-west1 \
    --to-revisions <known-good-revision>=100
  ```
  `docs/runbooks/deploys.md` has the tagged-revision procedure in full.
- **Web (Vercel):** promote the previous deployment from the Vercel dashboard.
  Confirm what is actually being served by reading `data-dpl-id` out of the page
  rather than trusting the commit status, which misreports in both directions.
- **The sandbox rootfs:** `:latest` is moved by hand. Roll back by re-promoting
  the previous dated tag — `docs/runbooks/sandbox-image.md` §5.
- **The database:** migrations are reversible and the history is linear, but a
  down-migration on production is itself an incident. The restore drill and its
  measured RTO are in `docs/runbooks/database.md` § Backups and the restore
  drill — read that section rather than improvising; this file does not keep a
  second copy of the commands.

## 8. Afterwards — the ADR is not optional

`05-security.md` §3 requires a post-incident ADR. Write it in `docs/adr/`,
following the numbering already there, and include:

- what happened, in the order it actually happened;
- how it was noticed — and if that was a user rather than a check, say so, since
  that is usually the most useful finding;
- what was ruled out and how, not only what was found;
- the control that would have caught it, and whether it is being built;
- **anything this runbook got wrong.** A runbook is only accurate on the day it
  is written, and the incident is the only time anyone finds out.
