import { getMajoranaAuth, signOutMajorana } from "../../../lib/auth";
import { AccountSettings } from "./account-settings";

export const metadata = { title: "Account — Majorana" };

export default async function Account() {
  const { user } = await getMajoranaAuth({ ensureSignedIn: true });
  return (
    <div className="mj-library-page">
      <div className="mj-library-scroll">
        <div className="mj-workspace-content">
          <header className="mj-page-header">
            <div>
              <h1 className="mj-page-title">Settings</h1>
              <p className="mj-page-lede">Identity, workspace access, and the data held for your Majorana workspace.</p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOutMajorana();
              }}
            >
              <button className="mj-secondary-button" type="submit">Sign out</button>
            </form>
          </header>
          <AccountSettings initialEmail={user.email} />
        </div>
      </div>
    </div>
  );
}
