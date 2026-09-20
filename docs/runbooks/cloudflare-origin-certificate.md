# The Cloudflare Origin Certificate on the Google load balancer

**Why this and not a Google-managed certificate.** A Google-managed certificate proves we
own the domain by reading a CNAME at `_acme-challenge.leonaqt.com`. Cloudflare put its own
validation record on that exact name automatically when it took the domain on, and a name
holds one CNAME, so the two cannot sit side by side. The owner ruled on **ai-ops 325** to
"stop needing Google's certificate at all: generate a free Cloudflare Origin Certificate, put
that on the Google load balancer, and turn proxying on" — which removes the conflict rather
than resolving it, and switches on the **ai-ops 318** edge rules in the same visit, because
those only apply to traffic that actually passes through Cloudflare.

**What an Origin Certificate is.** A certificate issued by Cloudflare, free, valid for up to
15 years, trusted by Cloudflare's edge **and by nothing else**. No browser has Cloudflare's
Origin CA in its trust store. It secures the hop from Cloudflare to us; the hop a visitor
sees is secured by Cloudflare's own public certificate. That makes it correct in exactly one
topology — every request arrives through Cloudflare — and wrong in every other.

**The consequence, stated once because everything below follows from it.** If
`leonaqt.com` is pointed at this load balancer with the orange cloud **off**, every visitor's
browser is handed a certificate signed by an authority it has never heard of, and the site is
a full-page TLS warning for everyone at once. Nothing on our side errors; our side is working
exactly as configured. So the record must be pointed here and proxied in the *same* edit.

Verified 2026-09-16 rather than assumed: Google Certificate Manager accepts a certificate
signed by a private CA (a throwaway one was created and deleted to check), and a self-managed
certificate reports an **empty** `managed.state` — which is why `40-serve.sh` no longer
compares that field with `ACTIVE`.

## Who does what

### The collaborator who holds Cloudflare access to `leonaqt.com`

Two visits to the dashboard. Nothing here changes what a visitor sees.

**Visit 1 — issue the certificate (about ten minutes, any time).**

1. Cloudflare dashboard → the `leonaqt.com` zone → **SSL/TLS** → **Origin Server** →
   **Create Certificate**.
2. Leave "Generate private key and CSR with Cloudflare" selected. Key type **RSA (2048)**.
3. Hostnames: `leonaqt.com` **and** `*.leonaqt.com`. Both. The wildcard covers `www` but not
   the bare name, and the site serves both.
4. Certificate Validity: **15 years**.
5. Press Create. Two boxes appear: **Origin Certificate** and **Private Key**.
   **The private key is shown once and never again.** Copy both boxes into a password
   manager before leaving the page. Send them to Eshaan through something end-to-end
   encrypted — not email, not Slack.
6. Same page's **SSL/TLS → Overview**: set the encryption mode to **Full (strict)**.
   Not *Flexible* (that sends plain HTTP to us, and our load balancer answers HTTP with a
   redirect to HTTPS, so the two make an infinite redirect). Not plain *Full* (that accepts
   any certificate from the origin, which throws away the reason for doing this at all).

**Between the visits — one rehearsal record (five minutes, any time, no visitor impact).**

Add `gcp-preview` as an **A** record to the load balancer's address, **Proxied**. The
certificate is a wildcard and `infra/web-lb/32-rehearsal-hostname.sh` gives the load balancer
a matching entry, so this one record carries real requests through Cloudflare's edge, Full
(strict), the origin lock and Cloud Run on a name no visitor uses. Then
`PREVIEW_HOST=gcp-preview.leonaqt.com infra/web-lb/80-cutover-preflight.sh` ends in GO or
NO-GO. Pages name `https://leonaqt.com/...` as canonical, so the extra host does not
compete in search; delete the record after the cutover.

What the collaborator was actually sent, as one PDF, is
`~/Developer/ai-ops/desk/leona/handoffs/leonaqt-cloudflare-collaborator-brief-20260917.pdf`.
Where it and this file disagree, the PDF is what he acted on.

**Visit 2 — the cutover (about five minutes, on a date Eshaan names).**

Do not do this until Eshaan confirms the certificate is installed on the load balancer and
the checks pass. Then, in one sitting:

7. **DNS** → the `@` (apex) record: change its address to the load balancer's, and set the
   cloud to **Proxied** (orange).
8. **DNS** → the `www` record: same address, also **Proxied** (orange).
   Eshaan will give the address; it is the load balancer's global IP.
