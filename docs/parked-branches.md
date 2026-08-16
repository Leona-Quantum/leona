# Parked branches

Every unexplained branch on this repository gets re-investigated from scratch by
whoever finds it next, and that has already happened at least twice. This file is
the note that stops it: one entry per branch that is deliberately still here, what
it is, and why nobody should act on it yet.

**Owner ruling (ai-ops 135, 2026-08-16): leave these alone.** Not merged, not
deleted, not reviewed. If you are here because you found a branch and wondered
whether it was forgotten — it is not, and the entry below is your answer.

Measured against `origin/dev` on 2026-08-17. "ahead" counts commits on the branch
that are not on `dev`; because this repository squash-merges, that number is a
poor guide to whether work has landed, and `--is-ancestor` reports `false` for
work that definitely has. Content comparison is the only reliable test here.

| branch | last commit | ahead of dev | status |
|---|---|---|---|
| `feature/vqe` | 2026-08-10 | 200 | needs an owner call before anyone reviews it |
| `feat/pageview-trend-table` | 2026-08-14 | 1 | closest to shippable; needs a duplication call |
| `feature/repository-step5b-safe-fetcher` | 2026-07-19 | 3 | probably superseded by an ADR |
| `feature/eval-circuit-generation-20260807` | 2026-08-08 | 1 | eval artifacts; check relevance first |
| `prod` | 2026-07-09 | 0 | pure ancestor of `dev`; referenced by nothing |

---

### `feature/vqe`

An entire VQE product surface — roughly 476 files and 271,000 insertions. The
size is the point: nobody can usefully review it without first knowing whether
the product wants a VQE surface at all, and that is a decision, not a code
review. **Do not attempt to rebase or land this** as a way of tidying up.

### `feat/pageview-trend-table`

527 lines: a GitHub Actions workflow, a database migration, and a collector that
keeps a durable daily pageview count outside the log's retention window.

Technically the closest to mergeable of the five. What makes it a decision rather
than a merge is that **Vercel Web Analytics is now live in the app** (it went in
for ai-ops 92), so this either complements it — Vercel's retention is limited and
this keeps history — or duplicates it. It also brings a scheduled job and a schema
change, which is real operational surface for a question nobody has answered.

### `feature/repository-step5b-safe-fetcher`

Probably conflicts with `docs/adr/0017-catalog-ingestion-threat-boundary.md`,
which solved the same threat a different way. **If that ADR stands, this branch is
dead** and should be deleted rather than merged. Nobody has done the comparison;
that is the work this entry is waiting on, and it is small.

### `feature/eval-circuit-generation-20260807`

Evaluation artifacts only — no product code. Harmless, possibly stale. Check
whether the evals it contains are still the ones being run before spending any
time on it.

### `prod`

A bare branch that is a **pure ancestor of `dev` with zero unique commits**. It is
referenced by no workflow and does not appear in `vercel.json`. An audit called it
safe to delete and it was deliberately left in place anyway: deleting something
named `prod` on a live product, on the strength of an audit the deleter did not
run, is not a trade worth making for the sake of one tidy line. If it is ever
removed, confirm the two facts above yourself first — `git rev-list --count
origin/dev..origin/prod` should be `0`, and a repository-wide grep for `prod`
across `.github/workflows/` and `vercel.json` should find no reference to it as a
branch.

---

## Not one of the five, and not covered by that ruling

### `owner/g1-grading-wip`

One commit ahead of `dev`, last touched 2026-08-06. Named `owner/`, so treat it as
Eshaan's working branch and leave it alone regardless.

### `pr409` … `pr426` and similar

Numbered snapshot branches from earlier PRs. These are not covered by ai-ops 135.
Before deleting any of them, compare by CONTENT against `dev` rather than by
ancestry — the squash-merge trap above applies, and a previous sweep confirmed
several superseded branches this way. A bundle of the last sweep is at
`~/Developer/_salvage-2026-08-16-branchsweep/`.
