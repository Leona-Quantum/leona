"use client";

import { useEffect, useState } from "react";
import { ACCOUNT_TIERS, type AccountTier } from "../../../lib/account-tier";
import type { PublicLocale } from "../../../lib/public-locale";
import { ACCOUNT_COPY } from "../../../lib/workspace-locale";
import {
  describeNextSlot,
  formatTokens,
  formatUsd,
  isMetered,
  parseUsage,
  type Allowance,
  type HardwareSpend,
  type SpendReport,
  type TokenAllowance,
  type UsageSummary,
} from "../../../lib/usage-summary";

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
  renderedTier: AccountTier;
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
  const enforcedTier = ACCOUNT_TIERS.find((known) => known === usage.tier);
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
      {usage.tokens ? <WeeklyMeters tokens={usage.tokens} locale={locale} /> : null}
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
        {usage.sharedProjects ? (
          <SharedProjects allowance={usage.sharedProjects} locale={locale} />
        ) : null}
        {usage.hardwareSpend ? (
          <HardwareSpendRow spend={usage.hardwareSpend} locale={locale} />
        ) : null}
      </dl>
      {usage.spend ? <ModelSpend spend={usage.spend} locale={locale} /> : null}
    </div>
  );
}

/**
 * The weekly allowance, as a bar that fills.
 *
 * This is the meter a submission is refused on. The run count below it is still
 * reported and is still what the plan is sold as, but since 2026-08-03 it does
 * not gate — so the bar is drawn from tokens, and the run figure appears
 * underneath as the sentence that makes six digits mean something.
 *
 * Three things the layout is doing deliberately:
 *
 * - The percentage is right-aligned opposite the label rather than trailing the
 *   bar, so a reader compares figures down a column instead of across a row.
 * - The ratio ("45,000 of 150,000") is a sub-line, not the headline. The
 *   headline is the percentage, because that is the question — how much is left
 *   — and the exact tokens are the supporting detail.
 * - An unmetered plan gets a sentence and no track at all. A full-width empty
 *   rail under "no limit" reads as a limit nobody has reached yet.
 */
function WeeklyMeters({ tokens, locale }: { tokens: TokenAllowance; locale: PublicLocale }) {
  const copy = ACCOUNT_COPY[locale];
  const slot = tokens.nextSlotAt ? describeNextSlot(tokens.nextSlotAt, locale) : null;
  const resetLine = slot
    ? slot.relative
      ? copy.meterResetsWhen(slot.text)
      : copy.meterResetsOn(slot.text)
    : null;

  if (tokens.limit === null) {
    return (
      <div className="mj-meters">
        <h3>{copy.meterWeeklyTitle}</h3>
        <div className="mj-meter">
          <div>
            <span className="mj-meter-name">{copy.meterTokens}</span>
          </div>
          <p className="mj-meter-unmetered">{copy.meterTokensUnmetered}</p>
        </div>
      </div>
    );
  }

  // Rounded for the label only; the fill uses the unrounded ratio so a meter at
  // 0.4% still shows a sliver rather than snapping to empty. Clamped because a
  // tier lowered under an account leaves `used` above `limit`, and a bar wider
  // than its track would overflow the panel.
  const ratio = Math.min(tokens.used / tokens.limit, 1);
  const percent = Math.min(Math.round((tokens.used / tokens.limit) * 100), 100);

  return (
    <div className="mj-meters">
      <h3>{copy.meterWeeklyTitle}</h3>
      <div className="mj-meter">
        <div>
          <span className="mj-meter-name">{copy.meterTokens}</span>
          {/* The reset line sits under the label rather than under the bar, so
              the row stays one row. Exhaustion is said in words as well as in
              colour: the amber fill is the only other signal, and colour alone
              is not one.
              Nothing at all when neither applies — an account that has spent
              nothing has no date to give, and falling back to the ratio here
              printed "0 of 150,000" twice, two lines apart. */}
          {tokens.exhausted || resetLine ? (
            <p className="mj-meter-sub">
              {tokens.exhausted ? copy.meterExhausted : resetLine}
            </p>
          ) : null}
        </div>
        <div
          className="mj-meter-track"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={copy.meterTokens}
        >
          <div
            className="mj-meter-fill"
            data-exhausted={tokens.exhausted}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <span className="mj-meter-pct">{copy.meterPercentUsed(percent)}</span>
      </div>
      {/* The exact figures, once, under the row. Kept off the row itself
          because the reference's whole point is that the row carries one fact
          — how much is left — and the tokens are the supporting detail. */}
      <p className="mj-meter-sub">
        {copy.meterAmount(formatTokens(tokens.used, locale), formatTokens(tokens.limit, locale))}
        {tokens.runsEquivalent === null
          ? null
          : ` \u00b7 ${copy.meterTokensRuns(tokens.runsEquivalent)}`}
      </p>
    </div>
  );
}

/**
 * Shared projects, and the sentence that stops the number being misread.
 *
 * "2 of 4 used" under the word "projects" says, to anyone who has not read the
 * tier table, that this account may have four projects. It may have as many as
 * it likes: this counts the shared ones only, from both directions — projects
 * it shares out and projects shared with it — and unshared projects are
 * unlimited on every tier. The scope line is therefore not supporting detail,
 * it is the half of the fact the number cannot carry.
 *
 * A limit of zero gets a sentence instead of a ratio. "0 of 0 used" is the
 * arithmetic of a tier that cannot share at all, and it reads as a quota that
 * has been consumed rather than a feature that is not included.
 */
