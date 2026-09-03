import type { Metadata } from "next";
import { LeonaWordmark } from "../../../components/leona-wordmark";
import { LiquidGridBackground } from "../../../components/liquid-grid-background";
import { PublicSite } from "../../../components/public-site";
import { Reveal } from "../../../components/reveal";
import { ABOUT_COPY } from "../../../lib/about-copy";
import { parsePublicLocale, PUBLIC_LOCALES } from "../../../lib/public-locale";
import { canonicalMetadata } from "../../../lib/public-metadata";
import { aboutMetadataCopy } from "../../../lib/public-page-metadata";

export const revalidate = 300;
export const dynamicParams = false;

export function generateStaticParams() {
  return PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = parsePublicLocale((await params).locale);
  return { ...aboutMetadataCopy(locale), ...canonicalMetadata("/about") };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parsePublicLocale((await params).locale);
  const copy = ABOUT_COPY[locale];

  return (
    <PublicSite
      activePath="/about"
      className="mj-company-site mj-about-site"
      locale={locale}
      chrome="static"
    >
      <LiquidGridBackground />

      <section className="mj-about-hero" aria-labelledby="about-hero-heading">
        <div className="mj-about-hero-copy">
          <p className="mj-section-label">{copy.hero.label}</p>
          <h1 id="about-hero-heading">
            {copy.hero.title.split("\n").map((line) => (
              <span className="mj-about-hero-line" key={line}>{line}</span>
            ))}
          </h1>
          <p className="mj-about-hero-lede">{copy.hero.body}</p>
        </div>

        <div className="mj-about-signal" aria-hidden="true">
          <span className="mj-about-signal-ring mj-about-signal-ring--outer" />
          <span className="mj-about-signal-ring mj-about-signal-ring--inner" />
          <span className="mj-about-signal-axis mj-about-signal-axis--horizontal" />
          <span className="mj-about-signal-axis mj-about-signal-axis--vertical" />
          <LeonaWordmark className="lq-wordmark--about-signal" />
          {copy.hero.signal.map((label, index) => (
            <span className={`mj-about-signal-label mj-about-signal-label--${index + 1}`} key={label}>
              {label}
            </span>
          ))}
          <span className="mj-about-signal-pulse" />
        </div>

        <div className="mj-about-hero-foot" aria-hidden="true">
          <span>LEONA / QUANTUM SYSTEMS</span>
          <span>ABOUT / 2026</span>
        </div>
      </section>

      <Reveal>
        <section className="mj-about-section mj-about-manifesto" aria-labelledby="about-why-heading">
          <div className="mj-about-section-marker">
            <p className="mj-section-label">{copy.why.label}</p>
          </div>
          <div className="mj-about-section-copy">
            <h2 id="about-why-heading">{copy.why.title}</h2>
            <div className="mj-about-prose">
              {copy.why.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
          </div>
        </section>
      </Reveal>

      <section className="mj-about-section mj-about-build" aria-labelledby="about-build-heading">
        <Reveal>
          <div className="mj-about-build-heading">
            <p className="mj-section-label">{copy.build.label}</p>
            <h2 id="about-build-heading">{copy.build.title}</h2>
            <p>{copy.build.body}</p>
          </div>
        </Reveal>
        <div className="mj-about-flow">
          {copy.build.steps.map((step, index) => (
            <Reveal delay={index * 80} key={step.number}>
              <article className="mj-about-flow-step">
                <div className="mj-about-flow-step-head">
                  <span>{step.number}</span>
                  <span className="mj-about-flow-dot" aria-hidden="true" />
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal>
        <section className="mj-about-section mj-about-direction" aria-labelledby="about-direction-heading">
          <div className="mj-about-direction-copy">
            <p className="mj-section-label">{copy.direction.label}</p>
            <h2 id="about-direction-heading">{copy.direction.title}</h2>
            <div className="mj-about-prose">
              {copy.direction.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
          </div>
          <ul className="mj-about-audiences" aria-label={copy.direction.title}>
            {copy.direction.audiences.map((audience, index) => (
              <li key={audience}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {audience}
              </li>
            ))}
          </ul>
        </section>
      </Reveal>

      <section className="mj-about-section mj-about-team" aria-labelledby="about-team-heading">
        <Reveal>
          <div className="mj-about-team-heading">
            <p className="mj-section-label">{copy.team.label}</p>
            <h2 id="about-team-heading">{copy.team.title}</h2>
            <p>{copy.team.body}</p>
          </div>
        </Reveal>
        <div className="mj-about-team-grid">
          {copy.team.members.map((member, index) => (
            <Reveal delay={index * 90} key={member.name}>
              <article className="mj-about-person-card">
                <div className="mj-about-person-topline">
                  <span>{member.number}</span>
                  <span>{member.role}</span>
                </div>
                <div className="mj-about-person-name">
                  <h3>{member.name}</h3>
                  {member.romanName ? <span>{member.romanName}</span> : null}
                </div>
                <p className="mj-about-person-affiliation">{member.affiliation}</p>
                <p className="mj-about-person-bio">{member.bio}</p>
                <ul className="mj-about-person-focus" aria-label={`${member.name} — ${copy.team.focusLabel}`}>
                  {member.focus.map((focus) => <li key={focus}>{focus}</li>)}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mj-about-section mj-about-support" aria-labelledby="about-support-heading">
        <Reveal>
          <div className="mj-about-support-heading">
            <p className="mj-section-label">{copy.support.label}</p>
            <h2 id="about-support-heading">{copy.support.title}</h2>
          </div>
        </Reveal>
        <div className="mj-about-support-grid">
          {copy.support.items.map((item, index) => (
            <Reveal delay={index * 90} key={item.title}>
              <article className="mj-about-support-card">
                <span>{item.eyebrow}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal>
        <section className="mj-company-final-cta mj-about-cta" aria-labelledby="about-cta-heading">
          <div className="mj-company-final-cta-copy">
            <p className="mj-section-label">{copy.cta.label}</p>
            <h2 id="about-cta-heading">{copy.cta.title}</h2>
            <p>{copy.cta.body}</p>
          </div>
          <div className="mj-public-actions">
            <a className="mj-primary-button" href="/contact">{copy.cta.primary}</a>
            <a className="mj-secondary-button" href="/workspace">{copy.cta.secondary}</a>
          </div>
        </section>
      </Reveal>
    </PublicSite>
  );
}
