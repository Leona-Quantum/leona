// The surface around the process map: the switch, the legend, the rail.
//
// Everything here is a server component. The only interactive elements are
// `<Link>`s and one `<details>`, which is the same rule the strand view follows
// and the same reason: a control that only works after hydration has no address,
// so it cannot be linked, sent, bookmarked, crawled, or checked with `curl`
// (D88.2). Opening a slot on this map is a link, not a click handler — which is
// why `?open=` carries a set of ids rather than component state.
import Link from "next/link";
import { ProcessCanvas } from "./repository-process-map";
import {
  bypassersOf,
  isCapability,
  layerNode,
  methodsRealizing,
  routeOf,
  rootCapabilities,
  type LayerCorpusEntry,
  type LayerGraph,
} from "../lib/repository/layers";
import { layoutProcessMap, type ProcessDiagram } from "../lib/repository/process-layout";
import { ancestorPath } from "../lib/repository/strand-layout";
import { STATE_VOCABULARY } from "../lib/repository/state-vocabulary";
import { layerState, specializationsOf } from "../lib/repository/states";
import { viewSwitchLabels } from "./repository-strand-view";
import type { PublicLocale } from "../lib/public-locale";

/**
 * The map opens exactly one slot at a time and there is no depth control.
 *
 * Not a simplification for its own sake: nesting a second slot inside a lane
 * puts the parent's circles on a line running through the middle of the nested
 * block, and their names spill sideways into it. Drilling down instead is the
 * owner's own model and it is the version that keeps the no-overlap guarantee.
 */
export const MAP_DEPTH = 1;

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
  routes: (delegated: number, partly: number, whole: number) => string;
  legendSlot: string;
  legendMethod: string;
  legendState: string;
  legendShut: string;
  legendEmpty: string;
  legendTie: string;
  legendFeed: string;
  back: string;
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
    routes: (delegated: number, partly: number, whole: number) =>
      `Of the routes that have been taken apart, ${delegated} are built entirely from named slots, ${partly} hand off part of the work and finish the rest themselves, and ${whole} are one undivided act. None of the three is a defect; they are different things to reuse.`,
    legendSlot: "a slot — click to open",
    legendMethod: "a method — click to read",
    legendState: "an object you are holding",
    legendShut: "ways through, not opened",
    legendEmpty: "nothing recorded fills it",
    legendTie: "the same object on both routes",
    legendFeed: "an ingredient the route needs",
    back: "All four",
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
    routes: (delegated: number, partly: number, whole: number) =>
      `分解されている経路のうち、${delegated} 件は名前のついた枠だけで構成され、${partly} 件は一部を枠に委ね残りを自身で行い、${whole} 件は分けられないひとつの作業です。いずれも欠陥ではなく、再利用の単位が違うということです。`,
    legendSlot: "枠 — クリックで展開",
    legendMethod: "手法 — クリックで解説",
    legendState: "手にしている対象",
    legendShut: "通り道あり・未展開",
    legendEmpty: "記録された手法なし",
    legendTie: "どちらの経路でも同じ対象",
    legendFeed: "経路に必要な材料",
    back: "四つすべて",
  },
};

function copyFor(locale: PublicLocale): MapViewCopy {
  return locale === "ja" ? COPY.ja : COPY.en;
}

/**
 * The map's address.
 *
 * `?focus=` is the whole state: which slot you are standing in, opened. Defaults
 * are omitted so the overview keeps one canonical URL.
 */
export function mapHref(focus: string | null): string {
  const params = new URLSearchParams({ view: "map" });
  if (focus) params.set("focus", focus);
  return `/repository/layers?${params.toString()}`;
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
  kind: "slot" | "method" | "state" | "shut" | "empty" | "tie" | "feed";
}): React.ReactElement {
  const common = { width: 34, height: 16, viewBox: "0 0 34 16", "aria-hidden": true } as const;
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
}: {
  graph: LayerGraph;
  focusId: string;
  locale: PublicLocale;
  copy: MapViewCopy;
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
                  <Link href={mapHref(item.id)}>{label(item)}</Link>
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
                  <Link href={`/repository/layers/${method.id}`}>{label(method)}</Link>
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
                  <Link href={`/repository/layers/${method.id}`}>{label(method)}</Link>
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
                  <Link href={`/repository/layers/${state.id}`}>{label(state)}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mj-strand-rail-writeup">
          <Link href={`/repository/layers/${focusId}`}>{copy.writeUp}</Link>
        </p>
      </div>
    </details>
  );
}

export function ProcessMapView({
  graph,
  corpus: _corpus,
  locale,
  focusId,
}: {
  graph: LayerGraph;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
  focusId: string | null;
}): React.ReactElement {
  const copy = copyFor(locale);
  const nav = viewSwitchLabels(locale);
  const roots = rootCapabilities(graph);
  const shown = focusId ? [layerNode(graph, focusId)].filter(isCapabilityNode) : roots;

  // The focused slot is the one that opens; on the overview nothing does.
  const open: ReadonlySet<string> = new Set(focusId ? [focusId] : []);
  const diagrams: { id: string; diagram: ProcessDiagram }[] = shown.map((capability) => ({
    id: capability.id,
    diagram: layoutProcessMap(graph, STATE_VOCABULARY, capability.id, locale, open, MAP_DEPTH),
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
          <Link href="/repository/layers?view=strands">{nav.strands}</Link>
          <Link href="/repository/layers?view=list">{nav.list}</Link>
        </div>
        {focusId ? (
          <Link className="mj-strand-back" href={mapHref(null)}>
            {copy.back}
          </Link>
        ) : null}
      </div>

      <div className="mj-strand-head">
        <h1 id="layers-heading">{copy.heading}</h1>
        <p className="mj-strand-lede">{focusId ? copy.lede : copy.ledeOverview}</p>
        <p className="mj-strand-lede">{copy.reading}</p>
      </div>

      <Legend copy={copy} />

      <div className="mj-strand-body">
        <div>
          {diagrams.map((entry) => (
            <ProcessCanvas
              key={entry.id}
              diagram={entry.diagram}
              locale={locale}
              title={labelOfNode(graph, entry.id, locale)}
            />
          ))}
          <p className="mj-strand-note">
            {collapsed > 0 ? copy.collapsed(collapsed) : copy.allOpen}
          </p>
          <p className="mj-strand-note">{copy.routes(delegated, partly, whole)}</p>
        </div>
        {focusId ? (
          <Rail graph={graph} focusId={focusId} locale={locale} copy={copy} />
        ) : null}
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
