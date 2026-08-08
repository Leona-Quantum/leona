// The surface around the convergence canvas.
//
// Server component throughout, same rule as every other Atlas surface: the only
// interactive elements are `<a href>`s, because a control that works only after
// hydration has no address (D88.2). Plain anchors rather than `next/link`, for
// the reason session 95 recorded — a `<Link>` is a same-document navigation and
// that is the one kind `@view-transition { navigation: auto }` does not animate,
// so using one here would silently delete the zoom on this surface only.
import { ViewSwitch } from "./repository-view-switch";
import { ConvergeCanvas } from "./repository-converge-map";
import {
  convergingSlots,
  crossingsAt,
  drawableSlots,
  layoutConverge,
  type ConvergeDiagram,
} from "../lib/repository/converge-layout";
import { expansionOf } from "../lib/repository/state-graph";
import { mapHref } from "../lib/repository/process-layout";
import { isCapability, layerNode, type LayerGraph } from "../lib/repository/layers";
import { STATE_VOCABULARY } from "../lib/repository/state-vocabulary";
import { layerState } from "../lib/repository/states";
import type { PublicLocale } from "../lib/public-locale";

interface ConvergeCopy {
  heading: string;
  lede: string;
  /** The lede when the figure is a fan of fillers rather than a chain of states. */
  ledeFan: string;
  grainStates: (interior: number) => string;
  grainMethods: (n: number, slot: string) => string;
  truncatedNote: string;
  inconsistentNote: string;
  linesHeading: string;
  ownPage: string;
  pickAll: string;
  pickConverging: (n: number) => string;
  nothing: string;
  legendShared: string;
  legendUnpublished: string;
  legendUnpinned: string;
  meets: (state: string, arriving: number, leaving: number) => string;
  unpublishedNote: (n: number) => string;
  noneUnpublished: string;
  onMap: string;
  crossHeading: (state: string) => string;
  crossTally: (total: number, recorded: number, unpinned: number, unpublished: number) => string;
  crossNone: string;
  crossMore: (shown: number, total: number) => string;
  crossCaveat: string;
}

