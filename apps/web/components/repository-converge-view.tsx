// The surface around the convergence canvas — and, since this session, the only
// drawing of the layer graph there is, on a page that is now nothing but the
// drawing.
//
// > *"The map page is an infinite canvas that takes up the entire page, only
// > with an option/arrow to go back to the atlas page and a small overlayed
// > information icon both in the top left … Overly pedantic explanations like
// > what is on the page right now should be removed — users can figure out
// > EXACT functionality as they interact."* — owner, ask H
//
// So the h1, the lede, the size rungs, the notes under the canvas, the key, the
// rail and the two disclosures are all off the visible page. Two of them are
// **not** deleted, because they were never decoration:
//
//   - **The linear reading** moves, whole, into `.mj-map-reading` at the end of
//     the document. That block is clipped to a pixel rather than removed, so a
//     screen reader still reads it, `curl` still returns it, a printout still
//     carries it (see the `@media print` rule beside the class), and a keyboard
//     reader who Tabs into it gets it revealed — every link in it is still a
//     link somebody can reach. Nothing in it is a control the visible surface
//     needs, and everything in it states a fact the canvas states in a pattern.
//   - **The key** moves into the information box, `map-info-popup.tsx` §2,
//     drawn with the canvas's own marks.
//
// The size rungs move into that box as well rather than into the clipped
// reading, because they are a control and not a reading: D88.2 says a named
// size has to stay clickable for somebody with no JavaScript, and the box is
// the one place left on this page where such a reader can click one.
//
// Map, Strands and List are retired. That decision was the owner's and it had
// been open for four sessions behind a contradiction their own notes recorded:
// NEXT.md called the retirement safe, and the comment on `resolveView` said
// `?view=list` was still the linear, screen-reader and print reading (D90.2).
// Both were true, which is why neither could settle it. The retirement is safe
// **once converge covers what they covered**, so this file now carries the four
// things only the older surfaces had:
//
//   1. the rail — where you are, what fills this slot, what skips it, what
//      narrower kinds of the object exist (from the map and the strand view);
//   2. the key — what every mark on the canvas means (from both);
//   3. the four-root overview — the places a reader arrives, drawn rather than
//      listed, which was the map's unfocused state;
//   4. the linear reading — every line and every object as text, in order, with
//      the nesting made explicit. This is the one that mattered: it is what a
//      screen reader, a printout and `curl` get, and it is what the List view
//      was for. It is now better than the List was, because it says the standing
//      of every line in words and the List never did.
//
// Server component throughout, same rule as every other Atlas surface: what a
// reader has opened lives in `?open=` and where they have panned lives in
// `?at=`, because a control that works only after hydration has no address
// (D88.2). Plain anchors rather than `next/link`, for the reason session 95
// recorded — a `<Link>` is a same-document navigation and that is the one kind
// `@view-transition { navigation: auto }` does not animate, so using one here
// would silently delete the zoom this surface is built around.
import { LayerCensusPanel } from "./repository-layers";
import { ConvergeCanvas } from "./repository-converge-map";
import { CanvasContinuity } from "./canvas-continuity";
import { InfiniteCanvas } from "./infinite-canvas";
import { MapInfoPopup } from "./map-info-popup";
import { ArrowLeftIcon, InfoIcon } from "./icons";
import {
  MAP_ABOUT_SECTIONS,
  withAbout,
  type MapAboutSection,
} from "../lib/repository/map-about";
import {
  parseCardSection,
  withCard,
  withCardSection,
  type CardSelection,
} from "../lib/repository/map-card";
import { cardFor, cardSections } from "../lib/repository/card-content";
import { MapCardPanel } from "./map-card-panel";
import {
  CONVERGE_OPEN_MAX,
  convergingSlots,
  crossingsAt,
  drawableSlots,
  figureHref,
  layoutConverge,
  legendMark,
  spokenName,
  type ConvergeDiagram,
  type ConvergeLane,
} from "../lib/repository/converge-layout";
import { convergeNotes } from "../lib/repository/converge-notes";
import { expansionOf } from "../lib/repository/state-graph";
import { ancestorPath } from "../lib/repository/strand-layout";
import { formatViewport, IDENTITY, type Viewport } from "../lib/repository/canvas-viewport";
import {
  bypassersOf,
  isCapability,
  layerNode,
  methodsRealizing,
  nodesWithEntries,
  rootCapabilities,
  routeOf,
  type LayerCorpusEntry,
  type LayerGraph,
} from "../lib/repository/layers";
import { STATE_VOCABULARY } from "../lib/repository/state-vocabulary";
import { PAPER_REGISTER } from "../lib/repository/paper-register";
import { layerState, specializationsOf } from "../lib/repository/states";
import type { PublicLocale } from "../lib/public-locale";

