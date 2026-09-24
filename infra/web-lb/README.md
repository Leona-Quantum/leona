# The website's Google Cloud front door

Everything between a visitor and `majorana-web` on Cloud Run, written as scripts
rather than clicked, because PLAN.md's issue 6 is that none of it exists and
nothing we already run is written down: *"Building it by hand again would be the
lasting risk."*

Each script is idempotent — it checks for the resource and creates it only if it
is absent — so re-running one is how you check the shape is still right, not a
thing to be careful about.

## The shape, and what is deliberately absent

```
visitor -> Cloudflare (DNS, CDN, rate limit on /repository, bot fight mode)
        -> Google external Application Load Balancer (static IP, managed cert)
        -> Cloud Armor: only Cloudflare's edge may reach the origin,
                        and at most 2400 requests a minute per visitor address
        -> url map:  /repository*  -> Cloud Run: majorana-web-atlas  (max 8, 8 in flight each)
                     everything else -> Cloud Run: majorana-web      (max 4)
           both: ingress load balancer only, same image, request logging on
```

**Why two services (2026-09-24).** One service capped at four instances was one
capacity pool for the whole site. A crawler walking the Atlas map's
`?focus=&open=` permutations (every one a cache miss and ~1 s of CPU) used all of
it, and Cloud Run answered "429 Rate exceeded." to ~83% of every request — the home
page and the JavaScript chunks included — for eight hours, until DNS went back to
Vercel. The Atlas is where the site's unbounded URL space lives, so it gets its own
instances: a flood there now ends in 429s on Atlas URLs only. The record is
`ai-ops/desk/leona/plans/incidents/2026-09-24-gcp-web-429.md`.

**Cloud CDN is off, on purpose.** Two rulings put the CDN at Cloudflare: ai-ops
141 ("Do it now but DNS and CDN only, no WAF rules yet") and ai-ops 318, which
adds a rate limit on `/repository` and bot fight mode after the 15 September
outage. Turning Cloud CDN on as well would put a second cache in front of a stack
whose caching has already caused two production incidents — which is the exact
objection ai-ops 141 was answering. One cache, at Cloudflare.

**Cloud Armor is not a WAF here.** ai-ops 141 said no WAF rules, and ai-ops 318
put the rate limiting at Cloudflare. The one job left for Armor is the one
Cloudflare cannot do for itself: refuse anything that reaches the load balancer
without coming through Cloudflare, so the origin cannot be attacked directly
around the edge protections. That is an origin lock, not a rule set.

## Order, and the two steps that are not automatic

