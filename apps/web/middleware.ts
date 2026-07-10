// Blast-radius file (CODEOWNERS). Secure by default: every matched route
// requires an AuthKit session unless listed in unauthenticatedPaths.
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export default authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ["/"],
  },
});

// Skip static assets; everything else goes through auth.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
