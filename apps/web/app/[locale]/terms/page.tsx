import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { TERMS_COPY } from "../../../lib/public-copy";
import { parsePublicLocale, PUBLIC_LOCALES } from "../../../lib/public-locale";

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
  title: "Terms of service",
  description: "Leona Quantum early-access terms for the public website and product.",
};

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = parsePublicLocale((await params).locale);
  const copy = TERMS_COPY[locale];
  return (
    <PublicSite activePath="/terms" className="mj-legal-site" locale={locale} chrome="static">
      <section className="mj-legal-hero">
        <h1>{copy.title}</h1>
        <p>{copy.lede}</p>
        <span>{copy.updated}</span>
      </section>
      <article className="mj-legal-document">
        <p className="mj-legal-note"><strong>{copy.noteLabel}</strong> {copy.noteBody}</p>
        {copy.sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
      </article>
    </PublicSite>
  );
}
