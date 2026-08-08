import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { LayerIndexView } from "../../../components/repository-layers";
import { MAP_OPEN_MAX, ProcessMapView, resolveZoom } from "../../../components/repository-process-view";
import { StrandView, STRAND_DEPTHS, type StrandDepth } from "../../../components/repository-strand-view";
import { ConvergeView } from "../../../components/repository-converge-view";
import { VIEWS, type RepositoryView } from "../../../components/repository-view-switch";
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
 * `?open=<root id>` — which top-level slot the **list** view arrives expanded.
 *
 * The list takes one, because a `<details>` is one disclosure and the list's
 * roots are the only things it discloses. The map takes a set — see
 * `resolveOpenSet` — and the two readings of one parameter name are deliberate:
 * on both views it means "this is showing its insides", and on both it is a real
 * address rather than an `onClick`, which is D88.2's rule.
 *
 * Resolved here, on the server, and validated against the root ids rather than
 * trusted: an unrecognised value means "the default", never an empty page. Same
 * rule `browse-params.ts` states for the four Atlas deep links.
 */
function resolveOpenRoot(params: Record<string, string | string[] | undefined>): string | null {
  const raw = params.open;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  return rootCapabilities(LAYER_GRAPH).some((root) => root.id === value) ? value : null;
}

/**
 * `?open=` on the **map**: every slot drawn expanded in place, as a set.
 *
 * A set rather than one id because the owner asked for exactly that, twice:
 * *"clicking on the line expands the line within the page/visualization itself
 * … with everything else still in view"*, and *"they can still click on process
 * lines on whatever zoomed in layer you are in to see more connections without
 * rendering a layer deeper."* One id would mean opening a second thing shuts the
 * first, which is the surface session 92 shipped and the one this replaces.
 *
 * Every id is validated against the graph's capabilities and unknown ones are
 * dropped rather than rejected — a URL naming four slots, one of which has since
 * been renamed, opens the other three instead of failing. `MAP_OPEN_MAX` bounds
 * it, because the parameter is user-supplied and the layout it drives is
 * recursive; the count over the cap is handed to the view, which prints it. The
 * constant is imported rather than repeated: the number that enforces and the
 * number that is reported have to be one number.
 */
function resolveOpenSet(params: Record<string, string | string[] | undefined>): {
  open: ReadonlySet<string>;
  dropped: number;
} {
  const raw = params.open;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const open = new Set<string>();
  let dropped = 0;
  for (const value of values) {
    const node = layerNode(LAYER_GRAPH, value);
    if (!node || !isCapability(node)) continue;
    if (open.size >= MAP_OPEN_MAX) {
      dropped += 1;
      continue;
    }
    open.add(value);
  }
  return { open, dropped };
}

function one(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : null;
}

/**
 * `?view=` — which drawing of the same graph.
 *
 * **Converge is the default**, which moves the default a third time, and this
 * time the argument that moved it twice before finally has to be applied to
 * itself. Session 90 made strands the default over the list because *"leaving
 * the better surface behind a query parameter means nobody arriving at the page
 * ever sees it"*; session 92 made the map the default over strands for the same
 * reason. Session 96 shipped a better surface than either and left it behind a
 * query parameter — and the owner's next message was *"i can't see the converge
 * option so i can't really comment on it"*. Read on production 2026-08-08, the
 * switch on this page said `Map · Strands · List`.
 *
 * The default is only half of what made it invisible; the other half was four
 * hand-written copies of the switch, and that is fixed in `ViewSwitch` where it
 * cannot recur.
 *
 * The three older views keep their addresses and none is deprecated *here* —
 * retiring them is a separate change with its own blockers, and until converge
 * covers what they cover, deleting them would remove the only drawing of the
 * device stack. `?view=list` is still the linear, screen-reader and print
 * reading (D90.2).
 */
function resolveView(params: Record<string, string | string[] | undefined>): RepositoryView {
  const value = one(params, "view");
  return (VIEWS as readonly string[]).includes(value ?? "")
    ? (value as RepositoryView)
    : "converge";
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
  const view = resolveView(params);
  const openSet = resolveOpenSet(params);
  const corpus: LayerCorpusEntry[] = entries.map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    titleJa: entry.titleJa,
    category: entry.category,
    description: entry.description,
    descriptionJa: entry.descriptionJa,
  }));

  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-layers-site"
      locale={locale}
      showLanguageToggle
    >
      {view === "list" ? (
        <LayerIndexView
          graph={LAYER_GRAPH}
          corpus={corpus}
          locale={locale}
          openRoot={resolveOpenRoot(params)}
        />
      ) : view === "converge" ? (
        <ConvergeView graph={LAYER_GRAPH} locale={locale} focusId={resolveFocus(params)} />
      ) : view === "strands" ? (
        <StrandView
          graph={LAYER_GRAPH}
          corpus={corpus}
          locale={locale}
          focusId={resolveFocus(params)}
          depth={resolveDepth(params)}
        />
      ) : (
        <ProcessMapView
          graph={LAYER_GRAPH}
          corpus={corpus}
          locale={locale}
          focusId={resolveFocus(params)}
          openIds={openSet.open}
          droppedOpen={openSet.dropped}
          zoom={resolveZoom(one(params, "zoom"))}
        />
      )}
    </PublicSite>
  );
}
