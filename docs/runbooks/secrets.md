# Secrets registry (NAMES ONLY — values never appear in this repo)

| Name | Store | Consumer | Created |
|---|---|---|---|
| ~~SNYK_TOKEN~~ | — | **retired 2026-07-20**: the Snyk account ran out of quota permanently and the job 403'd on every PR. Replaced by the `osv` + `semgrep` jobs in security.yml, neither of which needs a token or an account. Delete the repo secret if it is still set | 2026-07-09 (UTC) |
| ~~NEON_API_KEY~~ | GitHub Actions secret (repo) | **unused since 2026-07-27**: ci.yml and bench.yml ran on throwaway Neon branches and now run on a `postgres:17` service container. No workflow reads it. Delete the repo secret once Neon itself is decommissioned (docs/runbooks/database.md § Decommissioning Neon) — until then it is the rollback | 2026-07-10 |
| DATABASE_URL | GCP Secret Manager (majorana-core) | Cloud Run api+worker. **Version 3+ is Cloud SQL** (`majorana-pg`, Unix socket through the connector); versions 1–2 are the old Neon pooled URL and are the rollback path. docs/runbooks/database.md | 2026-07-10, repointed 2026-07-27 |
| DATABASE_URL_SECRET | GCP Secret Manager (majorana-core) | Alembic — a **direct** (never pooled) URL, because DDL through a transaction pooler is not safe. Read by `deploy.yml`'s `migrate database` step into the env var `DATABASE_URL_DIRECT` (the entry name and the variable name differ — see docs/runbooks/deploys.md § Environment). **Version 2+ points at 127.0.0.1:5432**, which resolves only while that workflow's Cloud SQL Auth Proxy step is running. Never wired to a Cloud Run service or Vercel; store, redact, and rotate as a database credential under the same requirements as DATABASE_URL. Readable by the deploy SA via a per-secret `roles/secretmanager.secretAccessor` grant | 2026-07-19, repointed 2026-07-27 |
| WORKOS_CLIENT_ID / WORKOS_API_KEY / WORKOS_COOKIE_PASSWORD | apps/web/.env.local (dev) + Vercel env Sensitive (deploy) | AuthKit (web); the API needs WORKOS_CLIENT_ID only. Vercel preview holds PLACEHOLDERS until the owner sets real values (step 5 browser test) | 2026-07-10 |
| SENTRY_DSN + NEXT_PUBLIC_SENTRY_DSN | api/worker: GCP Secret Manager (`SENTRY_DSN`), mounted by `deploy.yml` via `--update-secrets`. web: Vercel env (Production only) | api+worker share one DSN (Sentry project `python`, no per-service split — see `majorana_service` tag instead), web has its own (project `web`), org `majorana-ms`. DSNs are client keys, not strict secrets, but stored properly rather than as a literal now that both are wired | 2026-07-11, wired 2026-08-15 (ai-ops#97) |
| OPENAI_API_KEY / DEEPSEEK_API_KEY | GCP Secret Manager (majorana-core) + GitHub Actions secrets (repo) | Cloud Run **worker only** — the API never calls a model. Both wired at `:latest`, which Cloud Run resolves when a container STARTS: the worker runs continuously, so a rotation is not live until a new revision replaces the instance. The repo secrets are a separate copy, read by bench.yml and the eval harness, and a rotation has to reach them too. `DEEPSEEK_API_KEY` rotated to version 3 on 2026-08-01 (version 2 left enabled as the rollback) | 2026-07-14 |
| OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS | local secrets store (dev); GCP Secret Manager + Vercel env at deploy (pending) | all services → Grafana Cloud OTLP gateway (stack `yellowwildebeest692`); the header embeds token `majorana-otlp` (otlp-write scope) — treat as secret | 2026-07-11 |
| MAJORANA_CREDENTIAL_KEYS | GCP Secret Manager (majorana-core) | Cloud Run **api AND worker** — the api encrypts users' IBM Quantum API keys into `provider_credentials` (migration 0045), the worker decrypts them at submission time. Comma-separated Fernet keys, NEWEST FIRST. Unset, `PUT /v1/qpu/credentials` answers 503 `credential_storage_unavailable` and no hardware submission is possible; it never falls back to plaintext. See § Rotating MAJORANA_CREDENTIAL_KEYS below | pending owner action |
| ~~MAJORANA_QPU_IBM_TOKEN~~ | — | **retired**: one operator-owned IBM key that every account submitted through, which meant IBM's free Open Plan allowance (10 min of QPU time per 28-day rolling window, per account) was shared by the whole platform and every job ran under the operator's identity. Replaced by per-user credentials in `provider_credentials`. Nothing reads this variable any more — `packages/py/qpu/tests/test_submission_gating.py` pins that setting it again cannot reopen the gate. Delete it wherever it is set | retired 2026-08-02 |

## Infrastructure projects (names only)

| Provider | Project | Notes |
|---|---|---|
| GCP Cloud SQL | `majorana-core:us-west1:majorana-pg` | **The production database since 2026-07-27.** Postgres 17, db-g1-small, no authorized networks. docs/runbooks/database.md |
| Neon | `majorana` (ID `twilight-wildflower-01313590`) | Postgres 17, aws-us-west-2, org `org-tiny-glade-89486766` (owned by `emistry@berkeley.edu`), free tier. **No longer serving traffic** — retained as the rollback, still holds the pre-cutover data |
| GCP | `majorana-core` (number 639400385957) | Secret Manager + Cloud Run APIs enabled; billing linked |
| WorkOS | `majorana` | AuthKit project, dashboard signup done 2026-07-10 (owner); API key + client ID pulled into env at Phase 1 step 5 |
| ~~Snyk~~ | org `eshmis` | **abandoned 2026-07-20** — free-plan quota exhausted, no longer used by CI. Nothing depends on this account |
| Vercel | account `eshmis` (team `majoranaq`) | project `web`, linked from apps/web 2026-07-10 |
| GCP Artifact Registry | `us-west1-docker.pkg.dev/majorana-core/majorana` | api/worker images; us-west1 — the same region as Cloud Run and, since 2026-07-27, the database |
| Sentry | org `majorana-ms`, projects `python` (api+worker) + `web` | US region, free dev tier; errors only (AD-10). MAJORANA_ENV=production and MAJORANA_RELEASE (git SHA) are set by `deploy.yml`/Vercel; `python` events also carry a `majorana_service` tag (`api`/`worker`) |
| Grafana Cloud | org `yellowwildebeest692`, stack `yellowwildebeest692` (ID 1718943) | OTLP gateway prod-us-west-0; free tier after 14-day trial window (started ~2026-07-11) |

Rules: plans/rebuild/05-security.md §1 "Secrets". Rotation runbook lives here too.

## Hardware submission: what an operator does, and what a user does

Two separate jobs. Neither one alone lets anybody submit to a real QPU.

### Operator (once per deployment)

1. **Generate an encryption key.** A command, not a format to type by hand:

   ```bash
   uv run python -m majorana_api.credential_crypto
   ```

   It prints one Fernet key. Put it in Secret Manager as `MAJORANA_CREDENTIAL_KEYS`
   and wire it to **both** the `api` and the `worker` Cloud Run services — the api
   encrypts, the worker decrypts, and a worker without it closes every hardware
   run with "could not be decrypted" instead of submitting it.

2. **Open the deployment gate.** `MAJORANA_QPU_SUBMIT_ENABLED=true` on **both**
   services. It is a deployment-level owner decision (AGENTS.md rule 5: spending
   money) and defaults to closed everywhere.

3. Nothing else. There is no operator-owned IBM token any more, and there is no
   value in this repository or in Secret Manager that would let the platform
   submit to IBM on its own.

### User (once per account)

1. Create a free API key on the IBM Quantum Platform dashboard. It is 44
   characters.
2. Paste it into the hardware settings panel (`PUT /v1/qpu/credentials`). It is
   checked against IBM's IAM endpoint before it is stored: a key IBM refuses is
   refused here too, with IBM's reason, and nothing is saved.
3. Optionally paste the instance **CRN**, also from the IBM dashboard. Required
   only for an account with more than one instance — Qiskit Runtime carries it as
   a `Service-CRN` header, and IBM resolves a single-instance account without it.
   Open Plan instances exist only in `us-east`.

The user's own key means the user's own Open Plan allowance: ten minutes of QPU
time per 28-day rolling window, per account, rather than ten minutes shared by
everybody on the platform.

**There is no "connect with IBM" button and there will not be one.** IBM Quantum
Platform publishes no OAuth flow that lets a third-party application obtain an API
key on a user's behalf, so a paste is the only mechanism that exists. What the
product owes the user in exchange is that the paste is verified immediately, that
a bad key produces a sentence they can act on, and that the key is never readable
again by anyone — including them, including us.

## Rotating MAJORANA_CREDENTIAL_KEYS

The order matters and getting it wrong makes every stored credential
undecryptable at once.

1. Generate a new key (command above).
2. **Prepend** it, keeping the old one:
   `MAJORANA_CREDENTIAL_KEYS=<new>,<old>`. Deploy to api and worker. The first
   key encrypts, any key decrypts — new writes use `<new>`, existing rows still
   read under `<old>`, and nothing is re-encrypted.
3. Wait until no row still needs the old key. Each row carries `key_id`, the
   first eight hex of a SHA-256 over the key material that wrote it (not key
   material itself):

   ```sql
   select key_id, count(*) from provider_credentials group by key_id;
   ```

   A user reconnecting rewrites their row under the current key.
4. Drop the old key: `MAJORANA_CREDENTIAL_KEYS=<new>`.

Skipping step 2 — replacing rather than prepending — leaves every existing row
readable by nothing. Users are not locked out permanently (reconnecting takes
about thirty seconds) but every in-flight hardware run fails, and the failure
names the `key_id` that is missing so the cause is diagnosable from a row.
