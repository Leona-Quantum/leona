# AGENTS.md — majorana monorepo

Conventions for AI agents (Claude Code / Codex / others) working in this repository.
Plan authority: `~/Documents/Projects/Majorana/plans/rebuild/` (00-INDEX.md is the map).
Scope your context: each app/service/package has its own AGENTS.md — read the one for
the package you're touching, not the whole tree.

## Fresh-session bootstrap (mandatory)

Before substantive work in a fresh standalone Codex session, read these sources in order:

1. `~/Documents/AGENTS.md` (AI-OS map, safety rules, session protocol).
2. `~/Documents/Projects/_ops/WORKFLOW.md` §3 and
   `~/Documents/Projects/_ops/CODEX_ONBOARDING.md` (Claude/Codex handoff and Codex environment).
3. `~/Documents/Projects/Majorana/memory/START_NEXT.md` if present; process
   its Owner Inbox first, then read `STATUS.md` and `NEXT.md`.
4. `~/Documents/Projects/Majorana/plans/rebuild/00-INDEX.md` and
   `~/Documents/Projects/Majorana/plans/roadmap/00-INDEX.md`.
5. The nested `AGENTS.md` for every package you will touch.

Then report exactly five short lines covering current phase/revision, active pickup,
lane boundary, highest risk or plan gap, and intended next action. After that, proceed
with the user's bounded request unless it requires an owner decision or ask-first action.

Codex's standing lane is non-UI: pressure-test plans; inspect and improve `evals/` and
`packages/py/{llm,frameworks,openqasm,contracts,verification,sandbox}`; own Lane B
framework-native circuit execution, optional QASM interchange, and Python test coverage.
Do not build or restyle `apps/web` or `packages/ts/ui`
unless Eshaan explicitly overrides the lane. Use `feature/*` branches for repo changes;
Claude reviews and merges. Never push, merge, perform destructive work, or touch
credentials/secrets without the required owner approval.

## What this repo is

Majorana: a platform that turns LLM-generated quantum code into verified, reproducible,
reusable artifacts. One control plane (FastAPI, `services/api`) owns all business logic
and is the only DB caller; `apps/web` (Next.js) is a thin renderer; untrusted generated
code runs only in ephemeral network-locked sandboxes (`packages/py/sandbox`).

## Layout

- `apps/web` — Next.js App Router UI (Vercel)
- `services/api`, `services/worker` — FastAPI control plane + job runner (Cloud Run)
- `packages/py/*` — contracts, pipeline, verification, baselines, openqasm, sandbox, llm
- `packages/ts/*` — ui (vendored components), contracts-gen (GENERATED — never hand-edit)
- `db/migrations` — Alembic, single linear history, every migration reversible
- `evals/`, `bench/` — product evals and performance benchmarks (CI-run, JSON reports)

## Hard rules

1. **Blast-radius files** (see `.github/CODEOWNERS`) — migrations, contracts, sandbox,
   workflows, auth: never merged on subagent/Codex authority; orchestrator/owner reviews.
2. **Authz invariant:** repository-layer functions take `Scope` as first arg and apply
   workspace scoping themselves. No raw queries outside the repository layer.
3. **Sandbox invariant:** every sandbox creation applies deny-all egress explicitly.
   A sandbox that can reach the internet is a release-blocking bug.
4. **No invented results:** benchmarks/evals report actual command output; a run that
   didn't happen is reported as not run.
5. Ask-first (owner): pushes to protected branches, credential actions, spending money,
   making anything public.

## Branching / commits / PRs

- `feature/* → dev → prod`; squash merge only; protected branches require checks (admins too).
- Commit prefixes: `add:` `fix:` `rm:` `mv:` `chore:` `docs:` `refactor:` `ci:` — one
  concise English line, one logical change per commit.
- PR bodies follow `.github/PULL_REQUEST_TEMPLATE.md`; UI PRs attach screenshots;
  `db/` PRs state the up→down→up result.

## Commands

```bash
pnpm turbo run lint typecheck test   # TS side
uv run pytest                        # Python side
uv run ruff check . && uv run ruff format --check .
```

## Session protocol

Read `Projects/Majorana/memory/{STATUS,NEXT}.md` before starting; update them plus
`memory/DECISIONS.md` and `Projects/_ops/SESSION_LOG.md` when done; end with the
continuation prompt template from `plans/rebuild/09-agent-operating-model.md` §5.
