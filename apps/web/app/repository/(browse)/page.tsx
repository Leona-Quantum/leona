import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../../../lib/auth";
import { getPublicLocale } from "../../../lib/public-locale-server";
import {
  getRepositoryEstimates,
  getRepositoryListEntries,
  getRepositoryProfiles,
} from "../../../lib/repository-source";
import { VerificationLegend } from "../../../components/repository-verification";
import { RepositoryBrowser } from "../repository-browser";

export const metadata: Metadata = {
  title: "Atlas",
  description: "A public Leona Quantum research database for circuits and algorithms with evidence, sources, and export boundaries visible.",
};

export default async function RepositoryPage() {
  const locale = await getPublicLocale();
  const { user } = await getMajoranaAuth();
  const signInHref = !user && isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : null;
  const isJapanese = locale === "ja";
  // One request each for the whole corpus's cost and its circuit structure, and
  // concurrently with the listing — they share no inputs, so awaiting them in
  // sequence would put three round trips end to end on every browse render.
  //
  // Cost carries one assumption set stated once on the payload; the profile
  // listing carries none, because a profile is a property of the circuit and
  // every row is rankable against every other unconditionally. Either being null
  // (the catalog API off) removes its own ordering options rather than showing
  // options that rank nothing.
  const [entries, estimates, profiles] = await Promise.all([
    getRepositoryListEntries(),
    getRepositoryEstimates(),
    getRepositoryProfiles(),
  ]);

  return (
    <PublicSite activePath="/repository" className="mj-repository-site" locale={locale} showLanguageToggle>
      <section className="mj-repository-index-hero" aria-labelledby="repository-heading">
        <h1 id="repository-heading">{isJapanese ? "公開研究データベース" : "Public research database"}</h1>
        <p>
          {isJapanese
            ? "回路とアルゴリズムを検索し、仕組み、シミュレーション結果、コード、出典、ライセンス、どこまで検証済みかを確認できます。"
            : "Search circuits and algorithms, then inspect how they work, what simulation shows, which code is available, and where source, license, and verification boundaries begin."}
        </p>
        <RepositoryBrowser
          entries={entries}
          locale={locale}
          isSignedIn={Boolean(user)}
          signInHref={signInHref}
          legend={<VerificationLegend locale={locale} />}
          estimates={estimates}
          profiles={profiles}
        />
      </section>
    </PublicSite>
  );
}
