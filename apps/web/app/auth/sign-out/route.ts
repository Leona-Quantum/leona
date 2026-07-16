import { redirect } from "next/navigation";
import { signOutMajorana } from "../../../lib/auth";

// Link-friendly sign-out target for the workspace profile menu and the public
// header. WorkOS signOut() redirects itself; the local-dev no-op falls through
// to the landing page.
export async function GET(): Promise<Response> {
  await signOutMajorana();
  redirect("/");
}
