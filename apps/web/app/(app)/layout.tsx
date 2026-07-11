import type { ReactNode } from "react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { Shell } from "../../components/shell";

// Authed surface shell (Run / Library / Account). Middleware already gates these
// routes; withAuth here only supplies the header identity.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await withAuth();
  return (
    <Shell
      headerRight={
        user ? <span className="font-mono">{user.email}</span> : undefined
      }
    >
      {children}
    </Shell>
  );
}