interface ConvergeCopy {
  heading: string;
  lede: string;
  ledeFan: string;
  ledeOverview: string;
  grainStates: (interior: number) => string;
  grainMethods: (n: number, slot: string) => string;
  truncatedNote: string;
  inconsistentNote: string;
  collapsed: (n: number) => string;
  allOpen: string;
  linesHeading: string;
  /** Opens this process's card, here, without leaving the figure. */
  openCard: string;
  ownPage: string;
  pickAll: string;
  pickConverging: (n: number) => string;
  nothing: string;
  legendUnpublished: string;
  legendUnpinned: string;
  legendStrand: string;
  legendOpen: string;
  /**
   * The heading over the clipped reading.
   *
   * The four legend strings that used to sit beside it — the shared circle, the
   * inner circle, the ingredient line, the dotted-underlined name — are gone
   * from this file, because the key is now drawn in the information box (§2 of
   * `map-info-popup.tsx`) and a legend written twice is a legend that starts
   * describing two different pictures. What is left here are the two standings
   * `Lines` states in words and the two words it labels an opened line with,
   * all four of which are read out per line rather than as a key.
   */
  readingSummary: string;
  censusSummary: string;
  meets: (state: string, arriving: number, leaving: number) => string;
  unpublishedNote: (n: number) => string;
  noneUnpublished: string;
  crossHeading: (state: string) => string;
  crossTally: (total: number, recorded: number, unpinned: number, unpublished: number) => string;
  crossNone: string;
  crossMore: (shown: number, total: number) => string;
  crossCaveat: string;
  rail: string;
  path: string;
  ways: string;
  /**
   * The same heading with its count in it.
   *
   * The count used to be a `<span>` immediately after the label and rendered
   * `ways through7` — read on the page, and the reason a count has to arrive
   * through a copy function rather than as a sibling node: the separator
   * between a label and a number is part of the sentence, it differs by
   * language, and CSS is not where a sentence gets punctuated.
   */
  waysCount: (n: number) => string;
  around: string;
  noneAround: string;
  noneWays: string;
  narrower: string;
  noNarrower: string;
  writeUp: string;
  back: string;
  sizeLabel: string;
  sizeFit: string;
  sizePercent: (n: number) => string;
  opens: (n: number) => string;
  inside: string;
  needs: string;
  routes: (delegated: number, partly: number, whole: number) => string;
  canvasLabel: (subject: string) => string;
  /** The two overlay controls, which have icons and no visible label. */
  backToAtlas: string;
  openInfo: string;
  closeInfo: string;
  /** Names the clipped reading for a screen reader and for a printout. */
  readingRegion: string;
}

