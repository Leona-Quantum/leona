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
 * The address to meter, from the request's headers.
 *
 * `x-forwarded-for`'s first entry, matching `services/api/rate_limit.py` — one
 * convention for the whole product, so a reader does not have to work out
 * whether the two surfaces disagree.
 *
 * Spoofable in principle, and the module docstring already concedes that an
 * attacker who can vary the address defeats this. On Vercel the platform
 * appends the real peer to this header, so the FIRST entry is client-supplied
 * and the last is not — metering the first is deliberate anyway: it is what
 * keeps two people behind one corporate proxy from sharing a counter, and the
 * attacker it would otherwise catch is the one this limiter is documented not
 * to stop.
 */
export function contactAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || "unknown";
}
