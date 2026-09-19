// `/repository/folders[/…]` — the browsable hierarchy, at one address per folder.
//
// One optional catch-all rather than an index page plus a `[...path]` beside it: two
// files would be two copies of the same resolve-and-render, and the root is just the
// zero-length path. The shape and every rule are in `lib/repository/folder-tree.ts`.
//
// **Server-rendered, and that is the point of the route existing.** The catalogue was
// already reachable by search and by direct link; what it had no way to offer was
// walking down through subject areas, and a tree that only exists after hydration is a
// tree no crawler reads and no reader without JS ever sees. Every folder here is an
// `<a href>` to a real address, which is the same rule `browse-params.ts` states for
// the Atlas deep links.
//
// Served from the CDN, and NOT by being prerendered — the `layers`/`layers/[id]`
// split, not the `claims`/`papers` one. This page resolves `?scheme=` on the server
// so a shared "method view" link lands already switched, with JavaScript off — and
// reading `searchParams` opts any page out of static rendering unconditionally, so
// the `revalidate` + `dynamicParams = false` recipe that prerenders `papers` cannot
// reach this route at any price. What CAN reach it is the edge cache in FRONT of the
// render: `next.config.ts` attaches `Vercel-CDN-Cache-Control` / `CDN-Cache-Control`
// to this path (mirroring the `/repository/layers` entry, same 300s), and moving under
// `[locale]` is what makes that cache SAFE rather than merely fast — cookies are not
// part of Vercel's cache key, so serving this from a cookie-read layout would have
// handed a Japanese reader the English tree and called it a hit. See the long note in
// `../layers/page.tsx` for the measurement.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canonicalMetadata } from "../../../../../lib/public-metadata";
import { PublicSite } from "../../../../../components/public-site";
import { FolderView } from "../../../../../components/repository-folders";
import { isPublicLocale, parsePublicLocale } from "../../../../../lib/public-locale";
import { getRepositoryListEntries } from "../../../../../lib/repository-source";
import {
  buildFolderTree,
  buildMethodFolderTree,
  resolveFolderPath,
  resolveMethodFolderPath,
} from "../../../../../lib/repository/folder-tree";
import { parseFolderScheme } from "../../../../../components/repository-folders";

/**
 * `dynamicParams = false` does NOT cover this page — it restricts params only on a
 * route that prerenders, and this one reads `searchParams` and therefore never does
 * (see the file header). So every locale is "outside the prerendered set" and Next
 * renders it regardless; the page has to refuse an unknown one itself, which the body
 * below does. Required anyway, and asserted literally by `public-revalidate.test.ts`,
 * because every page under `[locale]` carries it whether or not it is the mechanism
 * doing the work.
 */
export const dynamicParams = false;

/**
 * Localised, for the reason every other public Atlas route is: a static English
 * export gives a Japanese reader an English title on this page and a Japanese one on
 * the entry it links to, and the inconsistency is the tell.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; path?: string[] }>;
}): Promise<Metadata> {
  const { path, locale: rawLocale } = await params;
  const locale = parsePublicLocale(rawLocale);
  // Same derivation the page body below uses for `segments` — so the canonical
  // address always names the folder this render resolved, not a re-guess of it.
  const segments = (path ?? []).map(decodeURIComponent);
  const canonicalPath = segments.length > 0 ? `/repository/folders/${segments.join("/")}` : "/repository/folders";
  return {
    ...(locale === "ja"
      ? {
          title: "フォルダ",
          description:
            "カタログを階層でたどる索引。記録の種別、アルゴリズムのファミリー、その中の主題トピックの順に降りていけます。",
        }
      : {
          title: "Folders",
          description:
            "Browse the catalogue as a hierarchy: the kind of record, then its algorithm family, then the subject topics inside it.",
        }),
    ...canonicalMetadata(canonicalPath),
  };
}

export default async function RepositoryFoldersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ path, locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  // Before anything else, and not covered by `dynamicParams = false` — see the
  // doc comment above. Without this, `/zz/repository/folders` served the English
  // tree with a 200. See `isPublicLocale`.
  if (!isPublicLocale(rawLocale)) notFound();
  const locale = parsePublicLocale(rawLocale);
  const entries = await getRepositoryListEntries();
  // **Exactly one tree is built per request.** ai-ops#45's second acceptance
  // condition is that load times must not spike, and building both so the
  // switcher could count the other one would double the work on every render
  // for a number nobody asked for.
  //
  // An unrecognised `?scheme=` resolves to the scheme the owner already picked
  // rather than 404ing — the `browse-params.ts` rule, not the path rule, because
  // this genuinely is a filter over one address and not an identity. The path
  // segments below keep the path rule.
  const scheme = parseFolderScheme(query.scheme);
  const tree = scheme === "method" ? buildMethodFolderTree(entries) : buildFolderTree(entries);
  // `notFound()` rather than falling back to the root — see the comment on
  // `resolveFolderPath`. A path segment is an identity, not a filter, and answering a
  // folder that does not exist with its parent's contents tells the reader it does.
  const segments = (path ?? []).map(decodeURIComponent);
  const location =
    scheme === "method"
      ? resolveMethodFolderPath(tree, entries, segments)
      : resolveFolderPath(tree, entries, segments);
  if (!location) notFound();

  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-layers-site"
      locale={locale}
      // See the same note on `../layers/page.tsx`: `"full"` (the default) would
      // call `getMajoranaAuth()`, which throws on a request that never reached
      // AuthKit's middleware because the locale rewrite answered first.
      chrome="static"
      showLanguageToggle
    >
      <FolderView
        location={location}
        locale={locale}
        scheme={scheme}
        placed={tree.placed}
        unplaced={tree.unreachable.length}
      />
    </PublicSite>
  );
}
