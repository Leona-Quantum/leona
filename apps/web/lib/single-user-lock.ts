// Temporary single-user lock (Owner Inbox 2026-07-19). While the DB and the
// authenticated surface are still under development, gate the whole app behind
// ONE username/password via HTTP Basic Auth and bypass WorkOS social login
// (Google/GitHub) entirely. Public marketing pages stay open — the public
// surface reads only static in-repo data and every /api/* route is non-public.
//
// Fully reversible: set SINGLE_USER_LOCK=false (or unset it) and normal WorkOS
// AuthKit auth is restored with no code change. See OWNER_TODO §1.
//
// Edge-safe by design: no WorkOS imports, no Node-only APIs (middleware runs in
// the edge runtime). Uses `btoa` and constant-time string compare only.

// Synthetic identity used across the app while the lock is active. Mirrors the
// LOCAL_DEV_AUTH shape in lib/auth.ts so the single authorized operator gets a
// stable user id for all their real data.
export const LOCK_ACCESS_TOKEN = "majorana-single-user-lock";

export const SINGLE_USER_LOCK_REALM = "Leona Quantum";

export function isSingleUserLockEnabled(): boolean {
  return (
    process.env.SINGLE_USER_LOCK === "true" &&
    Boolean(process.env.SINGLE_USER_LOCK_USERNAME) &&
    Boolean(process.env.SINGLE_USER_LOCK_PASSWORD)
  );
}

// The exact `Authorization` header value a correct credential produces, or null
// when the lock is not fully configured.
function expectedAuthHeader(): string | null {
  const user = process.env.SINGLE_USER_LOCK_USERNAME;
  const pass = process.env.SINGLE_USER_LOCK_PASSWORD;
  if (!user || !pass) return null;
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

// Length-independent comparison so a rejected header can't be distinguished by
// response timing. Not defense against a determined side-channel attacker —
// this is a development-stage gate — but cheap and correct to do.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isValidLockAuthHeader(header: string | null | undefined): boolean {
  const expected = expectedAuthHeader();
  if (!expected || !header) return false;
  return safeEqual(header, expected);
}
