import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { LayerIndexView } from "../../../components/repository-layers";
import { StrandView, STRAND_DEPTHS, type StrandDepth } from "../../../components/repository-strand-view";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getRepositoryListEntries } from "../../../lib/repository-source";
import { LAYER_GRAPH } from "../../../lib/repository/layer-graph";
import { isCapability, layerNode, rootCapabilities, type LayerCorpusEntry } from "../../../lib/repository/layers";

/**
 * Localised, because the node route beside it already is.
 *
 * A static English `metadata` export here would give a Japanese reader an
 * English title and description on the index and a Japanese one on every node
 * page — the inconsistency being the tell, since the two surfaces are one
 * reading. The page reads the locale cookie anyway, so this costs nothing.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPublicLocale();
  return locale === "ja"
    ? {
        title: "階層",
        description:
          "部品どうしの組み合わさり方。パイプラインを構成する枠、各枠に記録された手法、そして階層そのものを飛ばす経路を示します。",
      }
    : {
        title: "Layers",
        description:
          "How the pieces fit: the slots a quantum pipeline is made of, the methods recorded for each, and the routes that skip a layer entirely.",
      };
}

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

function one(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : null;
}

/**
 * `?view=` — which drawing of the same graph.
 *
 * **Strands is the default**, and that is the session-90 change rather than a
 * detail. The owner's reading of the list was *"this big rectangles structure is
 * just not a good representation"*, and leaving the better surface behind a
 * query parameter would mean nobody arriving at the page ever sees it. The list
 * keeps its address at `?view=list` and loses nothing — D90.2, and reversible in
 * one line.
 */
function resolveView(params: Record<string, string | string[] | undefined>): "strands" | "list" {
  return one(params, "view") === "list" ? "list" : "strands";
}

/**
 * `?focus=` — the capability the canvas centres on.
 *
 * Validated against the graph's capabilities rather than trusted, and an
 * unrecognised value falls back to the four-root overview rather than to an
 * empty canvas. Same rule as `browse-params.ts`, and the same reason: a deep
 * link that half-works is worse than one that lands somewhere sensible.
 *
 * Only a **capability** may be focused. A method id here resolves to null — a
 * method is not a slot you can stand in, it is one way through one, and its
 * write-up already has an address at `/repository/layers/<id>`.
 */
function resolveFocus(params: Record<string, string | string[] | undefined>): string | null {
  const value = one(params, "focus");
  if (!value) return null;
  const node = layerNode(LAYER_GRAPH, value);
  return node && isCapability(node) ? value : null;
}

/**
 * `?depth=` — how many levels of nesting are drawn. **One by default.**
 *
 * At depth 1 a slot shows its methods as fibers and each of their steps as a
 * shut oval with a count on it: the whole structure, one level down, on a canvas
 * that fits. Two was the first default and it is not one — `quantum-linear-solve`
 * at depth 2 is five methods each expanding into three sub-slots, which is
 * 1659×1695 of canvas and reads as a thicket rather than as a shape. Going
 * deeper is one click and it has an address.
 */
function resolveDepth(params: Record<string, string | string[] | undefined>): StrandDepth {
  const value = Number(one(params, "depth"));
  return (STRAND_DEPTHS as readonly number[]).includes(value) ? (value as StrandDepth) : 1;
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
      {resolveView(params) === "list" ? (
        <LayerIndexView
          graph={LAYER_GRAPH}
          corpus={corpus}
          locale={locale}
          openRoot={resolveOpenRoot(params)}
        />
      ) : (
        <StrandView
          graph={LAYER_GRAPH}
          corpus={corpus}
          locale={locale}
          focusId={resolveFocus(params)}
          depth={resolveDepth(params)}
        />
      )}
    </PublicSite>
  );
}
