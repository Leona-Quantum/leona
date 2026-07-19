# Collaborating on Leona Quantum

Leona Quantum uses a two-step collaboration boundary:

1. Contributors work on `feature/<slice>` branches and validate on their own
   machine with a development database and local auth.
2. Eshaan reviews and merges into `dev`, then owns the `dev` → Production
   promotion and hosted redeployment.

This works on the current Vercel Hobby setup because the contributor loop does
not depend on Vercel Preview deployments. A stable Preview link remains useful
for authenticated product review; local browsers are the source of truth for
unmerged changes.

## Adding A Collaborator

The collaborator must first accept the WorkOS invitation and sign in once so
the control plane can provision their user. Then an owner or admin opens
**Settings → Workspace members**, enters the exact email address, and chooses
`Member` or `Viewer`. The member is attached to the existing workspace and can
see its runs and Vault artifacts; they do not receive database credentials.

If the email is rejected, the user has not completed first login in this
environment yet, or the address does not match the WorkOS account claim.

## Local Contributor Loop

```bash
git fetch origin
git switch -c feature/<slice> origin/dev

# Use a disposable Neon dev branch or local Postgres database. Never use the
# production connection string in a contributor process.
export DATABASE_URL="<development-database-url>"
uv run --package majorana-api alembic -c db/alembic.ini upgrade head

# Terminal 1: API
export MAJORANA_ENV=development
export MAJORANA_LOCAL_DEV_AUTH=true
export MAJORANA_SANDBOX=local
uv run --package majorana-api uvicorn --factory majorana_api.app:create_app --port 8000

# Terminal 2: worker, using the same development database
export MAJORANA_ENV=development
export MAJORANA_SANDBOX=local
uv run --package majorana-worker majorana-worker

# Terminal 3: web
MAJORANA_LOCAL_DEV_AUTH=true pnpm --filter @majorana/web dev --port 3001
```

Open `http://localhost:3001/run`. The local auth identity is
`local-dev@majorana.test`; it is rejected by Cloud Run, Vercel, CI, and any
non-development process. Run the focused checks before opening a PR:

```bash
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
pnpm turbo run typecheck lint
```

The PR should state the local URL, the changed flow, and the checks that ran.
Do not commit `.env` files, tokens, Neon URLs, WorkOS secrets, or generated
browser/compiler caches.

## Review And Release

- Contributor opens a PR from `feature/<slice>` into `dev`.
- Required checks and code review must pass before merge.
- Eshaan verifies the merged `dev` deployment and any database migration on a
  development/Preview environment.
- Eshaan promotes `dev` to `prod`, supplies hosted secrets through the existing
  secret stores, and redeploys Cloud Run/Vercel. Contributors do not push to
  protected branches or promote Production.
- A rollback is a hosted deployment rollback or a forward fix; do not rewrite
  shared migration history.

For Codex sessions, use the repo `AGENTS.md` and `CODEX_ONBOARDING.md` as the
startup contract. Claude remains the review/merge coordinator for cross-boundary
changes, while the local branch and PR are the handoff surface.
