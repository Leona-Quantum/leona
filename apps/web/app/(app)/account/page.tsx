import { getMajoranaAuth } from "../../../lib/auth";
import { getAccountTier } from "../../../lib/account-tier-server";
import { AccountSettings } from "./account-settings";
import { ArchivedChats } from "./archived-chats";
import { BillingPanel } from "./billing-panel";
import { UsageNow } from "./usage-now";
import { LanguageToggle } from "../../../components/language-toggle";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { ACCOUNT_COPY } from "../../../lib/workspace-locale";

export const metadata = { title: "Account — Leona Quantum" };

export default async function Account() {
  const [{ user }, locale, { tier, limits }] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    getPublicLocale(),
    getAccountTier(),
  ]);
  const copy = ACCOUNT_COPY[locale];
  // null means unlimited in TierLimits; the tier table is the single source for
  // both the words and the numbers, so this panel cannot drift from what the
  // product actually enforces.
  const runs = limits.agentRunsPerWeek === null
    ? copy.usageUnlimited
    : copy.usageRunsPerWeek(limits.agentRunsPerWeek);
  const storage = limits.privateArtifacts === null
    ? copy.usageUnlimited
    : copy.usageArtifacts(limits.privateArtifacts);
  return (
    <div className="mj-library-page">
      <div className="mj-library-scroll">
        <div className="mj-workspace-content">
          <header className="mj-page-header">
            <div>
              <h1 className="mj-page-title">{copy.title}</h1>
              <p className="mj-page-lede">{copy.lede}</p>
            </div>
            <a className="mj-secondary-button" href="/auth/sign-out">{copy.signOut}</a>
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
          <ArchivedChats locale={locale} />
          <section className="mj-artifact-panel" id="usage" aria-labelledby="usage-heading">
            <div className="mj-panel-heading"><h2 id="usage-heading">{copy.usageTitle}</h2></div>
            <p className="mj-panel-help">{copy.usageEnforcement}</p>
            <dl className="mj-usage-list">
              <div><dt>{copy.usagePlan}</dt><dd>{copy.tierNames[tier]}</dd></div>
              <div><dt>{copy.usageRuns}</dt><dd>{runs}</dd></div>
              <div><dt>{copy.usageStorage}</dt><dd>{storage}</dd></div>
              <div><dt>{copy.usageSimulation}</dt><dd>{copy.usageQubits(limits.cpuSimQubits)}</dd></div>
            </dl>
            {/* The ceilings above are the plan; this is what is left of it.
                Client-side and additive — see usage-now.tsx for why the split. */}
            <UsageNow locale={locale} renderedTier={tier} />
          </section>
          <BillingPanel locale={locale} />
        </div>
      </div>
    </div>
  );
}
