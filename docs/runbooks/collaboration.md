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

## Sharing A Workspace

Every account gets one personal workspace on first sign-in and can create
shared ones. Everything a person runs and saves belongs to exactly one
workspace, and which workspace that is comes from a server-side pointer
(`users.active_workspace_id`) — never from anything the browser sends.

**To share work, in Settings:**

1. **Workspaces → New shared workspace.** Creating one does not move you into
   it; press **Open** when you want to work there. The free tier may own three
   workspaces in total, personal included.
2. **Members → Invite.** Enter the exact email address and choose `Member` (can
   run, save and edit) or `Viewer` (can read everything, cannot run or save).
   Admin is granted afterwards from the role selector, not by the invitation.
3. The invitee presses **Open** on that workspace in their own Settings.

**The invitee must have signed in to this deployment at least once.** An account
is provisioned from a verified WorkOS token, so an address nobody has signed in
with has no user row to attach. That case answers 404 and the UI says so; it is
not a failure to retry.

**What a member sees:** every run and every Vault artifact in the workspace,
including work saved before they arrived. There is no per-artifact sharing.
Their own browser-local drafts and chat titles stay theirs — local storage is
keyed by account *and* workspace.

**Removing someone** takes effect on their next request, not their next
sign-in: the pointer is re-validated against the membership table every time a
scope is derived, and a removed user falls back to their own workspace. Their
runs and artifacts stay — they belong to the workspace.

**The owner cannot be removed or re-roled.** Ownership transfer is a separate
operation that does not exist yet.

**Allowances.** The weekly execute-run allowance follows the *account* across
every workspace it can reach, so switching does not refill it and a colleague's
runs never spend yours. The Vault artifact cap is per workspace.

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
