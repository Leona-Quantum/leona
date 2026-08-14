import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { Reveal } from "../../../components/reveal";
import { WORKSPACE_LANDING_COPY } from "../../../lib/public-copy";
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
  ...canonicalMetadata("/workspace"),
  title: "Workspace",
  description: "Leona Quantum's personal quantum workspace for guided development, Studio, and verified artifacts.",
};

export default async function WorkspacePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = parsePublicLocale((await params).locale);
  const copy = WORKSPACE_LANDING_COPY[locale];
  return (
    <PublicSite activePath="/workspace" className="mj-open-source" locale={locale} chrome="static">
      <div className="mj-open-source-inner">
        <section className="mj-open-source-hero">
          <p className="mj-public-overline">{copy.overline}</p>
          <h1>{copy.title}</h1>
          <p className="mj-landing-copy">{copy.body}</p>
          <div className="mj-landing-actions">
            <a className="mj-primary-button" href="/contact">{copy.primary}</a>
            <a className="mj-secondary-button" href="/repository">{copy.secondary}</a>
          </div>
        </section>

        <section className="mj-open-source-section" aria-labelledby="workspace-flow-heading">
          <Reveal>
            <p className="mj-section-label">{copy.loopLabel}</p>
            <h2 id="workspace-flow-heading">{copy.loopTitle}</h2>
          </Reveal>
          <div className="mj-open-source-grid">
            {copy.loop.map((item, index) => (
              <Reveal delay={index * 90} key={item.kicker}>
                <article className="mj-open-source-card">
                  <span className="mj-open-source-kicker">{item.kicker}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mj-open-source-section" aria-labelledby="compute-heading">
          <Reveal>
            <p className="mj-section-label">{copy.computeLabel}</p>
            <h2 id="compute-heading">{copy.computeTitle}</h2>
          </Reveal>
          <Reveal delay={90}>
            <div className="mj-open-source-circuits">
              {copy.compute.map((item) => <div key={item.title}><strong>{item.title}</strong><span>{item.body}</span></div>)}
            </div>
          </Reveal>
        </section>

      </div>
    </PublicSite>
  );
}
