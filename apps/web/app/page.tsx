import type { Metadata } from "next";
import { CircuitBand } from "../components/circuit-band";
import { BrandMark } from "../components/icons";
import { LeoConstellation } from "../components/leo-constellation";
import { PublicSite } from "../components/public-site";
import { Reveal } from "../components/reveal";
import { ScrollCue } from "../components/scroll-cue";
import { HOME_COPY } from "../lib/public-copy";
import { getPublicLocale } from "../lib/public-locale-server";

export const metadata: Metadata = {
  title: "Leona Quantum",
  description: "Generate, optimize, and use quantum circuits with AI in one platform.",
};

export default async function Home() {
  const locale = await getPublicLocale();
  const copy = HOME_COPY[locale];
  return (
    <PublicSite activePath="/" className="mj-company-site" locale={locale}>
      {/* Centered hero over the constellation, with the live pipeline as a
          full-width band beneath — the owner retired the old split
          left-copy/right-card composition (Owner Inbox 2026-07-17). */}
      <section className="mj-company-hero">
        <LeoConstellation className="mj-company-constellation" />
        <div className="mj-company-hero-copy">
          <h1 className="mj-company-hero-title">
            {copy.hero.title.split("\n").map((line, lineIndex) => (
              <span className="mj-company-hero-title-line" key={line}>
                {line.split(" ").map((word, wordIndex) => (
                  // The joining space lives outside the inline-block span — trailing
                  // whitespace inside one is trimmed and the words would run together.
                  <span key={`${word}-${wordIndex}`}>
                    {wordIndex > 0 ? " " : ""}
                    <span className="mj-hero-word" style={{ animationDelay: `${(lineIndex + wordIndex) * 90}ms` }}>{word}</span>
                  </span>
                ))}
              </span>
            ))}
          </h1>
          <p className="mj-company-hero-lede">{copy.hero.lede}</p>
          <div className="mj-public-actions">
            <a className="mj-primary-button" href="/workspace">{copy.hero.primary}</a>
            <a className="mj-secondary-button" href="/repository">{copy.hero.secondary}</a>
            <a className="mj-text-link" href="/contact">{copy.hero.contact} ↗</a>
          </div>
        </div>
        <div className="mj-company-pipeline-band" aria-label={copy.visual.label}>
          <div className="mj-public-art-head">
            <span>{copy.visual.label}</span>
            <span className="mj-public-art-status">{copy.visual.status}</span>
          </div>
          <div className="mj-company-pipeline-flow">
            <div className="mj-company-hero-orbit" aria-hidden="true">
              <span className="mj-company-orbit-ring mj-company-orbit-ring--one" />
              <span className="mj-company-orbit-ring mj-company-orbit-ring--two" />
              <BrandMark size={72} />
              <span className="mj-company-orbit-dot mj-company-orbit-dot--one" />
              <span className="mj-company-orbit-dot mj-company-orbit-dot--two" />
            </div>
            <div className="mj-public-pipeline mj-public-pipeline--live mj-public-pipeline--row">
              {copy.visual.pipeline.map((step, index) => (
                <div className="mj-public-pipeline-step" key={step.number}>
                  <span className="mj-public-pipeline-number">{step.number}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                  {index < copy.visual.pipeline.length - 1 ? <span className="mj-public-pipeline-line" aria-hidden="true" /> : null}
                </div>
              ))}
            </div>
          </div>
          <div className="mj-public-art-foot">
            <span>{copy.visual.footer}</span>
            <span className="font-mono">{copy.visual.meta}</span>
          </div>
        </div>
        <ScrollCue href="#company-intro-heading" targetId="company-intro-heading">
          <span>{copy.hero.scrollCue}</span>
          <span className="mj-company-scroll-cue-chevron" aria-hidden="true">⌄</span>
        </ScrollCue>
      </section>

      <Reveal>
        {/* Intro. The Measure widget moved to the contact page (Owner Inbox
            2026-07-19) so the landing stays calm and text-light. */}
        <section className="mj-company-section mj-company-intro" aria-labelledby="company-intro-heading">
          <div className="mj-company-intro-copy">
            <p className="mj-section-label">{copy.intro.label}</p>
            <h2 id="company-intro-heading">{copy.intro.title}</h2>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <CircuitBand />
      </Reveal>

      <section className="mj-company-section mj-company-product-band" aria-labelledby="surfaces-heading">
        <Reveal>
          <div className="mj-company-section-heading">
            <p className="mj-section-label">{copy.product.label}</p>
            <h2 id="surfaces-heading">{copy.product.title}</h2>
          </div>
        </Reveal>
        <div className="mj-company-capability-list">
          {copy.product.items.map((item, index) => (
            <Reveal key={item.index} delay={index * 90}>
              <article>
                <span className="mj-company-index">{item.index}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
                <a className="mj-company-capability-note" href={item.href}>
                  {item.action} ↗
                </a>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal>
        <section className="mj-company-section mj-company-detail" aria-labelledby="atlas-heading">
          <div>
            <p className="mj-section-label">{copy.atlas.label}</p>
            <h2 id="atlas-heading">{copy.atlas.title}</h2>
          </div>
          <div className="mj-company-detail-copy">
            <p>{copy.atlas.body}</p>
            <a className="mj-text-link" href="/repository">{copy.atlas.action} ↗</a>
          </div>
        </section>
      </Reveal>

      <section className="mj-company-section mj-company-trace" aria-labelledby="trace-heading">
        <Reveal>
          <div className="mj-company-section-heading mj-company-trace-heading">
            <p className="mj-section-label">{copy.trace.label}</p>
            <h2 id="trace-heading">{copy.trace.title}</h2>
            <p>{copy.trace.body}</p>
          </div>
        </Reveal>
        <div className="mj-company-fact-grid">
          {copy.trace.items.map((item, index) => (
            <Reveal key={item.title} delay={index * 60}>
              <article className="mj-company-fact-card">
                <span className="mj-company-index">{String(index + 1).padStart(2, "0")}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal>
        <section className="mj-company-section mj-company-detail" aria-labelledby="frameworks-heading">
          <div>
            <p className="mj-section-label">{copy.frameworks.label}</p>
            <h2 id="frameworks-heading">{copy.frameworks.title}</h2>
          </div>
          <div className="mj-company-detail-copy">
            <p>{copy.frameworks.body}</p>
            <ul className="mj-company-framework-list" aria-label={copy.frameworks.title}>
              {copy.frameworks.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>
      </Reveal>

      {copy.principles ? (
        <section className="mj-company-section mj-company-principles" aria-labelledby="principles-heading">
          <Reveal>
            <div>
              <p className="mj-section-label">{copy.principles.label}</p>
              <h2 id="principles-heading">{copy.principles.title}</h2>
            </div>
          </Reveal>
          <div className="mj-company-principle-grid">
            {copy.principles.items.map((item, index) => (
              <Reveal key={item.title} delay={index * 90}>
                <article className="mj-company-principle-card">
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>
      ) : null}

      <Reveal>
        <section className="mj-company-final-cta" aria-labelledby="company-cta-heading">
          <div className="mj-company-final-cta-copy">
            <p className="mj-section-label">{copy.cta.label}</p>
            <h2 id="company-cta-heading">{copy.cta.title}</h2>
            <p>{copy.cta.body}</p>
          </div>
          <div className="mj-public-actions">
            <a className="mj-primary-button" href="/workspace">{copy.cta.primary}</a>
            <a className="mj-secondary-button" href="/repository">{copy.cta.secondary}</a>
          </div>
        </section>
      </Reveal>
    </PublicSite>
  );
}
