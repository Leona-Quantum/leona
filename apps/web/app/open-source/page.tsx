import type { Metadata } from "next";
import { PublicSite, REPOSITORY_URL } from "../../components/public-site";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Open source",
  description: "The public engineering page for Majorana's verified quantum workbench.",
};

export default function OpenSourcePage() {
  return (
    <PublicSite activePath="/open-source" className="mj-open-source">
      <div className="mj-open-source-inner">
        <section className="mj-open-source-hero">
          <h1>Quantum work you can inspect, run, and reuse.</h1>
          <p className="mj-landing-copy">
            Majorana connects a natural-language LLM workflow to a guarded circuit sandbox,
            evidence-backed verification, Studio editing, and a durable artifact Library.
            The source is public so the boundary between model output and measured evidence
            can be reviewed by the people who use it.
          </p>
          <div className="mj-landing-actions">
            <a className="mj-primary-button" href={REPOSITORY_URL} target="_blank" rel="noreferrer">View the repository ↗</a>
            <a className="mj-secondary-button" href="/repository">Browse verified entries</a>
          </div>
        </section>

        <section className="mj-open-source-section" aria-labelledby="connections-heading">
          <p className="mj-section-label">Connected by design</p>
          <h2 id="connections-heading">One circuit, one evidence trail.</h2>
          <div className="mj-open-source-grid">
            <article className="mj-open-source-card">
              <span className="mj-open-source-kicker">01 / LLM</span>
              <h3>Natural language to implementation</h3>
              <p>Provider-routed planning, generation, repair, and analysis turn a question into copyable code without exposing internal plumbing as the product surface.</p>
            </article>
            <article className="mj-open-source-card">
              <span className="mj-open-source-kicker">02 / SANDBOX</span>
              <h3>Execution with a hard boundary</h3>
              <p>Untrusted generated code runs in the Vercel Sandbox with explicit deny-all egress. The control plane keeps credentials and persistence outside the sandbox.</p>
            </article>
            <article className="mj-open-source-card">
              <span className="mj-open-source-kicker">03 / STUDIO</span>
              <h3>Edit the same artifact you verified</h3>
              <p>Studio opens saved versions, keeps framework variants copyable, and sends edits back through the same verification and Library path.</p>
            </article>
          </div>
        </section>

        <section className="mj-open-source-section" aria-labelledby="circuits-heading">
          <p className="mj-section-label">Circuit coverage</p>
          <h2 id="circuits-heading">Start with the three frameworks people reach for.</h2>
          <div className="mj-open-source-circuits">
            <div><strong>Qiskit</strong><span>Default executable path · Aer simulation · OpenQASM export</span></div>
            <div><strong>PennyLane</strong><span>Native differentiable circuit variant from the canonical IR</span></div>
            <div><strong>Cirq</strong><span>Native circuit variant with explicit export status and limitations</span></div>
          </div>
          <p className="mj-open-source-note">Each path is covered by deterministic connector tests and the hosted acceptance flow. A verified run remains the source of truth for measurements.</p>
        </section>

        <section className="mj-open-source-section mj-open-source-start" aria-labelledby="start-heading">
          <div>
            <p className="mj-section-label">Build with us</p>
            <h2 id="start-heading">Run the stack locally.</h2>
            <p>Read the architecture and verification notes in the repository, then start the web surface and Python workspace from the repo root.</p>
          </div>
          <pre><code>{`pnpm install
uv sync --all-packages
pnpm --filter @majorana/web dev`}</code></pre>
        </section>
      </div>
    </PublicSite>
  );
}
