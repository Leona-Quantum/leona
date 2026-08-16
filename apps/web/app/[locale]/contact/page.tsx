import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { Reveal } from "../../../components/reveal";
import { CONTACT_COPY } from "../../../lib/public-copy";
import { ContactForm } from "./contact-form";
import { MeasurementLab } from "../../../components/measurement-lab";
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
  ...canonicalMetadata("/contact"),
  title: "Contact",
  description: "Contact Leona Quantum about research workflows and early product access.",
};

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = parsePublicLocale((await params).locale);
  const copy = CONTACT_COPY[locale];
  return (
    <PublicSite activePath="/contact" className="mj-contact-site" locale={locale} chrome="static">
      <Reveal>
        <section className="mj-contact-hero">
          <div>
            <p className="mj-public-overline">{copy.overline}</p>
            <h1>{copy.title}</h1>
            <p>{copy.body}</p>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="mj-contact-layout" aria-label={copy.overline}>
          <div className="mj-contact-form-section mj-contact-form-section--solo">
            {/* The note moved INSIDE the form (ai-ops issue 125). It describes
                what the button does, and what the button does is now decided at
                runtime by whether a transactional sender is configured — which
                this server-rendered, CDN-cached page cannot know. Rendering it
                here would have left "opens a prepared email in your email app"
                on the page after the form stopped doing that. */}
            <ContactForm locale={locale} />
          </div>
          {/* A small interactive aside (Owner Inbox 2026-07-19): compact, no
              explanatory copy — just a qubit to measure while you're here. */}
          <aside className="mj-contact-measure" aria-labelledby="contact-measure-heading">
            <p className="mj-section-label" id="contact-measure-heading">{copy.measure.label}</p>
            <MeasurementLab compact />
          </aside>
        </section>
      </Reveal>
    </PublicSite>
  );
}
