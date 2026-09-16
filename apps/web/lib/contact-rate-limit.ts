/**
 * Per-address admission control for the public contact form (ai-ops 127).
 *
 * ## What was actually missing, and what was not
 *
 * The audit on ai-ops 127 reported "no bot protection on anything we host".
 * That was too broad for this route: `validateInquiry` already carries a
 * honeypot (`website`), it is rendered by the real form, submitted by it, and
 * covered by tests. A naive bot that fills every input it finds is already
 * refused.
 *
 * What the route had nothing of is a BOUND. A honeypot is a classifier — it
 * decides whether one submission looks automated — and a classifier says
 * nothing about how many times you may ask. Anything that leaves the field
 * empty, including a ten-line script written after reading the page source, had
 * unlimited attempts at a route that sends real email.
 *
 * ## Why that is worth a module three days before signups open
 *
 * `POST /api/contact` is the only unauthenticated route in `apps/web` that
 * spends something irreversible. Every accepted submission is an email sent
 * through Resend on a domain the owner is still setting up (ai-ops 130), and it
 * costs two things that do not come back: a slice of a 3,000/month free tier,
 * and the sending reputation of the domain itself. A flood does not need to
 * breach anything to be expensive — it only needs to be delivered.
 *
 * Today the route is inert (`contactSender()` returns null without the three
 * environment variables, and it answers 503). This limiter has to be in place
 * BEFORE the key lands rather than after, because the day the key lands is the
 * day the cost starts, and nothing about setting an environment variable
 * prompts anyone to revisit rate limiting.
 *
 * ## Fixed window, in this process, and what that is worth on serverless
 *
 * The counters live in one instance's memory. `services/api`'s limiter says the
 * same of Cloud Run and is worth reading for the fuller argument; the honest
 * difference here is that Vercel's functions are more numerous and shorter
 * lived than Cloud Run instances, so the effective ceiling is further above the
 * nominal one and a cold start begins at zero.
 *
 * So this is a backstop, not a quota, and it is worth having anyway: the flood
 * this is actually against is a script in a loop, which keeps a connection open
 * and lands on warm instances. It does not stop a distributed sender, and
 * nothing that fits in this repository would — saying so here is the point, so
 * that a later reader does not mistake the presence of a limiter for a bound it
 * never had.
 *
 * Pure, and takes its store and its clock as arguments, so the suite can drive
 * time instead of sleeping. The route owns the one long-lived store.
 */

import { isCloudflareEdgeAddress } from "./cloudflare-proxy.ts";

/**
 * The first entry of a header that may be a bare value or a comma-separated
 * list, trimmed; `""` if the header is absent or empty. Shared by every
 * forwarding-style header this file reads — see `contactAddress`'s "The FIRST
 * entry" section for why first, and why that is the same choice for all of
 * them despite their different trust levels.
 */
function firstEntry(value: string | null | undefined): string {
  return (value ?? "").split(",")[0]?.trim() ?? "";
}

/** One address's usage of the current window. */
export type WindowEntry = { count: number; resetAt: number };

export type RateLimitStore = Map<string, WindowEntry>;

export type Decision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Five submissions per ten minutes.
 *
 * A person writing in sends one, occasionally two if they realise they left
 * something out. Five is far enough above that nobody legitimate meets it —
 * including two people behind one office NAT — and far enough below a flood to
 * make the route uninteresting to hammer.
 */
export const CONTACT_WINDOW_MS = 10 * 60 * 1000;
export const CONTACT_MAX_PER_WINDOW = 5;

/**
 * The table is capped for the same reason `services/api`'s is: an attacker
 * rotating source addresses defeats any per-IP limiter, and what must not
 * follow is that the rotation exhausts this process's memory. On saturation the
 * request is ALLOWED, never refused — degrading to "off" loses a bound we never
 * had against that attacker, while degrading to "refuse" would take the contact
 * form down for everyone who is not attacking it.
 */
export const CONTACT_MAX_TRACKED = 10_000;

