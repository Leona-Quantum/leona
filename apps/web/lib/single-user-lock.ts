// Temporary single-user lock (Owner Inbox 2026-07-19). While the DB and the
// authenticated surface are still under development, gate the whole app behind
// ONE username/password and bypass WorkOS social login (Google/GitHub) entirely.
// Public marketing pages stay open — the public surface reads only static
// in-repo data and every /api/* route is non-public.
//
// Behaves like the normal WorkOS flow, not HTTP Basic Auth (Owner Inbox
// 2026-07-19 follow-up): a real sign-in PAGE sets a signed, httpOnly SESSION
// COOKIE, so the credential is entered once, persists across navigation and
// back to the public site, and "Sign out" truly clears it. The earlier Basic
// Auth gate re-prompted on nearly every navigation and read as signed-out on
// public pages — this replaces it.
//
// Fully reversible: set SINGLE_USER_LOCK=false (or unset it) and normal WorkOS
// AuthKit auth is restored with no code change. See OWNER_TODO §1.
//
// Edge-safe by design: no WorkOS imports, no Node-only APIs (middleware runs in
// the edge runtime). Uses Web Crypto (crypto.subtle), btoa, and constant-time
// compare only — all available in both the edge and Node runtimes.

// Synthetic identity used across the app while the lock is active. Mirrors the
// LOCAL_DEV_AUTH shape in lib/auth.ts so the single authorized operator gets a
// stable user id for all their real data.
export const LOCK_ACCESS_TOKEN = "majorana-single-user-lock";

// Session cookie holding the signed lock token. httpOnly + SameSite=Lax so it
// rides normal navigations (including returns from the public site) but is not
// readable by scripts.
export const LOCK_COOKIE = "mj_lock_session";

// Paths the lock must leave reachable so the sign-in flow itself can run.
export const LOCK_SIGN_IN_PATH = "/lock-sign-in";
export const LOCK_SIGN_IN_API = "/api/lock/sign-in";

export function isSingleUserLockEnabled(): boolean {
  return (
    process.env.SINGLE_USER_LOCK === "true" &&
    Boolean(process.env.SINGLE_USER_LOCK_USERNAME) &&
    Boolean(process.env.SINGLE_USER_LOCK_PASSWORD)
  );
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The signed session token a correct sign-in produces, or null when the lock is
// not fully configured. It is an HMAC over a stable message keyed by the secret
// password, so the raw password never lives in the cookie and the token can be
// verified statelessly (no session store). Rotating the password invalidates
// every existing cookie for free.
async function sessionToken(): Promise<string | null> {
  const user = process.env.SINGLE_USER_LOCK_USERNAME;
  const pass = process.env.SINGLE_USER_LOCK_PASSWORD;
  if (!user || !pass) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pass),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`mj-lock-v1|${user}`));
  return toBase64Url(signature);
}

// Value to write into the session cookie after a successful sign-in.
export async function issueSessionCookieValue(): Promise<string | null> {
  return sessionToken();
}

// Length-independent comparison so a rejected value can't be distinguished by
// response timing. Not defense against a determined side-channel attacker —
// this is a development-stage gate — but cheap and correct to do.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// True when the cookie carries a token that matches the current credentials.
export async function isValidSessionCookie(value: string | null | undefined): Promise<boolean> {
  const expected = await sessionToken();
  if (!expected || !value) return false;
  return safeEqual(value, expected);
}

// Validates a raw username/password pair from the sign-in form. Constant-time on
// both fields.
export function areLockCredentialsValid(username: string, password: string): boolean {
  const expectedUser = process.env.SINGLE_USER_LOCK_USERNAME;
  const expectedPass = process.env.SINGLE_USER_LOCK_PASSWORD;
  if (!expectedUser || !expectedPass) return false;
  // Evaluate both comparisons regardless so timing doesn't reveal which field
  // was wrong.
  const userOk = safeEqual(username, expectedUser);
  const passOk = safeEqual(password, expectedPass);
  return userOk && passOk;
}

// Same-origin relative path guard for post-sign-in redirects (prevents open
// redirects via ?returnTo=). Falls back to /run.
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/run";
  return raw;
}
