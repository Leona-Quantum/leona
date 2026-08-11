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
// nothing recorded inside opens its **card**, in place, rather than navigating —
// a line that goes somewhere when a reader expected it to expand teaches the
// wrong rule about every other line on the canvas, and a line that does nothing
// at all reads as a broken one. (It had no body target until session 118; the
// owner's report is what changed it. See the leaf anchor in `Lane`.)
//
// The name carries the figure's `view-transition-name`, which is what makes the
// second click read as *zooming into the thing* rather than as loading a
// different screen: the destination page draws the same subject under the same
// name, so the browser morphs one into the other.
import {
  ownStepName,
  spokenName,
  type ConvergeDiagram,
  type ConvergeFeed,
  type ConvergeLane,
  type ConvergeState,
} from "../lib/repository/converge-layout";
import type { PublicLocale } from "../lib/public-locale";

interface ConvergeCopy {
  /**
   * The locale these words are in.
   *
   * Carried so a component holding `copy` can reach the one phrase this file
   * does not own: `ownStepName`, whose single writer is the layout, because the
   * card prints the same words on the same hop and one fact wants one string.
   */
  lang: "en" | "ja";
  start: string;
  end: string;
  meets: (arriving: number, leaving: number) => string;
  ways: (n: number) => string;
  steps: (n: number) => string;
  unpublished: string;
  unpinned: string;
  readAbout: string;
  /**
   * What a name does on a surface that has a card.
   *
   * A second string rather than a reworded `readAbout`, because the two
   * surfaces genuinely differ and the node page still uses the first. A name
   * that says "opens its card here" on a page with no card layer would be the
   * label lying about the click, which is the failure `openHere` was split out
   * for on the line.
   */
  readHere: string;
  /**
   * What a **line** does when there is nothing inside it to open.
   *
   * A third string for the same reason `readHere` is a second one. This one is
   * spoken by a line, not by a name, and the two are different controls in
   * different places: a reader told "click the name" while their pointer is on
   * a line three hundred pixels long has been told to go somewhere else. The
   * whole `readAbout`/`readHere` split exists because a label that lies about
   * its own click is the failure mode this contract is shaped against.
   */
  lineReadHere: string;
  openHere: string;
  closeHere: string;
  inside: string;
  needs: string;
  inAtlas: string;
  handsOn: string;
  /**
   * What the bracket around a group of nested lanes says (W13).
   *
   * One static sentence rather than one naming the parent: the parent's own
   * line is the shape directly above the bracket, so the geometry already
   * points at it, and each nested lane's `spokenName` still carries the full
   * "a narrower version of X" sentence for a reader who cannot see the
   * nesting.
   */
  variantsNested: string;
}

