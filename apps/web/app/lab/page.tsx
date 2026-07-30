import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { BrandMark } from "../../components/icons";
import { getPublicLocale } from "../../lib/public-locale-server";
import { LAB_COPY } from "./lab-copy";

export const metadata: Metadata = {
  title: "Lab direction",
  description: "An alternative visual direction for the Leona Quantum landing page.",
};

/* Sample data, not a product claim. A Bell state prepared with H then CNOT is
 * ideally 50/50 across |00> and |11>; the residual weight on |01> and |10> is
 * what readout error on real hardware looks like. Shown so the panel displays
 * a real measurement rather than a decorative chart. */
const BELL_COUNTS = [
  { key: "00", pct: 48.4 },
  { key: "01", pct: 2.1 },
  { key: "10", pct: 2.6 },
  { key: "11", pct: 46.9 },
];

const IDEAL_AMPLITUDES = [
  { key: "|00›", amp: 0.7071 },
  { key: "|01›", amp: 0 },
  { key: "|10›", amp: 0 },
  { key: "|11›", amp: 0.7071 },
];

export default async function LabPage() {
  const locale = await getPublicLocale();
  const copy = LAB_COPY[locale];
  const peak = Math.max(...BELL_COUNTS.map((c) => c.pct));

  return (
    <>
      <nav className="lab-nav">
        <div className="lab-shell lab-nav-inner">
          <a className="lab-nav-brand" href="/lab">
            <BrandMark size={22} />
            <span>Leona Quantum</span>
          </a>
          <div className="lab-nav-links">
            <a href="/repository">{copy.nav.atlas}</a>
            <a href="/workspace">{copy.nav.workspace}</a>
            <a href="/pricing">{copy.nav.pricing}</a>
            <a href="/">{copy.nav.shipped}</a>
          </div>
        </div>
      </nav>

      <main className="lab-shell">
        {/* Hero: asymmetric split. Four text elements, no more. */}
        <section className="lab-hero">
          <div>
            <p className="lab-eyebrow lab-hero-eyebrow">{copy.hero.eyebrow}</p>
            <h1 className="lab-hero-title">
              {copy.hero.titleLead}
              <em>{copy.hero.titleEmphasis}</em>
              {copy.hero.titleTail}
            </h1>
            <p className="lab-hero-lede">{copy.hero.lede}</p>
            <div className="lab-hero-actions">
              <a className="lab-btn lab-btn--primary" href="/repository">
                {copy.hero.primary}
                <span className="lab-btn-arrow" aria-hidden="true">→</span>
              </a>
              <a className="lab-btn lab-btn--ghost" href="/workspace">
                {copy.hero.secondary}
              </a>
            </div>
          </div>

          {/* Instrument panel: a real circuit diagram and a real distribution,
              not a div mockup of a product screenshot. */}
          <div className="lab-panel lab-hero-panel">
            <div className="lab-panel-bar lab-mono">
              <span>{copy.panel.file}</span>
              <span>{copy.panel.qubits}</span>
            </div>
            <div className="lab-panel-body">
              <svg
                className="lab-circuit"
                viewBox="0 0 320 96"
                role="img"
                aria-label={
                  locale === "ja"
                    ? "量子回路。量子ビット0にアダマールゲート、続いて量子ビット0から1への制御NOTゲート、最後に両方の量子ビットを測定。"
                    : "Quantum circuit: a Hadamard gate on qubit zero, then a controlled-NOT from qubit zero to qubit one, followed by measurement of both qubits."
                }
              >
                <text className="lab-circuit-label" x="0" y="32">q0</text>
                <text className="lab-circuit-label" x="0" y="80">q1</text>
                <line className="lab-circuit-wire" x1="26" y1="28" x2="320" y2="28" />
                <line className="lab-circuit-wire" x1="26" y1="76" x2="320" y2="76" />

                {/* H on q0 */}
                <rect className="lab-circuit-gate" x="56" y="12" width="32" height="32" />
                <text className="lab-circuit-glyph" x="67" y="33">H</text>

                {/* CNOT: control on q0, target on q1 */}
                <line className="lab-circuit-wire" x1="140" y1="28" x2="140" y2="76" />
                <circle className="lab-circuit-node" cx="140" cy="28" r="4.5" />
                <circle className="lab-circuit-target" cx="140" cy="76" r="12" />
                <line className="lab-circuit-cross" x1="140" y1="64" x2="140" y2="88" />

                {/* measurement */}
                <rect className="lab-circuit-gate" x="212" y="12" width="32" height="32" />
                <text className="lab-circuit-glyph" x="222" y="33">M</text>
                <rect className="lab-circuit-gate" x="212" y="60" width="32" height="32" />
                <text className="lab-circuit-glyph" x="222" y="81">M</text>
              </svg>

              <div className="lab-hist">
                {BELL_COUNTS.map((count) => (
                  <div className="lab-hist-col" key={count.key}>
                    <span className="lab-hist-val lab-mono">{count.pct}%</span>
                    <span
                      className="lab-hist-bar"
                      data-weak={count.pct < 10 ? "true" : undefined}
                      style={{ height: `${(count.pct / peak) * 100}%` }}
                    />
                    <span className="lab-hist-key lab-mono">|{count.key}›</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="lab-panel-foot lab-mono">
              <span>{copy.panel.shots}</span>
              <span>{copy.panel.sample}</span>
            </div>
          </div>
        </section>

        {/* Statement: its own layout family. No eyebrow, no card, no columns. */}
        <section className="lab-statement lab-rise">
          <p>
            {copy.statement.lead}
            <span>{copy.statement.tail}</span>
          </p>
        </section>

        {/* Pipeline: hairline instrument strip. Stage names are the labels; no
            "Stage 1 / Stage 2" numbering. */}
        <section className="lab-pipeline" aria-labelledby="lab-pipeline-heading">
          <h2 id="lab-pipeline-heading" className="lab-section-title lab-rise">
            {copy.pipeline.heading}
          </h2>
          <div className="lab-pipeline-track lab-rise">
            {copy.pipeline.stages.map((stage) => (
              <article className="lab-pipeline-stage" key={stage.title}>
                <div className="lab-pipeline-tick" aria-hidden="true" />
                <h3>{stage.title}</h3>
                <p>{stage.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Evidence: asymmetric grid, exactly three cells for three points. */}
        <section className="lab-evidence" aria-labelledby="lab-evidence-heading">
          <p className="lab-eyebrow lab-rise">{copy.evidence.eyebrow}</p>
          <h2 id="lab-evidence-heading" className="lab-rise">
            {copy.evidence.heading}
          </h2>
          <div className="lab-evidence-grid lab-rise">
            <article className="lab-cell lab-cell--lead">
              <h3>{copy.evidence.lead.title}</h3>
              <p>{copy.evidence.lead.body}</p>
              <ul className="lab-readout">
                {IDEAL_AMPLITUDES.map((row) => (
                  <li key={row.key}>
                    <span className="lab-readout-key lab-mono">{row.key}</span>
                    {/* The amplitude rides on a custom property, not on an
                        inline transform. The scroll-driven `lab-grow-x`
                        animates `transform` with fill-mode `both`, and an
                        animation beats an inline style — so every meter used to
                        settle at scaleX(1), including the two rows whose printed
                        value is 0.0000. A measurement visual that draws zero as
                        a full bar is the one thing this page must not do. */}
                    <span
                      className="lab-readout-meter"
                      style={{ "--lab-amp": String(row.amp || 0.004) } as CSSProperties}
                      aria-hidden="true"
                    />
                    <span className="lab-readout-val lab-mono">{row.amp.toFixed(4)}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="lab-cell">
              <span className="lab-metric lab-mono">{copy.evidence.metric.value}</span>
              <h3>{copy.evidence.metric.title}</h3>
              <p>{copy.evidence.metric.body}</p>
            </article>

            <article className="lab-cell">
              <h3>{copy.evidence.backend.title}</h3>
              <p>{copy.evidence.backend.body}</p>
            </article>
          </div>
        </section>

        <section className="lab-cta">
          <h2>{copy.cta.heading}</h2>
          <div className="lab-cta-actions">
            <a className="lab-btn lab-btn--primary" href="/repository">
              {copy.cta.primary}
              <span className="lab-btn-arrow" aria-hidden="true">→</span>
            </a>
            <a className="lab-btn lab-btn--ghost" href="/contact">
              {copy.cta.secondary}
            </a>
          </div>
        </section>

        <footer className="lab-foot lab-mono">
          <span>&copy; 2026 Leona Quantum</span>
          <span>{copy.foot.note}</span>
        </footer>
      </main>
    </>
  );
}
