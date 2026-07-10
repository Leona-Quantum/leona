// AuthKit redirect URI target — register http://localhost:3000/auth/callback
// (and the deployed equivalent) in the WorkOS dashboard.
import { handleAuth } from "@workos-inc/authkit-nextjs";

export const GET = handleAuth({ returnPathname: "/dashboard" });
