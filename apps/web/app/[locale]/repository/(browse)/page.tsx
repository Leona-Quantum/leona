import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canonicalMetadata } from "../../../../lib/public-metadata";
import { PublicSite } from "../../../../components/public-site";
import { isPublicLocale, parsePublicLocale, PUBLIC_LOCALES } from "../../../../lib/public-locale";
import {
  getRepositoryEstimates,
  getRepositoryListEntries,
  getRepositoryProfiles,
} from "../../../../lib/repository-source";
import { VerificationLegend } from "../../../../components/repository-verification";
import { AboutTheAtlas } from "../../../../components/repository-preface";
import { resolveBrowseParams } from "../../../../lib/repository/browse-params";
import { RepositoryBrowser } from "../../../repository/repository-browser";

// Served from the CDN, not by being prerendered — same split as
// `layers/page.tsx` and for the same first reason: this page resolves
// `?topic=`, `?fits=`, `?category=`, `?gate=`, `?q=`, `?order=`, `?circuit=`
// and `?rows=` on the server, and reading `searchParams` opts a page out of
// static rendering unconditionally. `dynamicParams = false` is what stops
// `[locale]` from swallowing a mistyped one-segment URL and answering it with
// this page instead of a 404; `next.config.ts` attaches
// `Vercel-CDN-Cache-Control` here, exact-path only — this page does NOT also
// cover `/repository/<slug>`, which stays personalized and uncached in
// `app/repository/`.
//
// ## Why this page moved here at all
//
// It used to live at `app/repository/(browse)/page.tsx`, reading the locale
// from a cookie and calling `getMajoranaAuth()` for the "Add to Studio"
// button state — both Dynamic APIs, both making the whole route uncacheable,
// and the auth call is now not just costly but a plain bug at this address:
// `middleware.ts` answers a locale-rewritten path BEFORE the AuthKit gate
// ever runs (`localeRewrite()` returns before `workosMiddleware()` is
// reached), so `getMajoranaAuth()` -> `withAuth()` would THROW here, not
// merely personalize — see the same note on `claims/page.tsx`. The header's
// sign-in state now comes from `chrome="static"` + `<AuthStatus>` (ai-ops#94);
// the export button's now comes from `RepositoryBrowser`'s own client-side
// fetch to `/api/auth/session`. Neither reads auth during this render.
//
// `lib/routed-paths.ts` has the caching/routing side of this move — why
// `/repository` is now an exact `LOCALE_ROUTES` entry rather than folded into
// the `LOCALE_PREFIX_ROUTES` `repository` subtree, and why `/repository/<slug>`
// is unaffected by either.
export const dynamicParams = false;

export function generateStaticParams() {
  return PUBLIC_LOCALES.map((locale) => ({ locale }));
}

/**
 * Localised, for the reason `layers/page.tsx` already states: a static
 * English export here gives a Japanese reader an English title on the index
 * and a Japanese one on every entry page, and the inconsistency is the tell.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = parsePublicLocale((await params).locale);
  return {
    ...(locale === "ja"
      ? {
          title: "量子アトラス",
          description:
            "回路とアルゴリズムの公開研究データベース。各項目について、出典、どこまで検証されているか、そしてエクスポートの境界を明示しています。",
        }
      : {
          title: "The Quantum Atlas",
          description:
            "A public Leona Quantum research database for circuits and algorithms with evidence, sources, and export boundaries visible.",
        }),
    ...canonicalMetadata("/repository"),
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
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `dynamicParams = false` does NOT cover this page, even though it is set
  // above — that flag restricts params only on a route that prerenders, and
  // this one reads `searchParams` and therefore never does (see the file
  // header). So every locale is "outside the prerendered set" and Next
  // renders it regardless, exactly the trap `layers/page.tsx` documents and
  // guards against the same way: check first, before the catalog read starts
  // (a mistyped locale should cost a 404, not a corpus fetch), and guard here
  // rather than trust the segment config to have done it.
  const routeLocale = await params;
  if (!isPublicLocale(routeLocale.locale)) notFound();
  const locale = parsePublicLocale(routeLocale.locale);
  const searchParamsValue = await searchParams;
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
  } = resolveBrowseParams(searchParamsValue);
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
    <PublicSite
      activePath="/repository"
      className="mj-repository-site"
      locale={locale}
      // The full chrome with no per-visitor part in the server render — see
      // the file header for why `"full"` is not just costlier here but wrong:
      // `getMajoranaAuth()` would throw on this locale-rewritten path.
      chrome="static"
      showLanguageToggle
    >
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
        {/* Above the search bar, which is the order the owner specified: what
            this is, then the controls. The "four kinds" preface and the
            Ingredients shelf that used to sit between the two were removed
            from this page by owner instruction (ai-ops#94) — see the comment
            left in `repository-preface.tsx` for what that took with it.
            `repository-shelf.tsx`'s `IngredientShelf` is now unused rather
            than deleted, in case this is revisited. */}
        <AboutTheAtlas locale={locale} />
        <RepositoryBrowser
          entries={entries}
          locale={locale}
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
