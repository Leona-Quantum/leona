import {
  getSignInUrl,
  signOut,
  withAuth,
  type NoUserInfo,
  type UserInfo,
} from "@workos-inc/authkit-nextjs";
import { isWorkosAuthConfigured } from "./auth-config";
import { isLocalDevAuthEnabled, LOCAL_DEV_ACCESS_TOKEN } from "./local-dev-auth";

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
  if (isLocalDevAuthEnabled()) return "/dashboard";
  return getSignInUrl();
}

export function isMajoranaAuthConfigured(): boolean {
  return isWorkosAuthConfigured();
}

export async function signOutMajorana(): Promise<void> {
  if (!isLocalDevAuthEnabled()) await signOut();
}
