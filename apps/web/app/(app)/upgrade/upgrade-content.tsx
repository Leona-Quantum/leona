import Link from "next/link";
import { getAccountTier } from "../../../lib/account-tier-server";
import { PLAN_CARD_NAMES, upgradeCardsAbove } from "../../../lib/account-tier";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { PRICING_COPY, UPGRADE_COPY } from "../../../lib/public-copy";
import { UpgradePressure } from "./upgrade-pressure";

/**
 * /upgrade — what a person gets for moving up, and what they are using now.
 *
 * Built as its own route rather than as another panel on /account, which is
 * already ten stacked sections and twenty-eight label/value rows. The screen a
 * person lands on when they are running out of room should not itself be the
 * most crowded one in the product.
 *
 * Server-rendered. Everything except the live usage line is known from the
 * session and the tier table, so the page is complete on first paint and a
 * failed fetch cannot leave it half-empty — the usage line is the one client
 * piece, and it renders nothing at all when it cannot answer.
 */
export async function UpgradeContent() {
  const [locale, { tier: rawTier }] = await Promise.all([getPublicLocale(), getAccountTier()]);
  const copy = UPGRADE_COPY[locale];
  const pricing = PRICING_COPY[locale];

  // `preview` is the signed-out fixture tier and cannot legitimately reach a
  // route inside (app) — but `resolveAccountTier` returns it whenever it sees no
  // email, so a session that resolves oddly would land here and be offered FREE
  // as an upgrade. Treat it as free: this page is only ever rendered for someone
  // signed in, and offering them the plan they already have is the one output
  // that is certainly wrong.
  const tier = rawTier === "preview" ? "free" : rawTier;
  const currentCardName = PLAN_CARD_NAMES[tier];
  const currentCard = pricing.plans.find((plan) => plan.name === currentCardName) ?? null;
  const above = upgradeCardsAbove(tier);
  // Enterprise sells no tier, so it is not on the ladder and cannot be derived
  // from it. Offered to anyone already at the top of what is published.
  const cardNames = above.length > 0 ? above : [copy.enterpriseName];
  const cards = cardNames
    .map((name) => pricing.plans.find((plan) => plan.name === name))
    .filter((plan): plan is (typeof pricing.plans)[number] => plan !== undefined);

  return (
    <div className="mj-workspace-content">
      <header className="mj-page-header">
        <div>
          <h1 className="mj-page-title">{copy.title}</h1>
          <p className="mj-page-lede">{copy.lede}</p>
        </div>
        {/* next/link, not an anchor: /account is an intercepting route, and a
            document load lands on the full page instead of the settings modal.
            `account-entry-points.test.ts` enforces this repo-wide. */}
        <Link className="mj-secondary-button" href="/account">
          {copy.backToAccount}
        </Link>
      </header>

      {/* Unmetered accounts are told plainly rather than shown a ladder that
          does not apply to them. `developer` has no card and no allowance. */}
      {tier === "developer" ? (
        <section className="mj-artifact-panel">
          <div className="mj-panel-heading">
            <h2>{copy.developerTitle}</h2>
          </div>
          <p className="mj-panel-help">{copy.developerBody}</p>
        </section>
      ) : (
        <>
          <UpgradePressure locale={locale} />

          {currentCard ? (
            <section className="mj-artifact-panel">
              <div className="mj-panel-heading">
                <h2>{copy.currentLabel}</h2>
                <span className="mj-mono-muted">{currentCard.name}</span>
              </div>
              <p className="mj-panel-help">
                {currentCard.price} {currentCard.cadence} {copy.currentSuffix}
              </p>
              <ul className="mj-upgrade-features">
                {currentCard.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {above.length === 0 ? (
            <section className="mj-artifact-panel">
              <div className="mj-panel-heading">
                <h2>{copy.topOfLadderTitle}</h2>
              </div>
              <p className="mj-panel-help">{copy.topOfLadderBody}</p>
            </section>
          ) : null}

          <div className="mj-upgrade-cards">
            {cards.map((plan) => (
              <section className="mj-artifact-panel mj-upgrade-card" key={plan.name}>
                <div className="mj-panel-heading">
                  <h2>{plan.name}</h2>
                  <span className="mj-mono-muted">{plan.price}</span>
                </div>
                <p className="mj-panel-help">{plan.cadence}</p>
                <p className="mj-upgrade-description">{plan.description}</p>
                <ul className="mj-upgrade-features">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {/* /contact, not a checkout: there is no payment path in this
                    deployment and a button implying one would be a lie about
                    what happens next. The panel below says so in words. */}
                <a className="mj-primary-button" href="/contact">
                  {copy.cta}
                </a>
              </section>
            ))}
          </div>

          <section className="mj-artifact-panel">
            <div className="mj-panel-heading">
              <h2>{copy.checkoutTitle}</h2>
            </div>
            <p className="mj-panel-help">{copy.checkoutBody}</p>
          </section>
        </>
      )}
    </div>
  );
}