const COPY: Record<"en" | "ja", ConvergeCopy> = {
  en: {
    heading: "Where the routes meet",
    lede:
      "Every circle is drawn once. Several ways of getting somewhere end on the same circle, and every way onward leaves from it — so a route you can take is any line in, followed by any line out, whether or not a paper has put those two together.",
    ledeFan:
      "Every circle is drawn once. This step has no smaller object recorded inside it, so the strands between its two circles are the recorded ways of taking it — one strand per method.",
    ledeOverview:
      "Four problems nothing else needs — the places a reader arrives. Open a line to see what is recorded inside it, or click its name to go there.",
    grainStates: (interior: number) =>
      `The ${interior === 1 ? "circle" : `${interior} circles`} between the ends ${interior === 1 ? "is an object" : "are objects"} every way across passes through.`,
    grainMethods: (n: number, slot: string) =>
      `${n} recorded ${n === 1 ? "way" : "ways"} of doing ${slot}. Nothing smaller is recorded inside it, so there is no object in the middle to draw.`,
    truncatedNote:
      "The search for ways across hit its limit, so this figure is part of what the graph records rather than all of it.",
    inconsistentNote:
      "The shared objects are met in a different order on different routes, so they are not drawn as one line.",
    collapsed: (n: number) =>
      `${n} line${n === 1 ? " has" : "s have"} something recorded inside that you have not opened.`,
    allOpen: "Everything on this figure that opens is open.",
    linesHeading: "The lines on this figure",
    openCard: "Open the card",
    ownPage: "Read the full write-up",
    pickAll: "Every step you can open",
    pickConverging: (n: number) =>
      `${n} of these have an object recorded in the middle; the rest open into the methods that fill them.`,
    nothing: "Nothing recorded goes through this in more than one way.",
    legendUnpublished: "no recorded source takes this path",
    legendUnpinned: "recorded, but no source names which method",
    legendStrand: "a way across — click it to open it here",
    legendOpen: "opened: what was inside is drawn in its place",
    readingSummary: "Every line on this figure, in words",
    censusSummary: "What is on this map, counted",
    meets: (state: string, arriving: number, leaving: number) =>
      `${arriving} way${arriving === 1 ? "" : "s"} arrive at ${state} and ${leaving} lead on, so ${arriving * leaving} routes cross it.`,
    unpublishedNote: (n: number) =>
      `${n} line${n === 1 ? "" : "s"} here ${n === 1 ? "is" : "are"} a composition no recorded source takes. That is a fact about this graph, not a claim about the literature.`,
    noneUnpublished: "Every line on this figure is one a recorded source takes.",
    crossHeading: (state: string) => `Ways through ${state}`,
    crossTally: (total: number, recorded: number, unpinned: number, unpublished: number) =>
      `${total} combinations cross this circle. A source records ${recorded} of them end to end. ${unpinned} cross slots a source does record, without naming which method fills them. ${unpublished} are compositions no recorded source takes.`,
    crossNone: "No recorded source leaves any of these unwalked.",
    crossMore: (shown: number, total: number) => `Showing ${shown} of ${total}.`,
    crossCaveat:
      "These are derived from the two contracts each line carries, not proposed. A line here says the object one process hands back is the object the next one takes — nothing about whether it is a good idea, and nothing about whether the literature has missed it.",
    rail: "Where you are",
    path: "Path",
    ways: "Ways through",
    waysCount: (n: number) => `Ways through: ${n}`,
    around: "Routes that skip it",
    noneAround: "No recorded route avoids this step.",
    noneWays: "No method is recorded for this slot yet.",
    narrower: "Narrower kinds",
    noNarrower: "Nothing recorded is a narrower kind of this.",
    writeUp: "Read the full write-up",
    back: "All four",
    sizeLabel: "Size",
    sizeFit: "Back to the start",
    sizePercent: (n: number) => `${n}%`,
    opens: (n: number) => `opens into ${n}`,
    inside: "open",
    needs: "needs",
    routes: (delegated: number, partly: number, whole: number) =>
      `Of the routes that have been taken apart, ${delegated} are built entirely from named slots, ${partly} hand off part of the work and finish the rest themselves, and ${whole} are one undivided act. None of the three is a defect; they are different things to reuse.`,
    canvasLabel: (subject: string) =>
      `${subject} — drag to move the figure, pinch or ctrl-scroll to zoom, arrow keys to pan, 0 to reset`,
    backToAtlas: "Back to the Atlas",
    openInfo: "About this map",
    closeInfo: "Close",
    readingRegion: "This figure in words",
  },
  ja: {
    heading: "経路が合流する場所",
    lede:
      "円はひとつずつ描かれます。ある場所に至る複数の道はすべて同じ円で終わり、そこから先へ向かう道はすべてその円から出ます。したがって、入る線と出る線の任意の組み合わせが、たどりうる経路になります。論文がその二つを結びつけているかどうかとは無関係です。",
    ledeFan:
      "円はひとつずつ描かれます。この工程の内側により小さな対象は記録されていないため、二つの円のあいだの帯は、この工程を行う記録された手法そのものです。手法ひとつにつき一本です。",
    ledeOverview:
      "他のどの手法からも必要とされない四つの問題 — 読者が最初に立つ場所です。線をクリックすると内側が開き、名前をクリックするとそこへ移動します。",
    grainStates: (interior: number) =>
      `両端のあいだにある ${interior} 個の円は、どの道を通っても必ず経由する対象です。`,
    grainMethods: (n: number, slot: string) =>
      `${slot}を行う記録された手法が ${n} 件あります。内側により小さな対象は記録されていないため、中間に描く対象はありません。`,
    truncatedNote:
      "経路の探索が上限に達したため、この図はグラフが記録する全体ではなく、その一部です。",
    inconsistentNote:
      "共有される対象に出会う順序が経路によって異なるため、ひとつの線としては描いていません。",
    collapsed: (n: number) => `内側に記録がありまだ開いていない線が ${n} 本あります。`,
    allOpen: "この図で開ける線はすべて開いています。",
    linesHeading: "この図の線",
    openCard: "カードを開く",
    ownPage: "解説を読む",
    pickAll: "開くことのできる工程",
    pickConverging: (n: number) =>
      `このうち ${n} 件は中間に対象が記録されています。残りは、それを満たす手法へと開きます。`,
    nothing: "これを複数の方法で通る記録はありません。",
    legendUnpublished: "この経路をたどる記録された出典はありません",
    legendUnpinned: "記録はありますが、どの手法かを述べた出典はありません",
    legendStrand: "通り道 — クリックするとこの場で展開します",
    legendOpen: "展開中 — 内側にあったものがこの場に描かれています",
    readingSummary: "この図に描かれている線のすべて",
    censusSummary: "この地図にあるものの集計",
    meets: (state: string, arriving: number, leaving: number) =>
      `${state}には ${arriving} 本が到達し、${leaving} 本が続きます。したがって ${arriving * leaving} 通りの経路がここを通ります。`,
    unpublishedNote: (n: number) =>
      `この図の ${n} 本は、記録された出典がたどっていない組み合わせです。これはこのグラフについての事実であり、文献についての主張ではありません。`,
    noneUnpublished: "この図のすべての線は、記録された出典がたどるものです。",
    crossHeading: (state: string) => `${state}を通る道`,
    crossTally: (total: number, recorded: number, unpinned: number, unpublished: number) =>
      `この円を通る組み合わせは ${total} 通りです。出典が端から端までたどるものが ${recorded} 件、出典が枠は記録しているものの、どの手法が満たすかを述べていないものが ${unpinned} 件、記録された出典がたどっていない組み合わせが ${unpublished} 件あります。`,
    crossNone: "記録された出典がたどっていない組み合わせはありません。",
    crossMore: (shown: number, total: number) => `${total} 件のうち ${shown} 件を表示しています。`,
    crossCaveat:
      "これらは各線が持つ二つの契約から導かれたものであり、提案ではありません。ここでの線は、ある処理が返す対象が次の処理の受け取る対象と一致することを述べているにすぎません。それが良い着想であるか、文献が見落としているかについては何も述べていません。",
    rail: "現在地",
    path: "経路",
    ways: "通り道",
    waysCount: (n: number) => `通り道：${n} 件`,
    around: "この枠を飛ばす経路",
    noneAround: "この手順を回避する経路は記録されていません。",
    noneWays: "この枠を満たす手法はまだ記録されていません。",
    narrower: "より狭い種類",
    noNarrower: "これより狭い種類として記録されているものはありません。",
    writeUp: "解説を全文読む",
    back: "四つすべて",
    sizeLabel: "表示倍率",
    sizeFit: "最初の位置に戻す",
    sizePercent: (n: number) => `${n}%`,
    opens: (n: number) => `内側に ${n} 件`,
    inside: "展開中",
    needs: "必要なもの",
    routes: (delegated: number, partly: number, whole: number) =>
      `分解されている経路のうち、${delegated} 件は名前のついた枠だけで構成され、${partly} 件は一部を枠に委ね残りを自身で行い、${whole} 件は分けられないひとつの作業です。いずれも欠陥ではなく、再利用の単位が違うということです。`,
    canvasLabel: (subject: string) =>
      `${subject} — ドラッグで移動、ピンチまたは ctrl+スクロールで拡大縮小、矢印キーで移動、0 で元に戻ります`,
    backToAtlas: "アトラスに戻る",
    openInfo: "この地図について",
    closeInfo: "閉じる",
    readingRegion: "この図の内容を文章で",
  },
};

/**
 * The sizes offered as links.
 *
 * The viewport is continuous once JavaScript is running, but a *named* size has
 * to stay addressable: it is the only zoom a reader without JavaScript, a
 * printout or `curl` can reach, and D88.2 is that a control with no address is
 * not a control. So these six are real links that set `?at=`, and the free
 * gesture writes the same parameter back.
 */
