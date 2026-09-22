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
uv run --package majorana-evals python -m majorana_evals.jev_trial run \
    --ranker lexical  --out /tmp/jev-trial-lexical.json
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

A real run needs `TYPESAFE_API_KEY` in the environment. Load it from the secrets file;
the harness strips one pair of `.env`-style quotes, because Jev answers a quoted key
with a bare 401. With no key it refuses before any network attempt (exit 2) and writes
no report.

```bash
TYPESAFE_API_KEY="$(grep '^TYPESAFE_API_KEY=' ~/Developer/projects/leona-secrets/llm-keys.txt | cut -d= -f2-)" \
  uv run --package majorana-evals python -m majorana_evals.jev_trial run \
    --ranker live-jev --out evals/report-jev-trial-live-<date>.json \
    --markdown-out evals/report-jev-trial-live-<date>.md
```

## Live result, 2026-09-22 (owner put the key in; ai-ops#358)

Two full live runs plus a one-case smoke test, on `origin/dev` 3c212e59. Run 2 also
carried this branch's token-capture and quote-stripping edits, neither of which touches
the ranking. Reports: `evals/report-jev-trial-*-20260922*.json`.

| ranker | top-1 | top-3 | MRR | Brier |
|---|---|---|---|---|
| **Jev, run 1** | **94% (17/18)** | 100% | 0.972 | 0.060 |
| **Jev, run 2** | **94% (17/18)** | 100% | 0.972 | 0.055 |
| word overlap (`lexical`, zero-spend control) | 78% (14/18) | 100% | 0.889 | 0.310 (uncalibrated) |
| current finder | 17% (3/18) | 56% | 0.418 | n/a |
| random, seed 1337 | 39% | 72% | 0.572 | 0.219 |

What it cost: 20,129 billed input tokens for a full run, about $0.0008 at $42 per
billion; output is unbilled. Three calls in total (two full runs and the smoke test)
came to under $0.002.

How to read it:

- **Most of the gap is the finder, not Jev.** The `lexical` control ranks the same
  candidates by plain TF-IDF word overlap with the query, using exactly the text Jev is
  sent. It lifts top-1 from 17% to 78% with no model at all. Any content-aware ranking
  fixes most of the alphabetical tie-break problem in `DERIVATION.md`.
- **Jev adds a little on top, and 18 cases cannot say how much.** Jev got three cases
  right that word overlap missed (`optimization-adiabatic`,
  `ml-quantum-kernel-classifier`, `communication-teleportation`), and word overlap got
  none right that Jev missed. An exact sign test on 3 against 0 gives p = 0.25. That is
  consistent with a real edge, and it is not evidence of one.
- **Jev's confidence tracks its accuracy here.** All 13 answers above 0.8 confidence
  were right, and the one miss sat in the 0.4 to 0.6 bin. With a single miss that is
  thin evidence, but nothing contradicts it.
- **Stable top pick, jittery tail.** Jev chose the same first method in all 18 cases
  on both runs. The order below first place differed in 15 of 18, and confidence moved
  by up to 0.07.
- **The one case both miss may be a labelling choice.** `optimization-qaoa-benchmark`
  asks for "a QAOA ring-graph MaxCut benchmark circuit". Both rankers put
  `qaoa-maxcut-ring` first, which is a QAOA MaxCut circuit on a ring but is not tagged
  `benchmark-circuit`, so the ground truth scores it wrong.
- **The cases favour word matching.** Queries were written from the catalog's own
  tags and titles, so they share words with their answers. A set of queries phrased
  the way a user would put a problem, without the method's name in them, is the test
  that would separate Jev from word overlap. It has not been built.

## Tests

`evals/harness/tests/test_jev_trial.py` — loaders, metrics (incl. the theoretical
chance rate and reliability bins), all five zero-spend rankers end to end, the key loader's quote stripping, and that
`--ranker live-jev` refuses outright (no network call attempted) when
`TYPESAFE_API_KEY` is absent.
