import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMajoranaAuth, signOutMajorana } from "../../../lib/auth";
import { AUTH_HINT_COOKIE } from "../../../lib/auth-hint";

// Link-friendly sign-out target for the workspace profile menu, account page,
// and public header. WorkOS signOut() clears the session and redirects to /
// itself; the local-dev bypass falls through to the same landing page.
export async function GET(): Promise<Response> {
  // AuthKit's signOut helper is intentionally strict and can start a fresh
  // sign-in flow when no session exists. A public logout link must be safe to
  // revisit, so check the optional session first and make the route idempotent.
  const { user } = await getMajoranaAuth();
  // Dropped on both paths, and before the early return: the reader who lands
  // here already signed out somewhere else is exactly the one whose hint is
  // stale, and leaving it set would paint "Sign out" at them on the page this
  // route is about to redirect them to (ai-ops issue 114).
  (await cookies()).delete(AUTH_HINT_COOKIE);
  if (!user) redirect("/");
  await signOutMajorana();
  redirect("/");
}