const COPY: Record<"en" | "ja", ConvergeCopy> = {
  en: {
    lang: "en",
    start: "you start here",
    end: "you finish here",
    meets: (arriving: number, leaving: number) =>
      `${arriving} way${arriving === 1 ? "" : "s"} arrive here, ${leaving} lead on`,
    ways: (n: number) => `${n} way${n === 1 ? "" : "s"} through`,
    steps: (n: number) => `${n} part${n === 1 ? "" : "s"} inside`,
    unpublished: "no recorded source takes this path",
    unpinned: "recorded, but no source names which method",
    readAbout: "click the name to read about it",
    readHere: "click the name to read about it here",
    lineReadHere: "click the line to read about it here",
    openHere: "click the line to open it here",
    closeHere: "click the line to close it",
    inside: "open",
    needs: "needs",
    inAtlas: "the Atlas has a full record of this",
    handsOn: "what one part hands to the next",
    variantsNested: "narrower versions, nested under the line they refine",
  },
  ja: {
    lang: "ja",
    start: "ここから始まります",
    end: "ここで終わります",
    meets: (arriving: number, leaving: number) =>
      `${arriving} 本がここに到達し、${leaving} 本がここから続きます`,
    ways: (n: number) => `通り道 ${n} 件`,
    steps: (n: number) => `内側に ${n} 件`,
    unpublished: "この経路をたどる記録された出典はありません",
    unpinned: "記録はありますが、どの手法かを述べた出典はありません",
    readAbout: "名前をクリックすると解説を開きます",
    readHere: "名前をクリックするとこの場で解説を開きます",
    lineReadHere: "線をクリックするとこの場で解説を開きます",
    openHere: "線をクリックするとこの場で展開します",
    closeHere: "線をクリックすると畳みます",
    inside: "展開中",
    needs: "必要なもの",
    inAtlas: "アトラスに完全な記録があります",
    handsOn: "ある工程が次の工程へ渡す対象",
    variantsNested: "その上の線をより狭めた版が、入れ子で示されています",
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

function Hub({
  state,
  copy,
  selected = false,
}: {
  state: ConvergeState;
  copy: ConvergeCopy;
  selected?: boolean;
}): React.ReactElement {
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
      }${selected ? " mj-converge-hub--selected" : ""}`}
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

/**
 * An ingredient a route needs, hanging under the strand that consumes it.
 *
 * **Two targets, the same split a `Lane` has** — and until this was written the
 * stub had only one. `layoutConverge` has computed `openHref` for every stub, and
 * drawn the fan of methods behind an opened one, since ingredients became
 * openable; this component read `feed.href` and nothing else, so the only way to
 * open an ingredient was to type its address into `?open=` by hand. The layout
 * described a control no reader could reach.
 *
 * That is the ask: *"they are neither state nor process visually. They **are**
 * processes."* A thing you can open is a process; a thing you can only follow is
 * a tag. So the **stub** opens and shuts it here, and the **name** goes to its
 * own page — the line and the name being two destinations is the rule this canvas
 * already follows, and the reason `.mj-converge-canvas a:hover` is written per
 * target rather than per group.
 *
 * A stub with nothing recorded inside it gets no control at all, which is the
 * same rule R12.2 gives every line: `openHref` is null there, and the bare line
 * keeps the descriptive title so it does not lose its name along with its action.
 */
function Feed({
  feed,
  copy,
  selected = false,
}: {
  feed: ConvergeFeed;
  copy: ConvergeCopy;
  selected?: boolean;
}): React.ReactElement {
  const title = `${copy.needs}: ${spokenName(feed)}`;
  const action = feed.open ? copy.closeHere : copy.openHere;
  const stub = (
    <line
      className="mj-converge-feed-line"
      x1={n(feed.x)}
      y1={n(feed.y0)}
      x2={n(feed.x)}
      y2={n(feed.y1)}
    />
  );
  return (
    <g
      className={`mj-converge-feed${feed.open ? " mj-converge-feed--open" : ""}${selected ? " mj-converge-feed--selected" : ""}`}
      data-depth={feed.depth}
    >
      {/* Target one: the stub. Opens or shuts the ingredient, here. */}
      {feed.openHref === null ? (
        <g>
          <title>{title}</title>
          {stub}
        </g>
      ) : (
        <a href={feed.openHref} aria-label={`${spokenName(feed)} — ${action}`}>
          <title>{`${title} — ${action}`}</title>
          {stub}
          {/* A 1.5px stub is not a click target. A stroke, not a fill — the shape
              is a line and has no interior to hit. Same trick, same reason, as
              `.mj-converge-strand-hit`. */}
          <line
            className="mj-converge-feed-hit"
            x1={n(feed.x)}
            y1={n(feed.y0)}
            x2={n(feed.x)}
            y2={n(feed.y1)}
          />
        </a>
      )}

      {/* Target two: the name. The ingredient's card where there is one, and its
          own page where there is not — same rule as a lane's name, **including
          saying which**. This label read as the bare ingredient name until the
          card href landed under it, at which point the accessible name stopped
          describing the click: a reader on assistive technology was told
          "needs: Prepare a state" for a control that opens a panel in place.
          `LaneName` has carried its action since it was written; this is the
          same two strings for the same reason. Caught in review on PR 332.
          (Written without the hash: `check-raw-hex` reads a three-digit PR
          reference as a colour. Session 112's standing note, hit twice here —
          once writing it and once writing the note explaining it.) */}
      <a
        href={feed.cardHref ?? feed.href}
        aria-label={`${title} — ${feed.cardHref === null ? copy.readAbout : copy.readHere}`}
      >
        <title>{`${title} — ${feed.cardHref === null ? copy.readAbout : copy.readHere}`}</title>
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

/**
 * The classes a lane's `<g>` carries, shared by its **body** group and its
 * **name** group.
 *
 * Two groups per lane, because paint order decides what a plate can hide — see
 * `ConvergeCanvas`. One expression rather than two so a standing, an atlas mark
 * or a depth cannot apply to half of a lane: `.mj-converge-lane--unpublished
 * .mj-converge-lane-name` styles the name and
 * `.mj-converge-lane--unpublished .mj-converge-strand-body` styles the body,
 * and a second copy of this string is how one of them would quietly stop
 * matching.
 */
function laneClass(lane: ConvergeLane, documented: boolean, selected = false): string {
  return `mj-converge-lane mj-converge-lane--${lane.standing}${
    lane.open ? " mj-converge-lane--open" : ""
  }${documented ? " mj-converge-lane--atlas" : ""}${
    // The thing `?sel=` names (W16, the Prezi move) — like `subject`, a fact
    // about where the reader is rather than about what the literature records.
    // Both call sites pass it (the drawing and the name pass), so the name
    // carries the emphasis its lane does.
    selected ? " mj-converge-lane--selected" : ""
  }${
    // The line the page is *about*, on a method's own page. Not a standing and
    // not a category: those say what the literature records about a line, and
    // this says which line the reader clicked to get here. It is also the only
    // thing that tells two sibling leaves' pages apart — their fans are the same
    // drawing otherwise, which is how 43 of 63 method pages came to share one.
    lane.subject ? " mj-converge-lane--subject" : ""
  }${
    // The stretch a method performs itself. A category rather than a standing,
    // for the same reason `subject` is one: the standings say what the
    // literature records about a line, and this says what *kind* of line it is —
    // a piece of a route that no named slot covers. It carries the footnote
    // treatment so the phrase on it does not read as a name competing with the
    // names beside it.
    lane.own !== null ? " mj-converge-lane--own" : ""
  }${
    // A nested refinement (W13) — the same kind-not-standing call as `own`:
    // the row is a real method with its own name and clicks, drawn as the
    // aside its bracket says it is.
    lane.variant ? " mj-converge-lane--variant" : ""
  }`;
}

function isDocumented(lane: ConvergeLane, atlas: ReadonlySet<string>): boolean {
  return lane.nodeId !== null && atlas.has(lane.nodeId);
}

/**
 * The plate under a name, in the pass that draws **only** plates.
 *
 * **Every name, not only an opened one** (owner, session 107: *"plate every
 * name, but opened ones are fainter and within their lines"*). The split that
 * existed before was an accident of when the plate was built rather than a
 * decision: an opened name got one because its own branches structurally cross
 * it, and a shut name did not because a mostly-empty figure had nothing to cross
 * it with. Measured over all 19 figures × both locales, fully opened, **34 of
 * 478 shut names already have a line through them** — and drawing ingredient
 * fans takes that to 58. "Readable when open, sometimes not when shut" is also
 * the harder rule to explain to a reader.
 *
 * Not inside the name's `<a>`, and that is the point of the separate pass: a
 * plate that sits in the anchor is a filled rect and therefore a click target,
 * so it grows the name's box past the *small* one the owner asked for and eats
 * the collapse click on the line underneath it. Out here it is inert, and the
 * name's target is exactly `.mj-converge-hit`.
 */
function NamePlate({ lane }: { lane: ConvergeLane }): React.ReactElement | null {
  if (lane.label === "") return null;
  return (
    <rect
      className={`mj-converge-name-plate${
        // The lozenge-on-the-line treatment: names that sit ON a stroke — a
        // bone's, a shell's, or a leaf's own body (`labelInside`) — let the
        // line show through rather than cutting a hole in the canvas.
        lane.bone || lane.frame !== null || lane.labelInside ? " mj-converge-name-plate--open" : ""
      }`}
      data-name={lane.key}
      x={n(lane.labelX - lane.labelWidth / 2 - 5)}
      /* `-12.5` / 17, not `-12` / 16. The 16px height was measured against
         `getBBox()` on the rendered page — a 12px Japanese name draws 15.2px
         tall — but the *placement* was not: at `labelY - 12` the cover was
         0.5px above the name and 1.0px below, and the asymmetry is placement,
         not size. Half a pixel is nothing for the Latin face this repository
         ships; it is not nothing for a Japanese name, because Instrument Sans
         has no CJK glyphs and those fall back to whatever face the *reader's*
         machine offers, which may have a taller ascent than 0.5px allows.
         1.0 / 1.5, one pixel taller. OWNER_TODO §3, taken with the change to
         this component it was waiting for. */
      y={n(lane.labelY - 12.5)}
      width={n(lane.labelWidth + 10)}
      height="17"
    />
  );
}

function LaneName({
  lane,
  copy,
  atlas,
  title,
  selected = false,
}: {
  lane: ConvergeLane;
  copy: ConvergeCopy;
  atlas: ReadonlySet<string>;
  title: string;
  selected?: boolean;
}): React.ReactElement | null {
  if (lane.label === "") return null;
  // The card when this surface has one, the node's own page when it does not.
  // **One expression, not two branches**, because the anchor around it is
  // twenty lines of hit-target geometry and duplicating it to change one
  // attribute is how the two copies come apart. The full page is not lost: it
  // is the card's first link.
  const nameHref = lane.cardHref ?? lane.href;
  const nameAction = lane.cardHref === null ? copy.readAbout : copy.readHere;
  return (
    <g className={laneClass(lane, isDocumented(lane, atlas), selected)} data-depth={lane.depth}>
      {/* `spokenName`, not `fullLabel`: the count must reach a reader who is not
          looking at the picture. See `spokenName`. */}
      <a href={nameHref} aria-label={`${spokenName(lane)} — ${nameAction}`}>
        <title>{`${title} — ${nameAction}`}</title>
        {/* Sized to the name, not to a constant. It was a fixed 120x15 under
            text whose median drawn width is 235px, so **96% of English names
            and 80% of Japanese ones were wider than their own click target** —
            a reader aiming at the middle of a word hit nothing. The width comes
            from `lane.labelWidth`, which is the engine's own measurement of
            this string: the same number that sized the column, carried, never
            re-derived here. A second derivation of a width is exactly what
            clipped the widest label in a column built for it, twice.

            **This rect is the whole of the name's target**, which is what makes
            the owner's *"small click box for the label itself, and the rest of
            the line can be clickable to collapse as well"* true rather than
            approximately true. The plate is drawn in an earlier pass and takes
            no clicks; nothing else in this anchor is filled. So outside these
            few hundred square pixels the 24px stroke along the line is still
            the topmost target, and it still collapses. */}
        <rect
          className="mj-converge-hit"
          x={n(lane.labelX - lane.labelWidth / 2 - 4)}
          y={n(lane.labelY - 12)}
          width={n(lane.labelWidth + 8)}
          height="15"
        />
        <text
          className="mj-converge-lane-name"
          data-name={lane.key}
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
    </g>
  );
}

/**
 * What every shape of one lane says it is.
 *
 * One writer, read by the body group and by the name group, which are two
 * elements in two passes now. The `<title>` a reader hovers has to be the same
 * sentence whichever shape they land on, and two expressions of it is how the
 * name and the line come to describe the same thing differently.
 */
function laneTitle(lane: ConvergeLane, copy: ConvergeCopy, atlas: ReadonlySet<string>): string {
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
  return `${spokenName(lane)}${insideNote}${standingNote}${
    isDocumented(lane, atlas) ? ` · ${copy.inAtlas}` : ""
  }`;
}

/**
 * A lane's **body**: what it is drawn as, and the target that opens or shuts it.
 *
 * The name is not here. It is drawn by `NamePlate` and `LaneName` in two later
 * passes, because a plate can only rub out lines that were painted before it and
 * a lane's own branches are painted *after* it — see `ConvergeCanvas`.
 */
function Lane({
  lane,
  copy,
  atlas,
  selected = false,
}: {
  lane: ConvergeLane;
  copy: ConvergeCopy;
  atlas: ReadonlySet<string>;
  selected?: boolean;
}): React.ReactElement {
  const documented = isDocumented(lane, atlas);
  const title = laneTitle(lane, copy, atlas);

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
    <g className={laneClass(lane, documented, selected)} data-depth={lane.depth}>
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
        <path
          className={`mj-converge-spine${lane.bone ? " mj-converge-spine--bone" : ""}`}
          d={lane.d}
        >
          <title>{title}</title>
        </path>
      ) : (
        <path className="mj-converge-strand-body" d={lane.outline}>
          <title>{title}</title>
        </path>
      )}

      {/* The **exoskeleton** (W13): the shell around an opened chain's band.
          The chain's steps partition its belly end to end, so this outline is
          where the lane's own identity lives — thick-dotted like a bone, one
          band further out — and it is the collapse target the spine can no
          longer be. Visual shape out here (inert, like the plates); its hit
          path rides in the anchor below so the whole shell collapses. */}
      {lane.frame === null ? null : (
        <path className="mj-converge-frame" d={lane.frame.d}>
          <title>{title}</title>
        </path>
      )}

      {/* The **bracket** (W13): wraps this lane's nested refinements. Inert —
          the variants carry their own names and clicks — so it is a claim
          drawn, not a control: adjacency says what the `⊂` suffix used to. */}
      {lane.variantBracket === null ? null : (
        <path className="mj-converge-variant-bracket" d={lane.variantBracket}>
          <title>{copy.variantsNested}</title>
        </path>
      )}

      {/* Target one: the line. Opens or shuts it, here. The exoskeleton's hit
          shell shares the anchor: on an opened chain the spine is covered by
          its own steps, and the shell is the part of the lane a reader can
          still reach. */}
      {lane.openHref === null ? null : (
        <a
          href={lane.openHref}
          aria-label={`${spokenName(lane)} — ${lane.open ? copy.closeHere : copy.openHere}`}
        >
          <title>{`${title} — ${lane.open ? copy.closeHere : copy.openHere}`}</title>
          <path className="mj-converge-strand-hit" d={lane.d} />
          {lane.frame === null ? null : (
            <path className="mj-converge-frame-hit" d={lane.frame.d} />
          )}
        </a>
      )}

      {/* **A line with nothing inside still answers for itself.**

          Two lanes reach this: the stretch a method performs itself — the
          owner's *"blank processes should be separately clickable than the
          parent process"* — and, since session 118, any **leaf**: a step with
          nothing recorded under it, so `openable` is false and `openHref` is
          null.

          The leaf half is his session-118 report, about
          `truncated-taylor-propagator` drawn as the first step of the
          all-at-once encoding: *"i can't click on it specifically but it only
          clicks on the full thing."* He is describing paint order. A chain's
          steps are drawn **on** their parent's spine, so a step that emits no
          anchor of its own leaves the enclosing lane's 24px toggle as the
          topmost thing there — measured, 39 of 41 sampled points on that line
          toggled the encoding above it. A leaf now paints its own hit stroke
          after its parent's, so the click lands on the step the reader aimed at.

          On the line rather than on a name, because the own stretch has no name
          to put one on and a leaf's name is a few hundred square pixels beside a
          line hundreds of pixels long. That does not break R12.2's rule that a
          line expands rather than navigates: this href opens a card **in
          place**, so clicking a line still means "something opens here", which
          is the rule the reader has already learned from every other line.

          Mutually exclusive with the control above by construction, not by
          coincidence — the guard is `openHref === null`, which is the exact
          negation of the condition that draws it. Asserted, because "by
          construction" is what the last two dead controls on this canvas were
          also called. */}
      {lane.openHref === null && lane.cardHref !== null ? (
        <a
          href={lane.cardHref}
          aria-label={
            lane.own !== null
              ? `${lane.fullLabel} — ${ownStepName(copy.lang)}`
              : `${spokenName(lane)} — ${copy.lineReadHere}`
          }
        >
          <title>
            {lane.own !== null
              ? `${ownStepName(copy.lang)} — ${copy.readHere}`
              : `${title} — ${copy.lineReadHere}`}
          </title>
          <path className="mj-converge-strand-hit" d={lane.d} />
        </a>
      ) : null}

      {/* Target two — the name — is **not here**. It is drawn by `LaneName` in a
          later pass over the same lanes, with `NamePlate` in the pass before
          that, and the reason is paint order: SVG paints in document order, so a
          plate can only rub out lines emitted *before* it, and a lane's own
          branches are emitted *after* it. A plate that sits in this group is
          therefore under exactly the lines it was built to hide. Measured on
          this graph, fully opened: of the 45 names a line runs through, 12 are
          crossed by a line drawn later, and those 12 were unfixable while the
          plate lived here. */}
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
 * Z-order is load-bearing, and it is now five passes rather than three: strands,
 * the stubs hanging off them, every name's plate, every name, then the circles —
 * a circle is the thing several strands share, so it has to sit on top of all of
 * them or the shared circle reads as lines passing behind a dot. Within the
 * strands, deeper ones are emitted after shallower ones, which the layout
 * already guarantees by emitting a parent before its children. See the passes
 * themselves for why the names had to come out of their lanes' groups.
 */
export function ConvergeCanvas({
  diagram,
  locale,
  title,
  subjectId = null,
  atlas = EMPTY_ATLAS,
  claimed,
  selection = null,
}: {
  diagram: ConvergeDiagram;
  locale: PublicLocale;
  title: string;
  /**
   * The one element `?sel=` resolved to on THIS figure, or null (W16).
   *
   * Already resolved by the caller (`resolveSelection`) so this stays a
   * renderer of typed data: at most one of the three keys is non-null, and a
   * figure that is not the selected one receives null outright. The class it
   * paints is what the client's camera fly-to finds and measures.
   */
  selection?: { laneAddress: string | null; stateKey: string | null; feedKey: string | null } | null;
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
        <Lane
          key={lane.key}
          lane={lane}
          copy={copy}
          atlas={atlas}
          selected={selection?.laneAddress === lane.address}
        />
      ))}
      {diagram.feeds.map((feed) => (
        <Feed key={feed.key} feed={feed} copy={copy} selected={selection?.feedKey === feed.key} />
      ))}
      {/* Every plate, then every name, and both after every line. Three passes
          over one list rather than one pass emitting three things, because on
          this canvas paint order *is* the occlusion rule and there is no other
          lever: a plate hides what was drawn before it and nothing else.
          - Plates after lines, or a lane's own branches — emitted after it —
            paint straight back over the name it is hiding them from.
          - Names after every plate, so a plate can never rub out a *name*. With
            the two interleaved, a plate covers any earlier name it overlaps,
            which measured as 4 pairs today and is exactly the case ingredient
            fans multiply. Text over text is hard to read; text erased by a
            neighbour's box is not there at all, and the reader cannot tell it
            was ever drawn.
          - Circles last, unchanged: a circle is the thing several lines share,
            so it sits on top of all of them. */}
      {diagram.lanes.map((lane) => (
        <NamePlate key={lane.key} lane={lane} />
      ))}
      {diagram.lanes.map((lane) => (
        <LaneName
          key={lane.key}
          lane={lane}
          copy={copy}
          atlas={atlas}
          title={laneTitle(lane, copy, atlas)}
          selected={selection?.laneAddress === lane.address}
        />
      ))}
      {diagram.states.map((state) => (
        <Hub key={state.key} state={state} copy={copy} selected={selection?.stateKey === state.key} />
      ))}
    </svg>
  );
}
