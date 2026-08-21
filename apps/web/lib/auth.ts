import {
  getSignInUrl,
  signOut,
  withAuth,
  type NoUserInfo,
  type UserInfo,
} from "@workos-inc/authkit-nextjs";
import { isWorkosAuthConfigured } from "./auth-config";
import { isLocalDevAuthEnabled, LOCAL_DEV_ACCESS_TOKEN } from "./local-dev-auth";
import { safeReturnTo } from "./return-to";
import { siteOrigin } from "./site-origin";

const LOCAL_DEV_AUTH: UserInfo = {
  user: {
    object: "user",
    id: "local-dev-user",
    email: "local-dev@majorana.test",
    emailVerified: true,
    profilePictureUrl: null,
    // The SDK doesn't derive `name` from firstName/lastName — it deserializes
    // whatever the API sent verbatim (`user.name ?? null`). A real WorkOS user
    // with both names set carries a matching `name`, so mirror that here rather
    // than pass `null`, which is what the API sends only for the email-only
    // sign-ups this stub isn't modeling.
    name: "Local developer",
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

export function getMajoranaAuth(options: { ensureSignedIn: true }): Promise<UserInfo>;
export function getMajoranaAuth(
  options?: { ensureSignedIn?: false },
): Promise<UserInfo | NoUserInfo>;
export async function getMajoranaAuth(options?: { ensureSignedIn?: boolean }) {
  if (isLocalDevAuthEnabled()) return LOCAL_DEV_AUTH;
  if (!isWorkosAuthConfigured() && !options?.ensureSignedIn) {
    return { user: null } satisfies NoUserInfo;
  }
  if (options?.ensureSignedIn) return withAuth({ ensureSignedIn: true });
  return withAuth();
}

/*
 * There is deliberately no `getMajoranaSignInUrl()` here any more.
 *
 * It returned the WorkOS authorization URL and was called during page renders
 * to fill in a sign-in link. `getSignInUrl()` → `setPKCECookie()` →
 * `cookies().set()`, and Next.js permits a cookie write only in a Server Action
 * or a Route Handler, so any render that reached it 500s. Under authkit-nextjs
 * v2 this was dormant: PKCE was opt-in behind `WORKOS_ENABLE_PKCE`, and with it
 * off the library skipped the cookie write. v4 makes PKCE unconditional, so the
 * dormant bug became every `chrome="full"` page returning 500 in production
 * (PR 654 reverted the upgrade rather than diagnose it under an outage).
 *
 * Callers now use `majoranaSignInPath()` from `lib/sign-in.ts` — a constant
 * same-origin string — and the per-request hand-off happens once, after the
 * click, in `app/auth/sign-in/route.ts` via `getMajoranaAuthorizationUrl()`
 * below. Removing the export rather than documenting it is the point: a
 * render-time caller is now a typecheck failure instead of an outage.
 */

/**
 * The provider hand-off itself. Called ONLY from `app/auth/sign-in/route.ts`,
 * after a click has already reached this deployment.
 *
 * The only caller is a Route Handler, and that is a hard requirement rather than
 * a tidiness one. This is per-request by construction — it reads `headers()`,
 * and it carries a one-shot PKCE challenge whose verifier `getSignInUrl()`
 * writes to a cookie. Next.js permits a cookie write only in a Server Action or
 * a Route Handler, so reaching this from a render is a 500, not merely a page a
 * CDN cannot store. (Under authkit-nextjs v2 PKCE was opt-in behind
 * `WORKOS_ENABLE_PKCE` and the write was skipped when it was off, which is why
 * the render-time callers this replaced survived until the v4 upgrade.)
 *
 * Returning the relative `returnTo` under local dev auth keeps the route
 * handler's `new URL(target, request.url)` correct either way.
 */
export async function getMajoranaAuthorizationUrl(returnTo: string): Promise<string> {
  const destination = safeReturnTo(returnTo);
  if (isLocalDevAuthEnabled()) return destination;
  return getSignInUrl({ returnTo: destination });
}

export function isMajoranaAuthConfigured(): boolean {
  return isWorkosAuthConfigured();
}

/**
 * Sign out, and say where to land.
 *
 * WorkOS decides the destination, not us: `signOut` forwards `returnTo` to the
 * hosted logout endpoint as `return_to`, and a value that is not an absolute
 * URL registered as a sign-out redirect is ignored in favour of the
 * environment's *default* sign-out redirect. We passed `"/"`, which is neither,
 * so every sign-out landed on whatever that default happened to be — in this
 * deployment a stale Vercel preview host left over from before the domain
 * existed, which is what the owner saw.
 *
 * Passing the absolute origin is the half that belongs in code: the app should
 * name where it wants people to end up instead of inheriting it from a
 * dashboard field nobody looks at. The other half is registering that origin as
 * a sign-out redirect and making it the default — until that exists WorkOS
 * falls back exactly as it does today, so this is inert rather than wrong.
 */
export async function signOutMajorana(): Promise<void> {
  if (isLocalDevAuthEnabled()) return;
  await signOut({ returnTo: siteOrigin() ?? "/" });
}
