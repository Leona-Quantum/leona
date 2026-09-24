# Load tests for the website's Google Cloud front door

Written for the 2026-09-24 incident (`ai-ops/desk/leona/plans/incidents/2026-09-24-gcp-web-429.md`)
and kept so the next cutover can repeat them. **Point them only at
`gcp-preview.leonaqt.com`**, the rehearsal hostname, which goes through the same
Cloudflare → load balancer → Cloud Run path as production and serves no visitors.

| Script | What it asks | How to run |
|---|---|---|
| `atlas-flood.js` | Does an innocent visitor still get the site while a crawler floods the Atlas? Replays the crawler's real URLs (`crawler-urls-20260924.json`, from the request log) with cache-busters, beside a steady visitor stream | below |
| `browse.js` | Do ordinary people browsing — alone, or many behind one address — ever meet a 429? | `k6 run -e VUS=30 -e MINUTES=10 --out json=b.json browse.js` |
| `summarise.py` | Counts every response by stream, page class, status and **who answered it** (Cloud Run / Cloud Armor / Cloudflare / cache / app) | `python3 summarise.py run.json` |

## The two shapes of flood, and why both are needed

**One address** (`k6 run -e CRAWL_RPS=50 atlas-flood.js`): Cloudflare's per-IP
"Atlas crawl limit" refuses most of it at the edge. Measured 2026-09-24: 92% refused
by Cloudflare, and the ~7 requests/s that got through were still enough to make
Cloud Run refuse 15% of home-page requests on the old single-service setup. It is
also the shared-address test: the visitor stream runs from the same address, and
Cloudflare refused 88% of its `/repository*` requests too.

**Many addresses**: the real crawler kept ~58 requests/s on the origin for four
hours, which a single address cannot do past that limit. The distributed run is
a GitHub Actions matrix on a throwaway `loadtest/*` branch (15 runners × 4
requests/s, each under the per-IP limit, started together at the unix time in
`START_AT`), with the visitor stream on one more machine:

```
T=$(( $(date +%s) + 240 )); echo $T > infra/web-lb/load/START_AT   # on the loadtest branch
git commit -am "loadtest: <what>" && git push                       # starts the matrix
k6 run -e SCENARIO=visitor -e START_AT=$T --out json=v.json infra/web-lb/load/atlas-flood.js
gh run download <run-id> -D runs && gunzip runs/*/*.gz && cat runs/*/*.json > c.json
python3 infra/web-lb/load/summarise.py c.json; python3 infra/web-lb/load/summarise.py v.json
```

Delete the branch when done. It triggers nothing else: every other workflow
listens to `dev` only.

## What "passing" means

- Visitor stream: **0** Cloud Run 429s on the home page, other pages and static
  chunks, whatever the crawler is doing. A Cloud Run 429 on `/repository*` under a
  flood is the bulkhead doing its job; one anywhere else is the incident.
- `browse.js` from one address at the agreed load: **0** 429s from anyone.
- Cloud Armor, from the load balancer's log: preview decisions name the tester's
  own address as the key (`rateLimitAction.key`), which is the proof the limit is
  counting visitors and not Cloudflare's data centres.
