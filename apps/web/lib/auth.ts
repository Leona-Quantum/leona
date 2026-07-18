import {
  getSignInUrl,
  signOut,
  withAuth,
  type NoUserInfo,
  type UserInfo,
} from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isWorkosAuthConfigured } from "./auth-config";
import { isLocalDevAuthEnabled, LOCAL_DEV_ACCESS_TOKEN } from "./local-dev-auth";
import {
  isSingleUserLockEnabled,
  isValidSessionCookie,
  LOCK_ACCESS_TOKEN,
  LOCK_COOKIE,
  LOCK_SIGN_IN_PATH,
} from "./single-user-lock";

const LOCAL_DEV_AUTH: UserInfo = {
  user: {
    object: "user",
    id: "local-dev-user",
    email: "local-dev@majorana.test",
    emailVerified: true,
    profilePictureUrl: null,
    firstName: "Local",
    lastName: "developer",
    lastSignInAt: null,
    locale: "en-US",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    externalId: null,
    metadata: {},
  },
  sessionId: "local-dev-session",
  accessToken: LOCAL_DEV_ACCESS_TOKEN,
};

// Synthetic identity for the temporary single-user lock (Owner Inbox
// 2026-07-19). All of the one authorized operator's data lives under this
// stable id while the lock is active; flip SINGLE_USER_LOCK=false to restore
// WorkOS identities. Mirrors LOCAL_DEV_AUTH.
const LOCK_AUTH: UserInfo = {
  user: {
    object: "user",
    id: "single-user-lock",
    email: "operator@leonaquantum.com",
    emailVerified: true,
    profilePictureUrl: null,
    firstName: "Leona",
    lastName: "Quantum",
    lastSignInAt: null,
    locale: "en-US",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    externalId: null,
    metadata: {},
  },
  sessionId: "single-user-lock-session",
  accessToken: LOCK_ACCESS_TOKEN,
};

// True when the current request carries a valid lock session cookie. Because
// the cookie rides every request (including on public pages), the "Sign in" vs
// "Open workspace" decision stays correct even after navigating back to the
// public site — the earlier Basic Auth check read as signed-out there.
async function hasValidLockRequest(): Promise<boolean> {
  const store = await cookies();
  return isValidSessionCookie(store.get(LOCK_COOKIE)?.value);
}

export function getMajoranaAuth(options: { ensureSignedIn: true }): Promise<UserInfo>;
export function getMajoranaAuth(
  options?: { ensureSignedIn?: false },
): Promise<UserInfo | NoUserInfo>;
export async function getMajoranaAuth(options?: { ensureSignedIn?: boolean }) {
  if (isLocalDevAuthEnabled()) return LOCAL_DEV_AUTH;
  if (isSingleUserLockEnabled()) {
    if (await hasValidLockRequest()) return LOCK_AUTH;
    // Non-public routes never reach here (middleware redirects first).
    // Defensively, if an authed page ever resolved without a session, send it
    // to the sign-in page rather than rendering with a null user. Public pages
    // (ensureSignedIn falsy) just report signed-out.
    if (options?.ensureSignedIn) redirect(LOCK_SIGN_IN_PATH);
    return { user: null } satisfies NoUserInfo;
  }
  if (!isWorkosAuthConfigured() && !options?.ensureSignedIn) {
    return { user: null } satisfies NoUserInfo;
  }
  if (options?.ensureSignedIn) return withAuth({ ensureSignedIn: true });
  return withAuth();
}

export async function getMajoranaSignInUrl(): Promise<string> {
  if (isLocalDevAuthEnabled()) return "/run";
  // Lock mode has no WorkOS hosted login. Point "Sign in" at the dedicated
  // username/password page, which sets the session cookie and returns to /run.
  if (isSingleUserLockEnabled()) return `${LOCK_SIGN_IN_PATH}?returnTo=/run`;
  // Keep the post-AuthKit destination explicit at the call site as well as in
  // the callback route. This avoids falling back to a stale caller/default
  // pathname when a user starts sign-in from a public page.
  return getSignInUrl({ returnTo: "/run" });
}

export function isMajoranaAuthConfigured(): boolean {
  // Lock mode is a working auth configuration too, so "Sign in" affordances
  // still render (they route to the lock sign-in page).
  return isSingleUserLockEnabled() || isWorkosAuthConfigured();
}

export async function signOutMajorana(): Promise<void> {
  if (isLocalDevAuthEnabled()) return;
  // Lock mode: clear the session cookie so sign-out is real (unlike the old
  // Basic Auth gate, which the browser held onto until fully closed). The
  // /auth/sign-out route then lands the user back on the public site.
  if (isSingleUserLockEnabled()) {
    const store = await cookies();
    store.delete(LOCK_COOKIE);
    return;
  }
  await signOut({ returnTo: "/" });
}
