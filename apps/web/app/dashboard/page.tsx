// The step-5 round-trip: AuthKit session → WorkOS access token → FastAPI
// verifies via JWKS → provisions user+workspace → /v1/me echoes the Scope.
import { getMajoranaAuth, signOutMajorana } from "../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Me = {
  user_id: string;
  email: string;
  display_name: string | null;
  workspace_id: string;
  workspace_name: string;
  role: string;
};

async function fetchMe(accessToken: string): Promise<Me | { error: string }> {
  try {
    const res = await fetch(`${API_URL}/v1/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return { error: `API ${res.status}` };
    return (await res.json()) as Me;
  } catch (e) {
    return { error: `API unreachable: ${String(e)}` };
  }
}

export default async function Dashboard() {
  const { user, accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const me = await fetchMe(accessToken);
  return (
    <main>
      <h1>Dashboard</h1>
      <p>AuthKit session: {user.email}</p>
      <h2>/v1/me (control plane)</h2>
      <pre>{JSON.stringify(me, null, 2)}</pre>
      <form
        action={async () => {
          "use server";
          await signOutMajorana();
        }}
      >
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
