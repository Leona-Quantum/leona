// The surface around the process map: the switch, the legend, the rail.
//
// Everything here is a server component. The only interactive elements are
// `<a href>`s and one `<details>`, which is the same rule the strand view
// follows and the same reason: a control that only works after hydration has no
// address, so it cannot be linked, sent, bookmarked, crawled, or checked with
// `curl` (D88.2). Opening a slot on this map is a link, not a click handler —
// which is why `?open=` carries a set of ids rather than component state.
//
// **Plain anchors rather than `next/link`, deliberately (session 95.)** A
// `<Link>` is a *same-document* navigation, and a same-document navigation is
// the one kind `@view-transition { navigation: auto }` does not animate. The
// canvas beside this file has always emitted plain `<a href>` — SVG has no other
// kind — so half this surface zoomed between pages and half of it cut. There is
// nothing to lose by matching: these pages are statically generated, carry no
// client state to preserve across a navigation, and the transition covers the
// document fetch by holding the old frame until the new one is ready.
import { ProcessCanvas } from "./repository-process-map";
import {
  bypassersOf,
  isCapability,
  layerNode,
  methodsRealizing,
  nodesWithEntries,
  routeOf,
  rootCapabilities,
  type LayerCorpusEntry,
  type LayerGraph,
} from "../lib/repository/layers";
import {
  layoutProcessMap,
  mapHref,
  resolveZoom,
  zoomHref,
  MAP_ZOOMS,
  type MapZoom,
  type ProcessDiagram,
} from "../lib/repository/process-layout";
import { ancestorPath } from "../lib/repository/strand-layout";
import { STATE_VOCABULARY } from "../lib/repository/state-vocabulary";
import { layerState, specializationsOf } from "../lib/repository/states";
import { viewSwitchLabels } from "./repository-strand-view";
import type { PublicLocale } from "../lib/public-locale";

/**
 * How deep the map will draw an expansion it has been asked for.
 *
 * It was 1, with a comment saying nesting a slot inside a lane puts the parent's
 * circles on a line running through the middle of the nested block and their
 * names spill sideways into it. That was true and it was a diagnosis about
 * **names**: state names are now in `<title>` on the owner's brief, so they have
 * no extent to spill. What is left is circles and lines, which the column model
 * has always kept apart.
 *
 * This is a ceiling, not a setting. Nothing expands unless its id is in `?open=`,
 * so what a reader sees is what they clicked; this only says how far a chain of
 * deliberate clicks may go before the map stops following. Four is past anything
 * in the graph today — the deepest recorded chain is three — so it binds on a
 * hand-written URL rather than on a reader.
 */
export const MAP_DEPTH = 4;

/**
 * How many slots `?open=` may name at once.
 *
 * The parameter is user-supplied and drives a recursive layout, so it is
 * bounded. It lives here rather than in the page because the page enforces it
 * and this component *reports* it, and those two numbers must be one number.
 * Twenty-four is past anything a reader reaches by clicking — the whole authored
 * graph fully opened from its widest root names fewer.
 */
export const MAP_OPEN_MAX = 24;

interface MapViewCopy {
  heading: string;
  lede: string;
  ledeOverview: string;
  reading: string;
  rail: string;
  path: string;
  ways: string;
  around: string;
  noneAround: string;
  noneWays: string;
  narrower: string;
  noNarrower: string;
  writeUp: string;
  collapsed: (n: number) => string;
  allOpen: string;
  droppedOpen: (n: number, max: number) => string;
  routes: (delegated: number, partly: number, whole: number) => string;
  legendSlot: string;
  legendMethod: string;
  legendState: string;
  legendShut: string;
  legendEmpty: string;
  legendTie: string;
  legendFeed: string;
  legendAtlas: string;
  back: string;
  zoomLabel: string;
  zoomFit: string;
  zoomPercent: (n: number) => string;
}

