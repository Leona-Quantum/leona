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
| 3 | `31-origin-certificate.sh` | step 2, and a Cloudflare Origin Certificate + key |
| 4 | `40-serve.sh` | a servable certificate, and the origin lock attached |
| — | *point `leonaqt.com` at the printed IP, **proxied*** | **the collaborator who holds Cloudflare** |
| — | `90-verify.sh` | reads it all back, including from the TLS handshake |

`test-gates.sh` drives step 4's refusals with no cloud behind it; run it after touching
`common.sh`.

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
