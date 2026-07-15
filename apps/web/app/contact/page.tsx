import type { Metadata } from "next";
import { CONTACT_EMAIL, PublicSite } from "../../components/public-site";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Send a LeonaQ inquiry to the product contact queue.",
};

export default function ContactPage() {
  return (
    <PublicSite activePath="/contact" className="mj-contact-site">
      <section className="mj-contact-hero">
        <div>
          <p className="mj-public-overline">Contact queue</p>
          <h1>Tell us what you are trying to build or validate.</h1>
          <p>
            LeonaQ is building the evidence layer around quantum software: public research,
            private workspaces, and execution that can be inspected. Your note will be prepared
            for {CONTACT_EMAIL}.
          </p>
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

      <section className="mj-contact-form-section" aria-labelledby="contact-form-heading">
        <div>
          <p className="mj-section-label">Start a conversation</p>
          <h2 id="contact-form-heading">A short brief is enough.</h2>
          <p className="mj-contact-note">Submitting opens a prepared email in your email app. The current queue is mailto-backed; server-side delivery, CRM routing, and support SLAs are deferred until the operating workflow is finalized.</p>
        </div>
        <ContactForm />
      </section>
    </PublicSite>
  );
}
