# Auth dev loop (Phase 1 step 5)

End-to-end: AuthKit session (Next.js) → WorkOS access token → FastAPI JWKS
verification → first-login provisioning (user + personal workspace) → `/v1/me`.

## One-time setup (owner — dashboard values, never committed)

1. WorkOS dashboard → project `majorana` → **API keys**: copy *Client ID* and
   *API key* (staging environment).
2. WorkOS dashboard → **Redirects**: add `http://localhost:3000/auth/callback`
   as a redirect URI.
2b. WorkOS dashboard → **Authentication → Sessions → JWT template**: add
   `"email": {{user.email}}` (and optionally `"name": {{user.first_name}}`) —
   the API requires the email claim to provision and 403s without it.
3. `cp apps/web/.env.local.example apps/web/.env.local`, fill in the two values,
   and set `WORKOS_COOKIE_PASSWORD` to the output of `openssl rand -base64 32`.

## The local database

**A local PostgreSQL 17, not a hosted branch.** Production moved to Cloud SQL on
2026-07-27 (ADR-0024) and Cloud SQL has no branching, so there is no `neonctl` and no
per-developer hosted database any more. CI does the same thing — `ci.yml`'s `db` job and
`bench.yml` run a `postgres:17` service container.

Two properties are not optional, because this is a real database on a laptop that joins
untrusted networks: it is **published on loopback only**, and its password is
**generated, never chosen and never written into a document or a shell history**. That is
why no command below contains a literal password, and why this runbook does not tell you
what yours is.

```bash
# One password, generated once into its own owner-only file. `.env*.local` is
# gitignored; `umask 077` creates the file 0600. You never type the literal, so
# shell history records `$LOCAL_PG_PASSWORD` and not the value. (`docker inspect`
# will still show it — this is a laptop database, not a secret store.)
umask 077
LOCAL_PG_PASSWORD="$(openssl rand -hex 16)"
printf 'DATABASE_URL=postgresql://postgres:%s@127.0.0.1:5432/majorana\n' "$LOCAL_PG_PASSWORD" > .env.db.local
# Alembic reads DATABASE_URL_DIRECT; locally it is the same value.
printf 'DATABASE_URL_DIRECT=postgresql://postgres:%s@127.0.0.1:5432/majorana\n' "$LOCAL_PG_PASSWORD" >> .env.db.local
chmod 600 .env.db.local

# One container, once. 17 matches production; 16 is the sort of gap that surfaces
# as a mystery on the day it matters. The `127.0.0.1:` prefix is load-bearing:
# plain `-p 5432:5432` publishes the database on every host interface, so anyone
# on the same coffee-shop network can reach it.
docker run -d --name majorana-pg -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$LOCAL_PG_PASSWORD" -e POSTGRES_DB=majorana \
  postgres:17
unset LOCAL_PG_PASSWORD

# `docker run -d` returns long before postgres accepts clients, and the entrypoint
# restarts the server once after initdb — so wait on TCP, not on the Unix socket,
# or Alembic races the initialisation and fails with a connection error.
until docker exec majorana-pg pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done

set -a; . ./.env.db.local; set +a    # the only way this runbook loads the URLs
uv run --package majorana-api alembic -c db/alembic.ini upgrade head
```

Every later block here uses that same `set -a; . ./.env.db.local; set +a` line rather than
re-typing a URL. `.env.example` documents the same variable pair for the rest of the
backend configuration. **Never point either variable at production** — `db.py` refuses a
*Neon* URL in a deployed environment, but nothing stops a local process from opening the
production Cloud SQL instance if you hand it that URL.

## Run locally

### WorkOS-free local loop

For a local product walkthrough, the owner can use the explicit development-only
auth seam instead of a WorkOS account. This still uses the real API database and
the real user/workspace provisioning path; it only replaces the WorkOS session
and JWT verification at the two auth choke points.

```bash
# API — these guards are required; do not use this mode in CI, Cloud Run, or Vercel
export MAJORANA_ENV=development
export MAJORANA_LOCAL_DEV_AUTH=true
export MAJORANA_SANDBOX=local  # DEV/TEST double only; never production
set -a; . ./.env.db.local; set +a
uv run --package majorana-api uvicorn --factory majorana_api.app:create_app --port 8000

# In a second terminal, start the worker with the same database and the local
# subprocess double. This lets the UI exercise a real provider without Vercel
# sandbox credentials; it is not a production isolation boundary.
export MAJORANA_ENV=development
export MAJORANA_SANDBOX=local
set -a; . ./.env.db.local; set +a
uv run --package majorana-worker majorana-worker

# Web — Next must be running in development mode
MAJORANA_LOCAL_DEV_AUTH=true pnpm --filter @majorana/web dev
```

Open `http://localhost:3000/run`. The web BFF uses the synthetic local developer
identity and the API provisions `local-dev@majorana.test` in the real dev database.
The seam is fail-closed outside a local development process and never accepts a
production/Cloud Run/Vercel configuration.

```bash
# API (needs the local dev DB from above, migrated)
set -a; . ./.env.db.local; set +a
export WORKOS_CLIENT_ID="client_..."          # same value as apps/web/.env.local
uv run --package majorana-api alembic -c db/alembic.ini upgrade head
uv run --package majorana-api uvicorn --factory majorana_api.app:create_app --port 8000

# Web
pnpm --filter @majorana/web dev
```

Browser test: `http://localhost:3000` → Sign in → AuthKit hosted flow →
`/dashboard` must show your email AND a `/v1/me` JSON block with a real
`workspace_id` + `role: owner` (that proves JWKS verify + provisioning worked).

If `/v1/me` is 401 with a valid session: check the API log — an issuer
mismatch means the token's `iss` differs from the pinned default
(`https://api.workos.com/user_management/<client_id>`); set `WORKOS_JWT_ISSUER`
(and `WORKOS_JWKS_URL` if on a custom auth domain) to the actual values.
