import type { Metadata } from "next";
import { PublicSite, REPOSITORY_URL } from "../../components/public-site";

export const metadata: Metadata = {
  title: "Workspace",
  description: "LeonaQ's personal quantum workspace for LLM-assisted development, Studio, and verified Library artifacts.",
};

export default function WorkspacePage() {
  return (
    <PublicSite activePath="/workspace" className="mj-open-source">
      <div className="mj-open-source-inner">
        <section className="mj-open-source-hero">
          <p className="mj-public-overline">Personal quantum workspace</p>
          <h1>Turn a quantum question into work you can reopen.</h1>
          <p className="mj-landing-copy">
            LeonaQ connects an LLM-guided workflow to a guarded simulator, verification evidence,
            Studio editing, and a personal Library. Every account starts with its own workspace;
            your prompts, runs, and saved artifacts are not shared with another user by default.
          </p>
          <div className="mj-landing-actions">
            <a className="mj-primary-button" href="/contact">Request workspace access</a>
            <a className="mj-secondary-button" href="/repository">Start from the repository</a>
          </div>
        </section>

        <section className="mj-open-source-section" aria-labelledby="workspace-flow-heading">
          <p className="mj-section-label">One personal loop</p>
          <h2 id="workspace-flow-heading">LLM, Studio, Library, and execution stay connected.</h2>
          <div className="mj-open-source-grid">
            <article className="mj-open-source-card">
              <span className="mj-open-source-kicker">01 / NAMEKO</span>
              <h3>Ask in natural language</h3>
              <p>Nameko plans, generates, simulates, verifies, explains, and keeps the user-facing answer readable. Internal structured records power the workflow without becoming the product surface.</p>
            </article>
            <article className="mj-open-source-card">
              <span className="mj-open-source-kicker">02 / STUDIO</span>
              <h3>Inspect and continue</h3>
              <p>Open a saved circuit, switch among available framework variants, edit the implementation, and send the next version through the same evidence path.</p>
            </article>
            <article className="mj-open-source-card">
              <span className="mj-open-source-kicker">03 / LIBRARY</span>
              <h3>Keep the record</h3>
              <p>Private artifacts keep code, run records, verification, exports, provenance, resources, and limitations together so yesterday’s work is useful tomorrow.</p>
            </article>
          </div>
        </section>

        <section className="mj-open-source-section" aria-labelledby="compute-heading">
          <p className="mj-section-label">Compute roadmap</p>
          <h2 id="compute-heading">Use the right execution lane when the product is ready.</h2>
          <div className="mj-open-source-circuits">
            <div><strong>CPU simulation</strong><span>Current supported path for small, reproducible verified workflows.</span></div>
            <div><strong>GPU simulation</strong><span>Planned heavy-compute lane for larger circuits; provider, limits, and cost are deferred.</span></div>
            <div><strong>QPU access</strong><span>Planned hardware lane with explicit estimates, attestation, and user confirmation before spend.</span></div>
          </div>
          <p className="mj-open-source-note">QPU and GPU execution are roadmap items, not available services in this early-access slice.</p>
        </section>

        <section className="mj-open-source-section mj-open-source-start" aria-labelledby="workspace-open-heading">
          <div>
            <p className="mj-section-label">Open foundations</p>
            <h2 id="workspace-open-heading">Review the engineering boundary.</h2>
            <p>The codebase is public for review, while authenticated workspaces, credentials, and saved artifacts remain account-scoped. Read the repository and contribution notes before building with the stack.</p>
            <a className="mj-text-link" href={REPOSITORY_URL} target="_blank" rel="noreferrer">View the public codebase ↗</a>
          </div>
          <pre><code>{`pnpm install
uv sync --all-packages
pnpm --filter @majorana/web dev`}</code></pre>
        </section>
      </div>
    </PublicSite>
  );
}
