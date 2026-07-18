import {
  getSignInUrl,
  signOut,
  withAuth,
  type NoUserInfo,
  type UserInfo,
} from "@workos-inc/authkit-nextjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isWorkosAuthConfigured } from "./auth-config";
import { isLocalDevAuthEnabled, LOCAL_DEV_ACCESS_TOKEN } from "./local-dev-auth";
import {
  isSingleUserLockEnabled,
  isValidLockAuthHeader,
  LOCK_ACCESS_TOKEN,
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

// True when the current request carries the correct Basic Auth credential. The
// middleware already 401s non-public routes without it, so on the authed
// surface this is effectively always true; we re-check to stay honest on public
// pages (which decide "Sign in" vs "Open workspace" from the same seam).
async function hasValidLockRequest(): Promise<boolean> {
  const store = await headers();
  return isValidLockAuthHeader(store.get("authorization"));
}

export function getMajoranaAuth(options: { ensureSignedIn: true }): Promise<UserInfo>;
export function getMajoranaAuth(
  options?: { ensureSignedIn?: false },
): Promise<UserInfo | NoUserInfo>;
export async function getMajoranaAuth(options?: { ensureSignedIn?: boolean }) {
  if (isLocalDevAuthEnabled()) return LOCAL_DEV_AUTH;
  if (isSingleUserLockEnabled()) {
    if (await hasValidLockRequest()) return LOCK_AUTH;
    // Non-public routes never reach here (middleware 401s first). Defensively,
    // if an authed page ever resolved without the credential, send it to the
    // gated surface so the Basic Auth prompt fires rather than rendering with a
    // null user. Public pages (ensureSignedIn falsy) just report signed-out.
    if (options?.ensureSignedIn) redirect("/run");
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
  // Lock mode has no WorkOS hosted login. Point "Sign in" at the authed surface
  // so the browser's Basic Auth prompt (from middleware) does the gating.
  if (isSingleUserLockEnabled()) return "/run";
  // Keep the post-AuthKit destination explicit at the call site as well as in
  // the callback route. This avoids falling back to a stale caller/default
  // pathname when a user starts sign-in from a public page.
  return getSignInUrl({ returnTo: "/run" });
}

export function isMajoranaAuthConfigured(): boolean {
  // Lock mode is a working auth configuration too, so "Sign in" affordances
  // still render (they route to the Basic Auth prompt).
  return isSingleUserLockEnabled() || isWorkosAuthConfigured();
}

export async function signOutMajorana(): Promise<void> {
  // Basic Auth has no clean server-side logout — the browser caches the
  // credential until it's closed — so lock mode just lands the user back on the
  // public site. (WorkOS sign-out only runs in the normal auth path.)
  if (isLocalDevAuthEnabled() || isSingleUserLockEnabled()) return;
  await signOut({ returnTo: "/" });
}
