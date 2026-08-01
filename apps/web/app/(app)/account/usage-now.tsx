"use client";

import { useEffect, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { ACCOUNT_COPY } from "../../../lib/workspace-locale";
import { describeNextSlot, isMetered, parseUsage, type UsageSummary } from "../../../lib/usage-summary";

/**
 * What this account has actually spent, beside the ceilings it is allowed.
 *
 * The panel above this one has always shown the plan — "5 per week", "25
 * artifacts" — and never how many of them are gone. OWNER_TODO §2 named that
 * gap: the page shows your limit, not your usage.
 *
 * Additive on purpose. The ceilings render on the server from the tier table
 * and stay there whatever happens here; this block appears underneath once the
 * numbers arrive and simply does not appear if they never do. That ordering is
 * what makes a fetch failure cost nothing — the page is never worse than the
 * page that shipped before it, and there is no reserved gap that reads as
 * something having broken.
 */
export function UsageNow({
  locale,
  renderedTier,
}: {
  locale: PublicLocale;
  /** The tier the ceilings above were rendered from — the WEB app's answer. */
  renderedTier: "demo" | "free" | "developer";
}) {
  const copy = ACCOUNT_COPY[locale];
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/usage", { cache: "no-store" });
        if (!response.ok) return;
        const summary = parseUsage(await response.json());
        if (!cancelled && summary) setUsage(summary);
      } catch {
        // Nothing renders. See the note above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!usage) return null;

  const metered = isMetered(usage);
  // `tier` is whatever string the control plane sent. Naming a tier this page
  // has no copy for would render "undefined"; an unrecognised one means the two
  // services are further apart than this banner can explain, so it says nothing.
  const enforcedTier = (["demo", "free", "developer"] as const).find(
    (known) => known === usage.tier,
  );
  const slot =
    metered && usage.runs.nextSlotAt ? describeNextSlot(usage.runs.nextSlotAt, locale) : null;
  const slotLine = slot
    ? slot.relative
      ? copy.usageNextSlotWhen(slot.text)
      : copy.usageNextSlotOn(slot.text)
    : null;

  const spent = (used: number, limit: number | null) =>
    limit === null ? copy.usageSpentUnmetered(used) : copy.usageSpent(used, limit);

  return (
    <div className="mj-usage-now">
      <h3>{copy.usageNowTitle}</h3>
      {/* Two services resolve the tier, and they can disagree.
          The ceilings above are the WEB app's answer, from its own copy of the
          tier table and its own LEONA_DEVELOPER_EMAILS; the numbers below are
          the control plane's, and the control plane is the one that refuses a
          submission. A deployment where only one of the two has the allowlist
          set — an environment variable that has already been found set-but-
          empty on Vercel once — would otherwise print "Unlimited" directly
          above "3 of 5 used" and leave the reader to guess which is real.
          Naming the enforced one is cheaper than hiding the difference. */}
      {enforcedTier && enforcedTier !== renderedTier ? (
        <p className="mj-usage-now-conflict">
          {copy.usageEnforcedAs(copy.tierNames[enforcedTier])}
        </p>
      ) : null}
      <dl className="mj-usage-list">
        <div>
          <dt>{copy.usageRuns}</dt>
          <dd>
            {spent(usage.runs.used, usage.runs.limit)}
            {/* Said here rather than only in the menu: a rolling window is the
                one fact about this allowance people get wrong, and the account
                page is where somebody goes to find out why they are refused.
                Omitted when there is no allowance — explaining how a limit
                replenishes to someone who has no limit is just noise. */}
            {metered ? <small>{copy.usageWindow(usage.runs.windowDays)}</small> : null}
            {slotLine ? <small>{slotLine}</small> : null}
          </dd>
        </div>
        <div>
          <dt>{copy.usageStorage}</dt>
          <dd>
            {spent(usage.artifacts.used, usage.artifacts.limit)}
            <small>{copy.usageArtifactsScope}</small>
          </dd>
        </div>
        <div>
          <dt>{copy.usageWorkspaces}</dt>
          <dd>{spent(usage.workspaces.used, usage.workspaces.limit)}</dd>
        </div>
      </dl>
    </div>
  );
}
