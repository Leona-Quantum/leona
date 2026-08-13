/**
 * /sitemap.xml — every address a signed-out reader can open.
 *
 * `middleware.ts`'s matcher has excluded `sitemap.xml` from the auth gate since
 * the favicon incident, so the exclusion has been protecting a 404 ever since.
 * This is the file it was excluding.
 *
 * **The corpus half is derived, not listed.** The record slugs come from
 * `getRepositoryListEntries()` — the same call `/repository` and the detail
 * page's `generateStaticParams` make — so the sitemap cannot claim a record the
 * site does not serve, or miss one it does. Layer ids come from the layer graph
 * and the state vocabulary (which share that route), paper slugs from the paper
 * register. A hand-written list would have been wrong the first time the corpus
 * grew, which on this project is measured in days.
 *
 * **No `lastModified`.** A `<lastmod>` of "now" on every URL is not a date, it
 * is the time the sitemap was rendered, and it tells a crawler that all 700-odd
 * pages changed together every hour. The corpus carries no per-record modified
 * timestamp to put here instead, so the field is omitted rather than fabricated.
 * `changeFrequency` and `priority` are omitted for the plainer reason that
 * Google ignores both.
 */
import type { MetadataRoute } from "next";
import { getRepositoryListEntries } from "../lib/repository-source";
import { LAYER_GRAPH } from "../lib/repository/layer-graph";
import { PAPER_REGISTER } from "../lib/repository/paper-register";
import { paperSlug } from "../lib/repository/papers";
import { STATE_VOCABULARY } from "../lib/repository/state-vocabulary";
import { canonicalOrigin } from "../lib/site-origin";
import { sitemapPaths } from "../lib/sitemap-paths";

/**
 * Matches the catalog fetch's own window an order of magnitude out: the corpus
 * changes on deploys, and a crawler re-reading a sitemap more often than the
 * site is rebuilt learns nothing.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = await getRepositoryListEntries();
  const origin = canonicalOrigin();
  const paths = sitemapPaths({
    entrySlugs: entries.map((entry) => entry.slug),
    layerIds: [
      ...LAYER_GRAPH.nodes.map((node) => node.id),
      ...STATE_VOCABULARY.states.map((state) => state.id),
    ],
    paperSlugs: PAPER_REGISTER.papers.map((paper) => paperSlug(paper.id)),
  });
  // The root is `origin`, not `origin + "/"` — both resolve, but only one of
  // them is the URL every other page links to.
  return paths.map((path) => ({ url: path === "/" ? origin : `${origin}${path}` }));
}
