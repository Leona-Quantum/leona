import type { Metadata } from "next";
import { CONTACT_EMAIL, CONTACT_MAILTO, PublicSite } from "../components/public-site";

export const metadata: Metadata = {
  title: "Product",
  description: "Majorana is building the evidence layer for the future of quantum development.",
};

export default function Home() {
  return (
    <PublicSite activePath="/" className="mj-company-site">
      <section className="mj-company-hero">
        <div className="mj-company-hero-copy">
          <h1>The evidence layer for the future of quantum development.</h1>
          <p className="mj-company-hero-lede">
            Majorana brings public research, private experimentation, and trustworthy execution
            into one place. Inspect what exists, ask what to build, run it, and keep the evidence
            attached to the work.
          </p>
          <div className="mj-public-actions">
            <a className="mj-primary-button" href="/workspace">Open the workspace</a>
            <a className="mj-secondary-button" href="/repository">Explore the repository</a>
            <a className="mj-secondary-button" href="/contact">Contact us</a>
          </div>
          <p className="mj-company-hero-note">
            Built for researchers, quantum engineers, and R&amp;D teams who need more than plausible code.
          </p>
        </div>
        <div className="mj-company-hero-art" aria-label="Majorana product surfaces">
          <div className="mj-public-art-head">
            <span>MAJORANA / PRODUCT</span>
            <span className="mj-public-art-status">EVIDENCE FIRST</span>
          </div>
          <div className="mj-public-pipeline">
            {[
              ["01", "Repository", "Public algorithms and sources"],
              ["02", "Workspace", "LLM, Studio, and Library"],
              ["03", "Execute", "Simulation + verification"],
              ["04", "Compute", "QPU / GPU lanes planned"],
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
            <span>Quantum development, with context</span>
            <span className="font-mono">PUBLIC · PRIVATE · VERIFIED</span>
          </div>
        </div>
      </section>

      <section className="mj-company-section mj-company-intro" aria-labelledby="company-intro-heading">
        <div>
          <p className="mj-section-label">The company</p>
          <h2 id="company-intro-heading">Quantum development needs a place for evidence to live.</h2>
        </div>
        <p>
          The next generation of quantum software will not be built from isolated snippets alone.
          It will be built from research that can be inspected, experiments that can be repeated,
          and results whose assumptions remain visible. Majorana is building that connective layer.
        </p>
      </section>

      <section className="mj-company-section" aria-labelledby="surfaces-heading">
        <div className="mj-company-section-heading">
          <p className="mj-section-label">Products and services</p>
          <h2 id="surfaces-heading">One public foundation, one personal workbench, and a path to more compute.</h2>
        </div>
        <div className="mj-company-capability-list">
          <article>
            <span className="mj-company-index">01</span>
            <div>
              <h3>Public research database</h3>
              <p>Explore circuits and algorithms with classification, source context, verification boundaries, classical comparisons, and framework-aware code.</p>
            </div>
            <a className="mj-company-capability-note" href="/repository">Browse Repository ↗</a>
          </article>
          <article>
            <span className="mj-company-index">02</span>
            <div>
              <h3>Personal quantum workspace</h3>
              <p>Nameko turns natural language into a visible plan, generated implementation, simulation, verification, and saved Library artifact. Studio lets you inspect and continue the work.</p>
            </div>
            <a className="mj-company-capability-note" href="/workspace">See Workspace ↗</a>
          </article>
          <article>
            <span className="mj-company-index">03</span>
            <div>
              <h3>Future compute services</h3>
              <p>QPU access, GPU-heavy simulation, and other execution lanes are planned capabilities. Their cost, hardware, and attestation boundaries will be made explicit before launch.</p>
            </div>
            <span className="mj-company-capability-note">Planned · deferred</span>
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
          <p><strong>Personal by default.</strong> Every account gets its own workspace and Library. Collaboration is a future product decision, not a hidden default.</p>
          <p><strong>Open foundations, careful boundaries.</strong> Public research and public code stay distinct from private workspaces and credentials.</p>
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
