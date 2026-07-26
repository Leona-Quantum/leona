/**
 * Same-origin relative path guard for post-sign-in style redirects, so a
 * `?returnTo=` cannot become an open redirect. Falls back to /run.
 *
 * Lived in `single-user-lock.ts` until the /welcome name gate needed it too.
 * It was never lock-specific, and the lock is temporary — a guard against open
 * redirects should not disappear with it.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return "/run";
  // Parse against a fixed dummy origin: a truly same-origin relative path keeps
  // that origin. Backslashes (e.g. "/\evil.example") normalize to a network-path
  // redirect whose origin differs, so they fall back to /run.
  try {
    const base = new URL("https://lock.invalid");
    const target = new URL(raw, base);
    if (target.origin !== base.origin) return "/run";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/run";
  }
}
