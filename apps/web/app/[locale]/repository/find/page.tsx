// Proposal 2 (owner-approved 2026-09-20): "Atlas as the way in — from a
// problem to candidate methods". A reader states a problem and some limits;
// the Atlas returns the methods that fit, each with its cost as recorded, its
// advantage regime where one is stated, and its source, with actions to open
// the record, open it in Studio, or ask about it in Run.
//
// Served from the CDN by being prerendered outright — the `claims`/`papers`
// recipe (see those two files), not the `layers` one. This page reads no
// `searchParams`: every filter (problem, query, qubit/depth limits, hardware
// era) is client-side React state inside `AtlasMethodFinder`, so the render
// is identical for every visitor and `dynamicParams = false` actually holds.
// A shareable deep link to one filtered view is a real gap this leaves open —
// see the PR description for what is and is not done.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canonicalMetadata } from "../../../../lib/public-metadata";
import { PublicSite } from "../../../../components/public-site";
import { isPublicLocale, parsePublicLocale, PUBLIC_LOCALES } from "../../../../lib/public-locale";
import { getRepositoryEstimates, getRepositoryListEntries } from "../../../../lib/repository-source";
import {
  buildFinderRecord,
  estimatesBySlug,
  finderProblemOptions,
  type FinderRecord,
} from "../../../../lib/repository/finder.ts";
import { resolveWorkedExamples } from "../../../../lib/repository/worked-example-resolution.ts";
import { AtlasMethodFinder } from "../../../../components/atlas-method-finder";

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
  return {
    ...(locale === "ja"
      ? {
          title: "問題に合う手法を探す",
          description:
            "問題と制約（量子ビット数、深さ、誤り予算、想定ハードウェア）を入力すると、実際に記載された条件に一致する手法を、根拠と出典つきで返します。",
        }
      : {
          title: "Find a method for your problem",
          description:
            "State a problem and your limits — qubits, depth, error budget, NISQ or fault-tolerant — and get back the methods that fit, each with its stated cost, its source, and why it matched.",
        }),
    ...canonicalMetadata("/repository/find"),
  };
}

export default async function RepositoryFindPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // Same belt-and-suspenders guard `papers/page.tsx` and `claims/page.tsx`
  // use: `dynamicParams = false` already keeps an unknown locale out of the
  // prerendered set, but this page reads no searchParams either, so nothing
  // stops the guard here from actually running before any corpus fetch.
  const routeLocale = await params;
  if (!isPublicLocale(routeLocale.locale)) notFound();
  const locale = parsePublicLocale(routeLocale.locale);

  // The same two reads the browse page already does, concurrently — see
  // `(browse)/page.tsx`. `estimates` is null both when the catalog API is off
  // (`MAJORANA_PUBLIC_CATALOG_API` unset) and when it is on but unreachable;
  // `AtlasMethodFinder` cannot tell those apart and does not try to — either
  // way the fault-tolerant limit reports "the estimator is not wired" rather
  // than excluding anything on a guess (lib/repository/finder.ts).
  const [entries, estimates] = await Promise.all([getRepositoryListEntries(), getRepositoryEstimates()]);
  const estimateMap = estimatesBySlug(estimates);

  // Resolved here because `resolveWorkedExamples` reaches `worked-examples.ts`
  // (all 21 examples' full step lists) and that module's own header says to
  // import it only from a Server Component — a client module pulling it in
  // would ship every example to every visitor of this page, not just the ones
  // whose hero they open. Only the id survives into `FinderRecord`.
  const records: FinderRecord[] = entries.map((entry) =>
    buildFinderRecord(entry, estimateMap.get(entry.slug) ?? null, resolveWorkedExamples(entry.slug).hero?.id ?? null),
  );
  const problemOptions = finderProblemOptions(records);

  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-finder-site"
      locale={locale}
      // The full chrome with no per-visitor part in the server render — see
      // the same note on `claims/page.tsx` and `papers/page.tsx`: `"full"`
      // would call `getMajoranaAuth()`, which THROWS on this locale-rewritten
      // path because `localeRewrite()` answers before AuthKit's middleware
      // runs. Sign-in state for the Studio action comes from
      // `AtlasMethodFinder`'s own client-side fetch to `/api/auth/session`,
      // the same move `RepositoryBrowser` and `AtlasWorkedExample` make.
      chrome="static"
      showLanguageToggle
    >
      <AtlasMethodFinder
        locale={locale}
        records={records}
        problemOptions={problemOptions}
        estimatesAvailable={estimates !== null}
      />
    </PublicSite>
  );
}
