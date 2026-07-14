import type { Metadata } from "next";
import { CONTACT_EMAIL, CONTACT_MAILTO, PublicSite } from "../../components/public-site";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Majorana about product access, research, and collaboration.",
};

export default function ContactPage() {
  return (
    <PublicSite activePath="/contact" className="mj-contact-site">
      <section className="mj-contact-hero">
        <div>
          <h1>Let’s make quantum work more trustworthy.</h1>
          <p>
            Majorana is building the evidence layer around quantum software: a place where
            generated code can be run, checked, explained, and reused. Tell us what you are
            trying to build or validate.
          </p>
          <a className="mj-primary-button" href={CONTACT_MAILTO}>Email {CONTACT_EMAIL}</a>
        </div>
        <div className="mj-contact-panel">
          <span className="mj-section-label">Good reasons to write</span>
          <ul>
            <li>Research workflows and early product access</li>
            <li>Enterprise R&amp;D and private-corpus conversations</li>
            <li>Open-source contributions and technical feedback</li>
            <li>Press, partnerships, and speaking</li>
          </ul>
        </div>
      </section>

      <section className="mj-contact-details" aria-labelledby="contact-details-heading">
        <div>
          <p className="mj-section-label">Direct line</p>
          <h2 id="contact-details-heading">No form queue. Just an email.</h2>
        </div>
        <div>
          <p>For now, contact goes directly to the person building Majorana.</p>
          <a className="mj-contact-email" href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>
          <p className="mj-contact-note">A useful first note includes the framework, problem type, and what evidence you need to trust the result.</p>
        </div>
      </section>
    </PublicSite>
  );
}
