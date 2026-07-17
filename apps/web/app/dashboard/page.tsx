import { redirect } from "next/navigation";

// /dashboard was the step-5 auth round-trip debug page (raw /v1/me dump).
// Sessions that still land here — old bookmarks, stale WorkOS returnPathname
// state — belong in the real workspace.
export default function Dashboard() {
  redirect("/run");
}
