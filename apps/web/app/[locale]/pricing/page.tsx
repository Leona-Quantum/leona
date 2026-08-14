import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { Reveal } from "../../../components/reveal";
import { PRICING_COPY } from "../../../lib/public-copy";
import { isPublicDemoEnabled } from "../../../lib/public-demo";
import { parsePublicLocale, PUBLIC_LOCALES } from "../../../lib/public-locale";
import { canonicalMetadata } from "../../../lib/public-metadata";

// Served from the CDN. The locale comes from the path segment because a cached
// page cannot read a cookie — `middleware.ts` rewrites the clean URL to this
// one, keeping `/{clean}` in the address bar while giving each language its own
// cache entry. `dynamicParams = false` is what stops `[locale]` from swallowing
// every mistyped URL and answering it with this page instead of a 404.
export const revalidate = 300;
export const dynamicParams = false;

export function generateStaticParams() {
  return PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
  ...canonicalMetadata("/pricing"),
  title: "Pricing",
  description: "Early-access Leona Quantum plans for individual researchers and teams.",
};

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = parsePublicLocale((await params).locale);
  const copy = PRICING_COPY[locale];
  const demoEnabled = isPublicDemoEnabled();
  return (
    <PublicSite activePath="/pricing" className="mj-pricing-site" locale={locale} chrome="static">
      <Reveal>
        <section className="mj-public-page-hero">
          <h1>{copy.hero.title}</h1>
          <p>{copy.hero.body}</p>
        </section>
      </Reveal>

      <section className="mj-pricing-grid" aria-label={locale === "ja" ? "Leona Quantumのプラン" : "Leona Quantum plans"}>
        {copy.plans.map((plan, index) => {
          // With the demo off the Free plan's button goes to /contact, so its
          // copy label ("Try the preview") is stale — computed once here and
          // used for BOTH the visible text and the tooltip. They used to be
          // computed separately, which shipped a button reading "Talk to us"
          // whose hover tooltip still said "Try the preview".
          const toDemo = plan.name === "Free" && demoEnabled;
          const actionLabel = plan.name === "Free" && !demoEnabled
            ? (locale === "ja" ? "お問い合わせ" : "Talk to us")
            : plan.action;
          return (
          <Reveal delay={index * 90} key={plan.name}>
            <article className={`mj-pricing-card mj-pricing-card--${plan.tone}`}>
            <div className="mj-pricing-card-head">
              <h2>{plan.name}</h2>
              {plan.tone === "featured" ? <span className="mj-pricing-mark">{locale === "ja" ? "おすすめ" : "Recommended"}</span> : null}
            </div>
            <p className="mj-pricing-price">{plan.price}</p>
            <p className="mj-pricing-cadence">{plan.cadence}</p>
            <ul>
              {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <a
              className={plan.tone === "featured" ? "mj-primary-button" : "mj-secondary-button"}
              href={toDemo ? "/demo" : "/contact"}
              title={actionLabel}
            >
              {actionLabel}
            </a>
            </article>
          </Reveal>
          );
        })}
      </section>

      <Reveal>
        <section className="mj-pricing-note" aria-labelledby="pricing-note-heading">
          <div>
            <p className="mj-section-label">{copy.note.label}</p>
            <h2 id="pricing-note-heading">{copy.note.title}</h2>
          </div>
          <p>{copy.note.body}</p>
        </section>
      </Reveal>
    </PublicSite>
  );
}
