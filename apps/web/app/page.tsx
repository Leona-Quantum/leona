import Link from "next/link";
import { getMajoranaAuth, getMajoranaSignInUrl } from "../lib/auth";

export default async function Home() {
  const { user } = await getMajoranaAuth();
  if (user) {
    return (
      <main>
        <h1>Majorana</h1>
        <p>
          Signed in as {user.email}. <Link href="/dashboard">Dashboard</Link>
        </p>
      </main>
    );
  }
  const signInUrl = await getMajoranaSignInUrl();
  return (
    <main>
      <h1>Majorana</h1>
      <p>
        <a href={signInUrl}>Sign in</a>
      </p>
    </main>
  );
}
