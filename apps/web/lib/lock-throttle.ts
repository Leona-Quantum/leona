/** Brute-force throttle for the single-user lock sign-in.
 *
 * This guards `SINGLE_USER_LOCK_PASSWORD`, which is the *only* credential on the
 * deployment today, so the throttle is the whole of the anti-guessing story. It
 * previously lived inline in the route and keyed off the leftmost
 * `X-Forwarded-For` entry, which is the part of that header the *client* writes.
 * An attacker could therefore mint a fresh rate-limit bucket per request and
 * guess without limit, and — because every distinct spoofed value also created a
 * Map entry that lived for the full window — grow the counter map without bound
 * on the way.
 *
 * Two changes fix that, and the second is the load-bearing one:
 *
 *   1. Key off an edge-set header. `x-vercel-forwarded-for` and `x-real-ip` are
 *      written by the platform, not the caller. Where only `x-forwarded-for`
 *      exists we take the RIGHTMOST entry: a proxy appends the address it
 *      actually observed, so the right end is the trustworthy end and the left
 *      end is whatever the client invented.
 *
 *   2. Cap total failures across every key. Header-derived identity can never be
 *      fully trusted — behind a corporate NAT or a shared exit node it is not
 *      even *wrong*, just coarse — so a per-key limit alone can always be
 *      diluted by rotating the key. The global counter makes rotation
 *      pointless: spoofing spreads the same failures over more buckets while
 *      still spending the shared budget. That is a deterministic mechanism
 *      rather than a hope about which headers survive the edge.
 *
 * The global cap is deliberately much higher than the per-key one: it is a
 * backstop against a spoofing attacker, not the everyday limit, and it should be
 * effectively unreachable by a lone operator mistyping a password.
 *
 * KNOWN TRADE-OFF, accepted deliberately: a shared ceiling means an attacker
 * who burns it can also lock the real operator out for the rest of the window.
 * That is a denial of service, and it is the better of the two failure modes —
 * a 15-minute delay signing in, versus unlimited offline-speed guessing at the
 * only password protecting the deployment. It cannot be designed away at this
 * layer either: a rotating attacker always presents a *fresh* key, so any rule
 * of the form "let through callers whose own key looks clean" lets the attacker
 * through by construction. The real fix is not a cleverer counter, it is per-
 * caller identity — i.e. WorkOS returning and this temporary lock going away.
 *
 * Still per-instance and in-memory, so a serverless cold start resets it — the
 * pre-existing caveat, unchanged. A durable KV store is the real fix and needs
 * infra the owner has not provisioned; this raises the cost of brute-forcing
 * substantially without it. */

export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES = 10;
/** Shared ceiling across all keys in a window; see rationale (2) above. */
export const MAX_GLOBAL_FAILURES = 50;
/** Hard bound on tracked keys so a key-rotating caller cannot grow the map. */
export const MAX_TRACKED_KEYS = 2048;

export interface ThrottleHeaders {
  get(name: string): string | null;
}

/** Resolve the throttle key from request headers, preferring edge-set values.
 *
 * Returns "unknown" when nothing usable is present, which buckets all such
 * callers together — the conservative direction, since it can only over-throttle
 * an unidentifiable caller, never under-throttle a real one. */
export function throttleKeyFromHeaders(headers: ThrottleHeaders): string {
  const vercel = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) return vercel;

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // Rightmost, not leftmost: the client writes the left end of this header.
    const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    const nearest = parts[parts.length - 1];
    if (nearest) return nearest;
  }

  return "unknown";
}

export interface LockThrottle {
  /** Charge one attempt up front; false means refuse it.
   *
   * Admission is reserve-then-settle rather than check-then-record because the
   * credential comparison is `await`ed. With a check up front and the failure
   * recorded only afterwards, a concurrent burst all passes the check before
   * any of them has recorded anything — the counters move only after every
   * request is already inside. Charging the attempt *before* the await closes
   * that: this function has no await in it, and the runtime is single-threaded,
   * so the read and the increment cannot interleave.
   *
   * The cost is that a successful sign-in must give its reservation back, which
   * is what `release` is for. */
  reserve(key: string, now?: number): boolean;
  /** Settle a reservation as a success: refund it and clear earlier typos. */
  release(key: string): void;
}

export function createLockThrottle(): LockThrottle {
  const failures = new Map<string, { count: number; resetAt: number }>();
  let globalCount = 0;
  let globalResetAt = 0;

  function sweep(now: number): void {
    for (const [key, entry] of failures) {
      if (now > entry.resetAt) failures.delete(key);
    }
  }

  return {
    reserve(key: string, now: number = Date.now()): boolean {
      // --- read phase: decide admission ---------------------------------
      const globalWindowExpired = now > globalResetAt;
      if (!globalWindowExpired && globalCount >= MAX_GLOBAL_FAILURES) return false;

      const entry = failures.get(key);
      const entryLive = entry !== undefined && now <= entry.resetAt;
      if (entryLive && entry.count >= MAX_FAILURES) return false;

      // --- write phase: charge the attempt ------------------------------
      // No await separates this from the read above, so the pair is atomic
      // with respect to other requests on this instance.
      if (globalWindowExpired) {
        globalCount = 1;
        globalResetAt = now + FAILURE_WINDOW_MS;
      } else {
        globalCount += 1;
      }

      if (entryLive) {
        entry.count += 1;
        return true;
      }

      // Only sweep when about to add a key, and only then consider the hard
      // cap — a rotating caller is the sole way to reach it.
      if (failures.size >= MAX_TRACKED_KEYS) {
        sweep(now);
        // Everything is live and the map is still full: stop tracking new keys
        // rather than grow without bound. The global counter is already
        // throttling this caller, so dropping the per-key record costs nothing
        // it was protecting. The attempt is still admitted — it has been
        // charged globally, which is the bound that matters here.
        if (failures.size >= MAX_TRACKED_KEYS) return true;
      }
      failures.set(key, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
      return true;
    },

    release(key: string): void {
      // Refund the global charge as well as the per-key one. Without this a
      // successful sign-in would permanently consume shared budget, and enough
      // ordinary logins would exhaust the backstop with no attack at all.
      const entry = failures.get(key);
      if (entry) globalCount = Math.max(0, globalCount - entry.count);
      failures.delete(key);
    },
  };
}