| # | Script | Needs |
|---|---|---|
| 1 | `05-runtime-identity.sh` | nothing — the website's own service account, holding no project role |
| 2 | `06-sign-in-secrets.sh` | step 1; the owner mints the WorkOS key, everything else it finds or makes |
| 3 | `07-verify-twin.sh` | step 1 — the private twin `deploy-web.yml` smoke-tests |
| 4 | `10-origin-lock.sh` | nothing — creates the Cloud Armor policy from Cloudflare's published ranges. **Re-run 15 after it**: the per-visitor rules copy these ranges |
| 4b | `15-visitor-limits.sh` | step 4. Preview by default; `ENFORCE=1` to enforce |
| 5 | `20-load-balancer.sh` | step 4 |
| 5b | `25-atlas-bulkhead.sh` | step 5 and a serving `majorana-web` (it copies that service's spec) |
| 6 | `31-origin-certificate.sh` | step 5, and a Cloudflare Origin Certificate + key |
| 7 | `32-rehearsal-hostname.sh` | step 6 — lets any name under the domain be rehearsed through Cloudflare |
| 8 | `40-serve.sh` | a servable certificate, and the origin lock attached |
| — | `80-cutover-preflight.sh` | ends in **GO** or **NO-GO**; what stands behind telling the collaborator to move the records |
| — | *point `leonaqt.com` at the printed IP, **proxied*** | **the collaborator who holds Cloudflare** |
| — | `90-verify.sh` | reads it all back, including from the TLS handshake |
| — | `95-monitoring.sh` | alerts on Cloud Run 429/5xx for both services, uptime checks on `gcp-preview` |
| — | `load/` | the load tests that reproduce 2026-09-24 and check ordinary browsing — `load/README.md` |

`test-gates.sh` drives `40-serve.sh`'s refusals with no cloud behind it; run it after touching
`common.sh`.

## Two things the move would have broken by itself

Both were found on 2026-09-17 by reading what `40-serve.sh` does against what
`deploy-web.yml` did, before either had met the other in production.

**The deploy workflow passed `--no-allow-unauthenticated` to `majorana-web`.** On an
existing service gcloud reads that as "remove the `allUsers` binding" — the binding
`40-serve.sh` adds, because the load balancer reaches Cloud Run as an unauthenticated
caller. The first deploy after the cutover would have turned the site into a 403 for every
visitor. The workflow now leaves that binding alone and asserts the ingress restriction
instead.

**The smoke test probed `majorana-web` at a run.app URL.** Ingress is a property of the
service, so once it is restricted to the load balancer no run.app URL of that service
answers a GitHub runner, token or not — and the load balancer refuses a runner too, by
design. The smoke test would have failed forever and the site would have frozen at one
revision. It runs on the private twin now (`07-verify-twin.sh`).

**And one it would have widened.** `majorana-web` ran as the default compute account, which
holds `roles/editor`. On Vercel the website held no cloud credential at all.
`05-runtime-identity.sh` gives it an account with no project roles.

## What the rehearsal found before any visitor did

With the WorkOS settings mounted on the twin, `/`, `/repository` and `/pricing` rendered and
everything that runs the sign-in middleware returned **500**: the 404 page, the OG image,
`/auth/sign-in`, `/api/contact`, `/studio`. AuthKit reads `NEXT_PUBLIC_WORKOS_REDIRECT_URI`,
and Next inlines `NEXT_PUBLIC_*` at **build** time — setting it on the running service does
nothing, which was tried. The image had been built without it, because sign-in had never
been switched on there. It is a build argument now (`cloudbuild.web.yaml`). Had the records
moved first, every signed-out visitor to the workspace would have met a 500.

## Which certificate, and why 30 is no longer the path

`30-certificate.sh` asks Google to issue a certificate, proving control with a CNAME at
`_acme-challenge.leonaqt.com`. **That name is taken**: Cloudflare put its own validation
record there when it took the domain on, and a name holds one CNAME. The owner ruled on
**ai-ops 325** to stop needing Google's certificate rather than displace Cloudflare's — so
`31-origin-certificate.sh` is the live path and `30-certificate.sh` is kept for the case
where the domain ever leaves Cloudflare.

The trade is one sentence: a Cloudflare Origin Certificate is trusted by Cloudflare **and by
nothing else**, so the DNS record must be proxied (orange cloud) at the same moment it points
here, or every visitor gets a full-page certificate warning. `90-verify.sh` checks for
exactly that. The whole procedure, including what the owner and the collaborator each do, is
`docs/runbooks/cloudflare-origin-certificate.md`.

Nothing here waits on DNS any more, which was the point of ai-ops 325: an Origin
Certificate is valid the moment Cloudflare issues it, so the load balancer is
already serving a good certificate days before any record moves, and the cutover
is a switch rather than a TLS outage.

## The one ordering that is not cosmetic

`40-serve.sh` restricts Cloud Run ingress to the load balancer **before** it
allows unauthenticated requests, never the other way round. Between those two
commands in the wrong order, the whole site is a public URL on `run.app` with no
Cloudflare, no rate limit and no Armor in front of it. The script enforces the
order; this paragraph exists so nobody helpfully "simplifies" it into one step.

## Rolling back

Two different things can need undoing, and they are undone in different places.

**A bad deploy** (a revision that errors, or renders wrong): shift traffic back to
the previous revision, per service. It takes seconds and touches no DNS.
`deploy-web.yml` does this itself when any of its steps fails; by hand:

```
gcloud run revisions list --service majorana-web --region us-west1 --project majorana-core --limit 5
gcloud run services update-traffic majorana-web --region us-west1 --project majorana-core --to-revisions <previous>=100
# and the same for majorana-web-atlas, to the revision built from the same image
```

Keep the two on one image (`90-verify.sh` fails if they are not): a page rendered by
one asks the other for chunks by content hash.

**Google itself** (the load balancer, Armor, or capacity refusing people): point
`leonaqt.com` and `www` back at Vercel in Cloudflare, DNS-only (grey cloud) — as
they resolve today, read with `dig` on 2026-09-24 after the rollback: `leonaqt.com A
76.76.21.21` and `www CNAME cname.vercel-dns-0.com`. The collaborator who holds
Cloudflare does this. Done on 2026-09-24: the last request reached Google at 12:38:41 UTC, so
the switch takes effect within a minute. Know what it restores: Vercel's Git
integration was disconnected on 2026-09-21, so Vercel serves its last production
deployment (`d1c236c9`), not current `dev`. That is a working site but an old one,
and the API behind it has moved on since. It is a fallback for hours, not days.

