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
        -> Cloud Armor: only Cloudflare's edge may reach the origin
        -> Cloud Run: majorana-web  (ingress: load balancer only)
```

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
| 1 | `10-origin-lock.sh` | nothing — creates the Cloud Armor policy from Cloudflare's published ranges |
| 2 | `20-load-balancer.sh` | step 1 |
| 3 | `30-certificate.sh` | step 2; **prints a DNS record somebody has to add** |
| — | *the CNAME from step 3 goes into the zone* | **owner, or a Cloudflare API token** |
| 4 | `40-serve.sh` | the certificate reporting ACTIVE |
| — | *point `leonaqt.com` at the printed IP* | **owner** |

Steps 3 and 4 are split at the DNS record because a Google-managed certificate
authorised by DNS can be issued **before** any traffic moves. That is the whole
reason to do it this way: at cutover the certificate is already valid, so
switching the record is a switch and not a TLS outage.

## The one ordering that is not cosmetic

`40-serve.sh` restricts Cloud Run ingress to the load balancer **before** it
allows unauthenticated requests, never the other way round. Between those two
commands in the wrong order, the whole site is a public URL on `run.app` with no
Cloudflare, no rate limit and no Armor in front of it. The script enforces the
order; this paragraph exists so nobody helpfully "simplifies" it into one step.
