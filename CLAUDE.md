# CLAUDE.md

Read `AGENTS.md` (root) first, then the `AGENTS.md` of the package you are editing.

Plan docs live in the private repo `EshMis/ai-ops`, checked out at
`~/Developer/ai-ops/desk/leona/plans/`. Cite that absolute path — the `plans` symlink at
this repo's root is untracked and gitignored, so it exists only in the primary checkout and
a bare `plans/...` reference dangles in every worktree.

- `~/Developer/ai-ops/desk/leona/plans/roadmap/00-INDEX.md` — stage map
- `~/Developer/ai-ops/desk/leona/plans/rebuild/05-security.md` — security gate
- `~/Developer/ai-ops/desk/leona/plans/leona-block-repository-roadmap.md` — block-repository direction
- `docs/adr/` — architecture decisions, in this repo

The security gate is **not** `plans/security-baseline.md` — that path does not exist and the
file it names is superseded, in `.../plans/attic/`, describing a Supabase/Firebase stack this
project never built.

Current phase: `~/Documents/Projects/Majorana/memory/NEXT.md`, or
`~/Developer/ai-ops/desk/DESK.md` when that path reads as `Operation not permitted`
(`~/Documents` is TCC-protected; some sessions can stat it but not read it).

`dev` is production — see AGENTS.md § Branching before merging anything.
