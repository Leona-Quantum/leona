# AGENTS.md — majorana monorepo

Conventions for AI agents (Claude Code / Codex / others) working in this repository.

The product is **Leona Quantum** (short: **Leona**). The name `majorana` is still
everywhere in this tree, and the rule about it changed on 2026-08-14 — the paragraph that
used to sit here said the rename buys nothing and told you not to "fix" it, which is no
longer what the owner wants.

**The rename is scheduled work, and it stops above the infrastructure layer.**

- **In scope** (owner ruling ai-ops#70, widened in chat 2026-08-14 to "internal and
  external"): code, Python packages, npm scope, modules, env vars, storage keys, docs,
  user-facing copy, and the repo name itself. Do not add new `majorana` identifiers.
- **Permanently exempt, by explicit ruling** — *"write the infra ids down as a permanent,
  deliberate exception. They are invisible to every user."* GCP project `majorana-core`,
  Cloud SQL `majorana-pg`, Cloud Run `majorana-api` / `majorana-worker`, the Artifact
  Registry repo, and the Vercel team slug `majoranaq` keep their names. Do not reopen this.
- **Not yet ruled, so do not assume**: whether **published record ids** change. Those are
  public addresses. Changing them is a migration with a redirect obligation, and rows
  already signed in `license_assertions` cannot be updated in place (ADR-0020, append-only,
  enforced by a Postgres trigger). Get that decided before touching identities.

Still true, and still the trap: `apps/web/lib/public-repository.ts` holds
`replaceLegacyBrand()`, a display-time scrub over legacy fixture text. It is a bridge, not
a source of truth — the fixtures in `apps/web/lib/repository/entries-legacy.ts` still
contain the retired words. It also rewrites text it should not: never let a brand rewrite
run across physics terms or cited paper titles.

Plan authority lives in the private repo `EshMis/ai-ops`, checked out at
`~/Developer/ai-ops/desk/leona/plans/`. **Cite that path, not a `plans/...` one.** The
`plans` entry at this repo's root is an untracked, gitignored symlink to it that exists
only in the primary checkout — `git clone` and `git worktree add` do not create it, so a
bare `plans/...` reference dangles in every worktree, which is where lane agents work.
Verified 2026-08-14: 29 of 29 `majorana-wt-*` worktrees had no `plans/` directory.

- Stage map: `~/Developer/ai-ops/desk/leona/plans/roadmap/00-INDEX.md`
- Security gate: `~/Developer/ai-ops/desk/leona/plans/rebuild/05-security.md`
- Block-repository direction: `~/Developer/ai-ops/desk/leona/plans/leona-block-repository-roadmap.md`
- Architecture decisions: the ADRs under `docs/adr/` — in this repo, so these resolve everywhere.

(The old `plans/rebuild/` index and its phase docs were archived 2026-08-04 to
`.../plans/archive/rebuild/` — history, not authority.)

If any instruction you are carrying points the security gate at
`plans/security-baseline.md`, it is out of date: that path does not exist, and the file it
names sits in `.../plans/attic/` describing a Supabase/Firebase stack this project never
built. The gate is `~/Developer/ai-ops/desk/leona/plans/rebuild/05-security.md`.
Scope your context: each app/service/package has its own AGENTS.md — read the one for
the package you're touching, not the whole tree.

## Fresh-session bootstrap (mandatory)

Before substantive work in a fresh standalone session — Claude, Codex or any other agent,
the list is the same for all of them — read these sources in order:

1. `~/Developer/CLAUDE.md` (the tree protocol: map, session protocol, coordination, rules).
   This repo is a nested Git root, so it is **not** discovered automatically by either
   agent; read it explicitly.
2. `~/Developer/ops/WORKFLOW.md` §3.
3. `~/Developer/leona/memory/START_NEXT.md` if present; process
   its Owner Inbox first, then read `STATUS.md` and `NEXT.md`.
4. `~/Developer/ai-ops/desk/leona/plans/roadmap/00-INDEX.md` (the stage map) and
   `~/Developer/ai-ops/desk/leona/plans/leona-block-repository-roadmap.md`.
5. The nested `AGENTS.md` for every package you will touch.

**Every path above resolves into `~/Developer`, which is readable from every session type.**
That is the point of the 2026-08-29 consolidation. Do not "helpfully" rewrite any of them to
the `~/Documents/Projects/...` compat symlinks: those are TCC-protected, and an SSH-launched
or sandboxed session can `stat` them but not read them — which surfaces as `Operation not
permitted` and looks like a missing file rather than a denied read (verified 2026-08-14).

**Do not conclude the files are missing, moved, or stale — you cannot see them, which is a
different fact.** The remedy, if you are at the machine: give
`/usr/libexec/sshd-keygen-wrapper` Full Disk Access (System Settings → Privacy & Security →
Full Disk Access; the "Files & Folders" pane is the wrong one, and granting `sshd` or `ssh`
does nothing — macOS attributes the login session to the wrapper), then reconnect, because
the grant binds at process start.

When 1–3 are unreadable, take the ops layer as the substitute source — `~/Developer/ai-ops/desk/`
(`README.md`, `GOALS.md`, `DESK.md`, `ENVIRONMENT.md`), the per-project decision log
`~/Developer/ai-ops/desk/decisions/Leona.md`, and the most recent
`~/Developer/ai-ops/desk/handoffs/` entry — and say in your five lines that you did, so
nobody reads your summary as though you had the Owner Inbox in front of you.

Then report exactly five short lines covering current phase/revision, active pickup,
lane boundary, highest risk or plan gap, and intended next action. After that, proceed
with the user's bounded request unless it requires an owner decision or ask-first action.

There is no per-agent lane. Claude and Codex have the same privileges here, in every part
of the tree — `apps/web` and `packages/ts/ui` included — and the same duties (ruled by
Eshaan 2026-09-06; the former non-UI Codex lane is withdrawn). Use `feature/*` branches for
repo changes. Never push, merge, perform destructive work, or touch credentials/secrets
without the required owner approval — that rule binds every agent equally.

## What this repo is

Leona Quantum: a platform that turns LLM-generated quantum code into verified,
reproducible, reusable artifacts. The API and Worker are the only DB-connected processes, and both use
the repository layer owned by `services/api`; `apps/web` (Next.js) is a thin renderer;
untrusted generated code runs only in ephemeral network-locked sandboxes
(`packages/py/sandbox`).

## Layout

- `apps/web` — Next.js App Router UI (Cloud Run `majorana-web`, behind Cloudflare and the Google load balancer)
- `apps/news` — Leona Quantum News renderer and local editorial UI (Node.js)
- `services/api`, `services/worker` — FastAPI control plane + job runner (Cloud Run)
- `packages/py/*` — agent, contracts, estimation, frameworks, llm, notebooks (leona-notebooks: the
  notebook lane's pure core), openqasm, qpu, sandbox,
  verification
- `packages/ts/*` — ui (vendored components), ui-visual (render/diff harness),
  contracts-gen (GENERATED — never hand-edit)
- `db/migrations` — Alembic, single linear history, every migration reversible
- `evals/`, `bench/` — product evals and performance benchmarks (CI-run, JSON reports)

The two `packages/*` lines are checked against the filesystem by
`scripts/check-workspace-inventory.mjs`, which runs in `lint`. Add a package and this file
fails CI until it says so — a prose inventory nobody verifies is worse than none, because
it reads as current. `packages/py/ir/` is deliberately absent: it holds stale `.pyc` files
with no sources, is untracked, has no `pyproject.toml`, and nothing imports `majorana_ir`.

## Hard rules

1. **Blast-radius files** (see `.github/CODEOWNERS`) — migrations, contracts, sandbox,
   workflows, auth: never merged on a subagent's own authority, whichever agent it is;
   the orchestrating session or the owner reviews. This is a restriction on the ROLE, not
   on any agent by name — an orchestrating Codex session has exactly the standing an
   orchestrating Claude session has.
2. **Authz invariant:** repository-layer functions take `Scope` as first arg and apply
   workspace scoping themselves. The sole exception is `repos/system.py` for pre-Scope
   identity bootstrap and workspace-neutral control-plane jobs; it may never expose
   tenant data to request handlers. No raw queries outside the repository layer.
3. **Sandbox invariant:** every sandbox creation applies deny-all egress explicitly.
   A sandbox that can reach the internet is a release-blocking bug.
4. **No invented results:** benchmarks/evals report actual command output; a run that
   didn't happen is reported as not run.
5. Ask-first (owner): pushes to protected branches, credential actions, spending money,
   making anything public.
6. **Sourcing doctrine — `docs/adr/0026-sub-paper-extraction.md`.** Read it before authoring
   any Atlas record, map node or citation. In one line: a component may be extracted from a
   paper whose subject is something else, provided the paper contains it, the citation names
   where in the paper it is, and the extraction does not reach a topic the paper is not about.
   The two rules it does **not** relax: a record may never cite a paper that does not contain
   what it claims, and a figure the paper states only for its whole algorithm is not a claim
   about a part of it.

## Branching / commits / PRs

- `feature/* → dev`; squash merge only; protected branches require checks (admins too).
  **`dev` IS production.** leonaqt.com serves from `dev`: `.github/workflows/deploy-web.yml`
  ships `apps/web` to Cloud Run (ADR-0033; Vercel retired 2026-09-21) and
  `.github/workflows/deploy.yml` ships api + worker on every merge to it. The `prod` branch is vestigial — measured 2026-08-14, `origin/dev` is **559
  commits ahead of `origin/prod`**, and nothing has shipped from `prod` in months. Do not
  open a `dev → prod` PR expecting it to deploy anything. The consequence that matters:
  a merge to `dev` is a production release and needs the same owner authorisation a deploy
  does (hard rule 5), not the lighter bar a merge to a staging branch would.
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

Read `~/Developer/leona/memory/{STATUS,NEXT}.md` before starting; update them plus
`~/Developer/leona/memory/DECISIONS.md` when done; end with the continuation prompt
template from `~/Developer/ai-ops/desk/leona/plans/rebuild/09-agent-operating-model.md` §5.

Record the session with `python3 ~/Developer/ops/handoff.py add --project Leona`, which
appends one new file per session and so can never clobber a concurrent session's entry.
`_ops/SESSION_LOG.md` is **gone** — it belonged to the `ops.py` handoff store retired on
2026-08-29, and nothing has written it since. Decisions still go to
`~/Developer/ai-ops/desk/decisions/Leona.md`. Do the write rather than skipping it —
skipping is what leaves the next session reconstructing your lane second-hand.
