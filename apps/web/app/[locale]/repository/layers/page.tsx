import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canonicalMetadata } from "../../../../lib/public-metadata";
import { PublicSite } from "../../../../components/public-site";
import { ConvergeView } from "../../../../components/repository-converge-view";
import { isPublicLocale, parsePublicLocale, PUBLIC_LOCALES } from "../../../../lib/public-locale";
import { getRepositoryListEntries } from "../../../../lib/repository-source";
import { LAYER_GRAPH } from "../../../../lib/repository/layer-graph";
import { drawableSlots, resolveOpenIds } from "../../../../lib/repository/converge-layout";
import { parseViewport } from "../../../../lib/repository/canvas-viewport";
import { SEL_PARAM } from "../../../../lib/repository/canvas-selection";
import { cardExists } from "../../../../lib/repository/card-content";
import {
  INNER_PARAM,
  IOPEN_PARAM,
  parseCardId,
  parseInnerId,
  SECTION_PARAM,
} from "../../../../lib/repository/map-card";
import { parseAboutSection } from "../../../../lib/repository/map-about";
import { isCapability, layerCorpusEntry, layerNode, type LayerCorpusEntry } from "../../../../lib/repository/layers";
import { STATE_VOCABULARY } from "../../../../lib/repository/state-vocabulary";
import { PAPER_REGISTER } from "../../../../lib/repository/paper-register";
import { PAPER_PARAM, paperRevealFor } from "../../../../lib/repository/paper-reveal";
import { paperSlug } from "../../../../lib/repository/papers";

