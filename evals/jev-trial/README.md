# Jev offline trial (ai-ops#358)

Owner ruling: **"option 1. i have created account"** — option 1's text: "Sign up and
trial it offline on Atlas method ranking, no user data (recommended)." Background:
`~/Developer/ai-ops/desk/leona/plans/strategy-20260921/benchmarks-and-jev.md` §4.

Compares the production Atlas method finder's ranking
(`apps/web/lib/repository/finder.ts`'s `findMethods`) against Jev's (TypeSafe AI)
ranking, on 18 small, curated, catalog-derived cases (`curated-cases.yaml`,
`DERIVATION.md`). **No user data of any kind** — no logged query, nothing from the
users/workspaces database. **No product/API change** — nothing here is imported by
`apps/web`, `services/api`, or `services/worker`.

## What Jev actually is (primary sources, read 2026-09-21)

- Product: https://typesafe.ai/ — "Jev", described as TypeSafe's "first System One
  Model, optimized for automation". $42 / billion input tokens; output unbilled.
  Early access; the owner has an account (issue text).
- Docs (publicly reachable without logging in, as read): base URL
  `https://api.typesafe.ai/v1/systemone`; auth `Authorization: Bearer <key>`; three
  question primitives — Choice, Score, Noul; models `jev-latest`/`jev-preview` (both
  alias `jev-1.13.0`); limits 250k tokens/s, 1,200 req/min, 64k tokens/request (32k
  for `state` + longest question); text-only input.
- Privacy policy (https://typesafe.ai/legal/privacy-policy): "We will not train or
  fine tune any... model on your prompts or other Input" and "We will not disclose
  any Input to a third party other than our service providers."
- Second independent source: https://www.langchain.com/blog/building-a-harness-with-jev
  — confirms the request/response shape and the `TYPESAFE_API_KEY` env var name.

**Could not confirm, flagged rather than guessed at** (see `jev_client.py`'s module
docstring for the full list): whether the API is "OpenAI-compatible" — the strategy
doc says so, but nothing in the primary docs makes that claim, and the actual
endpoint/request/response shape is Jev's own, not `/v1/chat/completions`. This
client speaks the shape the primary docs actually document. Also unconfirmed: a
worked error-response body, and whether reading BEYOND what this pass fetched
(deeper docs pages) needs the early-access login that was not attempted here.

## Layout

```
curated-cases.yaml         18 cases: domain, natural-language query, expected_slugs,
                            derivation, expected_pool_size. Hash-pinned by the loader.
DERIVATION.md               Full method for how expected_slugs was derived, and the
                            "current finder ranks alphabetically" finding.
scripts/
  finder-rank.mts            Runs the REAL findMethods against the REAL local corpus.
  ts-extensionless-loader.mjs  Node loader hook finder-rank.mts needs (see its docstring).
```

Harness code: `evals/harness/src/majorana_evals/jev_trial/` (schema, curated_cases
loader, finder_bridge, jev_client, live_jev, controls, metrics, runner, CLI).

## Running it

Zero spend (no key needed, no network call):

```bash
uv run --package majorana-evals python -m majorana_evals.jev_trial run \
    --ranker current-finder --out /tmp/jev-trial-finder.json --markdown-out /tmp/jev-trial-finder.md
uv run --package majorana-evals python -m majorana_evals.jev_trial run \
    --ranker oracle   --out /tmp/jev-trial-oracle.json
uv run --package majorana-evals python -m majorana_evals.jev_trial run \
    --ranker random   --out /tmp/jev-trial-random.json
uv run --package majorana-evals python -m majorana_evals.jev_trial run \
    --ranker stub-jev --out /tmp/jev-trial-stub-jev.json
```

**Measured 2026-09-21** (this repo, `add/jev-offline-trial`), n=18 cases:

| ranker | top-1 | top-3 | MRR | Brier |
|---|---|---|---|---|
| current-finder | 17% (3/18) | 56% | 0.418 | n/a (reports no confidence) |
| oracle (positive control) | 100% | 100% | 1.000 | 0.000 |
| random, seed=1337 (negative control) | 39% | 72% | 0.572 | 0.219 |
| stub-jev (wiring test, not a quality signal) | 17% | 56% | 0.418 | 0.203 |

Theoretical chance top-1 rate (mean `|expected|/pool_size` across the 18 cases):
**25.9%** — the single seeded random draw (39%) is ordinary sampling variance at
n=18 heterogeneous pools, not a broken control (`metrics.theoretical_chance_top1_rate`
docstring works through this). The current finder scoring BELOW the theoretical
chance rate (17% vs 25.9%) is real and explained in `DERIVATION.md`: with no
qubit/depth limit set, every candidate in a domain pool satisfies the same one
criterion, so `findMethods` ranks the pool **alphabetically by title** — a
relevance-blind tie-break, not a bug in this harness. That gap (current finder below
chance; Jev's whole value proposition is a calibrated, content-aware score) is the
concrete case for the trial.

Mutation-check performed 2026-09-21: inverted `metrics.top_k_hit`'s comparison,
reran `--ranker oracle`, confirmed top-1/top-3 dropped from 100% to 0%, reverted.

A REAL run — spends a fraction of a cent (18 requests, roughly 500-1,000 input
tokens each at $42/billion input tokens, i.e. on the order of $0.001 total; output is
unbilled per typesafe.ai's pricing page; this is an ESTIMATE, not a measurement, made
before any real call) but is a real call to a new third party carrying the case's
problem-statement text as Input:

```bash
# TYPESAFE_API_KEY must be in the environment first — the operator loads it from
# ~/Developer/projects/leona-secrets/llm-keys.txt (see jev_client.py). No key ->
# this refuses before any network attempt (exit 2), and writes no report file.
uv run --package majorana-evals python -m majorana_evals.jev_trial run \
    --ranker live-jev --out evals/jev-trial-report.json \
    --markdown-out evals/jev-trial-report.md
```

## Tests

`evals/harness/tests/test_jev_trial.py` — loaders, metrics (incl. the theoretical
chance rate and reliability bins), all four zero-spend rankers end to end, and that
`--ranker live-jev` refuses outright (no network call attempted) when
`TYPESAFE_API_KEY` is absent.
