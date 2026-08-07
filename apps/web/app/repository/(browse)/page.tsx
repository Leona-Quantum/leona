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
import { RepositoryPreface } from "../../../components/repository-preface";
import { resolveBrowseParams } from "../../../lib/repository/browse-params";
import { RepositoryBrowser } from "../repository-browser";

export const metadata: Metadata = {
  title: "Atlas",
  description: "A public Leona Quantum research database for circuits and algorithms with evidence, sources, and export boundaries visible.",
};

/**
 * The Atlas browse page: a preface, then the controls over the corpus.
 *
 * Four deep links arrive here — `?topic=` from an entry page's chips, `?fits=`
 * from its interface panel, and since §0.5.1 `?category=` and `?gate=` from the
 * preface and the gate sidebar. `lib/repository/browse-params.ts` holds the one
 * rule all of them follow and the reason it is one function rather than four
 * ternaries.
 */
export default async function RepositoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // All four deep links in one call — see lib/repository/browse-params.ts for
  // the rule they share and for why `?category=` was the one that went two
  // sessions without an address.
  //
  // Resolved **here**, on the server, rather than from `window.location` in an
  // effect. The HTML then arrives already filtered, which is the only version a
  // crawler or a no-JS reader ever sees, and it is verifiable with `curl` rather
  // than a browser.
  //
  // Since s91 this is every control on the page, not four of them. `?q=`,
  // `?order=`, `?circuit=` and `?rows=` were client `useState` with no address,
  // which is the same defect `?category=` had: a reader could not bookmark a
  // sort, could not send one, and a crawler saw exactly one view of the
  // catalogue. The list is capped at `rows`, so the address of "the rest of it"
  // had to exist before the cap could ship — a cap with no link is a list with
  // rows nothing can reach.
  const {
    topic: initialTopic,
    stance: initialStance,
    category: initialCategory,
    gate: initialGate,
    query: initialQuery,
    order: initialOrder,
    circuitOnly: initialCircuitOnly,
    rows: initialRows,
  } = resolveBrowseParams(params);
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
        {/* Between the one-line hero and the controls, and it is deliberately
            above them: a reader who scrolls past it has still been told what
            these records are, and a reader who starts filtering does not need
            it. Rendered from `entries`, which is already in hand, so every
            number on it is counted rather than typed. */}
        <RepositoryPreface entries={entries} locale={locale} />
        <RepositoryBrowser
          entries={entries}
          locale={locale}
          isSignedIn={Boolean(user)}
          signInHref={signInHref}
          legend={<VerificationLegend locale={locale} />}
          estimates={estimates}
          profiles={profiles}
          initialTopic={initialTopic}
          initialStance={initialStance}
          initialCategory={initialCategory}
          initialGate={initialGate}
          initialQuery={initialQuery}
          initialOrder={initialOrder}
          initialCircuitOnly={initialCircuitOnly}
          initialRows={initialRows}
        />
      </section>
    </PublicSite>
  );
}
