import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../../../lib/auth";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getRepositoryListEntries } from "../../../lib/repository-source";
import { getStandardVqeCatalog } from "../../../lib/atlas-vqe/standard-source";
import { VerificationLegend } from "../../../components/repository-verification";
import { AtlasContentSwitch } from "../atlas-content-switch";

export const metadata: Metadata = {
  title: "Atlas",
  description: "A public Leona Quantum research database for circuits and algorithms with evidence, sources, and export boundaries visible.",
};

export default async function RepositoryPage() {
  const locale = await getPublicLocale();
  const { user } = await getMajoranaAuth();
  const signInHref = !user && isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : null;
  const isJapanese = locale === "ja";
  const entries = await getRepositoryListEntries();
  const vqeCatalog = getStandardVqeCatalog();

  return (
    <PublicSite activePath="/repository" className="mj-repository-site" locale={locale} showLanguageToggle>
      <section className="mj-repository-index-hero" aria-labelledby="repository-heading">
        <h1 id="repository-heading">{isJapanese ? "公開研究データベース" : "Public research database"}</h1>
        <p>
          {isJapanese
            ? "回路とアルゴリズムを検索し、仕組み、シミュレーション、コード、出典、ライセンス、検証の境界を確認できます。"
            : "Search circuits and algorithms, then inspect how they work, what simulation shows, which code is available, and where source, license, and verification boundaries begin."}
        </p>
        <AtlasContentSwitch
          entries={entries}
          vqeCatalog={vqeCatalog}
          locale={locale}
          isSignedIn={Boolean(user)}
          signInHref={signInHref}
          legend={<VerificationLegend locale={locale} />}
        />
      </section>
    </PublicSite>
  );
}