9. **Security → WAF → Rate limiting rules**: one rule, which is all a Free plan allows, and
   the zone is on Free (the collaborator confirmed it 2026-09-17). Expression
   `(starts_with(http.request.uri.path, "/repository") and not cf.bot_management.verified_bot)`,
   same IP, **60 requests per 10 seconds**, action Block for 10 seconds — on Free the period
   and the block are both fixed at 10 s and the only fields a rule may test are the path and
   "verified bot" (Cloudflare's rate-limiting page lists them as "Path, Verified Bot"; the
   17 September PDF wrote the older name `cf.client.bot`, corrected in the GO message of
   2026-09-19). If the expression editor refuses it, build the same rule from the two
   dropdown fields, URI Path starts with `/repository` and Verified Bot off. This is ai-ops 318. Verified bots are exempt on the collaborator's
   suggestion, relayed by the owner, so a search engine is never rate-limited off the Atlas.
   The trade is written down because nobody found out what sent the 15 September traffic: if
   it was a verified crawler, this rule lets it through, and the cache rule is what absorbs it.
10. **Security → Bots**: turn **Bot Fight Mode** on, **last**, and note the time. Also ai-ops
    318. It cannot be skipped for chosen paths or addresses, and Cloudflare says it may
    challenge legitimate automated traffic — which describes `web-deploy-watch`,
    `verify-web-cache` and the bench, all of which probe leonaqt.com from GitHub's runners.
    Knowing when it went on is how a challenged monitor is told from a real fault. If it
    blocks them or a search engine, it goes off again and the rate limit stays; the owner's
    options on 318 allowed for exactly that.
11. **Analytics & Logs → Web Analytics**: turn automatic setup **off** for the zone. With it
    on, Cloudflare injects `static.cloudflareinsights.com/beacon.min.js` into every proxied
    page; the site's Content-Security-Policy refuses it, so it collects nothing and logs a
    console error on every page view (seen on `gcp-preview` 2026-09-19). ai-ops 141 is DNS
    and CDN only, so the answer is to switch it off, not to widen the CSP.
12. Tell Eshaan it is done. Undo for any of these is the same screen and takes under a
    minute; step 7 and 8 reverse by putting the old address back.

### Eshaan

1. Receive the certificate and private key from the collaborator, over something end-to-end
   encrypted.
2. Put them somewhere an agent session can reach them **without them landing in the repo**:
   the project's secret store, or two files in a directory outside any checkout. The private
   key is a credential; `leona-secrets` is where it belongs, and nothing copies it elsewhere.
3. Approve the load balancer's standing cost before `40-serve.sh` runs — the forwarding rule
   is about $18/month and is the first line that bills.
4. Name the cutover date and tell the collaborator to make visit 2.

### The agent session doing the work

```bash
cd infra/web-lb
./05-runtime-identity.sh                                                  # the website's own identity, no project roles
./06-sign-in-secrets.sh --from-env-file <vercel pull> --contact-fallback auto
./07-verify-twin.sh                                                       # the private twin CI smoke-tests
./31-origin-certificate.sh --cert origin.pem --key origin.key --dry-run   # checks only
./31-origin-certificate.sh --cert origin.pem --key origin.key             # uploads, repoints the map
./32-rehearsal-hostname.sh                                                # any name under the domain can be rehearsed
./40-serve.sh                                                             # refuses unless the lock is attached
./90-verify.sh                                                            # reads the handshake, not the config
PREVIEW_HOST=gcp-preview.leonaqt.com ./80-cutover-preflight.sh            # GO, or NO-GO and why
```

**Say GO only on the preflight's GO.** The collaborator asked for the literal sentence "GO
for Cloudflare cutover" before he moves the records. `80-cutover-preflight.sh` is what
stands behind it: sign-in mounted and reaching WorkOS, the dedicated identity, a warm
instance, traffic on the latest revision, and — given a `PREVIEW_HOST` — a real request
through Cloudflare's edge, Full (strict), the origin lock and Cloud Run, on a name no
visitor uses. Without the rehearsal record the first request through Cloudflare is a real
visitor's.

`WEB_XFF_TRUSTED_HOPS` in `infra/fleet.env` goes `0` → `1` in the same commit that runs
`40-serve.sh`; `90-verify.sh` fails if they disagree. Turning Cloudflare's proxy on does not
make it `2` — the reason is written out beside the setting.

After the site is serving through Cloudflare, the Google-managed certificate
(`majorana-web-cert`) and its two DNS authorizations are dead weight and will sit at
`PROVISIONING` forever, which reads as a fault to the next person. Delete them then, not
before:

```bash
gcloud certificate-manager certificates delete majorana-web-cert --location=global --project=majorana-core
gcloud certificate-manager dns-authorizations delete majorana-web-auth-leonaqt-com --location=global --project=majorana-core
gcloud certificate-manager dns-authorizations delete majorana-web-auth-www-leonaqt-com --location=global --project=majorana-core
```

## After the switch: what was measured, 2026-09-20

The collaborator finished the Cloudflare side at about 07:40 UTC (both records proxied to
`35.190.65.233`, SSL Full (strict), the cache rule, the rate limit, Bot Fight Mode on at
07:36 UTC). Read back the same day from an ordinary connection:

- Both names resolve to Cloudflare; the apex answers 200 with `server: cloudflare` and
  `via: 1.1 google`; `www` answers 308 to the apex with path and query kept; visitors are
  handed a Let's Encrypt certificate, never the Origin one; a request that skips Cloudflare
  gets 403 from the origin lock.
- `/repository`, `/repository/layers` and `/repository/folders` come from Cloudflare's cache
  (HIT by the second request). The five never-shared requests (React payloads, the Japanese
  cookie, a bare `?_rsc`) are all DYNAMIC. 70 sampled sitemap URLs all answer 200 or 308.
- `infra/web-lb/90-verify.sh` passes: 22 allowed ranges against the 22 Cloudflare publishes,
  the Origin certificate in the handshake, ingress restricted, the twin private, one trusted
  forwarding hop.
- `majorana-web-cert` and its two DNS authorizations are deleted (their definitions are kept
  in ai-ops `desk/leona/plans/gcp-migration-20260912/archive/`). The two
  `_acme-challenge` CNAME records in Cloudflare DNS now point at nothing and can go.

**Bot Fight Mode challenges every request from a GitHub runner.** Measured at 22:52 UTC from
a runner in Azure (Cloudflare colo IAD): `/`, `/repository`, a record page and
`/auth/sign-in` each answered `403` with `cf-mitigated: challenge`. So the two post-deploy
probes cannot see the public site while it is on. They now say so rather than reporting the
site down (`scripts/check-live-pages.mjs` exits 2 with "could not see the site"), and the
question that mattered most — does a record page render — moved to the pre-shift smoke test
on the private twin in `deploy-web.yml`, which no edge setting can blind. What a runner can
no longer check is the part only the public name shows: Cloudflare's cache verdicts.
`web-deploy-watch` is unaffected; it reads GitHub's deployment records and never contacts the
site. Step 10 above named it as exposed, which was wrong.

Whether Bot Fight Mode stays on is the owner's call (ai-ops 318). With it off the monitors
see again and the rate limit still holds; with it on, read the cache from an ordinary
connection after a change to the cache rule: `node scripts/check-live-repository-cache.mjs`.

`gcp-preview` has no remaining use. Nothing in CI reads it; only
`infra/web-lb/80-cutover-preflight.sh` does, and that script's job is done. The wildcard map
entry that made it answer (`majorana-web-entry-wildcard`) is harmless to leave.

## What each check actually proves

- `31-origin-certificate.sh --dry-run` reads the files and refuses four ways: an issuer that
  is not Cloudflare's Origin CA, a certificate that does not cover both names, a certificate
  expiring within 30 days, and a private key from a different issuance. Each refusal has been
  observed against a deliberately broken pair.
- `40-serve.sh` refuses to publish unless the certificate the **map entry** points at is
  servable, and — for an Origin certificate specifically — unless the Cloud Armor origin lock
  is attached to the backend. `test-gates.sh` drives all eight outcomes with no cloud behind
  it, and two mutations of the gate take it red.
- `90-verify.sh` reads the certificate **from the TLS handshake**, not from the Certificate
  Manager resource, because those can disagree and the one a visitor meets is the handshake.
  It then checks that `leonaqt.com` does not resolve straight to the load balancer while an
  Origin certificate is being served — the one misconfiguration that breaks the site for
  everybody.

## What this does not cover

- Replacing the certificate. Its private key reached us through a GitHub issue; the owner
  ruled on 2026-09-17, in session, "no need for new certificate. it is okay as it is". Do not
  re-raise it.
- Cloudflare's cache rules for the Atlas pages. ai-ops 141 puts the CDN at Cloudflare, and
  the current cache design was measured against Vercel's rules, not Cloudflare's. It has to
  be re-measured after the switch; `verify-web-cache` is the instrument.
- Sign-in. The WorkOS values are ai-ops 321, where the owner ruled to generate fresh ones and
  accept that everyone signed in is signed out once at the switch.