export function admitContact(
  store: RateLimitStore,
  address: string,
  now: number,
  limit: number = CONTACT_MAX_PER_WINDOW,
  windowMs: number = CONTACT_WINDOW_MS,
): Decision {
  const entry = store.get(address);

  // A window that has run out is not a refusal to serve — it is simply a new
  // window. Reset rather than delete-and-reinsert so an address that keeps
  // writing in over hours does not churn the table.
  if (entry === undefined || now >= entry.resetAt) {
    if (entry === undefined && store.size >= CONTACT_MAX_TRACKED) {
      sweepExpired(store, now);
      // Still full after sweeping: allow, and do not record. Recording here is
      // what would let the rotation evict the entries that are doing the work.
      if (store.size >= CONTACT_MAX_TRACKED) return { allowed: true };
    }
    store.set(address, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (entry.count >= limit) {
    // Rounded UP, and floored at one: `Retry-After: 0` invites an immediate
    // retry, which is precisely the behaviour being bounded.
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  entry.count += 1;
  return { allowed: true };
}

/** Drop windows that have already elapsed. Called only when the table is full. */
export function sweepExpired(store: RateLimitStore, now: number): void {
  for (const [address, entry] of store) {
    if (now >= entry.resetAt) store.delete(address);
  }
}

/**
 * How many trailing `x-forwarded-for` entries were appended by infrastructure we
 * run, sitting to the RIGHT of the address that actually connected to it.
 *
 * `null` means "not configured", which is the Vercel topology and local
 * development: this file's Vercel branch answers first there and this number is
 * never consulted. Behind Google's external Application Load Balancer it is `1`
 * — the load balancer appends the connecting client's address and then its own,
 * so the peer is the second entry from the right. On a bare Cloud Run URL with
 * no load balancer in front it is `0`, because Google's front end appends only
 * the connecting address.
 *
 * It is a configured number rather than a guess for the same reason the Vercel
 * branch above exists at all: the entries to the left of the peer are whatever
 * the caller sent, and any rule that infers the boundary from the list's own
 * contents can be moved by the caller sending more of them.
 */
function trustedProxyHops(): number | null {
  const raw = process.env.LEONA_XFF_TRUSTED_HOPS?.trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * The address Google's infrastructure itself observed connecting, or `null` when
 * this deployment is not behind it (or the header does not have enough entries
 * to contain one).
 *
 * ## Why this is not simply the first entry
 *
 * Google's load balancer does not overwrite `x-forwarded-for` the way Vercel's
 * edge overwrites its own header. It PRESERVES whatever arrived and appends to
 * it, so a caller who sends `x-forwarded-for: 1.2.3.4` is served back a header
 * reading `1.2.3.4, <their real address>, <the load balancer>`. The first entry
 * is therefore caller-written — exactly the forgeable value the Vercel branch
 * above was written to stop using — while the entry Google wrote sits a fixed
 * distance from the RIGHT end, because appending cannot be affected by anything
 * the caller puts on the left.
 *
 * ## Too few entries means the request did not come through the load balancer
 *
 * Returning `null` here sends the caller to the `"unknown"` bucket rather than
 * to the last-resort branch. That is deliberate and it is the conservative
 * direction: every such request shares one bucket and is throttled together,
 * which costs a direct-to-`run.app` caller and cannot be used to escape metering
 * by writing a header. The permanent fix is at the ingress rather than here —
 * the Cloud Run service takes `--ingress=internal-and-cloud-load-balancing`, so
 * the load balancer is the only route in and this branch should never fire in
 * production.
 */
function googlePeerAddress(value: string | null | undefined): string | null {
  const hops = trustedProxyHops();
  if (hops === null) return null;
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const peer = entries[entries.length - 1 - hops];
  return peer ?? null;
}

/**
 * The address to meter, from the request's headers.
 *
 * ## The platform header first, and why that is not a detail
 *
 * The first version of this read `x-forwarded-for`'s first entry, to match
 * `services/api/rate_limit.py`. Review pointed out what that costs here, and it
 * is right: `x-forwarded-for` is a request header, so its first entry is written
 * by the CALLER. A script that varies it defeats the limiter with one line and
 * never has to leave one machine — which turns a limiter into decoration.
 *
 * `x-vercel-forwarded-for` is set by Vercel's edge and cannot be forged by a
 * client, so it is preferred wherever it is present. That is the entire
 * difference between bounding an abuser and bounding only an abuser who has not
 * thought about it.
 *
 * `x-real-ip` is next — also platform-set on Vercel — and the client-supplied
 * `x-forwarded-for` is the last resort, for local development and any
 * environment where neither platform header exists. Metering something is better
 * than metering nothing, and this ordering means the forgeable value is only
 * consulted when there is nothing trustworthy to use.
 *
 * The divergence from `services/api` is therefore deliberate rather than an
 * oversight: that service sits behind Cloud Run, where the trustworthy entry is
 * in a different place, and it documents its own reasoning. What is shared is
 * the principle, not the header name.
 *
 * None of this stops a genuinely distributed sender, and the module docstring
 * says so. It stops the cheap attack, which is the one that actually happens.
 *
 * ## `cf-connecting-ip`, and why it goes first rather than replacing anything (ai-ops 141)
 *
 * `leonaqt.com` is proxied through Cloudflare as of ai-ops 141. That changes
 * what `x-vercel-forwarded-for` means: Vercel's edge still sets it from the
 * actual TCP peer, but that peer is now Cloudflare, not the visitor — every
 * request from every visitor on Earth arrives from one of a small set of
 * Cloudflare edge addresses, and the platform header this function has trusted
 * since the finding above collapses to one shared bucket. The rate limiter would
 * still be un-forgeable; it would just no longer discriminate between visitors,
 * which defeats it as thoroughly as the original `x-forwarded-for` bug did.
 *
 * Cloudflare's fix for exactly this is `cf-connecting-ip`, set at its edge to
 * the real visitor address. But it is trustworthy only CONDITIONALLY: this
 * deployment's `*.vercel.app` alias is still reachable directly, entirely
 * outside `leonaqt.com`'s DNS, and nothing stops a request from reaching Vercel
 * that way instead of through Cloudflare. On that path `cf-connecting-ip` is
 * just another caller-supplied header — as forgeable as `x-forwarded-for` ever
 * was, under a name that sounds authoritative. Trusting it outright would trade
 * one bypass for another.
 *
 * `isCloudflareEdgeAddress` (`./cloudflare-proxy.ts`) is the check that closes
 * that gap: `cf-connecting-ip` is honoured only when `x-vercel-forwarded-for` —
 * still un-forgeable, still Vercel's own witness to who actually connected — is
 * itself one of Cloudflare's published edge addresses. That is true for every
 * request that really came through Cloudflare, and false for one that reached
 * Vercel by any other route, including the `*.vercel.app` alias. On that false
 * branch this function falls through to `x-vercel-forwarded-for` exactly as it
 * did before Cloudflare existed in front of this deployment — the real address
 * of whoever actually connected, not a header they wrote themselves.
 *
 * ## The FIRST entry, when a platform header carries more than one (found by review on PR 702)
 *
 * `x-vercel-forwarded-for` can arrive as a comma-separated list rather than a
 * bare address. The first version of this fix read the whole header value as
 * one string and handed it straight to `isCloudflareEdgeAddress`, which parses
 * neither a list of IPv4s nor a list of IPv6s, so it simply returned `false` —
 * `cf-connecting-ip` was silently ignored, and the entire list string (commas
 * and all) became the rate-limit key instead of an address. That is not the
 * "no Cloudflare header, behave as before" case; it is a key that varies with
 * the chain rather than with the visitor, which is worse than either.
 *
 * The list's FIRST entry is the one to trust here, and this is the opposite
 * choice from `x-forwarded-for`'s last-resort branch below on purpose, not by
 * inconsistency: those are different headers with different construction. A
 * generic `X-Forwarded-For` chain grows by each hop APPENDING the peer address
 * it directly observed, so the standard reading is leftmost-is-oldest — but
 * Vercel's own docs (`vercel.com/docs/headers/request-headers`) say
 * `x-vercel-forwarded-for` does not follow that: *"If you are trying to use
 * Vercel behind a proxy, we currently overwrite the X-Forwarded-For header and
 * do not forward external IPs."* Vercel discards whatever chain arrived from
 * upstream — from Cloudflare, in this topology — and starts the header fresh
 * from what its own edge directly observed. So if this header is ever more than
 * one entry despite that stated policy, the first one is Vercel's own freshly
 * substituted observation (the party that connected to VERCEL, i.e. Cloudflare
 * once proxied), and anything after it could only be Vercel's own further
 * internal hops — never an external address, and never useful here. `x-real-ip`
 * gets the same treatment: Vercel's docs describe it as identical in purpose to
 * `x-forwarded-for`, so nothing guarantees it stays single-valued either, and
 * there is no reason to trust its shape more than its sibling's.
 */
export function contactAddress(headers: Headers): string {
  const platform = firstEntry(headers.get("x-vercel-forwarded-for")) || firstEntry(headers.get("x-real-ip"));
  const cloudflare = headers.get("cf-connecting-ip")?.trim();
  if (cloudflare && platform && isCloudflareEdgeAddress(platform)) return cloudflare;
  if (platform) return platform;

  const peer = googlePeerAddress(headers.get("x-forwarded-for"));
  if (peer !== null) {
    if (cloudflare && isCloudflareEdgeAddress(peer)) return cloudflare;
    return peer;
  }
  if (trustedProxyHops() !== null) return "unknown";

  return firstEntry(headers.get("x-forwarded-for")) || "unknown";
}
