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
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicSite } from "../../../../components/public-site";
import { FolderView } from "../../../../components/repository-folders";
import { getPublicLocale } from "../../../../lib/public-locale-server";
import { getRepositoryListEntries } from "../../../../lib/repository-source";
import {
  buildFolderTree,
  buildMethodFolderTree,
  resolveFolderPath,
  resolveMethodFolderPath,
} from "../../../../lib/repository/folder-tree";
import { parseFolderScheme } from "../../../../components/repository-folders";

/**
 * Localised, for the reason every other public Atlas route is: a static English export
 * gives a Japanese reader an English title on this page and a Japanese one on the entry
 * it links to, and the inconsistency is the tell. The page reads the locale cookie
 * anyway, so it costs nothing.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPublicLocale();
  return locale === "ja"
    ? {
        title: "フォルダ",
        description:
          "カタログを階層でたどる索引。記録の種別、アルゴリズムのファミリー、その中の主題トピックの順に降りていけます。",
      }
    : {
        title: "Folders",
        description:
          "Browse the catalogue as a hierarchy: the kind of record, then its algorithm family, then the subject topics inside it.",
      };
}

export default async function RepositoryFoldersPage({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ path }, query, locale, entries] = await Promise.all([
    params,
    searchParams,
    getPublicLocale(),
    getRepositoryListEntries(),
  ]);
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
