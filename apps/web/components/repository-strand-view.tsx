// The strand surface: the canvas, plus the three things a reader needs around it.
//
// > *"some thing may on the side to see what payer a person is in and what is
// > around it and a way to hide that"* — owner, session-89 inbox
//
// The rail answers exactly that and nothing else: the path you came down, the
// slots beside the one you are in, and the routes that skip it. It is a
// `<details>` so hiding it needs no JS and leaves no state anywhere — and so a
// reader who collapses it still gets a page that works, which a rail behind a
// click handler would not.
//
// Everything here is a server component. The only interactive controls are links
// and `<details>`, both of which have addresses or native behaviour. Nothing on
// this surface stops working with JS off.
//
// Plain anchors rather than `next/link`, for the reason `repository-process-view`
// states in full: a same-document navigation is the one kind the cross-document
// view transition cannot animate, and the view switch here leads straight to a
// surface that does animate. Half a surface that zooms is worse than neither.
import {
  ancestorPath,
  layoutFocus,
  layoutOverview,
  siblingCapabilities,
  type StrandDiagram,
} from "../lib/repository/strand-layout";
import {
  bypassersOf,
  isCapability,
  layerCensus,
  layerNode,
  methodsRealizing,
  rootCapabilities,
  type LayerGraph,
} from "../lib/repository/layers";
import { STATE_VOCABULARY } from "../lib/repository/state-vocabulary";
import { StrandCanvas } from "./repository-strands";
import type { PublicLocale } from "../lib/public-locale";

/** Depth caps the surface offers. The graph runs six deep; three is where a page stops being readable. */
export const STRAND_DEPTHS = [1, 2, 3] as const;
export type StrandDepth = (typeof STRAND_DEPTHS)[number];

/**
 * The switch's words, in one place, because three surfaces render it.
 *
 * `LayerIndexView` draws the same control from the other side and had its own
 * inline locale conditions for the same three strings. Two copies of a
 * translated label is the shape that drifts: one of them gets reworded and the
 * two views start disagreeing about what the reader is looking at.
 */
export function viewSwitchLabels(locale: PublicLocale): {
  view: string;
  map: string;
  converge: string;
  strands: string;
  list: string;
} {
  return locale === "ja"
    ? { view: "表示", map: "マップ", converge: "合流", strands: "ストランド", list: "リスト" }
    : { view: "View", map: "Map", converge: "Converge", strands: "Strands", list: "List" };
}

/**
 * Named for the reason `repository-strands.tsx` gives: `as const` on a
 * two-locale record narrows each string to its own literal type and the
 * Japanese half stops being assignable to the English one.
 */
interface StrandViewCopy {
  heading: string;
  depth: string;
  lede: string;
  ledeOverview: string;
  reading: string;
  rail: string;
  path: string;
  beside: string;
  inside: string;
  around: string;
  noneAround: string;
  noneInside: string;
  noneBeside: string;
  writeUp: string;
  closed: (n: number) => string;
  allOpen: string;
  coverage: (anchored: number, nodes: number) => string;
  legendSlot: string;
  legendMethod: string;
  legendNested: string;
  legendSkip: string;
  legendShut: string;
  legendEmpty: string;
  back: string;
}

const COPY: Record<"en" | "ja", StrandViewCopy> = {
  en: {
    heading: "Layers",
    depth: "Depth",
    lede: "Every slot is a shape you enter and leave through one point — its contract. The fibres inside it are the recorded ways through. A fibre made of smaller shapes is a method whose own steps are slots.",
    ledeOverview:
      "Four problems nothing else needs — the places a reader arrives. Open one to stand inside it.",
    reading: "Ovals are slots: click one to stand in it. Fibres are methods: click one to read it.",
    rail: "Where you are",
    path: "Path",
    beside: "Beside this slot",
    inside: "Ways through",
    around: "Routes that skip it",
    noneAround: "No recorded route avoids this step.",
    noneInside: "No method is recorded for this slot yet.",
    noneBeside: "Nothing contains this slot — it is a place to start.",
    writeUp: "Read the full write-up",
    closed: (n: number) =>
      `${n} slot${n === 1 ? "" : "s"} drawn shut at this depth — open one, or go deeper.`,
    allOpen: "Nothing is hidden at this depth.",
    coverage: (anchored: number, nodes: number) =>
      `${anchored} of ${nodes} nodes name a record in the Atlas. The rest cite papers and nothing else, which is the reading list rather than a defect.`,
    legendSlot: "slot",
    legendMethod: "method",
    legendNested: "method made of slots",
    legendSkip: "route that skips a slot",
    legendShut: "more inside, not drawn",
    legendEmpty: "nothing recorded fills it",
    back: "All four",
  },
  ja: {
    heading: "階層",
    depth: "深さ",
    lede: "各枠は、入口と出口がそれぞれ一点に絞られた形で表されます。その一点が契約です。内部の繊維は記録された通り道であり、さらに小さな形からなる繊維は、その手順自体が枠である手法を表します。",
    ledeOverview:
      "他のどの手法からも必要とされない四つの問題 — 読者が最初に立つ場所です。開くと内部に入れます。",
    reading:
      "楕円は枠です。クリックするとその中に立ちます。繊維は手法です。クリックすると解説を読めます。",
    rail: "現在地",
    path: "経路",
    beside: "この枠の隣",
    inside: "通り道",
    around: "この枠を飛ばす経路",
    noneAround: "この手順を回避する経路は記録されていません。",
    noneInside: "この枠を満たす手法はまだ記録されていません。",
    noneBeside: "この枠を含むものはありません — ここが出発点です。",
    writeUp: "解説を全文読む",
    closed: (n: number) => `この深さでは ${n} 件の枠を閉じて描いています — 開くか、深さを上げてください。`,
    allOpen: "この深さで隠れているものはありません。",
    coverage: (anchored: number, nodes: number) =>
      `${nodes} 件のノードのうち ${anchored} 件が Atlas の記録を参照しています。残りは論文のみを引用しており、これは欠陥ではなく読むべき文献の一覧です。`,
    legendSlot: "枠",
    legendMethod: "手法",
    legendNested: "枠からなる手法",
    legendSkip: "枠を飛ばす経路",
    legendShut: "内部あり・未描画",
    legendEmpty: "記録された手法なし",
    back: "四つすべて",
  },
};

