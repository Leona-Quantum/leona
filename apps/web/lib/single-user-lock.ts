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

// Session lifetime baked into the signed token itself (not just the cookie's
// maxAge, which a client controls). ~30 days.
export const LOCK_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// HMAC signing key. Prefers a dedicated high-entropy secret when the operator
// sets SINGLE_USER_LOCK_SECRET, and otherwise falls back to the password so no
// new prod config is required. Either way the raw secret never lives in the
// cookie, and rotating the password (or the dedicated secret) invalidates every
// existing cookie for free.
async function signingKey(): Promise<CryptoKey | null> {
  const secret = process.env.SINGLE_USER_LOCK_SECRET || process.env.SINGLE_USER_LOCK_PASSWORD;
  if (!secret) return null;
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// HMAC over a message that binds the username and an absolute expiry, so a
// replayed cookie stops working once the expiry passes (a leaked cookie is no
// longer valid forever). Verified statelessly — no session store.
async function signExpiry(exp: number): Promise<string | null> {
  const user = process.env.SINGLE_USER_LOCK_USERNAME;
  const key = await signingKey();
  if (!user || !key) return null;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`mj-lock-v2|${user}|${exp}`),
  );
  return toBase64Url(signature);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// Value to write into the session cookie after a successful sign-in:
// "<exp>.<signature>", where exp is an absolute expiry (unix seconds).
export async function issueSessionCookieValue(): Promise<string | null> {
  const exp = nowSeconds() + LOCK_SESSION_MAX_AGE_SECONDS;
  const sig = await signExpiry(exp);
  return sig ? `${exp}.${sig}` : null;
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

// True when the cookie carries an unexpired token signed by the current key.
// Format: "<exp>.<signature>". Rejects malformed values, expired tokens, and
// signatures that don't match a fresh signature over the same expiry.
export async function isValidSessionCookie(value: string | null | undefined): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(value.slice(0, dot));
  const sig = value.slice(dot + 1);
  if (!Number.isInteger(exp) || exp <= nowSeconds() || !sig) return false;
  const expected = await signExpiry(exp);
  if (!expected) return false;
  return safeEqual(sig, expected);
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
