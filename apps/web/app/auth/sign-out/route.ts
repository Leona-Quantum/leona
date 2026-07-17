import { redirect } from "next/navigation";
import { getMajoranaAuth, signOutMajorana } from "../../../lib/auth";

// Link-friendly sign-out target for the workspace profile menu, account page,
// and public header. WorkOS signOut() clears the session and redirects to /
// itself; the local-dev bypass falls through to the same landing page.
export async function GET(): Promise<Response> {
  // AuthKit's signOut helper is intentionally strict and can start a fresh
  // sign-in flow when no session exists. A public logout link must be safe to
  // revisit, so check the optional session first and make the route idempotent.
  const { user } = await getMajoranaAuth();
  if (!user) redirect("/");
  await signOutMajorana();
  redirect("/");
}
