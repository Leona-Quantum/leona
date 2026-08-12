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
import { majoranaSignInPath } from "./sign-in";
import { siteOrigin } from "./site-origin";

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

export async function getMajoranaSignInUrl(): Promise<string> {
  return majoranaSignInPath("/run");
}

/** Called only after an explicit click reaches the same-origin sign-in route. */
export async function getMajoranaAuthorizationUrl(returnTo: string): Promise<string> {
  return getSignInUrl({ returnTo: safeReturnTo(returnTo) });
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