const COPY: Record<"en" | "ja", ConvergeCopy> = {
  en: {
    heading: "Where the routes meet",
    lede:
      "Every circle is drawn once. Several ways of getting somewhere end on the same circle, and every way onward leaves from it — so a route you can take is any line in, followed by any line out, whether or not a paper has put those two together.",
    ledeFan:
      "Every circle is drawn once. This step has no smaller object recorded inside it, so the lines between its two circles are the recorded ways of taking it — one line per method.",
    grainStates: (interior: number) =>
      `The ${interior === 1 ? "circle" : `${interior} circles`} between the ends ${interior === 1 ? "is an object" : "are objects"} every way across passes through.`,
    grainMethods: (n: number, slot: string) =>
      `${n} recorded ${n === 1 ? "way" : "ways"} of doing ${slot}. Nothing smaller is recorded inside it, so there is no object in the middle to draw.`,
    linesHeading: "The lines on this figure",
    truncatedNote:
      "The search for ways across hit its limit, so this figure is part of what the graph records rather than all of it.",
    inconsistentNote:
      "The shared objects are met in a different order on different routes, so they are not drawn as one line.",
    ownPage: "Read the full write-up",
    pickAll: "Every step you can open",
    pickConverging: (n: number) =>
      `${n} of these have an object recorded in the middle; the rest open into the methods that fill them.`,
    nothing: "Nothing recorded goes through this in more than one way.",
    legendShared: "more than one way reaches or leaves it",
    legendUnpublished: "no recorded source takes this path",
    legendUnpinned: "recorded, but no source names which method",
    meets: (state: string, arriving: number, leaving: number) =>
      `${arriving} way${arriving === 1 ? "" : "s"} arrive at ${state} and ${leaving} lead on, so ${arriving * leaving} routes cross it.`,
    unpublishedNote: (n: number) =>
      `${n} line${n === 1 ? "" : "s"} here ${n === 1 ? "is" : "are"} a composition no recorded source takes. That is a fact about this graph, not a claim about the literature.`,
    noneUnpublished: "Every line on this figure is one a recorded source takes.",
    onMap: "See it on the route map",
    crossHeading: (state: string) => `Ways through ${state}`,
    crossTally: (total: number, recorded: number, unpinned: number, unpublished: number) =>
      `${total} combinations cross this circle. A source records ${recorded} of them end to end. ${unpinned} cross slots a source does record, without naming which method fills them. ${unpublished} are compositions no recorded source takes.`,
    crossNone: "No recorded source leaves any of these unwalked.",
    crossMore: (shown: number, total: number) =>
      `Showing ${shown} of ${total}.`,
    crossCaveat:
      "These are derived from the two contracts each line carries, not proposed. A line here says the object one process hands back is the object the next one takes — nothing about whether it is a good idea, and nothing about whether the literature has missed it.",
  },
  ja: {
    heading: "経路が合流する場所",
    lede:
      "円はひとつずつ描かれます。ある場所に至る複数の道はすべて同じ円で終わり、そこから先へ向かう道はすべてその円から出ます。したがって、入る線と出る線の任意の組み合わせが、たどりうる経路になります。論文がその二つを結びつけているかどうかとは無関係です。",
    ledeFan:
      "円はひとつずつ描かれます。この工程の内側により小さな対象は記録されていないため、二つの円のあいだの線は、この工程を行う記録された手法そのものです。手法ひとつにつき一本です。",
    grainStates: (interior: number) =>
      `両端のあいだにある ${interior} 個の円は、どの道を通っても必ず経由する対象です。`,
    grainMethods: (n: number, slot: string) =>
      `${slot}を行う記録された手法が ${n} 件あります。内側により小さな対象は記録されていないため、中間に描く対象はありません。`,
    linesHeading: "この図の線",
    truncatedNote:
      "経路の探索が上限に達したため、この図はグラフが記録する全体ではなく、その一部です。",
    inconsistentNote:
      "共有される対象に出会う順序が経路によって異なるため、ひとつの線としては描いていません。",
    ownPage: "解説を読む",
    pickAll: "開くことのできる工程",
    pickConverging: (n: number) =>
      `このうち ${n} 件は中間に対象が記録されています。残りは、それを満たす手法へと開きます。`,
    nothing: "これを複数の方法で通る記録はありません。",
    legendShared: "複数の道が到達または出発する対象",
    legendUnpublished: "この経路をたどる記録された出典はありません",
    legendUnpinned: "記録はありますが、どの手法かを述べた出典はありません",
    meets: (state: string, arriving: number, leaving: number) =>
      `${state}には ${arriving} 本が到達し、${leaving} 本が続きます。したがって ${arriving * leaving} 通りの経路がここを通ります。`,
    unpublishedNote: (n: number) =>
      `この図の ${n} 本は、記録された出典がたどっていない組み合わせです。これはこのグラフについての事実であり、文献についての主張ではありません。`,
    noneUnpublished: "この図のすべての線は、記録された出典がたどるものです。",
    onMap: "経路マップで見る",
    crossHeading: (state: string) => `${state}を通る道`,
    crossTally: (total: number, recorded: number, unpinned: number, unpublished: number) =>
      `この円を通る組み合わせは ${total} 通りです。出典が端から端までたどるものが ${recorded} 件、出典が枠は記録しているものの、どの手法が満たすかを述べていないものが ${unpinned} 件、記録された出典がたどっていない組み合わせが ${unpublished} 件あります。`,
    crossNone: "記録された出典がたどっていない組み合わせはありません。",
    crossMore: (shown: number, total: number) => `${total} 件のうち ${shown} 件を表示しています。`,
    crossCaveat:
      "これらは各線が持つ二つの契約から導かれたものであり、提案ではありません。ここでの線は、ある処理が返す対象が次の処理の受け取る対象と一致することを述べているにすぎません。それが良い着想であるか、文献が見落としているかについては何も述べていません。",
  },
};

