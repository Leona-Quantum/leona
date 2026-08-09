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
import { AboutTheAtlas, RepositoryPreface } from "../../../components/repository-preface";
import { resolveBrowseParams } from "../../../lib/repository/browse-params";
import { RepositoryBrowser } from "../repository-browser";

/**
 * Localised, for the reason `layers/page.tsx:12-19` already states: a static
 * English export here gives a Japanese reader an English title on the index and
 * a Japanese one on every entry page, and the inconsistency is the tell. This
 * was the last public Atlas route still breaking that rule — its two siblings
 * (`layers/page.tsx`, `layers/[id]/page.tsx`) had both been converted. The page
 * reads the locale cookie anyway, so it costs nothing.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPublicLocale();
  return locale === "ja"
    ? {
        title: "量子アトラス",
        description:
          "回路とアルゴリズムの公開研究データベース。各項目について、出典、どこまで検証されているか、そしてエクスポートの境界を明示しています。",
      }
    : {
        title: "The Quantum Atlas",
        description:
          "A public Leona Quantum research database for circuits and algorithms with evidence, sources, and export boundaries visible.",
      };
}

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
        {/* > *"Atlas page title card something like 'The Quantum Atlas'."*
            > — owner, session 110
            >
            > *"the atlas description can be 1-2 short sentences."*

            The descriptive sentence that used to sit here is gone rather than
            shortened, and the box below is open rather than shut: two
            descriptions on one page is one that will drift, and the box is the
            one the owner specified the length of. `generateMetadata`'s
            description is unaffected — that is a different reader (a search
            result) and it is not on the page. */}
        <h1 id="repository-heading">{isJapanese ? "量子アトラス" : "The Quantum Atlas"}</h1>
        {/* Above the kinds and therefore above the search bar, which is the
            order the owner specified: what this is, then which kinds of record
            there are, then the controls. */}
        <AboutTheAtlas locale={locale} />
        {/* The four kinds, as links into their `?category=` sections. Its
            counted paragraphs went in session 110; what remains is navigation,
            and it still takes `entries` because the corpus is what decides
            which kinds exist. */}
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