const COPY: Record<"en" | "ja", MapViewCopy> = {
  en: {
    heading: "Layers",
    lede: "A circle is something you are holding. A line is work that turns one into another. Thick lines have recorded ways through them — open one and its alternatives fan out between the same two circles.",
    ledeOverview:
      "Four problems nothing else needs — the places a reader arrives. Open one to see the routes through it.",
    reading:
      "Click a line to open it. Click a circle to read what that object is. A route that skips a layer is just a longer line.",
    rail: "Where you are",
    path: "Path",
    ways: "Ways through",
    around: "Routes that skip it",
    noneAround: "No recorded route avoids this step.",
    noneWays: "No method is recorded for this slot yet.",
    narrower: "Narrower kinds",
    noNarrower: "Nothing recorded is a narrower kind of this.",
    writeUp: "Read the full write-up",
    collapsed: (n: number) =>
      `${n} line${n === 1 ? " has" : "s have"} ways through that you have not opened.`,
    allOpen: "Everything on this map is open.",
    droppedOpen: (n: number, max: number) =>
      `This link asked for ${n} more ${n === 1 ? "slot" : "slots"} than the map will open at once. `
      + `${max} are drawn; the rest are shown shut. Open them from the map instead of the address bar.`,
    routes: (delegated: number, partly: number, whole: number) =>
      `Of the routes that have been taken apart, ${delegated} are built entirely from named slots, ${partly} hand off part of the work and finish the rest themselves, and ${whole} are one undivided act. None of the three is a defect; they are different things to reuse.`,
    legendSlot: "a slot — click to open",
    legendMethod: "a method — click to read",
    legendState: "an object you are holding",
    legendShut: "ways through, not opened",
    legendEmpty: "nothing recorded fills it",
    legendTie: "the same object on both routes",
    legendFeed: "an ingredient the route needs",
    legendAtlas: "the Atlas has a full record of it",
    back: "All four",
    zoomLabel: "Size",
    zoomFit: "Fit",
    zoomPercent: (n: number) => `${n}%`,
  },
  ja: {
    heading: "階層",
    lede: "円は、いま手にしている対象です。線は、ある対象を別の対象に変える作業です。太い線には記録された通り道があり、開くと同じ二つの円のあいだに選択肢が広がります。",
    ledeOverview:
      "他のどの手法からも必要とされない四つの問題 — 読者が最初に立つ場所です。開くと、そこを通る経路が見えます。",
    reading:
      "線をクリックすると開きます。円をクリックすると、その対象の説明を読めます。階層を飛ばす経路は、単に長い線として描かれます。",
    rail: "現在地",
    path: "経路",
    ways: "通り道",
    around: "この枠を飛ばす経路",
    noneAround: "この手順を回避する経路は記録されていません。",
    noneWays: "この枠を満たす手法はまだ記録されていません。",
    narrower: "より狭い種類",
    noNarrower: "これより狭い種類として記録されているものはありません。",
    writeUp: "解説を全文読む",
    collapsed: (n: number) => `まだ開いていない通り道をもつ線が ${n} 本あります。`,
    allOpen: "このマップ上で閉じているものはありません。",
    droppedOpen: (n: number, max: number) =>
      `このリンクは、同時に開ける上限より ${n} 件多くの枠を要求しました。${max} 件を描画し、残りは閉じたまま表示しています。アドレスバーではなくマップ上から開いてください。`,
    routes: (delegated: number, partly: number, whole: number) =>
      `分解されている経路のうち、${delegated} 件は名前のついた枠だけで構成され、${partly} 件は一部を枠に委ね残りを自身で行い、${whole} 件は分けられないひとつの作業です。いずれも欠陥ではなく、再利用の単位が違うということです。`,
    legendSlot: "枠 — クリックで展開",
    legendMethod: "手法 — クリックで解説",
    legendState: "手にしている対象",
    legendShut: "通り道あり・未展開",
    legendEmpty: "記録された手法なし",
    legendTie: "どちらの経路でも同じ対象",
    legendFeed: "経路に必要な材料",
    legendAtlas: "アトラスに完全な記録あり",
    back: "四つすべて",
    zoomLabel: "表示倍率",
    zoomFit: "全体表示",
    zoomPercent: (n: number) => `${n}%`,
  },
};

// Re-exported so a page importing this surface gets its parameter parser from
// the same place it gets the view. The definitions live in `process-layout.ts`
// beside `slotHref`, which builds the other half of the same address.
export { MAP_ZOOMS, mapHref, resolveZoom, zoomHref, type MapZoom };

function copyFor(locale: PublicLocale): MapViewCopy {
  return locale === "ja" ? COPY.ja : COPY.en;
}

/**
 * The size control: six links, one of them the one you are on.
 *
 * Deliberately **not** a `<select>` and not a slider. Session 91 took three
 * `<select>`s off the Atlas for the same reason and replaced them with 45
 * addressable option links; this is that rule reaching the last surface without
 * one.
 *
 * The current rung is a `<strong aria-current>` rather than a link to itself,
 * which is the convention the rail already uses for "you are here".
 */
