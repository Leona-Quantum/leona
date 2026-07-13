import { redirect } from "next/navigation";
import { getMajoranaAuth, getMajoranaSignInUrl } from "../lib/auth";

export default async function Home() {
  const { user } = await getMajoranaAuth();
  if (user) {
    redirect("/run");
  }
  const signInUrl = await getMajoranaSignInUrl();
  return (
    <main className="mj-landing">
      <div className="mj-landing-inner">
        <p className="mj-landing-mark">Majorana</p>
        <h1>From quantum question to verified artifact.</h1>
        <p className="mj-landing-copy">
          Nameko Run plans and verifies technical work. Quepo Studio keeps the evidence, code, and reusable exports together.
        </p>
        <div className="mj-landing-actions">
          <a className="mj-primary-button" href={signInUrl}>Open the workspace</a>
          <a className="mj-secondary-button" href={signInUrl}>Sign in</a>
        </div>
      </div>
    </main>
  );
}
