import type { ReactNode } from "react";
import type { UserInfo } from "@workos-inc/authkit-nextjs";
import { Shell } from "../../components/shell";
import { getMajoranaAuth } from "../../lib/auth";
import { getPublicLocale } from "../../lib/public-locale-server";

// Authed surface shell (Run / Library / Account). Middleware already gates these
// routes; withAuth here only supplies the header identity.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [auth, locale] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    getPublicLocale(),
  ]);
  return (
    <Shell locale={locale} accountName={accountName(auth.user)}>
      {children}
    </Shell>
  );
}

// WorkOS leaves firstName/lastName null for email-only signups, so fall back to
// the local part of the address rather than rendering an empty name.
function accountName(user: UserInfo["user"]): string | undefined {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return full || user.email?.split("@")[0] || undefined;
}
