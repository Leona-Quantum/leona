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
export DATABASE_URL="$(neonctl connection-string dev-local --project-id twilight-wildflower-01313590 --pooled)"
uv run --package majorana-api uvicorn --factory majorana_api.app:create_app --port 8000

# In a second terminal, start the worker with the same database and the local
# subprocess double. This lets the UI exercise a real provider without Vercel
# sandbox credentials; it is not a production isolation boundary.
export MAJORANA_ENV=development
export MAJORANA_SANDBOX=local
export DATABASE_URL="$(neonctl connection-string dev-local --project-id twilight-wildflower-01313590 --pooled)"
uv run --package majorana-worker majorana-worker

# Web — Next must be running in development mode
MAJORANA_LOCAL_DEV_AUTH=true pnpm --filter @majorana/web dev
```

Open `http://localhost:3000/run`. The web BFF uses the synthetic local developer
identity and the API provisions `local-dev@majorana.test` in the real dev database.
The seam is fail-closed outside a local development process and never accepts a
production/Cloud Run/Vercel configuration.

```bash
# API (needs a dev DB — create/reuse a Neon branch, run migrations first)
export DATABASE_URL="$(neonctl connection-string dev-local --project-id twilight-wildflower-01313590)"
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
(`https://api.workos.com`). The verifier also requires the token's
`client_id` to equal `WORKOS_CLIENT_ID`. Set `WORKOS_JWT_ISSUER` (and
`WORKOS_JWKS_URL` if on a custom auth domain) to the actual values.