/**
 * Served from the CDN, and NOT by being prerendered — the distinction is the
 * whole design of this file's move and is worth stating where it will be read.
 *
 * This page resolves ten search parameters on the server (`?open=`, `?at=`,
 * `?card=`, `?paper=`, `?focus=`, `?inner=`, `?iopen=`, `?about=`, `?section=`,
 * `?sel=`), on purpose: a shared link lands where its sender was standing, and
 * it does so with JavaScript off. Next is unambiguous that this costs static
 * rendering — "`searchParams` is a Request-time API whose values cannot be known
 * ahead of time. Using it will opt the page into dynamic rendering at request
 * time." So the recipe that put `/pricing` and its five siblings on the CDN
 * (`revalidate` + `dynamicParams = false` + `chrome="static"`) cannot reach this
 * route, and no amount of removing cookie reads changes that.
 *
 * What CAN reach it is the edge cache in front of the render.
 * `next.config.ts` attaches `Vercel-CDN-Cache-Control` to this path, and
 * Vercel's cache key is the request URL *including the query string* — so every
 * distinct deep link gets its own entry rather than one entry serving them all.
 * That this works on a response Next itself marks `no-store` is measured, not
 * assumed: see the header block in `next.config.ts`.
 *
 * The move under `[locale]` is what makes that cache SAFE rather than merely
 * fast. Cookies are not part of Vercel's cache key — measured on the same
 * preview: two requests to one URL carrying `leona.locale.v2=en` and
 * `leona.locale.v2=ja` were served ONE render. Reading the locale cookie here,
 * with an edge cache in front, would therefore have handed a Japanese reader the
 * English page and called it a hit. The locale has to be in the path, and now is.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return PUBLIC_LOCALES.map((locale) => ({ locale }));
}

/**
 * Localised, because the node route beside it already is.
 *
 * A static English `metadata` export here would give a Japanese reader an
 * English title and description on the index and a Japanese one on every node
 * page — the inconsistency being the tell, since the two surfaces are one
 * reading. The locale is a path segment now, so this still costs nothing.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = parsePublicLocale((await params).locale);
  return {
    ...(locale === "ja"
      ? {
          // 地図 / "Map", not 階層 / "Layers" (ai-ops#78). The route stays
          // `/repository/layers`; what changes is what a reader is told this page
          // is called, which everything linking here — including the Atlas's own
          // "open the map" line — already called a map.
          //
          // 階層 survives *inside* the description because there it is the data
          // model: a layer is a thing on this surface, and "the routes that skip
          // a layer entirely" is a sentence about layers, not about the page.
          title: "地図",
          description:
            "部品どうしの組み合わさり方。パイプラインを構成する枠、各枠に記録された手法、そして階層そのものを飛ばす経路を示します。",
        }
      : {
          title: "Map",
          description:
            "How the pieces fit: the slots a quantum pipeline is made of, the methods recorded for each, and the routes that skip a layer entirely.",
        }),
    ...canonicalMetadata("/repository/layers"),
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
function resolveOpenSet(
  params: Record<string, string | string[] | undefined>,
  // `?open=` for the map, `?iopen=` for the truncated map inside the card. One
  // parser under two keys, never two parsers: the grammar is identical by
  // design (`lib/repository/map-card.ts`, the `?inner=` block), and the whole
  // history of this function is what happens when one parameter grows a second
  // reader.
  key: "open" | typeof IOPEN_PARAM = "open",
): {
  open: ReadonlySet<string>;
  dropped: number;
} {
  const raw = params[key];
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
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Locale is validated BEFORE the catalog read starts, not alongside it: with
  // `MAJORANA_PUBLIC_CATALOG_API` on, `getRepositoryListEntries()` is a network
  // call, and a `Promise.all` starting it next to `routeParams` fires that call
  // for every mistyped locale too, only to throw the result away on the next
  // line. `/zz/repository/layers` should cost a 404, not a catalog fetch.
  //
  // **`dynamicParams = false` does not cover this page.** It restricts params
  // only on a route that prerenders; this one reads `searchParams` and
  // therefore never does, so every locale is "outside the prerendered set" and
  // Next renders it. Measured: `/zz/repository/claims` (prerendered) 404s on
  // its own and `/zz/repository/layers` returned 200 with the English map — a
  // second address for the site's most-read page. See `isPublicLocale`.
  const routeLocale = await routeParams;
  if (!isPublicLocale(routeLocale.locale)) notFound();
  const [params, entries] = await Promise.all([searchParams, getRepositoryListEntries()]);
  const locale = parsePublicLocale(routeLocale.locale);
  const openSet = resolveOpenSet(params);
  // `?paper=` — the paper surface (W20). Its whole meaning is an ARRIVAL open
  // set — the owner's "expands only branches needed … other branches that
  // remain open that aren't relevant are closed" — so it is resolved before
  // the open set is chosen: a paper link carries no `open` values and lands on
  // the reveal; the moment the URL carries explicit `open` values the reader
  // owns them and the paper contributes highlight + panel only (D-W20.2). An
  // unresolvable value means no surface and says so, the `?card=` rule.
  const paperParam = one(params, PAPER_PARAM);
  const paperReveal =
    paperParam !== null && paperParam !== ""
      ? paperRevealFor(LAYER_GRAPH, STATE_VOCABULARY, paperParam)
      : null;
  const paperRow =
    paperReveal === null ? null : (PAPER_REGISTER.papers.find((row) => row.id === paperReveal.paperId) ?? null);
  const rawOpen = params["open"];
  const hasExplicitOpen = Array.isArray(rawOpen) ? rawOpen.length > 0 : typeof rawOpen === "string";
  const landing = paperReveal !== null && !hasExplicitOpen;
  // `?inner=` — the truncated map inside the open card (W9). Resolved on the
  // server like everything else on this page, and validated against
  // `drawableSlots` — the predicate the navigation list and the renderer
  // already share — rather than against `cardExists`: the value names a figure
  // to draw, not a card to open, and an `own:<methodId>` or a method id must
  // mean **shut** here or the URL claims a truncated map the layout cannot
  // produce. See `lib/repository/map-card.ts`.
  const drawable = new Set(drawableSlots(LAYER_GRAPH, STATE_VOCABULARY).map((slot) => slot.id));
  const inner = parseInnerId(params[INNER_PARAM], (id) => drawable.has(id));
  // `?iopen=` is parsed only when `?inner=` resolved: the set means nothing
  // except against the one figure `?inner=` names, so against no figure it is
  // not honoured — the same reason `withInner` and `withCard` both delete it.
  const iopenSet =
    inner.id === null ? null : resolveOpenSet(params, IOPEN_PARAM);
  // The narrow projection the graph needs. Passing the whole listing would let a
  // later change to this surface start reading fields the graph has no business
  // depending on.
  const corpus: LayerCorpusEntry[] = entries.map(layerCorpusEntry);
  // **The same input the panel is built from**, so the question "can this id be
  // opened" and the answer "here is what opens" cannot disagree. `ConvergeView`
  // builds its own from the same four values; they are one object's worth of
  // arguments and building it twice is cheaper than threading it, but they must
  // be built from the same four.
  const cardInput = {
    graph: LAYER_GRAPH,
    vocabulary: STATE_VOCABULARY,
    register: PAPER_REGISTER,
    corpus,
    locale,
  } as const;

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
        focusId={resolveFocus(params) ?? (paperReveal ? paperReveal.focusId : null)}
        open={landing ? new Set(paperReveal!.open) : openSet.open}
        // Which page of the information box is open, resolved on the server so
        // the box works with JavaScript off and so a link to one section of it
        // is a link somebody can send. See `lib/repository/map-about.ts`.
        about={parseAboutSection(params.about)}
        // Which card is open, resolved on the server for the same reason and by
        // the same shape. `parseCardId` validates: an id naming nothing means
        // *shut*, because there is no sensible default node to fall back to.
        // See `lib/repository/map-card.ts`.
        //
        // **The predicate is `cardExists`, not `layerNode(...) !== null`.** Not
        // every card id is a node id: `own:<methodId>` addresses the stretch a
        // method performs itself, which is a piece of a route and nobody's node.
        // Written out here, the predicate would be a second and simpler model of
        // what a card id is — and the simpler one counts every `own:` link as
        // dropped while the panel beneath it opens perfectly well, which is a
        // disagreement that shows up as a wrong number rather than as a broken
        // page.
        card={parseCardId(params.card, (id) => cardExists(cardInput, id))}
        // The truncated map inside that card, and what is open inside it —
        // resolved above. The empty set when `?inner=` did not resolve, so the
        // view never has to ask whether a set it was handed has a figure.
        inner={inner}
        iopen={iopenSet?.open ?? new Set()}
        // Which of that card's sections is showing. Passed raw and resolved in
        // `ConvergeView`, which is the only component that knows what sections
        // this card has — validating it here would mean assembling the card
        // twice, and two answers to "is this a section of it" that can disagree.
        cardSection={one(params, SECTION_PARAM)}
        droppedOpen={openSet.dropped}
        // Resolved on the server so the figure arrives already panned and
        // scaled: a shared link lands where its sender was standing even with
        // JavaScript off, which is the whole reason the viewport is a parameter
        // rather than component state.
        viewport={parseViewport(params.at)}
        // Which drawn thing the reader is on (W16, the Prezi move). Passed raw
        // and resolved in `ConvergeView` against what actually drew, the same
        // division of labour as `cardSection`: the page can say an id names a
        // node; only the layout knows whether anything on the figure draws it.
        sel={one(params, SEL_PARAM) ?? (landing ? paperReveal!.sel : null)}
        paper={
          paperReveal !== null && paperRow !== null
            ? {
                slug: paperSlug(paperReveal.paperId),
                title: paperRow.title,
                authors: paperRow.authors,
                year: paperRow.year,
                cited: new Set(paperReveal.cited),
                drawnCount: paperReveal.drawn.length,
                folded: paperReveal.folded,
                elsewhereCount: paperReveal.elsewhere.length,
                undrawnCount: paperReveal.undrawn.length,
                // W22 / RULING 06de05. Carried whenever `?paper=` resolves, NOT
                // only on the landing, and that is deliberate: unfolding changes
                // which lanes exist, so every address below the unfolded one
                // shifts with it. Dropping the unfold the moment the reader adds
                // their own `?open=` would leave their addresses pointing at
                // different lanes than the ones they clicked — D-W20.2 hands the
                // OPEN SET back to the reader, not the figure's shape.
                unfold: paperReveal.unfold,
              }
            : null
        }
        paperDropped={paperParam !== null && paperParam !== "" && paperReveal === null}
      />
    </PublicSite>
  );
}
