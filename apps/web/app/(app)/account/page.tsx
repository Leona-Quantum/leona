import { getMajoranaAuth, signOutMajorana } from "../../../lib/auth";
import { AccountSettings } from "./account-settings";
import { LanguageToggle } from "../../../components/language-toggle";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { ACCOUNT_COPY } from "../../../lib/workspace-locale";

export const metadata = { title: "Account — Leona Quantum" };

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
          <section className="mj-artifact-panel" id="usage" aria-labelledby="usage-heading">
            <div className="mj-panel-heading"><h2 id="usage-heading">{copy.usageTitle}</h2></div>
            <p className="mj-panel-help">{copy.usageHelp}</p>
            <dl className="mj-usage-list">
              <div><dt>{copy.usagePlan}</dt><dd>{copy.usagePlanValue}</dd></div>
              <div><dt>{copy.usageRuns}</dt><dd>{copy.usageRunsValue}</dd></div>
              <div><dt>{copy.usageStorage}</dt><dd>{copy.usageStorageValue}</dd></div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
