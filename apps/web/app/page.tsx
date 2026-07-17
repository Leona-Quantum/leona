import type { Metadata } from "next";
import { CircuitBand } from "../components/circuit-band";
import { BrandMark } from "../components/icons";
import { LeoConstellation } from "../components/leo-constellation";
import { PublicSite } from "../components/public-site";
import { Reveal } from "../components/reveal";
import { HOME_COPY } from "../lib/public-copy";
import { getPublicLocale } from "../lib/public-locale-server";

export const metadata: Metadata = {
  title: "Leona Quantum",
  description: "Leona Quantum connects public research, private workspaces, and verifiable quantum execution.",
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
            {copy.hero.title.split(" ").map((word, index) => (
              // The joining space lives outside the inline-block span — trailing
              // whitespace inside one is trimmed and the words would run together.
              <span key={`${word}-${index}`}>
                {index > 0 ? " " : ""}
                <span className="mj-hero-word" style={{ animationDelay: `${index * 90}ms` }}>{word}</span>
              </span>
            ))}
          </h1>
          <p className="mj-company-hero-lede">{copy.hero.lede}</p>
          <div className="mj-public-actions">
            <a className="mj-primary-button" href="/repository">{copy.hero.primary}</a>
            <a className="mj-secondary-button" href="/workspace">{copy.hero.secondary}</a>
            <a className="mj-text-link" href="/contact">{copy.hero.contact} ↗</a>
          </div>
          <p className="mj-company-hero-note">{copy.hero.note}</p>
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
      </section>

      <Reveal>
        <section className="mj-company-section mj-company-intro" aria-labelledby="company-intro-heading">
          <div>
            <p className="mj-section-label">{copy.intro.label}</p>
            <h2 id="company-intro-heading">{copy.intro.title}</h2>
          </div>
          <p>{copy.intro.body}</p>
        </section>
      </Reveal>

      <Reveal>
        <CircuitBand />
      </Reveal>

      <section className="mj-company-section mj-company-product-band" aria-labelledby="surfaces-heading">
        <div className="mj-company-section-heading">
          <p className="mj-section-label">{copy.product.label}</p>
          <h2 id="surfaces-heading">{copy.product.title}</h2>
        </div>
        <div className="mj-company-capability-list">
          {copy.product.items.map((item, index) => (
            <Reveal key={item.index} delay={index * 90}>
              <article>
                <span className="mj-company-index">{item.index}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
                <a className="mj-company-capability-note" href={index === 0 ? "/repository" : index === 1 ? "/workspace" : "/contact"}>
                  {item.action} ↗
                </a>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

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

      <Reveal>
        <section className="mj-company-final-cta" aria-labelledby="company-cta-heading">
          <div>
            <p className="mj-section-label">{copy.cta.label}</p>
            <h2 id="company-cta-heading">{copy.cta.title}</h2>
          </div>
          <div className="mj-public-actions">
            <a className="mj-primary-button" href="/contact">{copy.cta.contact}</a>
            <a className="mj-secondary-button" href="/pricing">{copy.cta.pricing}</a>
          </div>
        </section>
      </Reveal>
    </PublicSite>
  );
}