const SIZES = [50, 75, 100, 150, 200] as const;

/**
 * Is this viewport one of the named sizes, or somewhere a reader has dragged to?
 *
 * A size rung is only "current" when the figure is at that scale **and** has not
 * been moved: once a reader pans, no rung describes where they are, and marking
 * one would tell them a link they can still usefully click is the one they are
 * already on. Returns null in that case, which leaves every rung a link and the
 * reset link showing.
 */
function currentRung(viewport: Viewport): number | null {
  if (viewport.x !== 0 || viewport.y !== 0) return null;
  const percent = Math.round(viewport.z * 100);
  return (SIZES as readonly number[]).includes(percent) ? percent : null;
}

/** The address of this figure at a named size, keeping the focus and what is open. */
function sizeHref(
  focus: string | null,
  open: ReadonlySet<string>,
  size: number | null,
): string {
  const base = figureHref(focus, open);
  if (size === null) return base;
  const at = formatViewport({ x: 0, y: 0, z: size / 100 });
  return `${base}${base.includes("?") ? "&" : "?"}at=${encodeURIComponent(at)}`;
}

function SizeControl({
  focus,
  open,
  current,
  copy,
}: {
  focus: string | null;
  open: ReadonlySet<string>;
  current: number | null;
  copy: ConvergeCopy;
}): React.ReactElement {
  return (
    <div className="mj-process-zoom" role="group" aria-label={copy.sizeLabel}>
      <span className="mj-process-zoom-label">{copy.sizeLabel}</span>
      {SIZES.map((rung) =>
        rung === current ? (
          <strong key={rung} aria-current="true">
            {copy.sizePercent(rung)}
          </strong>
        ) : (
          <a key={rung} href={sizeHref(focus, open, rung)}>
            {copy.sizePercent(rung)}
          </a>
        ),
      )}
      {/* Only when there is something to reset. A "back to the start" link on a
          figure already at the start is a control that does nothing, and a
          reader who clicks it once learns to distrust the row it sits in. */}
      {current === 100 ? null : (
        <a href={sizeHref(focus, open, null)}>{copy.sizeFit}</a>
      )}
    </div>
  );
}

/**
 * The key used to be drawn here, by `KeyMark` and `Key`.
 *
 * It is now §2 of `map-info-popup.tsx`, drawn there from the same
 * `legendMark()` geometry so a change to the shape the canvas draws still
 * reaches the legend. Moved rather than copied, and this note is the whole
 * reason: two components drawing one key is exactly the failure the old
 * `KeyMark` shipped — three swatches drawing a lens the canvas had stopped
 * drawing, read on production after the deploy.
 */

/**
 * The rail, brought over from the map and the strand view.
 *
 * Every section states its own emptiness in a sentence rather than rendering
 * nothing — silence in a panel reads as "nothing to say here" when what it means
 * is "nobody has recorded this".
 *
 * The breadcrumb carries `?open=` with it, for the reason the map's rail
 * carried `?zoom=`: it re-focuses *this* figure, and arriving with a reader's
 * expansions dropped is arriving somewhere else.
 */