function SharedProjects({ allowance, locale }: { allowance: Allowance; locale: PublicLocale }) {
  const copy = ACCOUNT_COPY[locale];
  return (
    <div>
      <dt>{copy.usageSharedProjects}</dt>
      <dd>
        {allowance.limit === 0
          ? copy.usageSharedProjectsNone
          : allowance.limit === null
            ? copy.usageSpentUnmetered(allowance.used)
            : copy.usageSpent(allowance.used, allowance.limit)}
        {/* Dropped for a tier that cannot share, where the sentence above
            already says unshared projects stay unlimited. Printing both puts
            the same fact on the screen twice, a line apart. */}
        {allowance.limit === 0 ? null : <small>{copy.usageSharedProjectsScope}</small>}
      </dd>
    </div>
  );
}

/**
 * Dollars of hardware authorized, written for the case where there is no cap.
 *
 * Every tier's weekly hardware ceiling was removed once the owner ruled that
 * what a person spends on their own provider account is their decision, so
 * `limit_usd` is null in production and the unlimited branch is the ordinary
 * one. It reads as a complete sentence — "$3.40 authorized in the last 7 days"
 * — rather than as half of a ratio with "unlimited" on the other side.
 *
 * The bounded branch stays because the field stays: a self-set budget will use
 * it, and a branch that exists only in a comment is a branch nobody notices is
 * broken. The zero-ceiling branch is separate again, because the API's own
 * docstring is explicit that a zero limit is not a hardware ban — free-queue
 * devices estimate nothing, count as $0.00 and are never refused on it — and
 * "$0.00 of $0.00" would read as exactly the ban it is not.
 */
function HardwareSpendRow({ spend, locale }: { spend: HardwareSpend; locale: PublicLocale }) {
  const copy = ACCOUNT_COPY[locale];
  const used = formatUsd(spend.usedUsd, locale);
  const ceiling =
    spend.limitUsd === null
      ? null
      : spend.limitUsd === 0
        ? copy.usageHardwareFreeQueuesOnly
        : spend.exhausted
          ? copy.usageHardwareExhausted(formatUsd(spend.limitUsd, locale))
          : copy.usageHardwareRemaining(
              // `remaining` is the API's own subtraction, and the parser has
              // already refused a block where it disagrees with limit − used.
              // Recomputing it here would be a second answer to the same
              // question, printed a line below the first.
              formatUsd(spend.remainingUsd ?? 0, locale),
              formatUsd(spend.limitUsd, locale),
            );
  return (
    <div>
      <dt>{copy.usageHardware}</dt>
      <dd>
        {copy.usageHardwareAuthorized(used, spend.windowDays)}
        {ceiling ? <small>{ceiling}</small> : null}
        <small>{copy.usageHardwareScope}</small>
      </dd>
    </div>
  );
}

/**
 * What the workspace's conversations and runs actually consumed.
 *
 * Beneath the allowances rather than beside them because it is not one: it
 * refuses nothing, and reading it as a fourth quota would be the obvious
 * misunderstanding. Hence the separate heading, its own scope line — this is
 * the workspace's number, while the runs above it are the account's — and the
 * sentence saying nobody is charged for it.
 *
 * Rendered only when the control plane sent a coherent block; `parseSpend`
 * already dropped anything that did not add up, so nothing here has to decide
 * what to do about a total that disagrees with its own parts.
 */
function ModelSpend({ spend, locale }: { spend: SpendReport; locale: PublicLocale }) {
  const copy = ACCOUNT_COPY[locale];
  const line = (entry: { tokens: number; calls: number }) =>
    copy.spendTokens(formatTokens(entry.tokens, locale), entry.calls);

  return (
    <div className="mj-usage-spend">
      <h3>{copy.spendTitle}</h3>
      <p className="mj-usage-spend-scope">{copy.spendScope(spend.windowDays)}</p>
      {spend.total.tokens === 0 ? (
        <p className="mj-usage-spend-empty">{copy.spendEmpty(spend.windowDays)}</p>
      ) : (
        <>
          <dl className="mj-usage-list">
            <div>
              <dt>{copy.spendChat}</dt>
              <dd>{line(spend.chat)}</dd>
            </div>
            <div>
              <dt>{copy.spendRuns}</dt>
              <dd>{line(spend.runs)}</dd>
            </div>
            <div>
              <dt>{copy.spendTotal}</dt>
              <dd>{line(spend.total)}</dd>
            </div>
          </dl>
          {/* The model ids as the provider reported them. Not translated and
              not prettified: this is the string a person would compare against
              a provider's own console, and a friendly label would break that. */}
          <ul className="mj-usage-spend-models">
            {spend.byModel.map((entry) => (
              <li key={entry.model}>
                <span>{entry.model || copy.spendUnattributed}</span>
                <span>{formatTokens(entry.tokens, locale)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mj-usage-spend-note">{copy.spendNotBilled}</p>
    </div>
  );
}
