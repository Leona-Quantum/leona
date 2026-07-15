import type { Metadata } from "next";
import { PublicSite } from "../../components/public-site";
import { CONTACT_COPY } from "../../lib/public-copy";
import { getPublicLocale } from "../../lib/public-locale-server";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact LeonaQ about research workflows and early product access.",
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
        <div className="mj-contact-panel">
          <span className="mj-section-label">{copy.panelTitle}</span>
          <ul>{copy.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      </section>

      <section className="mj-contact-form-section" aria-labelledby="contact-form-heading">
        <div>
          <p className="mj-section-label">{copy.formLabel}</p>
          <h2 id="contact-form-heading">{copy.formTitle}</h2>
          <p className="mj-contact-note">{copy.formBody} {copy.note}</p>
        </div>
        <ContactForm locale={locale} />
      </section>
    </PublicSite>
  );
}
