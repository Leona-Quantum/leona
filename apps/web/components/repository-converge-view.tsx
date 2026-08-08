// The surface around the convergence canvas.
//
// Server component throughout, same rule as every other Atlas surface: the only
// interactive elements are `<a href>`s, because a control that works only after
// hydration has no address (D88.2). Plain anchors rather than `next/link`, for
// the reason session 95 recorded — a `<Link>` is a same-document navigation and
// that is the one kind `@view-transition { navigation: auto }` does not animate,
// so using one here would silently delete the zoom on this surface only.
import { ConvergeCanvas } from "./repository-converge-map";
import { viewSwitchLabels } from "./repository-strand-view";
import {
  convergingSlots,
  crossingsAt,
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
  pick: string;
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
  crossCaveat: string;
}

const COPY: Record<"en" | "ja", ConvergeCopy> = {
  en: {
    heading: "Where the routes meet",
    lede:
      "Every circle is drawn once. Several ways of getting somewhere end on the same circle, and every way onward leaves from it — so a route you can take is any line in, followed by any line out, whether or not a paper has put those two together.",
    pick: "Figures that have something to converge",
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
    crossCaveat:
      "These are derived from the two contracts each line carries, not proposed. A line here says the object one process hands back is the object the next one takes — nothing about whether it is a good idea, and nothing about whether the literature has missed it.",
  },
  ja: {
    heading: "経路が合流する場所",
    lede:
      "円はひとつずつ描かれます。ある場所に至る複数の道はすべて同じ円で終わり、そこから先へ向かう道はすべてその円から出ます。したがって、入る線と出る線の任意の組み合わせが、たどりうる経路になります。論文がその二つを結びつけているかどうかとは無関係です。",
    pick: "合流のある図",
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
  const nav = viewSwitchLabels(locale);
  const candidates = convergingSlots(graph, STATE_VOCABULARY);

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
        <div className="mj-strand-switch" role="group" aria-label={nav.view}>
          <span className="mj-strand-switch-label">{nav.view}</span>
          <a href="/repository/layers?view=map">{nav.map}</a>
          <span className="mj-strand-switch-on">{nav.converge}</span>
          <a href="/repository/layers?view=strands">{nav.strands}</a>
          <a href="/repository/layers?view=list">{nav.list}</a>
        </div>
      </div>

      <h1 id="converge-heading">{copy.heading}</h1>
      <p className="mj-layers-lede">{copy.lede}</p>

      {diagram && !diagram.empty ? (
        <>
          <ConvergeCanvas
            diagram={diagram}
            locale={locale}
            title={focus ? label(focus) : copy.heading}
          />

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
              <p className="mj-converge-caveat">{copy.crossCaveat}</p>
            </section>
          ) : null}

          {focus ? <p><a href={mapHref(focus.id)}>{copy.onMap}</a></p> : null}
        </>
      ) : (
        <p>{copy.nothing}</p>
      )}

      <section>
        <h2>{copy.pick}</h2>
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
