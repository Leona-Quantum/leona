import type { Metadata } from "next";
import { CONTACT_EMAIL, CONTACT_MAILTO, PublicSite } from "../../components/public-site";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "Majorana privacy policy for the early-access product and public website.",
};

export default function PrivacyPage() {
  return (
    <PublicSite activePath="/privacy" className="mj-legal-site">
      <section className="mj-legal-hero">
        <h1>Privacy policy</h1>
        <p>How Majorana handles information on the public website and early-access product.</p>
        <span>Last updated: July 14, 2026</span>
      </section>
      <article className="mj-legal-document">
        <p className="mj-legal-note"><strong>Early-access note:</strong> this page describes the current product and operating practices. It will be updated as Majorana grows, adds paid services, and formalizes its operating entity.</p>

        <section>
          <h2>1. Information we receive</h2>
          <p>We may receive account information such as your email address and authentication details when you create or use a Majorana account.</p>
          <p>When you use the workbench, we may process prompts, generated code, circuit data, run settings, simulation results, verification records, saved artifacts, and related metadata that you choose to submit. These records are necessary to provide the product and keep evidence attached to your work.</p>
          <p>If you email us, we receive the information you include in that message and any reply details needed to respond.</p>
        </section>

        <section>
          <h2>2. How we use information</h2>
          <p>We use information to authenticate users, run and verify requested workflows, save and reopen Library artifacts, provide support, secure the service, diagnose failures, and improve reliability and product quality.</p>
          <p>We may use aggregated or de-identified operational information to understand performance and improve the system. We do not present private workspace artifacts as public repository material without an explicit publish action.</p>
        </section>

        <section>
          <h2>3. Service providers and infrastructure</h2>
          <p>Majorana relies on specialized providers for hosting, authentication, databases, observability, model access, and isolated code execution. Those providers may process information only as needed to provide their services, subject to their own terms and privacy practices.</p>
          <p>Generated code is treated as untrusted input and is intended to run in an isolated, network-restricted execution environment. No security boundary is absolute, so do not submit secrets or information you are not authorized to process.</p>
        </section>

        <section>
          <h2>4. Public and private work</h2>
          <p>Public repository entries are separate from private Libraries. A Library entry is private by default. Publishing is an explicit action that may make an artifact, its code, and its evidence available to other people; review the content before publishing.</p>
        </section>

        <section>
          <h2>5. Retention and your choices</h2>
          <p>We retain account and workspace records for as long as needed to provide the service, meet legitimate operational needs, resolve disputes, and comply with applicable obligations. Retention may vary by record type and account status.</p>
          <p>You can ask about the information associated with your account, request correction or deletion where applicable, or ask a privacy question by emailing <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>. We may need to verify your request before acting on it.</p>
        </section>

        <section>
          <h2>6. Cookies and security</h2>
          <p>The authenticated product may use cookies or similar technologies to maintain a secure session. The public site may also receive ordinary technical information from your browser and hosting infrastructure.</p>
          <p>We use reasonable technical and organizational measures for the stage of the product, but no online service can promise perfect security. Keep account credentials private and do not place API keys, passwords, or regulated data in prompts or generated code.</p>
        </section>

        <section>
          <h2>7. Changes and contact</h2>
          <p>We may update this policy when the service changes. The date above identifies the latest version published on this page. Questions can be sent to <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>.</p>
        </section>
      </article>
    </PublicSite>
  );
}
