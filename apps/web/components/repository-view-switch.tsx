// The one place the view switch is written.
//
// ## Why this file exists
//
// It was written four times — once in each view — and only one copy knew about
// the fourth option. Session 96 shipped `?view=converge` and added it to
// `repository-converge-view.tsx`'s own switch; the copies in
// `repository-process-view.tsx` (the **default** view), `repository-strand-view.tsx`
// and `repository-layers.tsx` still listed three. So the surface that session
// shipped was reachable only by typing the query parameter, and the owner's
// session-97 note said exactly that:
//
// > *"i can't see the converge option so i can't really comment on it"*
//
// Read on production 2026-08-08, `/repository/layers` rendered `view · Map ·
// Strands · List`. Nothing was broken and every test passed: there was no test,
// because there was nothing to test — four literal lists of anchors, three of
// them one option short.
//
// A switch is a projection of the set of views onto "which one am I on". Written
// once, adding a view is one entry here and no copy can lag. `VIEWS` is the set,
// exported so a test can assert the page's router accepts exactly these.
import type { PublicLocale } from "../lib/public-locale";

/**
 * Every drawing of the graph, in the order the switch shows them.
 *
 * The order is the order they were built, which is also least-to-most recent —
 * the owner reads it left to right as the surface improving.
 */
export const VIEWS = ["map", "converge", "strands", "list"] as const;

export type RepositoryView = (typeof VIEWS)[number];

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
 * The switch, with `current` rendered as a `<span>` rather than a self-link.
 *
 * D91.4: the active option in a switch is never an anchor to the page you are
 * already on. Keeping that rule in one component is the second reason this file
 * exists — it was restated correctly in all four copies, which is four chances
 * to get it wrong later.
 */
export function ViewSwitch({
  current,
  locale,
}: {
  current: RepositoryView;
  locale: PublicLocale;
}): React.ReactElement {
  const labels = viewSwitchLabels(locale);
  return (
    <div className="mj-strand-switch" role="group" aria-label={labels.view}>
      <span className="mj-strand-switch-label">{labels.view}</span>
      {VIEWS.map((view) =>
        view === current ? (
          <span className="mj-strand-switch-on" key={view} aria-current="true">
            {labels[view]}
          </span>
        ) : (
          <a href={`/repository/layers?view=${view}`} key={view}>
            {labels[view]}
          </a>
        ),
      )}
    </div>
  );
}
