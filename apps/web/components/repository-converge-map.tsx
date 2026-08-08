// The convergence canvas: one circle per state, and the ways across drawn as
// tapered strands between them — openable in place.
//
// Same constraints as ever (D88.2, D90.3): every shape is an `<a href>` in HTML
// that arrives from the origin, there is no `"use client"` here, no measurement
// API, and the geometry is solved in `converge-layout.ts` before this file sees
// it. A crawler gets every destination, a reader with JavaScript off gets the
// same page, and the whole thing is checkable with `curl`. The pan-and-zoom
// viewport around this canvas *is* a client component, and it is deliberately
// only that: it moves the drawing, it does not produce it.
//
// ## What the shapes mean
//
// - A **circle** is a state, drawn **once**. The process canvas draws one circle
//   per route per state — `?focus=nonlinear-ode-solve` drew `nonlinear-ivp` four
//   times — and joins the copies with a dotted tie. Here the copies are one
//   circle, and the strands reaching it reach *it*. A **smaller** circle is an
//   object inside one particular way across: what one step hands to the next.
// - A **tapered strand** is a way across, pinched to a point at both circles.
//   The taper is not decoration. A line of constant width arriving at a circle
//   says *this ends here*; a strand pinching to a point says *this and the others
//   become one thing here*, which is what a convergence is.
// - A strand drawn **faint and thin** is one a reader has opened: its own body
//   is gone and what was inside it is drawn in its place, around it or along it.
// - A **stub hanging off** an opened strand is an ingredient that route needs —
//   a block-encoding, a prepared state — which does not move the route along and
//   so is not a stage.
//
// ## Two targets on one strand, which is the whole interaction
//
// > *"clicking a process line itself keeps the view but expands branches, while
// > clicking labels of processes induces the prezi functionality and zoom
// > in/atlas record rendering."* — owner, session-100 inbox
//
// So the **body** of a strand opens it here, in place, with everything else
// still in view; and the **name** goes there, to the thing's own page. Two
// shapes, two destinations, and the `<title>` on each says which. A strand with
// nothing recorded inside has no body target at all rather than a body that
// navigates — a line that goes somewhere when a reader expected it to expand
// teaches the wrong rule about every other line on the canvas.
//
// The name carries the figure's `view-transition-name`, which is what makes the
// second click read as *zooming into the thing* rather than as loading a
// different screen: the destination page draws the same subject under the same
// name, so the browser morphs one into the other.
import type {
  ConvergeDiagram,
  ConvergeFeed,
  ConvergeLane,
  ConvergeState,
} from "../lib/repository/converge-layout";
import type { PublicLocale } from "../lib/public-locale";

interface ConvergeCopy {
  start: string;
  end: string;
  meets: (arriving: number, leaving: number) => string;
  ways: (n: number) => string;
  steps: (n: number) => string;
  unpublished: string;
  unpinned: string;
  readAbout: string;
  openHere: string;
  closeHere: string;
  inside: string;
  needs: string;
  inAtlas: string;
  handsOn: string;
}

const COPY: Record<"en" | "ja", ConvergeCopy> = {
  en: {
    start: "you start here",
    end: "you finish here",
    meets: (arriving: number, leaving: number) =>
      `${arriving} way${arriving === 1 ? "" : "s"} arrive here, ${leaving} lead on`,
    ways: (n: number) => `${n} way${n === 1 ? "" : "s"} through`,
    steps: (n: number) => `${n} part${n === 1 ? "" : "s"} inside`,
    unpublished: "no recorded source takes this path",
    unpinned: "recorded, but no source names which method",
    readAbout: "click the name to read about it",
    openHere: "click the line to open it here",
    closeHere: "click the line to close it",
    inside: "open",
    needs: "needs",
    inAtlas: "the Atlas has a full record of this",
    handsOn: "what one part hands to the next",
  },
  ja: {
    start: "ここから始まります",
    end: "ここで終わります",
    meets: (arriving: number, leaving: number) =>
      `${arriving} 本がここに到達し、${leaving} 本がここから続きます`,
    ways: (n: number) => `通り道 ${n} 件`,
    steps: (n: number) => `内側に ${n} 件`,
    unpublished: "この経路をたどる記録された出典はありません",
    unpinned: "記録はありますが、どの手法かを述べた出典はありません",
    readAbout: "名前をクリックすると解説を開きます",
    openHere: "線をクリックするとこの場で展開します",
    closeHere: "線をクリックすると畳みます",
    inside: "展開中",
    needs: "必要なもの",
    inAtlas: "アトラスに完全な記録があります",
    handsOn: "ある工程が次の工程へ渡す対象",
  },
};

