import type { Metadata } from "next";
import { PublicSite } from "../../components/public-site";
import { TERMS_COPY } from "../../lib/public-copy";
import { getPublicLocale } from "../../lib/public-locale-server";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "LeonaQ early-access terms for the public website and product.",
};

export default async function TermsPage() {
  const locale = await getPublicLocale();
  const copy = TERMS_COPY[locale];
  return (
    <PublicSite activePath="/terms" className="mj-legal-site" locale={locale}>
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
