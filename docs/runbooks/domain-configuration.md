# Domain configuration handoff

This is the DNS handoff for the person who controls the two domains. It contains
no API keys, passwords, or other secrets.

## What is being connected

The web application is hosted in the Vercel project `majoranaq/web`.

| Domain | Registrar/DNS provider | Current Vercel state | Action |
| --- | --- | --- | --- |
| `leonaqt.com` | GoDaddy | Already added to the Vercel project, but DNS still points to GoDaddy parking | Replace the parking records with Vercel records |
| `leonaquantum.com` | Cloudflare | Not yet added to the Vercel project | App owner adds it to Vercel first; then add the Vercel records in Cloudflare |

The recommended arrangement is to serve both domains from the same Vercel
project. The app owner should choose one as the primary/canonical domain and
configure the other to redirect to it. If the team only wants one public domain,
configure that one and leave the other parked or redirect it later.

## 1. GoDaddy: configure `leonaqt.com`

In GoDaddy, open **Domains → leonaqt.com → DNS → Manage DNS**. Keep GoDaddy as
the registrar and DNS provider; do not change the nameservers for this setup.

First, remove or replace records that send the site to GoDaddy's parking page.
At the time this handoff was written, the apex record resolved to
`160.153.0.21`, and `www` followed the apex domain.

Add the records (they match what I already put in the Vercel domain card):

| Host/Name | Type | Value | Purpose |
| --- | --- | --- | --- |
| `@` | `A` | `76.76.21.21` | Vercel apex domain |
| `www` | `CNAME` | `cname.vercel-dns-0.com` | Vercel `www` domain |

Do not delete existing `MX`, `TXT`, or other records used for email or domain
verification. Only replace conflicting web/parking records for `@` and
`www`.

## 2. Cloudflare: configure `leonaquantum.com`

The domain is already delegated to Cloudflare. In Cloudflare, select
`leonaquantum.com`, then open **DNS → Records**.

Add the records (they match what I already put in the Vercel domain card):

| Name | Type | Target | Proxy |
| --- | --- | --- | --- |
| `@` | `A` | `76.76.21.21` | DNS only while verifying |
| `www` | `CNAME` | `cname.vercel-dns-0.com` or the exact Vercel target | DNS only while verifying |

In Cloudflare, `@` means the root domain. Set the orange-cloud proxy to
**DNS only** during Vercel verification. After Vercel reports the domains as
valid, the owner can decide whether Cloudflare proxying is needed; it is not
required for this Vercel setup. Do not change existing mail (`MX`) or verification
(`TXT`) records.

### Troubleshooting

- If GoDaddy still shows **Coming Soon**, check for a remaining `@` parking A
  record, a `www` forwarding rule, or a conflicting `www` record.
- If Cloudflare does not verify, confirm the record is in the authoritative
  Cloudflare zone and temporarily use **DNS only** rather than the orange-cloud
  proxy.
- DNS caches can take up to 24–48 hours to clear after nameserver changes.

## References
- [Vercel: setting up a custom domain](https://vercel.com/docs/domains/set-up-custom-domain)
- [Vercel: troubleshooting domains](https://vercel.com/docs/domains/troubleshooting)
- [Vercel: working with nameservers](https://vercel.com/docs/domains/working-with-nameservers)
