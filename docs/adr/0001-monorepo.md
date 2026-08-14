# ADR-0001: Single monorepo

**Date:** 2026-07-09 · **Status:** accepted

> **Amendment, 2026-08-14 — where the monorepo lives, and who can see it.** The decision
> below is unchanged; two facts in its wording are not. The repository was `EshMis/majorana`
> and is being transferred to **`LeonaQuantum/leona`** (owner rulings ai-ops#46 and #70), and
> it is **public**, not private as the Decision line says — it went public before the launch
> work and the sentence was never revisited. Neither changes the argument for one repo, so
> the original text is left as written rather than edited in place; this note is the record.
**Context:** Rebuild replaces two legacy repos (nameko, quepo). Solo founder + agent-driven
development: cross-cutting changes (contracts → API → UI) are the common case, and agents
pay context cost per repo boundary. Owner confirmed monorepo 2026-07-09.
**Decision:** One private monorepo. pnpm workspaces + Turborepo for TS; uv workspace for
Python, glued in via package.json script shims registered in turbo.json (Turborepo's
documented multi-language pattern). No Bazel/Nx — agents have far more training exposure
to package.json/pyproject than to build-graph DSLs.
**Consequences:** Buys atomic cross-stack PRs, one CI surface, one clone for agents. Costs
path-filter discipline in CI as the repo grows. Reversal trigger (two-repo exit criteria,
plans/archive/rebuild/03-repo-structure.md §6): ≥2 humans owning frontend vs platform independently; agent context
cost measurably degrading sessions (>~50 packages); or genuinely independent release
cadences/compliance boundaries. Exit is cheap: `apps/web` + `packages/ts` lift out against
the OpenAPI contract.
