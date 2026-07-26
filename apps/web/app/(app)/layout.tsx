import type { ReactNode } from "react";
import type { UserInfo } from "@workos-inc/authkit-nextjs";
import { Shell } from "../../components/shell";
import { StorageScope } from "../../components/storage-scope";
import { resolveAccountTier } from "../../lib/account-tier";
import { getMajoranaAuth } from "../../lib/auth";
import { getPublicLocale } from "../../lib/public-locale-server";
import { isSingleUserLockEnabled } from "../../lib/single-user-lock";

// Authed surface shell (Run / Library / Account). Middleware already gates these
// routes; withAuth here only supplies the header identity.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [auth, locale] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    getPublicLocale(),
  ]);
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
 * `null` while the single-user lock is on, and that is the load-bearing part.
 * The lock guarantees one identity, so there is nothing to separate — and
 * adopting the owner's existing chats into the lock's synthetic
 * `single-user-lock` id would strand them the day the lock comes off and the
 * owner signs in as their real WorkOS account. Leaving them unscoped lets that
 * account claim them (see lib/user-storage.ts).
 *
 * Read here rather than in the client component: the lock's environment
 * variables are server-only, and a client read would resolve to "unlocked" for
 * everyone.
 */
function storageScopeId(user: UserInfo["user"]): string | null {
  if (isSingleUserLockEnabled()) return null;
  return user.id ? `u:${user.id}` : null;
}

// WorkOS leaves firstName/lastName null for email-only signups, so fall back to
// the local part of the address rather than rendering an empty name.
function accountName(user: UserInfo["user"]): string | undefined {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return full || user.email?.split("@")[0] || undefined;
}
