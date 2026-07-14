import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CONTACT_EMAIL, CONTACT_MAILTO, PublicSite } from "../components/public-site";
import { getMajoranaAuth } from "../lib/auth";
import { isPublicDemoEnabled } from "../lib/public-demo";

export const metadata: Metadata = {
  title: "Verified quantum work",
  description: "Majorana turns quantum questions into executable code, measured evidence, and reusable artifacts.",
};

export default async function Home() {
  const { user } = await getMajoranaAuth();
  if (user) redirect("/run");
  const demoEnabled = isPublicDemoEnabled();

  return (
    <PublicSite activePath="/" className="mj-company-site">
      <section className="mj-company-hero">
        <div className="mj-company-hero-copy">
          <h1>Build quantum work you can trust.</h1>
          <p className="mj-company-hero-lede">
            Majorana takes a technical question from natural language to executable code,
            measured results, verification, and a reusable artifact with its evidence attached.
          </p>
          <div className="mj-public-actions">
            {demoEnabled ? <a className="mj-primary-button" href="/demo">Try the public preview</a> : null}
            <a className="mj-secondary-button" href="/repository">Explore the repository</a>
            <a className="mj-secondary-button" href={CONTACT_MAILTO}>Contact us</a>
          </div>
          <p className="mj-company-hero-note">
            Built for researchers, quantum engineers, and R&amp;D teams who need more than plausible code.
          </p>
        </div>
        <div className="mj-company-hero-art" aria-label="Majorana verification pipeline preview">
          <div className="mj-public-art-head">
            <span>NAMEKO / RUN</span>
            <span className="mj-public-art-status">EVIDENCE ATTACHED</span>
          </div>
          <div className="mj-public-pipeline">
            {[
              ["01", "Plan", "Problem, framework, checks"],
              ["02", "Generate", "Copyable implementation"],
              ["03", "Verify", "Measured result + verdict"],
              ["04", "Save", "Reusable Library artifact"],
            ].map(([number, label, detail], index) => (
              <div className="mj-public-pipeline-step" key={label}>
                <span className="mj-public-pipeline-number">{number}</span>
                <div>
                  <strong>{label}</strong>
                  <span>{detail}</span>
                </div>
                {index < 3 ? <span className="mj-public-pipeline-line" aria-hidden="true" /> : null}
              </div>
            ))}
          </div>
          <div className="mj-public-art-foot">
            <span>Bell state measurement</span>
            <span className="font-mono">TVD 0.0088 · PASS</span>
          </div>
        </div>
      </section>

      <section className="mj-company-section mj-company-intro" aria-labelledby="company-intro-heading">
        <div>
          <p className="mj-section-label">The product</p>
          <h2 id="company-intro-heading">A workbench for the part generic copilots skip.</h2>
        </div>
        <p>
          Quantum code is easy to make look right. The hard part is running it, checking it
          against the request, preserving what happened, and making the result useful again
          tomorrow. Majorana makes that evidence the center of the workflow.
        </p>
      </section>

      <section className="mj-company-section" aria-labelledby="surfaces-heading">
        <div className="mj-company-section-heading">
          <p className="mj-section-label">Three connected surfaces</p>
          <h2 id="surfaces-heading">From first prompt to durable work.</h2>
        </div>
        <div className="mj-company-capability-list">
          <article>
            <span className="mj-company-index">01</span>
            <div>
              <h3>Nameko</h3>
              <p>The conversational agent that plans, generates, simulates, verifies, explains, and keeps the user-facing answer readable.</p>
            </div>
            <span className="mj-company-capability-note">Run · Explain · Ideate</span>
          </article>
          <article>
            <span className="mj-company-index">02</span>
            <div>
              <h3>Library</h3>
              <p>The private store for code, runs, verification records, export status, limitations, and provenance that should travel with the artifact.</p>
            </div>
            <span className="mj-company-capability-note">Save · Reopen · Reuse</span>
          </article>
          <article>
            <span className="mj-company-index">03</span>
            <div>
              <h3>Studio</h3>
              <p>The R&amp;D workspace where saved work can be inspected, edited, resimulated, and turned into the next verified version.</p>
            </div>
            <span className="mj-company-capability-note">Edit · Simulate · Verify</span>
          </article>
        </div>
      </section>

      <section className="mj-company-section mj-company-principles" aria-labelledby="principles-heading">
        <div>
          <p className="mj-section-label">Our standard</p>
          <h2 id="principles-heading">Trust is a product behavior.</h2>
        </div>
        <div className="mj-company-principle-list">
          <p><strong>Measured results over plausible code.</strong> A run that did not happen is never presented as evidence.</p>
          <p><strong>Evidence travels with the artifact.</strong> Verification, runtime context, and known limitations stay attached when work is saved.</p>
          <p><strong>Open foundations, careful boundaries.</strong> The engineering is public; private workspaces, credentials, and user data stay scoped.</p>
        </div>
      </section>

      <section className="mj-company-final-cta" aria-labelledby="company-cta-heading">
        <div>
          <p className="mj-section-label">Start with the evidence</p>
          <h2 id="company-cta-heading">Bring us the quantum question you do not want to take on faith.</h2>
        </div>
        <div className="mj-public-actions">
          <a className="mj-primary-button" href={CONTACT_MAILTO}>Email {CONTACT_EMAIL}</a>
          <a className="mj-secondary-button" href="/pricing">See early-access plans</a>
        </div>
      </section>
    </PublicSite>
  );
}
