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
  layoutConverge,
  type ConvergeDiagram,
} from "../lib/repository/converge-layout";
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