/** Trim a float for the DOM. Same helper and same reason as the process canvas. */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

/** One shared empty set rather than a fresh `new Set()` per render. */
const EMPTY_ATLAS: ReadonlySet<string> = new Set<string>();

/**
 * The figure's identity **across pages**, for the cross-document zoom.
 *
 * A view transition pairs an old element with a new one by name, so a strand on
 * this figure and that node's own page carrying the same name is what makes
 * clicking it read as zooming into the thing — the owner's prezi, in one CSS
 * property rather than a canvas library. Where no pair exists the browser falls
 * back to the whole page, which still scales and fades rather than cutting.
 *
 * Sanitised because the value is a CSS `<custom-ident>` and node ids are
 * authored strings: a leading digit or a stray character would make the whole
 * declaration invalid, and an invalid declaration is silent. The prefix also
 * guarantees the ident cannot start with a digit whatever the id does.
 */
export function transitionNameFor(id: string): string {
  return `mj-fig-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function Hub({ state, copy }: { state: ConvergeState; copy: ConvergeCopy }): React.ReactElement {
  const note = state.depth > 0
    ? copy.handsOn
    : state.terminal
      ? state.arriving === 0
        ? copy.start
        : copy.end
      : copy.meets(state.arriving, state.leaving);
  return (
    <g
      className={`mj-converge-hub${state.terminal && state.depth === 0 ? " mj-converge-hub--terminal" : ""}${
        state.depth > 0 ? " mj-converge-hub--inner" : ""
      }${
        state.depth === 0 && (state.arriving > 1 || state.leaving > 1)
          ? " mj-converge-hub--shared"
          : ""
      }`}
    >
      {/* The note rides IN the aria-label, not only in the `<title>`.
          `aria-label` wins the accessible-name computation over an SVG `<title>`
          child, so with the two split a screen reader announced the bare state
          name and never the payload — "3 ways arrive here, 2 lead on" was
          visible to a mouse and inaudible to everyone else. One string, used
          twice, so they cannot drift apart either. */}
      <a href={state.href} aria-label={`${state.label} — ${note}`}>
        <title>{`${state.label} — ${note}`}</title>
        <circle className="mj-converge-dot" cx={n(state.cx)} cy={n(state.cy)} r={n(state.r)} />
        {/* A 24px minimum touch target, invisible, over an 11px dot. Same reason
            the process canvas carries one: the name lives behind the hover. */}
        <circle
          className="mj-converge-hit"
          cx={n(state.cx)}
          cy={n(state.cy)}
          r={n(Math.max(state.r + 6, 13))}
        />
      </a>
    </g>
  );
}

/** An ingredient a route needs, hanging under the strand that consumes it. */
function Feed({ feed, copy }: { feed: ConvergeFeed; copy: ConvergeCopy }): React.ReactElement {
  return (
    <g className="mj-converge-feed" data-depth={feed.depth}>
      <a href={feed.href} aria-label={`${copy.needs}: ${feed.fullLabel}`}>
        <title>{`${copy.needs}: ${feed.fullLabel}`}</title>
        <line
          className="mj-converge-feed-line"
          x1={n(feed.x)}
          y1={n(feed.y0)}
          x2={n(feed.x)}
          y2={n(feed.y1)}
        />
        <text
          className="mj-converge-feed-name"
          x={n(feed.x + 4)}
          y={n(feed.y1 + (feed.outward > 0 ? 9 : -3))}
        >
          {feed.label}
        </text>
      </a>
    </g>
  );
}

function Lane({
  lane,
  copy,
  atlas,
}: {
  lane: ConvergeLane;
  copy: ConvergeCopy;
  atlas: ReadonlySet<string>;
}): React.ReactElement {
  const standingNote =
    lane.standing === "unpublished"
      ? ` — ${copy.unpublished}`
      : lane.standing === "unpinned"
        ? ` — ${copy.unpinned}`
        : "";
  const insideNote =
    lane.inside > 0
      ? ` · ${lane.opensInto === "ways" ? copy.ways(lane.inside) : copy.steps(lane.inside)}${
          lane.open ? `, ${copy.inside}` : ""
        }`
      : "";
  const documented = lane.nodeId !== null && atlas.has(lane.nodeId);
  const title = `${lane.fullLabel}${insideNote}${standingNote}${
    documented ? ` · ${copy.inAtlas}` : ""
  }`;

  // **A lane carries no `view-transition-name`, and never usefully did.**
  //
  // It used to, on the `<text>`, with a per-document set making sure no two lanes
  // claimed one id — careful bookkeeping over a property the browser ignores.
  // Measured under Playwright, because a hidden agent tab skips every view
  // transition and so cannot tell "does not work" from "did not run":
  // `view-transition-name` on a `<path>`, a `<text>`, a `<circle>` or a `<g>`
  // inside an `<svg>` is **never captured** — `getComputedStyle` reports the name
  // and no `::view-transition-group(<name>)` is ever built — while the same name
  // on a `<div>` is. The root `<svg>` is captured, and that one is kept below.
  //
  // What moves a lane now is a CSS transition on its geometry, which does work
  // inside an SVG and is strictly better here: it bends the actual curve instead
  // of crossfading a snapshot of it. See the converge block in `styles.css`.

  return (
    <g
      className={`mj-converge-lane mj-converge-lane--${lane.standing}${
        lane.open ? " mj-converge-lane--open" : ""
      }${documented ? " mj-converge-lane--atlas" : ""}`}
      data-depth={lane.depth}
    >
      {/* Open: the centre line stays, faint, and what was inside is drawn in its
          place. Shut: the tapered body. Never both — an opened strand still
          drawing its own body would claim to be a way across at the same time
          as showing the ways across it decomposes into. */}
      {/* The `<title>` rides on the drawn shape, not only on the two anchors.
          Exactly one lane on the whole surface had none — the run of named hops,
          which is drawn open and has no id, so it gets neither anchor and so got
          neither `<title>`. It is also the longest label in the graph. Hanging
          the description off the *drawing* rather than off the *controls* means
          a lane cannot lose its description by losing a control, which is how
          that one went missing. The anchors keep their own, action-specific
          titles: "click the line to open it here" is about the control. */}
      {lane.open ? (
        <path className="mj-converge-spine" d={lane.d}>
          <title>{title}</title>
        </path>
      ) : (
        <path className="mj-converge-strand-body" d={lane.outline}>
          <title>{title}</title>
        </path>
      )}

      {/* Target one: the line. Opens or shuts it, here. */}
      {lane.openHref === null ? null : (
        <a
          href={lane.openHref}
          aria-label={`${lane.fullLabel} — ${lane.open ? copy.closeHere : copy.openHere}`}
        >
          <title>{`${title} — ${lane.open ? copy.closeHere : copy.openHere}`}</title>
          <path className="mj-converge-strand-hit" d={lane.d} />
        </a>
      )}

      {/* Target two: the name. Goes to the thing's own page, and carries the
          pairing that makes the arrival read as a zoom into it.
          An opened strand draws no name — see `place` in the layout for why it
          cannot have one that does not collide — so there is nothing here to
          hang a target on, and an invisible band claiming a name that is not
          drawn would be a hit target for nothing. */}
      {lane.label === "" ? null : (
        <a href={lane.href} aria-label={`${lane.fullLabel} — ${copy.readAbout}`}>
          <title>{`${title} — ${copy.readAbout}`}</title>
          {/* Sized to the name, not to a constant. It was a fixed 120x15 under
              text whose median drawn width is 235px, so **96% of English names
              and 80% of Japanese ones were wider than their own click target** —
              a reader aiming at the middle of a word hit nothing. The width comes
              from `lane.labelWidth`, which is the engine's own measurement of
              this string: the same number that sized the column, carried, never
              re-derived here. A second derivation of a width is exactly what
              clipped the widest label in a column built for it, twice. */}
          <rect
            className="mj-converge-hit"
            x={n(lane.labelX - lane.labelWidth / 2 - 4)}
            y={n(lane.labelY - 12)}
            width={n(lane.labelWidth + 8)}
            height="15"
          />
          <text
            className="mj-converge-lane-name"
            /* Positioned by `transform`, not by `x`/`y`. Those are not animatable
               CSS properties on a `<text>` (measured), so a name set with them
               jumps to its new place while every line around it glides. The
               transform *is* animatable, and the canvas transitions it. */
            x="0"
            y="0"
            transform={`translate(${n(lane.labelX)} ${n(lane.labelY)})`}
            textAnchor="middle"
          >
            {lane.label}
          </text>
        </a>
      )}
    </g>
  );
}

/**
 * The canvas.
 *
 * Deliberately **not** `role="img"`: that collapses every destination on it into
 * one alt string, and the whole point is that each shape is its own link. Same
 * call as the process canvas, D90.2.
 *
 * Z-order is load-bearing. Strands first, then the stubs hanging off them, then
 * the circles — a circle is the thing several strands share, so it has to sit on
 * top of all of them or the shared circle reads as lines passing behind a dot.
 * Within the strands, deeper ones are emitted after shallower ones, which the
 * layout already guarantees by emitting a parent before its children.
 */
export function ConvergeCanvas({
  diagram,
  locale,
  title,
  subjectId = null,
  atlas = EMPTY_ATLAS,
  claimed,
}: {
  diagram: ConvergeDiagram;
  locale: PublicLocale;
  title: string;
  /**
   * View-transition names already spoken for **on this page**.
   *
   * Page, not canvas. A `view-transition-name` must be unique per *document*, and
   * a duplicate does not degrade politely — the browser skips the transition for
   * every element claiming that name. The unfocused surface draws four figures at
   * once and one node can appear on more than one of them, so a set scoped to a
   * single canvas would let two figures claim the same name and silently kill the
   * zoom the whole surface is built around. The caller owns the set; a canvas
   * rendered on its own gets a fresh one.
   */
  claimed?: Set<string>;
  /**
   * What this figure is *of*. Two figures of the same thing on two pages are one
   * figure to the reader, and naming them so is what the browser needs to move
   * one into the other.
   */
  subjectId?: string | null;
  /**
   * Node ids the Atlas holds a full record for (`nodesWithEntries`).
   *
   * Passed in rather than derived here because it depends on the corpus that
   * actually loaded, and that is a fetch this component must not make. Empty by
   * default, which draws no marks — the right failure: a surface that could not
   * read the corpus claims nothing about it rather than claiming everything.
   */
  atlas?: ReadonlySet<string>;
}): React.ReactElement | null {
  if (diagram.empty) return null;
  const copy = COPY[locale === "ja" ? "ja" : "en"];
  // The set now has exactly one kind of claimant — the figure itself — because
  // the root `<svg>` is the only element here a `view-transition-name` reaches.
  // It is still needed: the unfocused surface draws four figures at once and one
  // node can be the subject of more than one of them, and a duplicate name does
  // not degrade politely, it kills the transition for every element claiming it.
  const named = claimed ?? new Set<string>();
  const subjectClaims = subjectId !== null && !named.has(subjectId);
  if (subjectClaims) named.add(subjectId);
  return (
    <svg
      className="mj-converge-canvas"
      viewBox={`0 0 ${n(diagram.width)} ${n(diagram.height)}`}
      width={n(diagram.width)}
      height={n(diagram.height)}
      style={
        subjectClaims
          ? ({ viewTransitionName: transitionNameFor(subjectId!) } as React.CSSProperties)
          : undefined
      }
    >
      <title>{title}</title>
      {diagram.lanes.map((lane) => (
        <Lane key={lane.key} lane={lane} copy={copy} atlas={atlas} />
      ))}
      {diagram.feeds.map((feed) => (
        <Feed key={feed.key} feed={feed} copy={copy} />
      ))}
      {diagram.states.map((state) => (
        <Hub key={state.key} state={state} copy={copy} />
      ))}
    </svg>
  );
}
