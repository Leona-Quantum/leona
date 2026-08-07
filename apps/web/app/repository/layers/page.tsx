import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { LayerIndexView } from "../../../components/repository-layers";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getRepositoryListEntries } from "../../../lib/repository-source";
import { LAYER_GRAPH } from "../../../lib/repository/layer-graph";
import { rootCapabilities, type LayerCorpusEntry } from "../../../lib/repository/layers";

export const metadata: Metadata = {
  title: "Layers",
  description:
    "How the pieces fit: the slots a quantum pipeline is made of, the methods recorded for each, and the routes that skip a layer entirely.",
};

/**
 * `?open=<root id>` — which top-level slot arrives expanded.
 *
 * Resolved here, on the server, and validated against the root ids rather than
 * trusted: an unrecognised value means "the default", never an empty page. Same
 * rule `browse-params.ts` states for the four Atlas deep links, and the reason
 * this is a `<details open>` rather than a click handler is D88.2 — a control
 * that only works after hydration has no address at all.
 *
 * The one trap this route does not have is the one the port affordance shipped
 * with (session 88): the
 * `<details>` opened here has no collapsed ancestor, so a reader following the
 * link lands on something they can actually see. That was worth checking rather
 * than assuming, because `curl | grep 'open='` returns the same string either
 * way.
 */
function resolveOpenRoot(params: Record<string, string | string[] | undefined>): string | null {
  const raw = params.open;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  return rootCapabilities(LAYER_GRAPH).some((root) => root.id === value) ? value : null;
}

export default async function RepositoryLayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, locale, entries] = await Promise.all([
    searchParams,
    getPublicLocale(),
    getRepositoryListEntries(),
  ]);
  // The narrow projection the graph needs. Passing the whole listing would let a
  // later change to this surface start reading fields the graph has no business
  // depending on.
  const corpus: LayerCorpusEntry[] = entries.map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    titleJa: entry.titleJa,
    category: entry.category,
  }));

  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-layers-site"
      locale={locale}
      showLanguageToggle
    >
      <LayerIndexView
        graph={LAYER_GRAPH}
        corpus={corpus}
        locale={locale}
        openRoot={resolveOpenRoot(params)}
      />
    </PublicSite>
  );
}
