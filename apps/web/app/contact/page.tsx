import type { Metadata } from "next";
import { PublicSite } from "../../components/public-site";
import { Reveal } from "../../components/reveal";
import { CONTACT_COPY } from "../../lib/public-copy";
import { getPublicLocale } from "../../lib/public-locale-server";
import { ContactForm } from "./contact-form";
import { MeasurementLab } from "../../components/measurement-lab";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Leona Quantum about research workflows and early product access.",
};

export default async function ContactPage() {
  const locale = await getPublicLocale();
  const copy = CONTACT_COPY[locale];
  return (
    <PublicSite activePath="/contact" className="mj-contact-site" locale={locale}>
      <section className="mj-contact-hero">
        <div>
          <p className="mj-public-overline">{copy.overline}</p>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
        </div>
      </section>

      <Reveal>
        <section className="mj-contact-layout" aria-label={copy.overline}>
          <div className="mj-contact-form-section mj-contact-form-section--solo">
            <ContactForm locale={locale} />
            <p className="mj-contact-note">{copy.note}</p>
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