export function ZoomControl({
  current,
  hrefFor,
  copy,
}: {
  current: MapZoom | null;
  /** Built by the surface, because only it knows what else is in its URL. */
  hrefFor: (zoom: MapZoom | null) => string;
  copy: { zoomLabel: string; zoomFit: string; zoomPercent: (n: number) => string };
}): React.ReactElement {
  const rungs: (MapZoom | null)[] = [null, ...MAP_ZOOMS];
  return (
    <div className="mj-process-zoom" role="group" aria-label={copy.zoomLabel}>
      <span className="mj-process-zoom-label">{copy.zoomLabel}</span>
      {rungs.map((rung) => {
        const text = rung === null ? copy.zoomFit : copy.zoomPercent(rung);
        return rung === current ? (
          <strong key={String(rung)} aria-current="true">
            {text}
          </strong>
        ) : (
          <a key={String(rung)} href={hrefFor(rung)}>
            {text}
          </a>
        );
      })}
    </div>
  );
}

/**
 * A mark drawn as real SVG reusing the canvas's own class names, so a
 * stylesheet change reaches the key and the diagram together. Copying the shapes
 * into a second set of classes is how a legend starts describing a picture that
 * no longer looks like that.
 */
function LegendMark({
  kind,
}: {
  kind: "slot" | "method" | "state" | "shut" | "empty" | "tie" | "feed" | "atlas";
}): React.ReactElement {
  const common = { width: 34, height: 16, viewBox: "0 0 34 16", "aria-hidden": true } as const;
  // The mark for "the Atlas holds a record of this" is drawn on the **name**,
  // not on the line, so the key has to show a name. Real text through the real
  // class, for the same reason every other mark here is real SVG: a hand-drawn
  // approximation is how a key starts describing something the canvas stopped
  // doing.
  if (kind === "atlas") {
    return (
      <svg className="mj-strand-legend-mark mj-process-key" {...common}>
        <g className="mj-process mj-process--slot mj-process--collapsed mj-process--atlas">
          <text className="mj-process-name" x="17" y="12" textAnchor="middle">
            abc
          </text>
        </g>
      </svg>
    );
  }
  if (kind === "state") {
    return (
      <svg className="mj-strand-legend-mark mj-process-key" {...common}>
        <g className="mj-process-state">
          <circle className="mj-process-dot" cx="17" cy="8" r="5" />
        </g>
      </svg>
    );
  }
  if (kind === "tie") {
    return (
      <svg className="mj-strand-legend-mark mj-process-key" {...common}>
        <g className="mj-process-tie mj-process-tie--same">
          <line x1="17" y1="2" x2="17" y2="14" />
        </g>
      </svg>
    );
  }
  if (kind === "feed") {
    return (
      <svg className="mj-strand-legend-mark mj-process-key" {...common}>
        <g className="mj-process-feed">
          <line x1="12" y1="3" x2="12" y2="13" />
        </g>
      </svg>
    );
  }
  const state = kind === "shut" ? "collapsed" : kind === "empty" ? "unfilled" : "leaf";
  const weight = kind === "method" ? "method" : "slot";
  return (
    <svg className="mj-strand-legend-mark mj-process-key" {...common}>
      <g className={`mj-process mj-process--${weight} mj-process--${state}`}>
        <line className="mj-process-line" x1="2" y1="8" x2="32" y2="8" />
        {kind === "shut" ? (
          <line className="mj-process-line-inner" x1="5" y1="11.5" x2="29" y2="11.5" />
        ) : null}
      </g>
    </svg>
  );
}