function Rail({
  graph,
  focusId,
  locale,
  copy,
  open,
}: {
  graph: LayerGraph;
  focusId: string;
  locale: PublicLocale;
  copy: ConvergeCopy;
  open: ReadonlySet<string>;
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
                  <a href={figureHref(item.id, open)}>{label(item)}</a>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section>
          {/* One string, not a label with a count element beside it. The
              element form rendered `ways through7`: `.mj-strand-rail-count` is
              a pill whose spacing came from CSS, and the reading this heading
              is now part of has no CSS at all — a screen reader, a printout and
              `curl` all got the two run together. A separator is punctuation,
              punctuation is part of a sentence, and a sentence differs by
              language, so it goes through the copy function. */}
          <h3>{ways.length > 0 ? copy.waysCount(ways.length) : copy.ways}</h3>
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
            same fact is on the canvas as a circle; a reader who has not spotted
            it there can read it here. */}
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

/**
 * The figure, in words, with the nesting made explicit.
 *
 * This is the List view's job, done better. It was never a nicety: a lane's
 * three-valued standing is carried on the canvas by a fill pattern, so a screen
 * reader got nothing and a printout got three patterns with nothing saying which
 * was which, and the drawn `<text>` is the *fitted* label. Every line here
 * carries its full name, its standing as a word, what is inside it, and the two
 * destinations the shape has.
 *
 * Ordered, because a line's position in a fan is meaningful, and nested, because
 * a step inside a method is not a sibling of the method.
 */
function Lines({
  diagram,
  copy,
}: {
  diagram: ConvergeDiagram;
  copy: ConvergeCopy;
}): React.ReactElement {
  // **`parentKey`, not a key prefix**, and `ConvergeFeed.parentKey` exists for
  // exactly this — its own doc comment is a warning that a prefix of an address
  // selects the whole subtree under it and never one generation.
  //
  // **This is a hardening, not a repair, and the measurement says so.** Swept
  // over every slot figure and every method page, saturated — 2,830 lanes — the
  // two agree everywhere, because a feed's key is `<parentKey>~<slot>` and feeds
  // are only ever planned on the lane that consumes them. The prefix is right by
  // an accident of two facts rather than by the one that matters, and this list
  // is the whole of the figure for a reader who is not looking at it. `a lane's
  // ingredients are its own, not its descendants'` pins the equivalence so the
  // day a feed is planned one level down, it is caught here rather than read out
  // to somebody as the truth.
  const feedsFor = (lane: ConvergeLane) =>
    diagram.feeds.filter((feed) => feed.parentKey === lane.key);
  return (
    <ol className="mj-converge-lanes">
      {diagram.lanes.map((lane) => (
        <li
          key={lane.key}
          className={`mj-converge-lane-row--${lane.standing}`}
          data-depth={lane.depth}
        >
          {/* The count rides with the name here too — this list is the whole of
              the figure for a reader who is not looking at it. */}
          <a href={lane.href}>{spokenName(lane)}</a>
          {lane.standing === "recorded" ? null : (
            <span className="mj-converge-lane-standing">
              {" — "}
              {lane.standing === "unpublished" ? copy.legendUnpublished : copy.legendUnpinned}
            </span>
          )}
          {lane.inside > 0 ? (
            <span className="mj-converge-lane-standing">
              {" — "}
              {lane.open ? copy.inside : copy.opens(lane.inside)}
              {lane.openHref ? (
                <>
                  {" · "}
                  <a href={lane.openHref}>
                    {lane.open ? copy.legendOpen : copy.legendStrand}
                  </a>
                </>
              ) : null}
            </span>
          ) : null}
          {feedsFor(lane).length > 0 ? (
            <ul className="mj-converge-feeds">
              {feedsFor(lane).map((feed) => (
                <li key={feed.key}>
                  {copy.needs}
                  {": "}
                  <a href={feed.href}>{spokenName(feed)}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function ConvergeView({
  graph,
  corpus,
  locale,
  focusId,
  open,
  about = null,
  card = { id: null, dropped: 0 },
  cardSection = null,
  droppedOpen = 0,
  viewport = IDENTITY,
}: {
  graph: LayerGraph;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
  focusId: string | null;
  /** What the reader has opened, from `?open=`. */
  open: ReadonlySet<string>;
  /**
   * Which section of the information box is open, from `?about=`.
   *
   * A parameter and not component state, so the box opens with JavaScript off,
   * `curl` returns it, and a reader can send somebody the exact page of it they
   * mean — see `lib/repository/map-about.ts` for the argument in full.
   */
  about?: MapAboutSection | null;
  /**
   * Which node's card is open, from `?card=`.
   *
   * A parameter for the same reason `about` is, and resolved on the server by
   * the same shape — see `lib/repository/map-card.ts`. The card is assembled
   * here rather than passed in because this is the component that already holds
   * the graph, the vocabulary and the corpus, and a card is a join of all three.
   */
  card?: CardSelection;
  /**
   * Which of the open card's sections is showing, from `?sec=`.
   *
   * Resolved here rather than on the page for one reason: the list of sections
   * depends on the card, and this is where the card is assembled. The page can
   * say whether an id names a node; it cannot say whether a string names a
   * section of the card that id opens without building the card twice.
   */
  cardSection?: string | null;
  /** How many ids the URL asked for over the cap. Reported, never dropped silently. */
  droppedOpen?: number;
  /** Where the reader has panned and how far in, from `?at=`. */
  viewport?: Viewport;
}): React.ReactElement {
  const lang: "en" | "ja" = locale === "ja" ? "ja" : "en";
  const copy = COPY[lang];
  const notes = convergeNotes(lang);
  const candidates = drawableSlots(graph, STATE_VOCABULARY);
  const converging = convergingSlots(graph, STATE_VOCABULARY);

  const node = focusId ? layerNode(graph, focusId) : null;
  const focus = node && isCapability(node) ? node : null;

  // Which of these shapes the Atlas holds a full record for. The owner's
  // framing: *"atlas has everything about specific algorithms, while this map
  // has everything including how they fit in"* — so the figure says where the
  // two meet, and says it against the corpus that actually loaded rather than
  // against the graph's own optimism.
  const atlas = nodesWithEntries(graph, new Set(corpus.map((entry) => entry.slug)));

  const label = (item: { label: string; labelJa: string }) =>
    lang === "ja" ? item.labelJa : item.label;

  // Unfocused, this draws the four roots — the map's overview, which converge
  // never had. It used to fall back to `candidates[0]`, which showed a reader
  // arriving at the page one arbitrary slot and no way to tell it was arbitrary.
  // IDENTITY is the default, so omitting it keeps a bare `/repository/layers`
  // link bare instead of stamping `at=0,0,1` onto all 83 of them.
  const atParam =
    viewport.x === IDENTITY.x && viewport.y === IDENTITY.y && viewport.z === IDENTITY.z
      ? null
      : formatViewport(viewport);

  const subjects = focus ? [focus] : rootCapabilities(graph);
  const figures = subjects.map((subject) => ({
    subject,
    diagram: layoutConverge({
      graph,
      vocabulary: STATE_VOCABULARY,
      focus: subject,
      locale,
      open,
      // The page's own `?focus=`, not this figure's subject: unfocused, every
      // open link must come back to the overview rather than to one root.
      focusParam: focusId,
      // Where the reader is standing, carried onto every address this figure
      // emits. Serialized from the parsed viewport rather than taken from the
      // query string so that a viewport the parser *rejected* is not handed
      // back out again — `parseViewport` falls back to IDENTITY on a malformed
      // `?at=`, and a link that carries the malformed original would keep it
      // alive across every click.
      at: atParam,
      // **This surface, and only this surface, has a card to open.** It is the
      // one place `MapCardPanel` is mounted (below), and `?card=` is read by
      // exactly one route (`app/repository/layers/page.tsx`). The node page
      // passes nothing and its names keep going to node pages — see the `cards`
      // option for what would otherwise happen there.
      cards: true,
    }),
  }));
  const drawn = figures.filter((figure) => !figure.diagram.empty);

  // The convergence, restated as a number. A picture showing four lines meeting
  // is not the same as being told that those four lines are 4 routes; the
  // sentence is what a reader can carry away and check.
  const first = drawn[0]?.diagram ?? null;
  const shared = (first?.states ?? []).filter(
    (state) =>
      state.depth === 0 && state.arriving > 0 && state.leaving > 0 && (state.arriving > 1 || state.leaving > 1),
  );

  // The discovery lives one level below the drawn lanes. A lane is a *slot*, and
  // at slot granularity every lane on the authored graph is one a source walks —
  // so the figure's own unpublished count is zero and would stay zero. The
  // unpublished pairs are combinations of the **methods** filling two slots, and
  // this is where the owner's Carleman + Schrödingerisation shows up.
  const census =
    focus && first && !first.empty && shared[0]
      ? crossingsAt(
          graph,
          STATE_VOCABULARY,
          expansionOf(graph, STATE_VOCABULARY, focus),
          shared[0].stateId,
          locale,
        )
      : null;

  // The three route shapes, counted from the graph rather than typed into copy:
  // a number written into a translated sentence is a second copy of a fact and
  // nothing fails when it drifts.
  const decomposed = graph.nodes
    .filter((item) => item.kind === "method" && item.steps.length > 0)
    .map((item) => routeOf(graph, STATE_VOCABULARY, item as never));
  const delegated = decomposed.filter((route) => route.coverage === "delegated").length;
  const partly = decomposed.filter((route) => route.coverage === "partly-own").length;
  const whole = decomposed.filter((route) => route.coverage === "all-own").length;

  // Summed the same way, over the same figures, because on the overview the
  // two sentences are about all four at once. `capped` used to be a `.some()`
  // over a boolean: four figures could be hiding forty-five lines between them
  // and the page said "something".
  const collapsed = drawn.reduce((total, figure) => total + figure.diagram.collapsedCount, 0);
  const capped = drawn.reduce((total, figure) => total + figure.diagram.cappedCount, 0);
  // Every `view-transition-name` this page hands out, in one set, because the
  // uniqueness rule the names have to obey is a page-level rule.
  const claimed = new Set<string>();
  const currentSize = currentRung(viewport);
  // The addresses the information box needs, built here because this is the one
  // component that knows the reader's focus, their whole open set and where they
  // have panned to. `withAbout` appends to what `figureHref` already produced
  // rather than composing a URL of its own, so asking what a line means cannot
  // cost the reader a line they had opened or the place they were standing —
  // which is precisely what a box that rebuilt the address from scratch would do,
  // silently, on every open.
  const base = figureHref(focusId, open, atParam);
  const sectionHrefs = Object.fromEntries(
    MAP_ABOUT_SECTIONS.map((id) => [id, withAbout(base, id)]),
  ) as Record<MapAboutSection, string>;
  const closeHref = withAbout(base, null);
  // The card, assembled from the graph, the vocabulary and the corpus — the
  // three things this component already holds and no other component holds
  // together. `?about=` is cleared by `withCard` when a card opens, because two
  // overlays on one map is a URL claiming a state the page cannot draw.
  const openCard = card.id === null ? null : cardFor({ graph, vocabulary: STATE_VOCABULARY, corpus, locale: lang, register: PAPER_REGISTER }, card.id);
  const cardCloseHref = withCard(base, null);
  // The address the open card is already at. Every section link is built on it,
  // so switching section keeps the reader's focus, their whole open set and
  // where they had panned — and `withCard` has already stripped any stale
  // `?sec=` a previous card left behind.
  const cardBase = card.id === null ? base : withCard(base, card.id);
  const cardHrefFor = (id: string) => withCard(base, id);
  // One control, two states. A separate close button in the overlay would be a
  // third thing in a corner the owner asked to hold exactly two.
  const infoHref = about === null ? sectionHrefs[MAP_ABOUT_SECTIONS[0]] : closeHref;
  const infoLabel = about === null ? copy.openInfo : copy.closeInfo;

  return (
    // `CanvasContinuity` wraps the whole surface rather than only the canvas,
    // which is a widening of its job and deliberate. Every control on this page
    // that is not the back arrow — the information icon, the five section links,
    // the close link, the size rungs — is a link to *this* path with a different
    // query, and that is exactly the click it was built to intercept. Left
    // around the canvas alone, opening the box would have been a document
    // replacement: the figure would remount, and a reader who had panned would
    // be put back where the server last rendered them, because the anchor
    // carries the rendered `?at=` and not the live one. It substitutes the live
    // value; that is the whole reason it takes `renderedAt`.
    <CanvasContinuity className="mj-map-shell" renderedAt={atParam}>
      {/* The two controls, and nothing else on the page.

          `position: absolute` and outside the flow, so the canvas below is
          exactly `100dvh` — see the rewritten comment on
          `.mj-canvas-viewport--fill`, whose old `calc(100dvh - 15rem)` was a
          hand-measured stand-in for chrome that no longer exists.

          The back arrow is unconditional, unlike the `.mj-strand-back` link it
          replaces, which only rendered when `?focus=` was set and so was absent
          on the one view a first-time reader actually lands on. It leaves for
          `/repository`, a different path, so `CanvasContinuity` above passes it
          through and the Atlas view transition animates it. */}
      <div className="mj-map-overlay">
        <a
          className="mj-map-overlay-button"
          href="/repository"
          aria-label={copy.backToAtlas}
          title={copy.backToAtlas}
        >
          <ArrowLeftIcon />
        </a>
        <a
          className="mj-map-overlay-button"
          href={infoHref}
          aria-label={infoLabel}
          title={infoLabel}
          aria-expanded={about !== null}
          // Where the box hands focus back when it closes and the element that
          // opened it has gone — see `map-info-popup.tsx`'s cleanup.
          data-modal-return-focus
        >
          <InfoIcon />
        </a>
      </div>

      {drawn.length > 0 ? (
        <InfiniteCanvas
          initial={viewport}
          label={copy.canvasLabel(focus ? label(focus) : copy.heading)}
          locale={locale}
          // Still `fill`, and it has to be: `.mj-canvas-viewport--fill` is what
          // binds a plain two-finger wheel to panning and what contains the
          // overscroll that would otherwise navigate the page away mid-pan.
          // Dropping it here would look like a styling change and behave like a
          // deleted gesture.
          fill
        >
          {drawn.map((figure) => (
            <ConvergeCanvas
              key={figure.subject.id}
              diagram={figure.diagram}
              locale={locale}
              title={label(figure.subject)}
              subjectId={figure.subject.id}
              atlas={atlas}
              // One set across all four figures — see `claimed`. Built here
              // because this is the component that knows how many figures the
              // page is drawing.
              claimed={claimed}
            />
          ))}
        </InfiniteCanvas>
      ) : (
        <p className="mj-map-empty">{copy.nothing}</p>
      )}

      <MapInfoPopup
        locale={lang}
        section={about}
        sectionHrefs={sectionHrefs}
        closeHref={closeHref}
        // The canvas's own geometry, not a second drawing of it.
        laneMark={legendMark().outline}
        sizeControl={<SizeControl focus={focusId} open={open} current={currentSize} copy={copy} />}
      />

      {/* Rendered whether or not a card is open, and `hidden` when it is not —
          the same shape `MapInfoPopup` uses, and for the same reason: the panel
          is a parameter, so its markup is server-rendered and its dismissal is a
          link. A card that only mounted after a click would be a control with no
          address, which is the thing `?card=` exists to avoid. */}
      <MapCardPanel
        card={openCard}
        closeHref={cardCloseHref}
        // Resolved against the sections this card actually has. A `?sec=` naming
        // something else is a stale link, and the panel falls back to the first
        // section rather than blanking a card that opened perfectly well.
        section={
          openCard === null
            ? null
            : parseCardSection(cardSection ?? undefined, cardSections(openCard).map((s) => s.id))
        }
        // A map rather than a function: `MapCardPanel` is a client component
        // and a function prop cannot cross that boundary. Built on the address
        // the card is already at, so switching section keeps the reader's
        // focus, their whole open set and where they had panned — the same rule
        // every other link on this card follows, and the same shape
        // `MapInfoPopup` takes its five section addresses in.
        sectionHrefs={
          openCard === null
            ? {}
            : Object.fromEntries(
                cardSections(openCard).map((s) => [s.id, withCardSection(cardBase, s.id)]),
              )
        }
        locale={locale}
      />

      {/* The figure in words, clipped rather than deleted.

          `.mj-map-reading` is a pixel on screen and everything in the document:
          a screen reader reads it, `curl` returns it, the `@media print` rule
          beside the class puts it back on a printout, and `:focus-within`
          reveals it the moment a keyboard reader Tabs into it — so none of the
          links below is a control somebody can focus and not see. That last
          part is why this is a clip and not `hidden`: `hidden` would take the
          reading out of the accessibility tree entirely, which is the one thing
          the retirement of the List view promised would not happen (D90.2). */}
      <div className="mj-map-reading" role="region" aria-label={copy.readingRegion}>
        <h1 id="converge-heading">{copy.heading}</h1>
        <p className="mj-strand-lede">
          {!focus
            ? copy.ledeOverview
            : first && !first.empty && first.grain === "methods"
              ? copy.ledeFan
              : copy.lede}
        </p>

        {focusId ? (
          <p>
            <a className="mj-strand-back" href={figureHref(null, open)}>
              {copy.back}
            </a>
          </p>
        ) : null}

        {drawn.length > 0 ? (
          <>
            {/* What this figure is. A chain of shared circles and a fan of
                fillers are different claims — "every way across passes through
                this object" versus "these are the recorded ways across" — and a
                reader who takes the second for the first reads three ways to
                estimate an observable as three objects every estimate passes
                through. D89.6: say which, never let the picture imply it. */}
            {focus && first ? (
              <p className="mj-converge-grain">
                {first.grain === "states"
                  ? copy.grainStates(first.states.filter((state) => state.depth === 0).length - 2)
                  : copy.grainMethods(
                      first.lanes.filter((lane) => lane.depth === 0).length,
                      label(focus),
                    )}
              </p>
            ) : null}

            {/* A cap that bites is reported. `maxHops` biting makes
                `expansionOf` return "nothing finer is recorded", which this page
                would draw as a method fan — identical to a slot the literature
                genuinely has nothing finer for. Silence here would be the
                surface asserting the stronger of two readings it cannot tell
                apart. */}
            {first?.truncated ? <p className="mj-converge-caveat">{copy.truncatedNote}</p> : null}
            {first && !first.chainConsistent ? (
              <p className="mj-converge-caveat">{copy.inconsistentNote}</p>
            ) : null}

            <p className="mj-strand-note">
              {collapsed > 0 ? copy.collapsed(collapsed) : copy.allOpen}
            </p>
            {/* Both limits, in the engine's own words rather than this
                component's — see `converge-notes.ts`. The node page says the
                same two things about the same two caps now, and it says them in
                the same sentences because there is one copy of each. */}
            {droppedOpen > 0 ? (
              <p className="mj-strand-note">{notes.droppedOpen(droppedOpen, CONVERGE_OPEN_MAX)}</p>
            ) : null}
            {capped > 0 ? <p className="mj-strand-note">{notes.cappedInside(capped)}</p> : null}
            <p className="mj-strand-note">{copy.routes(delegated, partly, whole)}</p>

            <h2 className="mj-converge-lines-heading">{copy.readingSummary}</h2>
            <h3 className="mj-converge-lines-heading">{copy.linesHeading}</h3>
            {drawn.map((figure) => (
              <div key={figure.subject.id}>
                {/* Which figure this list is of. Only when there is more than
                    one: the unfocused surface draws all four roots, and four
                    ordered lists in a row under one heading is a reading that
                    cannot be followed — this is the reading a screen reader and
                    a printout get, so it is the one that must not be
                    ambiguous. */}
                {drawn.length > 1 ? (
                  <h4 className="mj-converge-lines-subject">
                    <a href={figureHref(figure.subject.id, open)}>{label(figure.subject)}</a>
                  </h4>
                ) : null}
                <Lines diagram={figure.diagram} copy={copy} />
              </div>
            ))}

            {/* Only when one figure is drawn.

                `shared` and `unpublishedCount` come from the first figure, and
                on the unfocused overview there are four — so this stated the
                shared circles and the unpublished count of one root as facts
                about the page. A count over a mixed population names no
                problem: the sentence was true of `drawn[0]` and false of what
                the reader was looking at. `collapsedCount` above is aggregated
                across all four because it can be; these two cannot, because "2
                ways arrive at Linear ODE system" is a fact about one figure. */}
            {focus && first ? (
              <ul className="mj-converge-facts">
                {shared.map((state) => {
                  const named = layerState(STATE_VOCABULARY, state.stateId);
                  return (
                    <li key={state.key}>
                      {copy.meets(named ? label(named) : state.stateId, state.arriving, state.leaving)}
                    </li>
                  );
                })}
                <li>
                  {first.unpublishedCount > 0
                    ? copy.unpublishedNote(first.unpublishedCount)
                    : copy.noneUnpublished}
                </li>
              </ul>
            ) : null}

            {census ? (
              <section className="mj-converge-crossings">
                <h3>
                  {copy.crossHeading(
                    layerState(STATE_VOCABULARY, census.stateId)
                      ? label(layerState(STATE_VOCABULARY, census.stateId)!)
                      : census.stateId,
                  )}
                </h3>
                <p>
                  {copy.crossTally(census.total, census.recorded, census.unpinned, census.unpublished)}
                </p>
                {census.examples.length > 0 ? (
                  <ul>
                    {census.examples.map((crossing) => (
                      <li key={crossing.key}>
                        <a href={crossing.inHref}>{crossing.inLabel}</a>
                        {" → "}
                        <a href={crossing.outHref}>{crossing.outLabel}</a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{copy.crossNone}</p>
                )}
                {census.examplesTruncated ? (
                  <p>{copy.crossMore(census.examples.length, census.unpublished)}</p>
                ) : null}
                <p className="mj-converge-caveat">{copy.crossCaveat}</p>
              </section>
            ) : null}

            {/* The focused slot's own write-up.

                This link used to sit outside the disclosure on purpose, and the
                comment that put it there said so: the surface once emitted 19
                hrefs and not one of them was the page for the thing it was
                drawing, so hiding it again would undo that fix. That reasoning
                is **overruled here, explicitly**, because the place it named no
                longer exists — there is no visible prose on this page at all,
                so "outside the fold" is not a location any more. What replaces
                it is weaker but real: the link is in the document, it is one
                Tab from the canvas, and `:focus-within` makes this block
                visible the moment a keyboard reader reaches it. W5's state and
                process cards are where it becomes a visible control again. */}
            {focus ? (
              <p className="mj-converge-own">
                {/* **Two links, and the order is the argument.** The card is a
                    preview of this process — what it takes and returns, why it
                    is a layer, what fills it, what makes it unnecessary — and
                    the write-up is the record. The card leads because it is the
                    cheaper of the two: it opens here, on the figure the reader
                    is already looking at, without costing them their `?open=`
                    set or where they had panned to. Neither replaces the other,
                    and the card's own first link is the page. */}
                <a href={cardHrefFor(focus.id)}>{copy.openCard}</a>
                <a href={`/repository/layers/${focus.id}`}>{copy.ownPage}</a>
              </p>
            ) : null}
          </>
        ) : null}

        {/* The rail, which is not deleted.

            It is genuinely useful and W5 turns it into the state card and the
            process card. Until then it lives here rather than on the canvas:
            every address it emits stays in the document, a screen reader still
            gets "where you are", and none of it competes with the drawing for
            the screen the owner asked to give entirely to the drawing. Its
            write-up link and its breadcrumb are the same links `/repository
            /layers/<id>` carries, so nothing here is the only way to reach
            anything. */}
        {focusId ? (
          <Rail graph={graph} focusId={focusId} locale={locale} copy={copy} open={open} />
        ) : null}

        {/* Every step, not the two that converge.
            This list *was* `convergingSlots`, and the mismatch between what it
            offered and what the page could draw is the whole defect: 16 slots
            were addressable, rendered nothing, and appeared nowhere to click. It
            is `drawableSlots` now — the same predicate the layout branches on,
            so the navigation and the renderer cannot hold different opinions
            about what exists. */}
        <section>
          <h2>{copy.pickAll}</h2>
          <p>{copy.pickConverging(converging.length)}</p>
          <ul className="mj-converge-picks">
            {candidates.map((item) => (
              <li key={item.id}>
                {item.id === focus?.id ? (
                  <strong aria-current="true">{label(item)}</strong>
                ) : (
                  <a href={figureHref(item.id, open)}>{label(item)}</a>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* The counted census. It lived only inside `?view=list`, so the numbers
            saying how complete this graph honestly is were reachable only from a
            surface that no longer exists. Rendered from the one component rather
            than restated here: a census written twice drifts, and more quietly
            than a link does. */}
        <section>
          <h2>{copy.censusSummary}</h2>
          <LayerCensusPanel graph={graph} corpus={corpus} locale={locale} />
        </section>
      </div>
    </CanvasContinuity>
  );
}
