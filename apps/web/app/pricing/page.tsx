import type { Metadata } from "next";
import { PublicSite } from "../../components/public-site";
import { PRICING_COPY } from "../../lib/public-copy";
import { getPublicLocale } from "../../lib/public-locale-server";
import { isPublicDemoEnabled } from "../../lib/public-demo";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Early-access LeonaQ plans for individual researchers and teams.",
};

export default async function PricingPage() {
  const locale = await getPublicLocale();
  const copy = PRICING_COPY[locale];
  const demoEnabled = isPublicDemoEnabled();
  return (
    <PublicSite activePath="/pricing" className="mj-pricing-site" locale={locale}>
      <section className="mj-public-page-hero">
        <h1>{copy.hero.title}</h1>
        <p>{copy.hero.body}</p>
      </section>

      <section className="mj-pricing-grid" aria-label={locale === "ja" ? "LeonaQのプラン" : "LeonaQ plans"}>
        {copy.plans.map((plan) => (
          <article className={`mj-pricing-card mj-pricing-card--${plan.tone}`} key={plan.name}>
            <div className="mj-pricing-card-head">
              <h2>{plan.name}</h2>
              {plan.tone === "featured" ? <span className="mj-pricing-mark">{locale === "ja" ? "おすすめ" : "Recommended"}</span> : null}
            </div>
            <p className="mj-pricing-price">{plan.price}</p>
            <p className="mj-pricing-cadence">{plan.cadence}</p>
            <p className="mj-pricing-description">{plan.description}</p>
            <ul>
              {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <a
              className={plan.tone === "featured" ? "mj-primary-button" : "mj-secondary-button"}
              href={plan.name === "Free" && demoEnabled ? "/demo" : "/contact"}
              title={plan.action}
            >
              {plan.name === "Free" && !demoEnabled ? (locale === "ja" ? "お問い合わせ" : "Talk to us") : plan.action}
            </a>
          </article>
        ))}
      </section>

      <section className="mj-pricing-note" aria-labelledby="pricing-note-heading">
        <div>
          <p className="mj-section-label">{copy.note.label}</p>
          <h2 id="pricing-note-heading">{copy.note.title}</h2>
        </div>
        <p>{copy.note.body}</p>
      </section>
    </PublicSite>
  );
}
