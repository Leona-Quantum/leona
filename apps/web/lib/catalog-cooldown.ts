// A short cooldown after the catalog API refuses us, so a render does not
// re-issue requests that are already known to fail.
//
// Why it exists (2026-09-15): the production API refused catalog reads with 429
// for hours. Next's Data Cache only stores a fetch whose status is 200
// (`next/dist/server/lib/patch-fetch.js`, the `res.status === 200` branch), so
// a refused page is never cached, and nothing on this path backed off. Every
// uncached render walked every catalog page again, got the same 429, fell back
// to the static corpus, and the next render did it all over. The load became
// closed-loop: when the API got faster, the renderer simply sent more.
//
// What this does and does not change: while a cooldown is active,
// `fetchCatalogPage` (repository-source.ts) returns null WITHOUT a network call.
// Null is exactly what a failed fetch already returns, so every caller behaves
// as it does today on a failure: the listing falls back to the static corpus,
// and the published-slug guard reports "not provable this render" rather than
// treating anything as withdrawn. It only skips requests whose answer is
// already known.
//
// The state is module-level, so it lives per warm server instance, not across
// the fleet. That damps each instance's retries; it is not a global circuit
// breaker, and it does not need to be one to break the loop above.
//
// Dependency-free on purpose, like catalog-pagination.ts: repository-source.ts
// pulls in the whole static corpus, which the node test runner cannot load, so
// the logic that needs tests lives here.

/** Cooldown after a refusal that states no Retry-After. */
export const CATALOG_COOLDOWN_BASE_MS = 20_000;

/** Longest cooldown any Retry-After can ask for. Past this, a stale public page
 * is served for longer than the site's own 300 s revalidate window is worth. */
export const CATALOG_COOLDOWN_MAX_MS = 60_000;

/**
 * Whether a status means "the API is overloaded or broken", which is what a
 * cooldown is for. A 404 for an unknown slug, or a 400, is an answer about the
 * request, not about the server's capacity, so it must not silence the catalog.
 */
export function isOverloadStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Seconds a `Retry-After` header asks us to wait, or null if absent or
 * unreadable. Accepts both forms RFC 9110 allows: delta-seconds and an HTTP-date.
 */
export function parseRetryAfterSeconds(header: string | null | undefined, nowMs: number): number | null {
  const raw = header?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  // Only the IMF-fixdate form ("Tue, 15 Sep 2026 10:00:45 GMT"), the one RFC 9110
  // says senders must generate. The shape check matters: `Date.parse` alone
  // accepts almost anything ("-5" and "1.5" both parse as dates in V8), which
  // turned malformed headers into a zero-second wait.
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)) return null;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

export interface CatalogCooldown {
  /** True while a cooldown from an earlier failure is still running. */
  shouldSkip(): boolean;
  /** Start (or extend) a cooldown. `retryAfterSeconds` from the refusal, if it gave one. */
  recordFailure(retryAfterSeconds?: number | null): void;
  /** A successful read ends any cooldown. */
  recordSuccess(): void;
  /** Milliseconds left in the current cooldown; 0 when none. */
  remainingMs(): number;
  /** True at most once per cooldown window, so a skip is logged once, not per fetch. */
  shouldLogSkip(): boolean;
}

export function createCatalogCooldown(
  options: { baseMs?: number; maxMs?: number; now?: () => number } = {},
): CatalogCooldown {
  const baseMs = options.baseMs ?? CATALOG_COOLDOWN_BASE_MS;
  const maxMs = options.maxMs ?? CATALOG_COOLDOWN_MAX_MS;
  const now = options.now ?? Date.now;
  let until = 0;
  let loggedFor = 0;

  return {
    shouldSkip: () => now() < until,
    recordFailure(retryAfterSeconds) {
      const asked = retryAfterSeconds == null ? 0 : retryAfterSeconds * 1000;
      const wait = Math.min(maxMs, Math.max(baseMs, asked));
      // Extend, never shorten: a later refusal with a short Retry-After must not
      // cut a longer cooldown the server already asked for.
      until = Math.max(until, now() + wait);
    },
    recordSuccess() {
      until = 0;
    },
    remainingMs: () => Math.max(0, until - now()),
    shouldLogSkip() {
      if (now() >= until || loggedFor === until) return false;
      loggedFor = until;
      return true;
    },
  };
}

/** The one shared instance `fetchCatalogPage` consults. */
export const catalogCooldown: CatalogCooldown = createCatalogCooldown();
