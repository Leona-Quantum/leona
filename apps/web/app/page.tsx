import { getSignInUrl, withAuth } from "@workos-inc/authkit-nextjs";
import Link from "next/link";

export default async function Home() {
  const { user } = await withAuth();
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
  const signInUrl = await getSignInUrl();
  return (
    <main>
      <h1>Majorana</h1>
      <p>
        <a href={signInUrl}>Sign in</a>
      </p>
    </main>
  );
}
