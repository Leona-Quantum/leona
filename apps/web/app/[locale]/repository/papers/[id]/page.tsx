// One paper, at one address.
//
// The segment is `paperSlug(id)`, not the id: a `PaperId` carries a `:` and,
// for every pre-2007 arXiv id and every DOI, a `/` — and a segment containing a
// slash is two segments. `validatePaperRegister` checks the whole register
// round-trips through the mapping and that no two rows claim one segment, so a
// collision fails the build rather than serving one paper at another's address.
//
// Served from the CDN by being prerendered outright, on the `layers/[id]`
// recipe minus the `searchParams` half of it: this page reads none, so unlike
// its neighbour it genuinely prerenders — one static page per paper per
// locale, all ~241+ of them (`PAPER_REGISTER` is a hand-authored, committed
// file with no generator to re-run; see its own header). `dynamicParams =
// false` restricts BOTH segments here for real, because this route actually
// prerenders: an unknown `[locale]` or an unknown `[id]` 404s at the routing
// layer, and the `notFound()` call below stays as the honest answer for an id
// that parses but that the register and the corpus lookups then disagree
// about.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canonicalMetadata } from "../../../../../lib/public-metadata";
import { PublicSite } from "../../../../../components/public-site";
import { PaperView } from "../../../../../components/repository-papers";
import { parsePublicLocale, PUBLIC_LOCALES } from "../../../../../lib/public-locale";
import { getRepositoryEntries } from "../../../../../lib/repository-source";
import { LAYER_GRAPH } from "../../../../../lib/repository/layer-graph";
import { PAPER_REGISTER } from "../../../../../lib/repository/paper-register";
import { STATE_VOCABULARY } from "../../../../../lib/repository/state-vocabulary";
import { paperPageFor, paperPages } from "../../../../../lib/repository/paper-pages";
import { paperIdFromSlug, paperSlug } from "../../../../../lib/repository/papers";

export const revalidate = 300;
export const dynamicParams = false;

export function generateStaticParams() {
  const ids = PAPER_REGISTER.papers.map((paper) => paperSlug(paper.id));
  return PUBLIC_LOCALES.flatMap((locale) => ids.map((id) => ({ locale, id })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id, locale: rawLocale } = await params;
  const locale = parsePublicLocale(rawLocale);
  const paperId = paperIdFromSlug(id);
  const paper = paperId && PAPER_REGISTER.papers.find((row) => row.id === paperId);
  if (!paper) return { title: locale === "ja" ? "論文" : "Papers" };
  return {
    title: paper.title,
    description: `${paper.authors} · ${paper.year}`,
    ...canonicalMetadata(`/repository/papers/${id}`),
  };
}

export default async function RepositoryPaperPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id, locale: rawLocale } = await params;
  const locale = parsePublicLocale(rawLocale);
  const paperId = paperIdFromSlug(id);
  if (!paperId) notFound();
  // The corpus is fetched before the 404 check would need it, but only after the
  // slug has parsed — an unparseable segment must not cost a corpus read.
  const entries = await getRepositoryEntries();
  const page = paperPageFor(paperPages(PAPER_REGISTER, LAYER_GRAPH, entries, STATE_VOCABULARY), paperId);
  if (!page) notFound();
  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-layers-site"
      locale={locale}
      // See the same note on `papers/page.tsx` and `claims/page.tsx`: `"full"`
      // would call `getMajoranaAuth()`, which throws on a request that never
      // reached AuthKit's middleware because the locale rewrite answered first.
      chrome="static"
      showLanguageToggle
    >
      <PaperView page={page} locale={locale} />
    </PublicSite>
  );
}
