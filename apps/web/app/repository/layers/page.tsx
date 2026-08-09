import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { ConvergeView } from "../../../components/repository-converge-view";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getRepositoryListEntries } from "../../../lib/repository-source";
import { LAYER_GRAPH } from "../../../lib/repository/layer-graph";
import { resolveOpenIds } from "../../../lib/repository/converge-layout";
import { parseViewport } from "../../../lib/repository/canvas-viewport";
import { parseAboutSection } from "../../../lib/repository/map-about";
import { isCapability, layerNode, type LayerCorpusEntry } from "../../../lib/repository/layers";

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
 * `?view=` is gone, and old links carrying it still work.
 *
 * There were four drawings of this graph and there is now one. The three that
 * were retired — map, strands, list — each kept an address for several sessions
 * after a better surface existed, and the parameter is therefore in bookmarks,
 * in the owner's own notes, and in whatever has been shared. It is not read
 * anywhere any more, and that is deliberate: an unrecognised parameter lands on
 * the one surface rather than 404ing, which is the same rule `browse-params.ts`
 * states for the Atlas deep links. Nothing has to be redirected and nothing
 * breaks.
 */

/**
 * `?open=` — every line the reader has opened, in place, as a set.
 *
 * A set rather than one id because the owner asked for exactly that, twice:
 * *"clicking on the line expands the line within the page/visualization itself
 * … with everything else still in view"*, and *"they can still click on process
 * lines on whatever zoomed in layer you are in to see more connections without
 * rendering a layer deeper."* One id would mean opening a second thing shuts the
 * first, which is the surface session 92 shipped and the one this replaces.
 *
 * A value names **one lane by its position** — `1.0.3`, the fourth child of the
 * first child of bundle 1's lane 0 — and a node id is still accepted so that
 * links written before addresses existed keep opening what they always did.
 * Unknown values are dropped rather than rejected: a URL naming four things, one
 * of which has since been renamed, opens the other three instead of failing.
 * `CONVERGE_OPEN_MAX` bounds it, because the parameter is user-supplied and the
 * layout it drives is recursive; the count over the cap is handed to the view,
 * which prints it.
 *
 * **`resolveOpenIds`, not a copy of it.** This page used to carry its own loop
 * with a different predicate and no `reserved` argument — two parsers for one
 * parameter, which is how two pages come to disagree about what a URL means. The
 * disagreement would have arrived with this change: the node page would have
 * started honouring addresses while the overview went on validating against the
 * graph and dropping every one of them.
 */
function resolveOpenSet(params: Record<string, string | string[] | undefined>): {
  open: ReadonlySet<string>;
  dropped: number;
} {
  const raw = params.open;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return resolveOpenIds(values, (id) => layerNode(LAYER_GRAPH, id) !== null);
}

function one(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : null;
}

/**
 * `?focus=` — the capability the figure is of.
 *
 * Validated against the graph's capabilities rather than trusted, and an
 * unrecognised value falls back to the four-root overview rather than to an
 * empty canvas. Same rule as `browse-params.ts`, and the same reason: a deep
 * link that half-works is worse than one that lands somewhere sensible.
 *
 * Only a **capability** may be focused. A method id here resolves to null — a
 * method is not a slot you can stand in, it is one way through one, and its
 * write-up already has an address at `/repository/layers/<id>`. A method is
 * opened, not focused, and `?open=` is where that lives.
 */
function resolveFocus(params: Record<string, string | string[] | undefined>): string | null {
  const value = one(params, "focus");
  if (!value) return null;
  const node = layerNode(LAYER_GRAPH, value);
  return node && isCapability(node) ? value : null;
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
  const openSet = resolveOpenSet(params);
  // The narrow projection the graph needs. Passing the whole listing would let a
  // later change to this surface start reading fields the graph has no business
  // depending on.
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
      // `mj-map-site` is this route ONLY, and the distinction matters: three
      // other surfaces carry `mj-layers-site` (a node's page and both paper
      // pages) and on all three the figure illustrates a written record, so the
      // reading column is right for them. Here the figure IS the page, and the
      // full-bleed rules key on this class so widening the map cannot widen a
      // document by accident.
      //
      // `mj-repository-site` is the one that must not be dropped: `styles.css`
      // scopes every Atlas view transition on `:root:has(.mj-repository-site)`,
      // and a page that lost it would lose the whole navigation animation with
      // no error — the animation simply not playing is the only symptom.
      className="mj-repository-site mj-layers-site mj-map-site"
      locale={locale}
      // > *"The map page is an infinite canvas that takes up the entire page,
      // > only with an option/arrow to go back to the atlas page and a small
      // > overlayed information icon both in the top left."* — owner, ask H
      //
      // So: no header, no nav, no footer, and no language or theme toggle in
      // the chrome. Both toggles moved into the information box's footer rather
      // than being dropped — `ConvergeView` renders it — because `data-theme`
      // living on `<html>` means removing the header removed the control and
      // not the setting, and a reader left holding a setting they cannot change
      // is worse off than one who never had the control.
      chrome="none"
      // Kept in the call even though `chrome="none"` renders no toggle. It is
      // the default anyway, and a surface that goes back to `"full"` should not
      // silently go back to it *without* a language switch.
      showLanguageToggle
    >
      <ConvergeView
        graph={LAYER_GRAPH}
        corpus={corpus}
        locale={locale}
        focusId={resolveFocus(params)}
        open={openSet.open}
        // Which page of the information box is open, resolved on the server so
        // the box works with JavaScript off and so a link to one section of it
        // is a link somebody can send. See `lib/repository/map-about.ts`.
        about={parseAboutSection(params.about)}
        droppedOpen={openSet.dropped}
        // Resolved on the server so the figure arrives already panned and
        // scaled: a shared link lands where its sender was standing even with
        // JavaScript off, which is the whole reason the viewport is a parameter
        // rather than component state.
        viewport={parseViewport(params.at)}
      />
    </PublicSite>
  );
}
