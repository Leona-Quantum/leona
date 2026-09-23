# k6 abuse scenario — `POST /v1/notebooks/shared/lookup` (ai-ops 349 option 2): MET

The evidence for `plans/rebuild/05-security.md` §1a/§2 on the new anonymous route
this PR adds. The PR body itself flagged this as owed ("k6 abuse run: not
requested by this brief's checklist and not run"). Harness:
`bench/k6/share-abuse.js`, driven by `bench/k6/run-share-abuse.sh` and
`bench/k6/mint_share_fixtures.py` (mints a fixture notebook with a planted
answer-key sentinel and four tokens — valid, revoked, expired, and a
never-minted random one — through the repository layer, never through the
HTTP mint route or WorkOS).

## What was run

| | |
|---|---|
| date | 2026-09-23 14:09–14:10 PDT |
| k6 | v2.1.0 (commit/devel, go1.26.4, darwin/arm64) |
| service | `majorana_api.app:create_app` under uvicorn, one worker, 127.0.0.1:8002 |
| database | local PostgreSQL 17 in Docker, container `pg-s0923-share` (port 55437), database `majorana_k6_share` |
| host `uptime` immediately before | load averages **7.18 11.15 17.84** on a 10-core Mac |
| result | **PASSED**, k6 exit 0, every threshold held |

## Full counts

```
share_flood_attempts ............. 2701   (threshold: count>900   — held)
share_flood_refused ............... 1801  (threshold: count>0     — held)
share_flood_served ................. 900  (threshold: count==900 — held; EXACTLY
                                            the real DEFAULT_ANON_LIMIT=900, the
                                            same shared anonymous ceiling
                                            `/v1/catalog/*` and `/v1/tour-signals`
                                            already use — read from
                                            rate_limit.py at run time)
share_flood_unexpected ................ 0  (threshold: count==0    — held)
share_second_served ................. 37  (threshold: count>0     — held; a
                                            SECOND address reading the SAME
                                            live link through the whole flood)
share_second_refused .................. 0  (threshold: count==0    — held)
share_random_404 ...................... 3  (threshold: count>0     — held; a
                                            syntactically-valid, never-minted
                                            token)
share_random_unexpected ............... 0  (threshold: count==0    — held)
share_revoked_404 ...................... 3  (threshold: count>0     — held)
share_revoked_unexpected ............... 0  (threshold: count==0    — held)
share_expired_404 ...................... 3  (threshold: count>0     — held; born
                                            already expired via mint()'s own
                                            `now` override, no sleep needed)
share_expired_unexpected ............... 0  (threshold: count==0    — held)
sentinel_leaked ........................ 0  (threshold: count==0    — held; the
                                            planted answer-key sentinel
                                            appeared in NO response body across
                                            2747 total requests)
server_errors (whole run, all scenarios) 0  (threshold: count==0    — held)
```

## What this demonstrates, and what it does not

- **The shared per-address anonymous ceiling covers this route exactly like
  `/v1/catalog/*` and `/v1/tour-signals`.** `share_flood_served == 900` is
  EXACT, not "some were served" — the same discipline `pat-abuse.js`'s
  `pat_flood_served==TOKEN_LIMIT` threshold uses, chosen over a softer
  `count>0` because a limiter that let through 850 or 950 would pass a looser
  bound just as well.
- **The control that says the ceiling is address-keyed, not token- or
  notebook-keyed**: a second address, reading the identical live token through
  the entire flood, was never refused (`share_second_refused == 0` on 37
  reads). One token, two addresses is the isolating case — a second,
  unrelated token would have proven nothing a second address does not already
  prove more directly.
- **Random, revoked and expired tokens all answer 404** — never 401/403, per
  the route's own docstring ("a share link's whole point is that its holder
  has no other credential to be challenged for"). All three lifecycle checks
  ran on a THIRD address (`198.51.100.219`), distinct from the flood's and the
  second reader's, specifically so a scheduling accident could never make one
  of these three collide with the ceiling instead of exercising the lookup
  logic under test.
- **The planted answer-key sentinel (`K6-SHARE-ANSWER-KEY-<random>`, embedded
  in a `SOLUTION`-role cell's source AND that same cell's prior `CellResult`
  stdout — the two surfaces `routes/notebook_shares.py::
  _redact_report_for_public`'s docstring names as needing separate guards)
  never appeared in any response body this run read, across 2747 total
  requests.** This is a live, black-box re-check of the same claim
  `test_a_share_link_redacts_every_secret_surface_through_the_public_route`
  already proves at the pytest level; the k6 run adds concurrency and real
  HTTP framing, not a new code path.
- **Zero 5xx across the whole run** (`server_errors == 0`), including during
  the 20-second flood at ~135 requests/s.
- **What this does NOT establish**: cross-tenant isolation (a link for
  notebook A never showing notebook B) and the creator-only mint/list/revoke
  authz — both already proven live in
  `services/api/tests/authz/test_notebook_share_links_live.py` and out of
  scope for an abuse/rate-limit run. Also not established: behavior under the
  production `majorana_api`/`app_rw` non-superuser Postgres role — this
  throwaway container connects as the `postgres` superuser, the same
  documented gap the tour-signals and personal-access-token gates carry.

## Reproducing

```bash
bench/k6/run-share-abuse.sh
```

Requires Docker, `k6`, and `.env.db.local` pointed at a throwaway Postgres —
see the script's own header for why `BASE_URL` is deliberately not an
argument. Check `uptime` first; the tour-signals gate
(`docs/gates/k6-tour-signals-2026-09-23.md`) found this host's result depends
on it.