function Legend({ copy }: { copy: MapViewCopy }): React.ReactElement {
  const items: [Parameters<typeof LegendMark>[0]["kind"], string][] = [
    ["state", copy.legendState],
    ["slot", copy.legendSlot],
    ["method", copy.legendMethod],
    ["shut", copy.legendShut],
    ["empty", copy.legendEmpty],
    ["tie", copy.legendTie],
    ["feed", copy.legendFeed],
    ["atlas", copy.legendAtlas],
  ];
  return (
    <ul className="mj-strand-legend">
      {items.map(([kind, label]) => (
        <li key={kind}>
          <LegendMark kind={kind} />
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The rail. Every section states its own emptiness in a sentence rather than
 * rendering nothing — silence in a panel reads as "nothing to say here" when
 * what it means is "nobody has recorded this".
 */
function Rail({
  graph,
  focusId,
  locale,
  copy,
  openIds,
  zoom,
}: {
  graph: LayerGraph;
  focusId: string;
  locale: PublicLocale;
  copy: MapViewCopy;
  /**
   * What the reader has expanded. Carried by the path for the same reason
   * `zoom` is: the breadcrumb re-focuses *this* map, and arriving with the
   * expansions dropped is arriving somewhere else.
   */
  openIds: ReadonlySet<string>;
  /** Carried by the path, which re-focuses this same map. See `ZoomControl`. */
  zoom: MapZoom | null;
}): React.ReactElement | null {
  const node = layerNode(graph, focusId);
  if (!node || !isCapability(node)) return null;
  const label = (item: { label: string; labelJa: string }) =>
    locale === "ja" ? item.labelJa : item.label;

  const path = ancestorPath(graph, focusId);
  const ways = methodsRealizing(graph, focusId);
  const around = bypassersOf(graph, focusId);
  const endState = layerState(STATE_VOCABULARY, node.contract.to);
  const narrower = endState ? specializationsOf(STATE_VOCABULARY, endState.id) : [];

  return (
    <details className="mj-strand-rail" open>
      <summary>{copy.rail}</summary>
      <div className="mj-strand-rail-body">
        <section>
          <h3>{copy.path}</h3>
          <ol className="mj-strand-rail-path">
            {path.map((item) => (
              <li key={item.id}>
                {item.id === focusId ? (
                  <strong aria-current="true">{label(item)}</strong>
                ) : (
                  <a href={mapHref(item.id, openIds, zoom)}>{label(item)}</a>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h3>
            {copy.ways}
            {ways.length > 0 ? <span className="mj-strand-rail-count">{ways.length}</span> : null}
          </h3>
          {ways.length === 0 ? (
            <p className="mj-strand-rail-none">{copy.noneWays}</p>
          ) : (
            <ul>
              {ways.map((method) => (
                <li key={method.id}>
                  <a href={`/repository/layers/${method.id}`}>{label(method)}</a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>{copy.around}</h3>
          {around.length === 0 ? (
            <p className="mj-strand-rail-none">{copy.noneAround}</p>
          ) : (
            <ul>
              {around.map((method) => (
                <li key={method.id}>
                  <a href={`/repository/layers/${method.id}`}>{label(method)}</a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* What this slot leaves you holding, and the narrower kinds of it. The
            vertical relation on the canvas is the same fact; a reader who has
            not spotted it there can read it here. */}
        <section>
          <h3>{copy.narrower}</h3>
          {narrower.length === 0 ? (
            <p className="mj-strand-rail-none">{copy.noNarrower}</p>
          ) : (
            <ul>
              {narrower.map((state) => (
                <li key={state.id}>
                  <a href={`/repository/layers/${state.id}`}>{label(state)}</a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mj-strand-rail-writeup">
          <a href={`/repository/layers/${focusId}`}>{copy.writeUp}</a>
        </p>
      </div>
    </details>
  );
}

export function ProcessMapView({
  graph,
  corpus,
  locale,
  focusId,
  openIds,
  droppedOpen = 0,
  zoom = null,
}: {
  graph: LayerGraph;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
  focusId: string | null;
  openIds: ReadonlySet<string>;
  droppedOpen?: number;
  zoom?: MapZoom | null;
}): React.ReactElement {
  const copy = copyFor(locale);
  const nav = viewSwitchLabels(locale);
  const roots = rootCapabilities(graph);
  const shown = focusId ? [layerNode(graph, focusId)].filter(isCapabilityNode) : roots;
  // Which of these shapes the Atlas holds a full record for. The owner's
  // framing: *"atlas has everything about specific algorithms, while this map
  // has everything including how they fit in"* — so the map says where the two
  // meet, and says it against the corpus that actually loaded rather than
  // against the graph's own optimism.
  const atlas = nodesWithEntries(graph, new Set(corpus.map((entry) => entry.slug)));

  // `?open=` is what a reader clicked; the focused slot joins it because arriving
  // at a slot's own view with it shut would show a reader the one line they just
  // asked to see the inside of.
  const open: ReadonlySet<string> = new Set([...openIds, ...(focusId ? [focusId] : [])]);
  const diagrams: { id: string; diagram: ProcessDiagram }[] = shown.map((capability) => ({
    id: capability.id,
    diagram: layoutProcessMap(
      graph,
      STATE_VOCABULARY,
      capability.id,
      locale,
      open,
      MAP_DEPTH,
      focusId,
      zoom,
    ),
  }));
  const collapsed = diagrams.reduce((total, entry) => total + entry.diagram.collapsedCount, 0);

  // The three route shapes, counted from the graph rather than typed into copy:
  // a number written into a translated sentence is a second copy of a fact and
  // nothing fails when it drifts.
  const decomposed = graph.nodes
    .filter((node) => node.kind === "method" && node.steps.length > 0)
    .map((node) => routeOf(graph, STATE_VOCABULARY, node as never));
  const delegated = decomposed.filter((route) => route.coverage === "delegated").length;
  const partly = decomposed.filter((route) => route.coverage === "partly-own").length;
  const whole = decomposed.filter((route) => route.coverage === "all-own").length;

  return (
    <section className="mj-strand-view mj-process-view" aria-labelledby="layers-heading">
      <div className="mj-strand-controls">
        <div className="mj-strand-switch" role="group" aria-label={nav.view}>
          <span className="mj-strand-switch-label">{nav.view}</span>
          <span className="mj-strand-switch-on">{nav.map}</span>
          <a href="/repository/layers?view=strands">{nav.strands}</a>
          <a href="/repository/layers?view=list">{nav.list}</a>
        </div>
        {focusId ? (
          <a className="mj-strand-back" href={mapHref(null, openIds, zoom)}>
            {copy.back}
          </a>
        ) : null}
      </div>


      {/* One line of orientation, then the picture.
          What used to be here was an `<h1>`, two full paragraphs and a
          seven-item key — around 450px of reading before the map began, on a
          surface whose whole argument is the map. *"i want the main map screen
          to be one big continuous surface"*, owner, session 94. The second
          paragraph and the key are the same words, moved below the drawing:
          both are things a reader consults *about* a picture they can already
          see, and neither is something they need before it. */}
      <div className="mj-strand-head">
        <h1 id="layers-heading">{copy.heading}</h1>
        <p className="mj-strand-lede">{focusId ? copy.lede : copy.ledeOverview}</p>
      </div>

      {/* Directly above the thing it sizes — a control for the picture, not for
          the page. The map is 1,046px wide for four routes and wider than that
          focused, and until now the only answer to a drawing that does not fit
          the column was to scroll it sideways: *"they can zoom in and out of the
          page on their own"*, owner, session 92. Every line's toggle carries the
          choice, so opening a slot does not quietly undo it. */}
      <ZoomControl current={zoom} hrefFor={(next) => zoomHref(focusId, openIds, next)} copy={copy} />

      <div className="mj-strand-body">
        <div>
          {diagrams.map((entry) => (
            <ProcessCanvas
              key={entry.id}
              diagram={entry.diagram}
              locale={locale}
              title={labelOfNode(graph, entry.id, locale)}
              scale={zoom === null ? null : zoom / 100}
              subjectId={entry.id}
              atlas={atlas}
            />
          ))}
          <p className="mj-strand-note">
            {collapsed > 0 ? copy.collapsed(collapsed) : copy.allOpen}
          </p>
          {/* The `?open=` cap, said out loud. It is bounded because the parameter
              is user-supplied and drives a recursive layout, and a cap a reader
              cannot see is a map quietly missing something they asked for. */}
          {droppedOpen > 0 ? (
            <p className="mj-strand-note">{copy.droppedOpen(droppedOpen, MAP_OPEN_MAX)}</p>
          ) : null}
          <p className="mj-strand-note">{copy.routes(delegated, partly, whole)}</p>
        </div>
        {focusId ? (
          <Rail graph={graph} focusId={focusId} locale={locale} copy={copy} openIds={openIds} zoom={zoom} />
        ) : null}
      </div>

      {/* The key, under the thing it is a key to. */}
      <div className="mj-strand-key">
        <p className="mj-strand-lede">{copy.reading}</p>
        <Legend copy={copy} />
      </div>
    </section>
  );
}

function isCapabilityNode(node: ReturnType<typeof layerNode>): node is Exclude<
  ReturnType<typeof layerNode>,
  null
> & { kind: "capability" } {
  return node !== null && node.kind === "capability";
}

function labelOfNode(graph: LayerGraph, id: string, locale: PublicLocale): string {
  const node = layerNode(graph, id);
  if (!node) return id;
  return locale === "ja" ? node.labelJa : node.label;
}