export function convergeHref(focus: string | null): string {
  const params = new URLSearchParams({ view: "converge" });
  if (focus) params.set("focus", focus);
  return `/repository/layers?${params.toString()}`;
}

export function ConvergeView({
  graph,
  locale,
  focusId,
}: {
  graph: LayerGraph;
  locale: PublicLocale;
  focusId: string | null;
}): React.ReactElement {
  const lang: "en" | "ja" = locale === "ja" ? "ja" : "en";
  const copy = COPY[lang];
  // Every slot that draws, not only the two whose interiors converge. Those are
  // different questions and answering the second here is what left 16 of the 18
  // slots with a blank page and no way to reach the other 16 from this surface.
  const candidates = drawableSlots(graph, STATE_VOCABULARY);
  const converging = convergingSlots(graph, STATE_VOCABULARY);

  const node = focusId ? layerNode(graph, focusId) : null;
  const focus = node && isCapability(node) ? node : (candidates[0] ?? null);
  const diagram: ConvergeDiagram | null = focus
    ? layoutConverge({ graph, vocabulary: STATE_VOCABULARY, focus, locale })
    : null;

  const label = (item: { label: string; labelJa: string }) =>
    lang === "ja" ? item.labelJa : item.label;

  // The convergence, restated as a number. A picture showing four lines meeting
  // is not the same as being told that those four lines are 4 routes; the
  // sentence is what a reader can carry away and check.
  const shared = (diagram?.states ?? []).filter(
    (state) => state.arriving > 0 && state.leaving > 0 && (state.arriving > 1 || state.leaving > 1),
  );

  // The discovery lives one level below the drawn lanes. A lane is a *slot*, and
  // at slot granularity every lane on the authored graph is one a source walks —
  // so the figure's own unpublished count is zero and would stay zero. The
  // unpublished pairs are combinations of the **methods** filling two slots, and
  // this is where the owner's Carleman + Schrödingerisation shows up.
  const census =
    focus && diagram && !diagram.empty && shared[0]
      ? crossingsAt(
          graph,
          STATE_VOCABULARY,
          expansionOf(graph, STATE_VOCABULARY, focus),
          shared[0].stateId,
          locale,
        )
      : null;

  return (
    <section className="mj-strand-view mj-process-view" aria-labelledby="converge-heading">
      <div className="mj-strand-controls">
        <ViewSwitch current="converge" locale={locale} />
      </div>

      <h1 id="converge-heading">{copy.heading}</h1>
      {/* `grain` is only meaningful once something is drawn. The empty result
          carries `grain: "methods"` because a fan is what it failed to build,
          and reading it before the `empty` check printed "the lines between its
          two circles are the recorded ways of taking it" above a page with no
          lines and no circles. Unreachable on the authored graph — no slot is
          unfilled — which is exactly why it would have sat there. */}
      <p className="mj-layers-lede">
        {diagram && !diagram.empty && diagram.grain === "methods" ? copy.ledeFan : copy.lede}
      </p>

      {diagram && !diagram.empty ? (
        <>
          {/* What this figure is, before the figure. A chain of shared circles
              and a fan of fillers are different claims — "every way across
              passes through this object" versus "these are the recorded ways
              across" — and a reader who takes the second for the first reads
              three ways to estimate an observable as three objects every
              estimate passes through. D89.6: say which, never let the picture
              imply it. */}
          <p className="mj-converge-grain">
            {diagram.grain === "states"
              ? copy.grainStates(diagram.states.length - 2)
              : copy.grainMethods(diagram.lanes.length, focus ? label(focus) : "")}
          </p>

          {/* A cap that bites is reported. `maxHops` biting makes `expansionOf`
              return "nothing finer is recorded", which this page would draw as a
              method fan — identical to a slot the literature genuinely has
              nothing finer for. Silence here would be the surface asserting the
              stronger of two readings it cannot tell apart. */}
          {diagram.truncated ? <p className="mj-converge-caveat">{copy.truncatedNote}</p> : null}
          {diagram.chainConsistent ? null : (
            <p className="mj-converge-caveat">{copy.inconsistentNote}</p>
          )}

          <ConvergeCanvas
            diagram={diagram}
            locale={locale}
            title={focus ? label(focus) : copy.heading}
          />

          {/* The figure, in words.

              Not a nicety: the lane's three-valued standing was carried ONLY by
              `stroke-dasharray` on a CSS modifier, so a screen-reader user got
              nothing, a print reader got three dash patterns and a legend that
              never said which line was which, and the `<text>` label was the
              fitted one. Every lane now has one row naming it, saying what its
              standing is in words, and linking where the shape links. */}
          <h2 className="mj-converge-lines-heading">{copy.linesHeading}</h2>
          <ol className="mj-converge-lanes">
            {diagram.lanes.map((lane) => (
              <li key={lane.key} className={`mj-converge-lane-row--${lane.standing}`}>
                <a href={lane.href}>{lane.fullLabel}</a>
                {lane.standing === "recorded" ? null : (
                  <span className="mj-converge-lane-standing">
                    {" — "}
                    {lane.standing === "unpublished" ? copy.legendUnpublished : copy.legendUnpinned}
                  </span>
                )}
              </li>
            ))}
          </ol>

          <ul className="mj-converge-facts">
            {shared.map((state) => {
              const named = layerState(STATE_VOCABULARY, state.stateId);
              return (
                <li key={state.key}>
                  {copy.meets(
                    named ? label(named) : state.stateId,
                    state.arriving,
                    state.leaving,
                  )}
                </li>
              );
            })}
            <li>
              {diagram.unpublishedCount > 0
                ? copy.unpublishedNote(diagram.unpublishedCount)
                : copy.noneUnpublished}
            </li>
          </ul>

          <ul className="mj-strand-legend">
            <li>{copy.legendShared}</li>
            <li>{copy.legendUnpublished}</li>
            <li>{copy.legendUnpinned}</li>
          </ul>

          {census ? (
            <section className="mj-converge-crossings">
              <h2>
                {copy.crossHeading(
                  layerState(STATE_VOCABULARY, census.stateId)
                    ? label(layerState(STATE_VOCABULARY, census.stateId)!)
                    : census.stateId,
                )}
              </h2>
              <p>
                {copy.crossTally(
                  census.total,
                  census.recorded,
                  census.unpinned,
                  census.unpublished,
                )}
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

          {/* The focused slot's own write-up, which this surface never linked.
              Measured before this: the converge page emitted 19 hrefs and not
              one of them was the page for the thing it was drawing — a reader
              looking at "Estimate an observable" had no way to read what it is
              without going through a lane. */}
          {focus ? (
            <p className="mj-converge-own">
              <a href={`/repository/layers/${focus.id}`}>{copy.ownPage}</a>
              {" · "}
              <a href={mapHref(focus.id)}>{copy.onMap}</a>
            </p>
          ) : null}
        </>
      ) : (
        <p>{copy.nothing}</p>
      )}

      {/* Every step, not the two that converge.
          This list *was* `convergingSlots`, and the mismatch between what it
          offered and what the page could draw is the whole defect: 16 slots were
          addressable, rendered nothing, and appeared nowhere to click. It is
          `drawableSlots` now — the same predicate the layout branches on, so the
          navigation and the renderer cannot hold different opinions about what
          exists. The convergence count stays as a sentence, because it is still
          true and still worth saying. */}
      <section>
        <h2>{copy.pickAll}</h2>
        <p>{copy.pickConverging(converging.length)}</p>
        <ul className="mj-converge-picks">
          {candidates.map((item) => (
            <li key={item.id}>
              {item.id === focus?.id ? (
                <strong aria-current="true">{label(item)}</strong>
              ) : (
                <a href={convergeHref(item.id)}>{label(item)}</a>
              )}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
