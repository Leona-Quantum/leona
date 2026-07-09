# AGENTS.md — majorana monorepo

Conventions for AI agents (Claude Code / Codex / others) working in this repository.
Plan authority: `~/Documents/Projects/Majorana/plans/rebuild/` (00-INDEX.md is the map).
Scope your context: each app/service/package has its own AGENTS.md — read the one for
the package you're touching, not the whole tree.

## What this repo is

Majorana: a platform that turns LLM-generated quantum code into verified, reproducible,
reusable artifacts. One control plane (FastAPI, `services/api`) owns all business logic
and is the only DB caller; `apps/web` (Next.js) is a thin renderer; untrusted generated
code runs only in ephemeral network-locked sandboxes (`packages/py/sandbox`).

## Layout

- `apps/web` — Next.js App Router UI (Vercel)
- `services/api`, `services/worker` — FastAPI control plane + job runner (Cloud Run)
- `packages/py/*` — contracts (source of truth), pipeline, verification, baselines, ir, sandbox, llm
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
