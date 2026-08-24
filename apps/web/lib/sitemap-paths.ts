/**
 * Which paths the sitemap publishes, and which prefixes robots.txt refuses.
 *
 * Its own module, with no Next and no corpus imports, so the bare node test
 * runner can load it — and so the two files that have to agree about what
 * "public" means (`app/sitemap.ts` and `app/robots.ts`) read one list instead of
 * each carrying a copy that drifts.
 *
 * The dynamic half is NOT listed here. Record, layer and paper addresses are
 * passed in by the caller from the same sources the pages themselves render
 * from, so a sitemap can only be wrong about the corpus if the pages are too.
 */

/**
 * Public pages with a fixed address.
 *
 * Every one is in `middleware.ts`'s PUBLIC_PATHS, or under one of them — a
 * sitemap entry for a page that redirects to sign-in is an invitation to index
 * a login screen.
 *
 * Three of that file's public paths are deliberately absent. `/open-source` is
 * a redirect alias for `/workspace`, and a sitemap should name the destination
 * rather than the hop; `/auth/callback` and `/auth/sign-out` are
 * unauthenticated because they have to be, not because they are pages.
 */
export const PUBLIC_STATIC_PATHS: readonly string[] = [
  "/",
  "/pricing",
  "/workspace",
  "/contact",
  "/privacy",
  "/terms",
  "/repository",
  "/repository/folders",
  "/repository/layers",
  "/repository/papers",
  "/repository/claims",
];

/**
 * Public paths that only redirect somewhere else.
 *
 * Crawlable — there is no reason to refuse them — but not addresses to publish,
 * because a sitemap that lists a hop teaches crawlers a URL the site does not
 * consider canonical. Listed rather than left implicit so the route census in
 * `sitemap-paths.test.ts` has somewhere to put them.
 */
export const PUBLIC_REDIRECT_ALIASES: readonly string[] = ["/open-source"];

/**
 * Public page prefixes whose concrete addresses come from user-owned data.
 *
 * Unlike repository records, Qapp slugs are not part of this checkout's static
 * corpus, so this module cannot enumerate them into the sitemap. The prefix is
 * still classified explicitly so the route census cannot mistake a public
 * dynamic surface for an authenticated page or an untracked route.
 */
export const PUBLIC_DYNAMIC_PATH_PREFIXES: readonly string[] = ["/q"];

/**
 * Public endpoints that are read by machines and are not pages.
 *
 * A fourth category because `llms.txt` (ai-ops 133) fits none of the three and
 * forcing it into one would state something false. It must not be disallowed —
 * being read is the entire point. It must not be published in the sitemap
 * either: a sitemap is a list of PAGES a crawler should index, and listing a
 * plain-text descriptor there invites it into search results as though it were
 * one. And it redirects nowhere, so it is not an alias.
 *
 * `robots.txt` and `sitemap.xml` belong to this category conceptually and are
 * absent for a mechanical reason worth writing down: they use Next's metadata
 * file conventions (`app/robots.ts`, `app/sitemap.ts`), which contribute no
 * directory under `app/`, so the route census in `sitemap-paths.test.ts` never
 * sees them and has nothing to account for. `llms.txt` has no such convention,
 * so it is a Route Handler in a directory, so it is a real route segment.
 */
export const MACHINE_READABLE_PATHS: readonly string[] = ["/llms.txt"];

/**
 * Prefixes robots.txt refuses: the authenticated application, the machine
 * surfaces, and the pages that are neither.
 *
 * Derived by reading `apps/web/app/` against `middleware.ts` — anything not in
 * PUBLIC_PATHS is behind the AuthKit gate, so a crawler following a link there
 * gets a sign-in redirect, and every such URL that reaches an index is a result
 * a reader cannot open. Matching is by prefix, which is why `/run` covers
 * `/run/<taskId>` and `/library` covers `/library/<artifactId>`.
 *
 * `/dashboard` and `/welcome` are gated too, and would be worth excluding even
 * if they were not: one redirects to `/run`, the other is a name prompt.
 * `/demo` and `/lab` are preview surfaces that only exist on some deployments
 * (`isPublicDemoEnabled()`; the lab is an alternative visual direction), so
 * indexing either would publish an address most visitors get a 404 from.
 */
export const CRAWLER_DISALLOWED_PATHS: readonly string[] = [
  "/account",
  "/api/",
  "/auth/",
  "/dashboard",
  "/demo",
  "/dev/",
  "/lab",
  "/library",
  "/qapps",
  "/run",
  "/shared/",
  "/studio",
  "/upgrade",
  "/welcome",
];

export interface PublicSurface {
  /** Published corpus record slugs — `/repository/<slug>`. */
  entrySlugs: readonly string[];
  /**
   * Layer page ids — `/repository/layers/<id>`. Map nodes and state-vocabulary
   * states share this route by design (states.ts §3), so both belong here.
   */
  layerIds: readonly string[];
  /** Paper register slugs, already through `paperSlug()`. */
  paperSlugs: readonly string[];
}

/**
 * `encodeURIComponent` leaves `-`, `_`, `.` and `~` alone, which is every
 * character `paperSlug()` can produce and every character a record or layer id
 * uses today. It is here for the id that does not follow that rule yet, not for
 * the ones that do.
 */
function segment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Every public URL path, in reading order, with duplicates dropped.
 *
 * Duplicates are dropped rather than trusted away: `validateLayerGraph` already
 * refuses a node id that collides with a state id, and the corpus checks refuse
 * a repeated slug, but a sitemap listing one URL twice is a defect a reader can
 * see and neither of those gates is this file's to rely on.
 */
export function sitemapPaths(surface: PublicSurface): string[] {
  const paths = [
    ...PUBLIC_STATIC_PATHS,
    ...surface.entrySlugs.map((slug) => `/repository/${segment(slug)}`),
    ...surface.layerIds.map((id) => `/repository/layers/${segment(id)}`),
    ...surface.paperSlugs.map((slug) => `/repository/papers/${segment(slug)}`),
  ];
  return [...new Set(paths)];
}
