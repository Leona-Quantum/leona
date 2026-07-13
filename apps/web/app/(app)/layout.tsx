import type { ReactNode } from "react";
import { Shell } from "../../components/shell";
import { getMajoranaAuth } from "../../lib/auth";

// Authed surface shell (Run / Library / Account). Middleware already gates these
// routes; withAuth here only supplies the header identity.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await getMajoranaAuth({ ensureSignedIn: true });
  return (
    <Shell
      headerRight={
        user ? <span className="font-mono">{user.email}</span> : undefined
      }
      userEmail={user?.email}
    >
      {children}
    </Shell>
  );
}
