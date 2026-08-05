import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../../../lib/auth";
import { getPublicLocale } from "../../../lib/public-locale-server";
import {
  getRepositoryEstimates,
  getRepositoryListEntries,
  getRepositoryProfiles,
} from "../../../lib/repository-source";
import { getStandardVqeCatalog } from "../../../lib/atlas-vqe/standard-source";
import { getPrivateMvpCapabilityManifest } from "../../../lib/atlas-vqe/private-mvp-source";
import { VerificationLegend } from "../../../components/repository-verification";
import { isTopicId } from "../../../lib/repository/topics";
import { AtlasContentSwitch } from "../atlas-content-switch";

export const metadata: Metadata = {
  title: "Atlas",
  description: "A public Leona Quantum research database for circuits and algorithms with evidence, sources, and export boundaries visible.",
};

/**
 * `/repository?topic=chemistry` — where an entry page's topic chips point.
 *
 * Resolved **here**, on the server, rather than from `window.location` in an
 * effect. This page does not hydrate in either browser surface — confirmed
 * again this session against a production build, so it is not the dev-mode CSP
 * — and an effect that never runs is a link that silently does nothing. Reading
 * it server-side means the HTML arrives already filtered, which is also the
 * only version of this a crawler or a no-JS reader ever sees.
 *
 * An unknown id resolves to no filter rather than to an empty list: a retired
 * topic in an old bookmark should show the corpus, not a blank page.
 */
export default async function RepositoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const wanted = (await searchParams).topic;
  const initialTopic = typeof wanted === "string" && isTopicId(wanted) ? wanted : "";
  const locale = await getPublicLocale();
  const { user } = await getMajoranaAuth();
  const signInHref = !user && isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : null;
  const isJapanese = locale === "ja";
  const vqeCatalog = getStandardVqeCatalog();
  const vqeCapabilityManifest = getPrivateMvpCapabilityManifest();
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
        <AtlasContentSwitch
          entries={entries}
          vqeCatalog={vqeCatalog}
          vqeCapabilityManifest={vqeCapabilityManifest}
          locale={locale}
          isSignedIn={Boolean(user)}
          signInHref={signInHref}
          legend={<VerificationLegend locale={locale} />}
          estimates={estimates}
          profiles={profiles}
          initialTopic={initialTopic}
        />
      </section>
    </PublicSite>
  );
}
