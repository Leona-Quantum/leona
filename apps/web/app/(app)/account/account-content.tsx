import { getMajoranaAuth } from "../../../lib/auth";
import { DEFAULT_PROJECT_ARTIFACT_LIMIT } from "../../../lib/account-tier";
import { getAccountTier } from "../../../lib/account-tier-server";
import { AccountSettings } from "./account-settings";
import { ArchivedChats } from "./archived-chats";
import { BillingPanel } from "./billing-panel";
import { QpuCredentials } from "./qpu-credentials";
import { UsageNow } from "./usage-now";
import { LanguageToggle } from "../../../components/language-toggle";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { ACCOUNT_COPY, WORKSPACE_COPY } from "../../../lib/workspace-locale";
import { ACCOUNT_TITLE_ID } from "./account-title-id";
import { AccountPanes } from "./account-panes";

/**
 * The settings body, rendered identically by the full page and by the modal.
 *
 * It exists as its own file for one reason: /account now has two entry shapes —
 * the route at `app/(app)/account/page.tsx` and the intercepted slot at
 * `app/(app)/@modal/(.)account/page.tsx` — and two copies of this JSX would
 * drift the first time a panel is added to one of them. Everything the two
 * shapes disagree about (the scroll container, the close affordance, the dialog
 * semantics) lives in the wrappers; everything they agree about lives here.
 *
 * Async and server-side, so it reads its own session, locale and tier rather
 * than taking them as props. Both callers then need nothing but the locale for
 * their own chrome.
 */

export async function AccountContent() {
  const [{ user }, locale, { tier, limits }] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    getPublicLocale(),
    getAccountTier(),
  ]);
  const copy = ACCOUNT_COPY[locale];
  // The archive panel is the sidebar's, not this page's — it is the same list
  // the rail links to, so its label comes from the same string.
  const archiveLabel = WORKSPACE_COPY[locale].sidebar.archive;
  // null means unlimited in TierLimits; the tier table is the single source for
  // both the words and the numbers, so this panel cannot drift from what the
  // product actually enforces.
  const runs = limits.agentRunsPerWeek === null
    ? copy.usageUnlimited
    : copy.usageRunsPerWeek(limits.agentRunsPerWeek);
  const storage = limits.privateArtifacts === null
    ? copy.usageUnlimited
    : copy.usageArtifacts(limits.privateArtifacts);
  // The rail's order is the order the old single stack had, top to bottom, so
  // nothing moved for anyone who knew where a control was — it only stopped
  // requiring a scroll to reach. The ids are the fragments `/account#usage` and
  // `/account#archived` already pointed at; `account-panes.tsx` selects a pane
  // from them rather than scrolling to one, which is the only behaviour change
  // those two entry points see.
  const panes = [
    {
      id: "preferences",
      label: copy.preferences,
      panel: (
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
      ),
    },
    {
      id: "identity",
      label: copy.identity,
      panel: <AccountSettings initialEmail={user.email} locale={locale} />,
    },
    {
      id: "archived",
      label: archiveLabel,
      panel: <ArchivedChats locale={locale} />,
    },
    {
      id: "usage",
      label: copy.usageTitle,
      panel: (
        <section className="mj-artifact-panel" id="usage" aria-labelledby="usage-heading">
          <div className="mj-panel-heading"><h2 id="usage-heading">{copy.usageTitle}</h2></div>
          <p className="mj-panel-help">{copy.usageEnforcement}</p>
          <dl className="mj-usage-list">
            <div><dt>{copy.usagePlan}</dt><dd>{copy.tierNames[tier]}</dd></div>
            <div><dt>{copy.usageRuns}</dt><dd>{runs}</dd></div>
            <div><dt>{copy.usageStorage}</dt><dd>{storage}</dd></div>
            {/* Beside the two allowances rather than in a panel of its own, and
                not read from `limits`: this one is the same on every tier and
                belongs to the project, not to the plan (ai-ops#82 moved it here
                off /pricing, where a per-project figure printed under a per-
                account cap was the misreading that got the whole line struck). */}
            <div><dt>{copy.usageProjectArtifacts}</dt><dd>{copy.usageProjectArtifactsValue(DEFAULT_PROJECT_ARTIFACT_LIMIT)}</dd></div>
            <div><dt>{copy.usageSimulation}</dt><dd>{copy.usageQubits(limits.cpuSimQubits)}</dd></div>
          </dl>
          {/* The ceilings above are the plan; this is what is left of it.
              Client-side and additive — see usage-now.tsx for why the split. */}
          <UsageNow locale={locale} renderedTier={tier} />
        </section>
      ),
    },
    {
      // Immediately after the allowances, and before billing, because it is the
      // one control here that changes what the hardware line means: a connected
      // key moves IBM's free allowance off the pool everybody shares and onto
      // the reader's own account. Adjacency was the whole argument for its old
      // position in the stack, and the rail keeps it.
      id: "qpu",
      label: copy.qpuTitle,
      panel: <QpuCredentials locale={locale} />,
    },
    {
      id: "billing",
      label: copy.billingTitle,
      panel: <BillingPanel locale={locale} />,
    },
  ];

  return (
    <div className="mj-workspace-content">
      <header className="mj-page-header">
        <div>
          <h1 className="mj-page-title" id={ACCOUNT_TITLE_ID}>{copy.title}</h1>
          <p className="mj-page-lede">{copy.lede}</p>
        </div>
        {/* Deliberately a plain anchor, in the modal as much as on the page:
            /auth/sign-out is a route handler that clears the session cookie and
            redirects out of the app. There is no page for a client-side
            navigation to render. */}
        <a className="mj-secondary-button" href="/auth/sign-out">{copy.signOut}</a>
      </header>
      <AccountPanes panes={panes} navLabel={copy.sectionsLabel} />
    </div>
  );
}
