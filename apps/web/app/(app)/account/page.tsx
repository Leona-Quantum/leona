import { getMajoranaAuth, signOutMajorana } from "../../../lib/auth";
import { AccountSettings } from "./account-settings";
import { LanguageToggle } from "../../../components/language-toggle";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { ACCOUNT_COPY } from "../../../lib/workspace-locale";

export const metadata = { title: "Account — Majorana" };

export default async function Account() {
  const [{ user }, locale] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    getPublicLocale(),
  ]);
  const copy = ACCOUNT_COPY[locale];
  return (
    <div className="mj-library-page">
      <div className="mj-library-scroll">
        <div className="mj-workspace-content">
          <header className="mj-page-header">
            <div>
              <h1 className="mj-page-title">{copy.title}</h1>
              <p className="mj-page-lede">{copy.lede}</p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOutMajorana();
              }}
            >
              <button className="mj-secondary-button" type="submit">{copy.signOut}</button>
            </form>
          </header>
          <section className="mj-artifact-panel mj-language-preference-panel">
            <div className="mj-panel-heading"><h2>{copy.preferences}</h2><span className="mj-mono-muted">{locale.toUpperCase()}</span></div>
            <div className="mj-language-preference">
              <div>
                <strong>{copy.language}</strong>
                <p>{copy.languageHelp}</p>
              </div>
              <LanguageToggle locale={locale} label={copy.language} />
            </div>
          </section>
          <AccountSettings initialEmail={user.email} locale={locale} />
        </div>
      </div>
    </div>
  );
}
