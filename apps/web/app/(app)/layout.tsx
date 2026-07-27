import type { ReactNode } from "react";
import type { UserInfo } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { Shell } from "../../components/shell";
import { StorageScope } from "../../components/storage-scope";
import { hasCompleteProfileName } from "../../lib/account-profile";
import { resolveAccountTier } from "../../lib/account-tier";
import { getMajoranaAuth } from "../../lib/auth";
import { getPublicLocale } from "../../lib/public-locale-server";

// Authed surface shell (Run / Library / Account). Middleware already gates these
// routes; withAuth here only supplies the header identity.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [auth, locale] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    getPublicLocale(),
  ]);

  // An account has a first and last name before it opens (Owner Inbox
  // 2026-07-27). WorkOS leaves both null for email-only sign-ups, so this is the
  // only place it can be required. Gating in the LAYOUT rather than the
  // middleware is deliberate: the middleware would have to decode the session on
  // every asset request to learn the same thing, and /api routes must keep
  // answering — /api/account/profile is how the name gets set.
  if (!hasCompleteProfileName(auth.user)) redirect("/welcome");

  const scopeId = storageScopeId(auth.user);
  return (
    // The tier is resolved here rather than in the Shell because the developer
    // allowlist lives in a server-only environment variable: reading it in a
    // client component would silently resolve every account to "free".
    <StorageScope scopeId={scopeId}>
      {/*
        Keyed by the scope so a change of account remounts rather than reuses.
        Shell's workspace load effect depends on demoMode and a refresh tick, not
        on who is signed in — without the key, a re-render that swapped the
        identity would leave the previous account's chats on screen, read from
        storage under the old key.
      */}
      <Shell
        key={scopeId ?? "unscoped"}
        locale={locale}
        accountName={accountName(auth.user)}
        accountTier={resolveAccountTier(auth.user.email)}
      >
        {children}
      </Shell>
    </StorageScope>
  );
}

/**
 * Which account browser storage belongs to.
 *
 * `null` only for a user with no id, which the type allows and the runtime does
 * not produce. Everything unscoped that predates PR 162 is still adopted once, by
 * the first account to sign in on that browser — see lib/user-storage.ts. That
 * adoption is why this returned `null` under the single-user lock: scoping the
 * owner's chats to the lock's synthetic identity would have stranded them the
 * day they signed in for real. The lock is gone; the adoption is not, because
 * browsers that have never signed in since PR 162 still exist.
 */
function storageScopeId(user: UserInfo["user"]): string | null {
  return user.id ? `u:${user.id}` : null;
}

// WorkOS leaves firstName/lastName null for email-only signups, so fall back to
// the local part of the address rather than rendering an empty name.
function accountName(user: UserInfo["user"]): string | undefined {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return full || user.email?.split("@")[0] || undefined;
}
