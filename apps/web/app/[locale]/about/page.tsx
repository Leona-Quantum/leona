import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PublicSite } from "../../../components/public-site";
import { Reveal } from "../../../components/reveal";
import { ABOUT_COPY } from "../../../lib/about-copy";
import { parsePublicLocale, PUBLIC_LOCALES } from "../../../lib/public-locale";
import { canonicalMetadata } from "../../../lib/public-metadata";
import { aboutMetadataCopy } from "../../../lib/public-page-metadata";
import eshaanPortrait from "./images/eshaan.jpeg";
import ruiSuzukiPortrait from "./images/rui-suzuki.webp";
import watanabePortrait from "./images/watanabe.png";

export const revalidate = 300;
export const dynamicParams = false;

const TEAM_PORTRAITS = {
  "01": ruiSuzukiPortrait,
  "02": watanabePortrait,
  "03": eshaanPortrait,
} as const;

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
      <section className="mj-about-section mj-about-team" aria-labelledby="about-team-heading">
        <div className="mj-about-team-heading">
          <h1 id="about-team-heading">{copy.team.title}</h1>
        </div>
        <div className="mj-about-team-grid">
          {copy.team.members.map((member, index) => (
            <Reveal delay={index * 90} key={member.name}>
              <article className="mj-about-person-card">
                <div className="mj-about-person-portrait">
                  <Image
                    alt={copy.team.portraitAlt.replace("{name}", member.name)}
                    placeholder="blur"
                    sizes="(max-width: 720px) 90vw, (max-width: 1000px) 45vw, 350px"
                    src={TEAM_PORTRAITS[member.number]}
                  />
                </div>
                <div className="mj-about-person-content">
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
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal>
        <section className="lq-about-vision" aria-labelledby="about-vision-heading">
          <div className="lq-site-section-heading">
            <p className="mj-section-label">{copy.vision.label}</p>
            <h2 id="about-vision-heading">{copy.vision.title}</h2>
            <p>{copy.vision.lede}</p>
          </div>
          <ol className="lq-about-vision-list">
            {copy.vision.items.map((item, index) => (
              <li key={item.title}>
                <span className="lq-about-vision-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ol>
          <p className="lq-about-vision-close">{copy.vision.close}</p>
        </section>
      </Reveal>

      <Reveal>
        <section className="mj-company-final-cta mj-about-cta" aria-labelledby="about-cta-heading">
          <div className="mj-company-final-cta-copy">
            <p className="mj-section-label">{copy.cta.label}</p>
            <h2 id="about-cta-heading">{copy.cta.title}</h2>
            <p>{copy.cta.body}</p>
          </div>
          <div className="mj-public-actions">
            <Link className="mj-primary-button" href="/contact">{copy.cta.primary}</Link>
            <a className="mj-secondary-button" href="/run">{copy.cta.secondary}</a>
          </div>
        </section>
      </Reveal>
    </PublicSite>
  );
}
