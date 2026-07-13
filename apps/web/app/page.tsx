import { redirect } from "next/navigation";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../lib/auth";
import { isPublicDemoEnabled } from "../lib/public-demo";

export default async function Home() {
  const { user } = await getMajoranaAuth();
  if (user) {
    redirect("/run");
  }
  const demoEnabled = isPublicDemoEnabled();
  const signInUrl = isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : null;
  return (
    <main className="mj-landing">
      <div className="mj-landing-inner">
        <p className="mj-landing-mark">Majorana</p>
        <h1>From quantum question to verified artifact.</h1>
        <p className="mj-landing-copy">
          Nameko Run plans and verifies technical work. Quepo Studio keeps the evidence, code, and reusable exports together.
        </p>
        <div className="mj-landing-actions">
          {demoEnabled ? <a className="mj-primary-button" href="/demo">Open the public preview</a> : null}
          {signInUrl ? (
            <a className="mj-secondary-button" href={signInUrl}>Sign in</a>
          ) : (
            <span className="mj-landing-status">Workspace sign-in is being configured.</span>
          )}
        </div>
      </div>
    </main>
  );
}
