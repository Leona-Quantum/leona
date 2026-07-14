import type { ReactNode } from "react";
import { Shell } from "../../components/shell";
import { getMajoranaAuth } from "../../lib/auth";
import { getPublicLocale } from "../../lib/public-locale-server";

// Authed surface shell (Run / Library / Account). Middleware already gates these
// routes; withAuth here only supplies the header identity.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [, locale] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    getPublicLocale(),
  ]);
  return (
    <Shell locale={locale}>
      {children}
    </Shell>
  );
}
