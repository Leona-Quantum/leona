import type { Metadata } from "next";
import { CONTACT_MAILTO, PublicSite } from "../../components/public-site";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../../lib/auth";
import {
  PUBLIC_REPOSITORY_ENTRIES,
  PUBLIC_REPOSITORY_GUIDANCE,
} from "../../lib/public-repository";
import { getPublicLocale } from "../../lib/public-locale-server";
import { RepositoryBrowser } from "./repository-browser";

export const metadata: Metadata = {
  title: "Repository",
  description: "A public research database for circuits and algorithms with evidence, sources, and export boundaries visible.",
};

export default async function RepositoryPage() {
  const locale = await getPublicLocale();
  const { user } = await getMajoranaAuth();
  const signInHref = !user && isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : null;
  const isJapanese = locale === "ja";

  return (
    <PublicSite activePath="/repository" className="mj-repository-site" locale={locale} showLanguageToggle>
      <section className="mj-repository-index-hero" aria-labelledby="repository-heading">
        <h1 id="repository-heading">{isJapanese ? "公開研究データベース" : "Public research database"}</h1>
        <p>
          {isJapanese
            ? "回路とアルゴリズムを検索し、仕組み、シミュレーション、コード、出典、ライセンス、検証の境界を確認できます。"
            : "Search circuits and algorithms, then inspect how they work, what simulation shows, which code is available, and where source, license, and verification boundaries begin."}
        </p>
        <RepositoryBrowser
          entries={PUBLIC_REPOSITORY_ENTRIES}
          locale={locale}
          isSignedIn={Boolean(user)}
          signInHref={signInHref}
        />
      </section>

      <section className="mj-repository-legend" aria-labelledby="repository-legend-heading">
        <div>
          <p className="mj-section-label">{isJapanese ? "凡例" : "Legend"}</p>
          <h2 id="repository-legend-heading">{isJapanese ? "レコードの境界を読む" : "Read the record boundaries"}</h2>
        </div>
        <div className="mj-repository-legend-grid">
          <div><strong>Classification</strong><span>What kind of gate, state, operator, or algorithm the record describes.</span></div>
          <div><strong>Verification</strong><span>Which check passed for the stated conditions; it is not a universal correctness claim.</span></div>
          <div><strong>Export</strong><span>Native, converted, downloadable, or unsupported paths are kept distinct.</span></div>
          <div><strong>License / source</strong><span>The displayed source and license travel with the public reference; personal Library copies remain private.</span></div>
        </div>
      </section>

      <section className="mj-repository-guidance" aria-labelledby="repository-guidance-heading">
        <div>
          <p className="mj-section-label">{isJapanese ? "設計の参考" : "Catalog design reference"}</p>
          <h2 id="repository-guidance-heading">{isJapanese ? PUBLIC_REPOSITORY_GUIDANCE.titleJa : PUBLIC_REPOSITORY_GUIDANCE.title}</h2>
        </div>
        <div>
          <p>{isJapanese ? PUBLIC_REPOSITORY_GUIDANCE.descriptionJa : PUBLIC_REPOSITORY_GUIDANCE.description}</p>
          <a className="mj-text-link" href={PUBLIC_REPOSITORY_GUIDANCE.sourceUrl} target="_blank" rel="noreferrer">
            {PUBLIC_REPOSITORY_GUIDANCE.sourceLabel} ↗
          </a>
          <p className="mj-repository-deferred-note">
            {isJapanese
              ? "投稿、レビュー、公開、ライセンスの詳細ポリシーは、サービス化の前に確定します。"
              : "Submission, review, publication, and exact licensing policy are deferred until the catalog becomes a service-backed contribution flow."}
          </p>
          <a className="mj-secondary-button" href={CONTACT_MAILTO}>{isJapanese ? "出典を提案する" : "Suggest a source"}</a>
        </div>
      </section>
    </PublicSite>
  );
}
