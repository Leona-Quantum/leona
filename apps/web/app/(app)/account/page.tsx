// S9 Account — stub: identity + sign-out. Plan/usage meters land with the S9 build.
import { signOut, withAuth } from "@workos-inc/authkit-nextjs";

export const metadata = { title: "Account — Majorana" };

export default async function Account() {
  const { user } = await withAuth({ ensureSignedIn: true });
  return (
    <section>
      <h1 style={{ fontSize: "var(--fs-20)", fontWeight: 600 }}>Account</h1>
      <p>
        Signed in as <span style={{ fontFamily: "var(--font-mono)" }}>{user.email}</span>
      </p>
      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <button
          type="submit"
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border-0)",
            borderRadius: "var(--radius-control)",
            color: "var(--text-0)",
            font: "inherit",
            fontWeight: 500,
            padding: "var(--sp-2) var(--sp-4)",
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </form>
    </section>
  );
}
