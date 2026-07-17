// AuthKit redirect URI target — register http://localhost:3000/auth/callback
// (and the deployed equivalent) in the WorkOS dashboard.
import { handleAuth } from "@workos-inc/authkit-nextjs";

// Land the signed-in user in the real workspace, not the /dashboard debug
// surface (Owner Inbox 2026-07-17: the raw /v1/me dump read as a broken page).
export const GET = handleAuth({ returnPathname: "/run" });
