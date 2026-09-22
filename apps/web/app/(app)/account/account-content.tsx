import { getMajoranaAuth } from "../../../lib/auth";
import { DEFAULT_PROJECT_ARTIFACT_LIMIT } from "../../../lib/account-tier";
import { getAccountTier } from "../../../lib/account-tier-server";
import { AccountSettings } from "./account-settings";
import { ArchivedChats } from "./archived-chats";
import { BillingPanel } from "./billing-panel";
import { QpuCredentials } from "./qpu-credentials";
import { UsageNow } from "./usage-now";
import { WorkspacesPane } from "./workspaces-pane";
import { AccentPicker } from "../../../components/accent-picker";
import { LanguageToggle } from "../../../components/language-toggle";
import { ThemeToggle } from "../../../components/theme-toggle";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { ACCOUNT_COPY, COMMENTS_COPY, SHARING_COPY, TOURS_COPY, WORKSPACE_COPY } from "../../../lib/workspace-locale";
import { MentionsList } from "../../../components/mentions-list";
import { ACCOUNT_TITLE_ID } from "./account-title-id";
import { AccountPanes } from "./account-panes";
import { GuidedToursPane } from "../../../components/tour/guided-tours-pane";

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
  // Preferences, then who you are, then what you have used, then the rest.
  // The ids are the fragments `/account#usage` and `/account#archived` already
  // pointed at; `account-panes.tsx` selects a pane from them. Usage sits high
  // because the rail's first item links to it (owner, 2026-09-10).
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
            <LanguageToggle locale={locale} label={copy.language} mode="refresh" />
          </div>
          {/* Theme and colour (owner, 2026-09-12): the same light/dark control the
              rail and the public header carry, and the workspace's accent. */}
          <div className="mj-language-preference">
            <div>
              <strong>{copy.theme}</strong>
              <p>{copy.themeHelp}</p>
            </div>
            <ThemeToggle locale={locale} />
          </div>
          <div className="mj-language-preference">
            <div>
              <strong>{copy.accent}</strong>
              <p>{copy.accentHelp}</p>
            </div>
            <AccentPicker locale={locale} />
          </div>
        </section>
      ),
    },
    {
      // Settings → Guided tours (TUTORIAL.md): restart or resume any tour.
      id: "tours",
      label: TOURS_COPY[locale].settings.label,
      panel: <GuidedToursPane locale={locale} />,
    },
    {
      id: "identity",
      label: copy.profile,
      panel: <AccountSettings initialEmail={user.email} locale={locale} />,
    },
    {
      id: "usage",
      label: copy.usageTitle,
      panel: (
        <section className="mj-artifact-panel" id="usage" aria-labelledby="usage-heading">
          <div className="mj-panel-heading"><h2 id="usage-heading">{copy.usageTitle}</h2><span className="mj-mono-muted">{copy.tierNames[tier]}</span></div>
          {/* The bars: what is used of each allowance, from the service that
              enforces them (usage-now.tsx). */}
          <UsageNow locale={locale} renderedTier={tier} />
          {/* Two facts that are ceilings, not meters. The per-project figure is
              the same on every tier and belongs to the project, not the plan
              (ai-ops 82 moved it here off /pricing); the qubit ceiling is the
              tier table's, so this cannot drift from what runs. */}
          <dl className="mj-usage-facts">
            <div><dt>{copy.usageSimulation}</dt><dd>{copy.usageQubits(limits.cpuSimQubits)}</dd></div>
            <div><dt>{copy.usageProjectArtifacts}</dt><dd>{copy.usageProjectArtifactsValue(DEFAULT_PROJECT_ARTIFACT_LIMIT)}</dd></div>
          </dl>
        </section>
      ),
    },
    {
      id: "workspaces",
      label: SHARING_COPY[locale].workspacesTitle,
      panel: <WorkspacesPane locale={locale} />,
    },
    {
      // Comments that name you (proposal 9), reached from the account menu's
      // "Mentions" entry as `/account#mentions`. Beside Workspaces because a
      // mention is only ever from someone in the workspace you are in.
      id: "mentions",
      label: COMMENTS_COPY[locale].mentionsTitle,
      panel: <MentionsList locale={locale} />,
    },
    {
      id: "archived",
      label: archiveLabel,
      panel: <ArchivedChats locale={locale} />,
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
