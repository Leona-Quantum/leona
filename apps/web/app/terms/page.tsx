import type { Metadata } from "next";
import { CONTACT_EMAIL, CONTACT_MAILTO, PublicSite } from "../../components/public-site";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "Majorana early-access terms of service for the public website and product.",
};

export default function TermsPage() {
  return (
    <PublicSite activePath="/terms" className="mj-legal-site">
      <section className="mj-legal-hero">
        <h1>Terms of service</h1>
        <p>The rules for using the Majorana website, workbench, Library, and public repository.</p>
        <span>Last updated: July 14, 2026</span>
      </section>
      <article className="mj-legal-document">
        <p className="mj-legal-note"><strong>Early-access note:</strong> Majorana is evolving. These plain-language terms are a practical starting point for the current product; additional commercial terms may apply when paid plans or enterprise agreements become available.</p>

        <section>
          <h2>1. Using Majorana</h2>
          <p>By accessing Majorana, you agree to use the service lawfully, respect other users, and follow these terms. If you use Majorana for an organization, you represent that you have authority to accept these terms on its behalf.</p>
          <p>You are responsible for keeping your account access secure and for the prompts, code, data, and artifacts you submit or publish.</p>
        </section>

        <section>
          <h2>2. Acceptable use</h2>
          <p>Do not use Majorana to violate law or third-party rights, exfiltrate secrets, attack infrastructure, bypass usage controls, submit malware, or interfere with the service or another person’s workspace. Do not use generated code or results as a substitute for professional review in safety-critical, financial, medical, or regulated settings.</p>
        </section>

        <section>
          <h2>3. Generated code and verification</h2>
          <p>Majorana helps generate, execute, and analyze technical work. Generated code can be incomplete or wrong. A verification result means that the documented checks passed for the recorded run and conditions; it is not a guarantee of correctness in every environment or a promise of algorithmic advantage.</p>
          <p>You must review code, assumptions, resource estimates, export classifications, and limitations before relying on an artifact or running it on hardware.</p>
        </section>

        <section>
          <h2>4. Your content and public publishing</h2>
          <p>You keep the rights you have in content you submit. You grant Majorana the limited permission needed to host, process, execute, display, back up, and improve the service for you. Private Library content is not public by default.</p>
          <p>If you publish an artifact to the public repository, you confirm that you have the rights to publish it and that the content does not contain secrets or restricted material. Public source code in the repository is also subject to the license shown with that code, including the project’s MIT-licensed open-source foundation where applicable.</p>
        </section>

        <section>
          <h2>5. Plans, pricing, and changes</h2>
          <p>Majorana is currently presented as an early-access product. The pricing page describes intended packaging; paid billing, limits, credits, and refunds will be governed by terms shown before a transaction is enabled.</p>
          <p>We may change, suspend, or discontinue parts of the service as the product develops. We will try to preserve access to useful records and communicate material changes where practical.</p>
        </section>

        <section>
          <h2>6. Disclaimers and liability</h2>
          <p>Majorana is provided on an early-access basis. To the extent permitted by law, the service is provided without warranties that it will be uninterrupted, error-free, secure, or suitable for a particular purpose. You use generated code, simulations, exports, and public artifacts at your own risk.</p>
          <p>Nothing on Majorana is legal, medical, financial, or safety advice. Any limitation of liability or indemnity terms required for a paid or enterprise relationship will be stated in the applicable commercial agreement.</p>
        </section>

        <section>
          <h2>7. Contact</h2>
          <p>Questions about these terms can be sent to <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>. We may update these terms as Majorana adds accounts, paid plans, and new execution capabilities; the date above identifies the current version.</p>
        </section>
      </article>
    </PublicSite>
  );
}