function copyFor(locale: PublicLocale): StrandViewCopy {
  return locale === "ja" ? COPY.ja : COPY.en;
}

function strandHref(focus: string | null, depth: StrandDepth): string {
  const params = new URLSearchParams({ view: "strands" });
  if (focus) params.set("focus", focus);
  // Depth 1 is the default the route resolves to, so leaving it out keeps the
  // common URL short and keeps one canonical address for the default view.
  if (depth !== 1) params.set("depth", String(depth));
  return `/repository/layers?${params.toString()}`;
}

/**
 * A shape drawn at its real proportions, so the legend cannot drift from the canvas.
 *
 * Copying the path by hand into a legend is how a key ends up describing a
 * previous version of a diagram. These reuse the same classes, so a stylesheet
 * change reaches both.
 */
function LegendMark({ kind }: { kind: "slot" | "method" | "nested" | "skip" | "shut" | "empty" }) {
  const lens = "M 1 9 C 8 1 30 1 37 9 C 30 17 8 17 1 9 Z";
  return (
    <svg className="mj-strand-legend-mark" viewBox="0 0 38 18" aria-hidden="true">
      {kind === "skip" ? (
        <g className="mj-strand-bypass">
          <path className="mj-strand-lens" d={lens} />
          <path className="mj-strand-bypass-line" d="M 1 9 C 10 20 28 20 37 9" />
        </g>
      ) : null}
      {kind !== "skip" ? (
        <g className={`mj-strand-fascicle mj-strand-fascicle--${kind === "empty" ? "empty" : kind === "shut" ? "closed" : "open"}`}>
          <path className="mj-strand-lens" d={lens} />
          {kind === "shut" ? (
            <path className="mj-strand-lens-inner" d="M 5 9 C 11 4 27 4 33 9 C 27 14 11 14 5 9 Z" />
          ) : null}
          {kind === "method" ? (
            <g className="mj-strand-fiber mj-strand-fiber--atomic">
              <path className="mj-strand-fiber-line" d="M 1 9 C 8 4 30 4 37 9" />
            </g>
          ) : null}
          {kind === "nested" ? (
            <g className="mj-strand-fiber mj-strand-fiber--decomposed">
              <path className="mj-strand-fiber-line" d="M 1 9 L 37 9" />
              <path className="mj-strand-lens" d="M 9 9 C 12 5 17 5 20 9 C 17 13 12 13 9 9 Z" />
              <path className="mj-strand-lens" d="M 21 9 C 24 5 29 5 32 9 C 29 13 24 13 21 9 Z" />
            </g>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}

function Legend({ copy }: { copy: StrandViewCopy }) {
  const items = [
    { kind: "slot" as const, text: copy.legendSlot },
    { kind: "method" as const, text: copy.legendMethod },
    { kind: "nested" as const, text: copy.legendNested },
    { kind: "skip" as const, text: copy.legendSkip },
    { kind: "shut" as const, text: copy.legendShut },
    { kind: "empty" as const, text: copy.legendEmpty },
  ];
  return (
    <ul className="mj-strand-legend">
      {items.map((item) => (
        <li key={item.kind}>
          <LegendMark kind={item.kind} />
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The rail. Three lists and a link, and every one of them can legitimately be
 * empty — so each says what its own emptiness means rather than rendering
 * nothing. Silence in a panel reads as "there is nothing to say", which on this
 * surface is almost never what is true.
 */
function Rail({
  graph,
  focusId,
  locale,
  copy,
  depth,
}: {
  graph: LayerGraph;
  focusId: string;
  locale: PublicLocale;
  copy: StrandViewCopy;
  depth: StrandDepth;
}) {
  const node = layerNode(graph, focusId);
  if (!node || !isCapability(node)) return null;
  const path = ancestorPath(graph, focusId);
  const siblings = siblingCapabilities(graph, focusId);
  const methods = methodsRealizing(graph, focusId);
  const skippers = bypassersOf(graph, focusId);
  const label = (item: { label: string; labelJa: string }) =>
    locale === "ja" ? item.labelJa : item.label;

  return (
    <details className="mj-strand-rail" open>
      <summary>{copy.rail}</summary>
      <div className="mj-strand-rail-body">
        <section>
          <h3>{copy.path}</h3>
          <ol className="mj-strand-rail-path">
            {path.map((step) => (
              <li key={step.id} aria-current={step.id === focusId ? "true" : undefined}>
                {step.id === focusId ? (
                  <strong>{label(step)}</strong>
                ) : (
                  <a href={strandHref(step.id, depth)}>{label(step)}</a>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h3>{copy.beside}</h3>
          {siblings.length === 0 ? (
            <p className="mj-strand-rail-none">{copy.noneBeside}</p>
          ) : (
            <ul>
              {siblings.map((item) => (
                <li key={item.id}>
                  <a href={strandHref(item.id, depth)}>{label(item)}</a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>
            {copy.inside} <span className="mj-strand-rail-count">{methods.length}</span>
          </h3>
          {/* A slot nothing realises is a supported state of the diagram — it is
              drawn with a dashed outline — so the rail has to say so rather than
              render an empty list. Three of the four sections here already did;
              this one was the omission. */}
          {methods.length === 0 ? (
            <p className="mj-strand-rail-none">{copy.noneInside}</p>
          ) : (
            <ul>
              {methods.map((item) => (
                <li key={item.id}>
                  <a href={`/repository/layers/${item.id}`}>{label(item)}</a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>{copy.around}</h3>
          {skippers.length === 0 ? (
            <p className="mj-strand-rail-none">{copy.noneAround}</p>
          ) : (
            <ul>
              {skippers.map((item) => (
                <li key={item.id}>
                  <a href={`/repository/layers/${item.id}`}>{label(item)}</a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <a className="mj-strand-rail-writeup" href={`/repository/layers/${focusId}`}>
          {copy.writeUp}
        </a>
      </div>
    </details>
  );
}

export function StrandView({
  graph,
  corpus,
  locale,
  focusId,
  depth,
}: {
  graph: LayerGraph;
  corpus: readonly { slug: string }[];
  locale: PublicLocale;
  focusId: string | null;
  depth: StrandDepth;
}) {
  const copy = copyFor(locale);
  const nav = viewSwitchLabels(locale);
  const lang: "en" | "ja" = locale === "ja" ? "ja" : "en";
  const roots = rootCapabilities(graph);
  const census = layerCensus(graph, new Set(corpus.map((entry) => entry.slug)), STATE_VOCABULARY);

  const diagram: StrandDiagram = focusId
    ? layoutFocus(graph, focusId, lang, depth)
    : layoutOverview(graph, roots, lang, depth);

  const focusNode = focusId ? layerNode(graph, focusId) : null;
  const focusLabel =
    focusNode && isCapability(focusNode)
      ? locale === "ja"
        ? focusNode.labelJa
        : focusNode.label
      : null;

  return (
    <div className="mj-strand-view">
      <header className="mj-strand-head">
        <h1>{focusLabel ?? copy.heading}</h1>
        <p className="mj-strand-lede">{focusId ? copy.lede : copy.ledeOverview}</p>
      </header>

      <div className="mj-strand-controls">
        <div className="mj-strand-switch" role="group" aria-label={nav.view}>
          <span className="mj-strand-switch-label">{nav.view}</span>
          <a href="/repository/layers?view=map">{nav.map}</a>
          <span className="mj-strand-switch-on">{nav.strands}</span>
          <a href="/repository/layers?view=list">{nav.list}</a>
        </div>
        <div className="mj-strand-switch" role="group" aria-label={copy.depth}>
          <span className="mj-strand-switch-label">{copy.depth}</span>
          {STRAND_DEPTHS.map((option) =>
            option === depth ? (
              <span className="mj-strand-switch-on" key={option}>
                {option}
              </span>
            ) : (
              <a href={strandHref(focusId, option)} key={option}>
                {option}
              </a>
            ),
          )}
        </div>
        {focusId ? (
          <a className="mj-strand-back" href={strandHref(null, depth)}>
            ← {copy.back}
          </a>
        ) : null}
      </div>

      <Legend copy={copy} />

      <div className="mj-strand-body">
        <StrandCanvas diagram={diagram} locale={lang} title={focusLabel ?? copy.heading} />
        {focusId ? (
          <Rail graph={graph} focusId={focusId} locale={locale} copy={copy} depth={depth} />
        ) : null}
      </div>

      <p className="mj-strand-note">{copy.reading}</p>
      <p className="mj-strand-note">
        {diagram.closedCount > 0 ? copy.closed(diagram.closedCount) : copy.allOpen}
      </p>
      <p className="mj-strand-note">{copy.coverage(census.anchored, census.nodes)}</p>
    </div>
  );
}
