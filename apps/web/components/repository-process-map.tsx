// The process map: the layer graph drawn as states and the processes between
// them, on the server, as links.
//
// Same constraint as the strand canvas and for the same reason (D88.2, D90.3):
// every shape here is an `<a href>` in the HTML that leaves the origin. No
// `"use client"`, no measurement API, no layout in the browser. The geometry
// arrives from `process-layout.ts` already solved, so a crawler sees every
// destination, a reader with JavaScript off gets the same page, and the whole
// thing is checkable with `curl`.
//
// ## What the shapes mean
//
// - A **circle** is a state — an object you can be holding. Clicking it opens
//   its page, which says what it is and what leads into and out of it. Two
//   circles with the same name on different lanes are the same object; that is
//   what the faint vertical tie between them says.
// - A **thick line** is a slot: something to achieve, with recorded ways to do
//   it. Clicking it opens the slot in place, and its alternatives fan out
//   between the same two circles.
// - A **thin line** is a method — one particular way. Clicking it opens the
//   write-up rather than expanding anything, because there is nothing under it
//   to expand.
// - A **longer line** is a route that skips a layer. It is not dotted and it is
//   not annotated: it skips by reaching further, which is the whole reason this
//   drawing replaced the arcs the strand canvas used.
// - A **dashed line** is a slot nothing recorded fills. A **double line** is a
//   slot that has ways through it you have not opened. Those are different
//   claims and never share a shape (D90.6).
// - A **stub hanging below a lane** is an ingredient that route needs — a
//   prepared state, a polynomial — which does not move the route along and so is
//   not a stage.
import type {
  FeedStub,
  KinshipTie,
  LaneLabel,
  ProcessBox,
  ProcessDiagram,
  ProcessGroup,
  StateBox,
} from "../lib/repository/process-layout";

/**
 * Named rather than inferred from the English block, for the reason the strand
 * canvas gives: `as const` on a two-locale record narrows every string to its
 * own literal type, and the Japanese half then stops being assignable to the
 * English half.
 */
interface MapCopy {
  ways: (n: number) => string;
  noWay: string;
  opened: (n: number) => string;
  needs: string;
  atomic: string;
  undecomposed: string;
  sameThing: string;
  kindOf: string;
  start: string;
  end: string;
  /**
   * The three destinations, said out loud on every shape that has one.
   *
   * A line and the name above it now go to different places, and nothing about
   * their appearance says so. On a canvas where the only text is the process
   * names, the `<title>` is the whole affordance — so it names the action, not
   * just the thing.
   */
  openHere: string;
  closeHere: string;
  readAbout: string;
}

const COPY: Record<"en" | "ja", MapCopy> = {
  en: {
    ways: (n: number) => `${n} way${n === 1 ? "" : "s"} through`,
    noWay: "no way through recorded",
    opened: (n: number) => `${n} way${n === 1 ? "" : "s"}, open`,
    needs: "needs",
    atomic: "primitive",
    undecomposed: "not taken apart yet",
    sameThing: "the same object on both routes",
    kindOf: "a narrower kind of the object above",
    start: "you start here",
    end: "you finish here",
    openHere: "click the line to open it here",
    closeHere: "click the line to close it",
    readAbout: "click the name to read about it",
  },
  ja: {
    ways: (n: number) => `通り道 ${n} 件`,
    noWay: "記録された通り道なし",
    opened: (n: number) => `通り道 ${n} 件・展開中`,
    needs: "必要なもの",
    atomic: "基本要素",
    undecomposed: "未分解",
    sameThing: "どちらの経路でも同じ対象",
    kindOf: "上の対象の、より狭い種類",
    start: "ここから始まります",
    end: "ここで終わります",
    openHere: "線をクリックするとこの場で展開します",
    closeHere: "線をクリックすると畳みます",
    readAbout: "名前をクリックすると解説を開きます",
  },
};

/** Round to a tenth: full floats make the HTML noticeably bigger for no gain. */
function n(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/**
 * An opened slot: the same line it always was, gone faint, with its ways drawn
 * around it.
 *
 * It used to be a filled region — a `<rect>` a shade off the page, behind
 * everything it contained. The owner's session-92 verdict was direct: *"I don't
 * like how clicking into processes opens up the expanded version that sits on a
 * different colored square in the back — get rid of that square and keep it on
 * the page itself."* And they said what replaces it: *"the straight original
 * process line turns into a faint line, and there are muscle strand-shapes lines
 * around it that are the new methods/subprocesses."*
 *
 * That reads as styling and is not. The rect existed because session 92 drew the
 * opened slot as a line **and** its lanes, and the line ran straight through
 * them; a region was the way to stop claiming the parent was a hop you could
 * take. It works now because the lanes converge on the slot's own two endpoints
 * instead of being stacked independently inside it — the faint line and the
 * strands share their ends, so the faint line is not crossing anything, it is
 * the thing the strands are alternatives to.
 *
 * The name still opens the slot's own page; only the region is gone.
 */
function Group({ group, copy }: { group: ProcessGroup; copy: MapCopy }): React.ReactElement {
  const label = `${group.fullLabel} — ${copy.opened(group.methodCount)}`;
  const spineY = (group.top + group.bottom) / 2;
  return (
    <g className="mj-process-group" data-depth={group.depth}>
      <line
        className="mj-process-spine"
        x1={n(group.x0)}
        y1={n(spineY)}
        x2={n(group.x1)}
        y2={n(spineY)}
      />
      {group.closeHref === null ? null : (
        <a href={group.closeHref} aria-label={`${group.fullLabel} — ${copy.closeHere}`}>
          <title>{`${label} — ${copy.closeHere}`}</title>
          <line
            className="mj-process-hit-line"
            x1={n(group.x0)}
            y1={n(spineY)}
            x2={n(group.x1)}
            y2={n(spineY)}
          />
        </a>
      )}
      <a href={group.href} aria-label={`${group.fullLabel} — ${copy.readAbout}`}>
        <title>{group.summary ? `${label} — ${group.summary}` : label}</title>
        {/* Inside the box, not five pixels above it. The name used to hang over
            the top edge into whatever was there, which was the canvas margin
            while only one slot could be open and an ancestor's lane name as
            soon as two could. */}
        <rect
          className="mj-process-hit"
          x={n(group.x0)}
          y={n(group.top)}
          width={n(Math.max(0, group.x1 - group.x0))}
          height="17"
        />
        <text className="mj-process-group-name" x={n(group.x0 + 4)} y={n(group.top + 13)}>
          {group.label}
        </text>
      </a>
    </g>
  );
}

/**
 * A process: the line between two states.
 *
 * The `<a>` wraps a **fat transparent stroke** of the same line rather than a
 * filled shape. Carried over from the strand canvas, where it was load-bearing:
 * a filled region would cover its own interior and eat the clicks meant for
 * whatever is drawn inside it.
 */
function Process({ process, copy }: { process: ProcessBox; copy: MapCopy }): React.ReactElement {
  const note =
    process.state === "unfilled"
      ? copy.noWay
      : process.state === "collapsed"
        ? copy.ways(process.methodCount)
        : process.outlook === "atomic"
          ? copy.atomic
          : process.outlook === "undecomposed"
            ? copy.undecomposed
            : null;
  const title = [process.fullLabel, note ? ` (${note})` : "", process.summary ? ` — ${process.summary}` : ""].join(
    "",
  );
  const midX = (process.x0 + process.x1) / 2;
  return (
    <g
      className={`mj-process mj-process--${process.weight} mj-process--${process.state}`}
      data-depth={process.depth}
    >
      <line
        className="mj-process-line"
        x1={n(process.x0)}
        y1={n(process.y)}
        x2={n(process.x1)}
        y2={n(process.y)}
      />
      {/* A slot with ways through it you have not opened gets a second line, not
          a fainter one. "Fainter" is not a difference a reader can name. */}
      {process.state === "collapsed" ? (
        <line
          className="mj-process-line-inner"
          x1={n(process.x0 + 3)}
          y1={n(process.y + 3.5)}
          x2={n(process.x1 - 3)}
          y2={n(process.y + 3.5)}
        />
      ) : null}
      {/* Two targets, two destinations — the owner's session-92 brief.
          *"They can click on labels to see a specific expanded process and
          description, while they can click on the line itself to expand with
          everything else still in view."* So the line opens it **here**, in
          place, and the name goes **there**, to the process's own page. One
          shape, one thing it does, and the `<title>` on each says which. */}
      {process.href === null ? null : (
        <a href={process.href} aria-label={`${process.fullLabel} — ${copy.openHere}`}>
          <title>{`${title} — ${copy.openHere}`}</title>
          <line
            className="mj-process-hit-line"
            x1={n(process.x0)}
            y1={n(process.y)}
            x2={n(process.x1)}
            y2={n(process.y)}
          />
        </a>
      )}
      <a href={process.pageHref} aria-label={`${process.fullLabel} — ${copy.readAbout}`}>
        <title>{`${title} — ${copy.readAbout}`}</title>
        <rect
          className="mj-process-hit"
          x={n(process.x0)}
          y={n(process.y - 15)}
          width={n(Math.max(0, process.x1 - process.x0))}
          height="14"
        />
        <text className="mj-process-name" x={n(midX)} y={n(process.y - 7)} textAnchor="middle">
          {process.label}
        </text>
      </a>
    </g>
  );
}

/**
 * A state: a circle, and its name only on hover.
 *
 * The name is in `<title>`, not in a `<text>`, on the owner's session-92 brief —
 * *"states do not have written labels, only tool-tipped labels if hovered on"* —
 * and it is the change that makes the rest of this surface possible. A state's
 * written name was the widest thing on the canvas: `stateWidth` reserved up to
 * 200px per column for it, and session 92 abandoned inline expansion precisely
 * because *"the parent's own circles sat on a line running through the middle of
 * the nested block and their centred, wide names spilled sideways into it"*.
 * Take the names off the canvas and that collision has nothing to collide with.
 *
 * `<title>` rather than a hover script for the usual reason (D88.2): a tooltip
 * that needs hydration is not a tooltip for a crawler, a reader with JS off, or
 * `curl`. The cost is real and is paid on purpose — there is no hover on a touch
 * screen, so on a phone the name is one tap away on the state's own page rather
 * than one hover away here. The circle is a link either way.
 */
function State({ state, copy }: { state: StateBox; copy: MapCopy }): React.ReactElement {
  const note = state.terminal === "entry" ? copy.start : state.terminal === "exit" ? copy.end : null;
  const title = [state.fullLabel, note ? ` (${note})` : "", state.summary ? ` — ${state.summary}` : ""].join(
    "",
  );
  return (
    <g className={`mj-process-state${state.terminal ? " mj-process-state--terminal" : ""}`}>
      <a href={state.href} aria-label={state.fullLabel}>
        <title>{title}</title>
        <circle className="mj-process-dot" cx={n(state.cx)} cy={n(state.cy)} r={n(state.r)} />
        {/* An invisible disc wider than the dot: a 9px circle is under the 24px
            minimum for a touch target, and the name now lives behind the hover. */}
        <circle
          className="mj-process-hit-dot"
          cx={n(state.cx)}
          cy={n(state.cy)}
          r={n(Math.max(state.r + 6, 13))}
        />
      </a>
    </g>
  );
}

/**
 * The vertical tie between two neighbouring lanes holding the same object.
 *
 * `same` and `kind` are drawn differently on purpose — one says two routes meet
 * here, the other says one route's object is a narrower version of the other's,
 * and those are not the same claim about the literature.
 */
function Tie({ tie, copy }: { tie: KinshipTie; copy: MapCopy }): React.ReactElement {
  return (
    <g className={`mj-process-tie mj-process-tie--${tie.relation}`}>
      <title>{tie.relation === "same" ? copy.sameThing : copy.kindOf}</title>
      <line x1={n(tie.x)} y1={n(tie.y0)} x2={n(tie.x)} y2={n(tie.y1)} />
    </g>
  );
}

/**
 * One alternative's name, above the row it occupies.
 *
 * The `coverage` value rides along as a data attribute rather than as a second
 * mark on the canvas: it is a real distinction — whether this route is built
 * from named slots or is one undivided act — but it is not one a reader needs
 * before they have decided which row to look at.
 */
function Lane({ lane, copy }: { lane: LaneLabel; copy: MapCopy }): React.ReactElement {
  const note =
    lane.outlook === "atomic" ? copy.atomic : lane.outlook === "undecomposed" ? copy.undecomposed : null;
  return (
    <g className="mj-process-lane" data-coverage={lane.coverage}>
      <a href={lane.href}>
        <title>
          {`${lane.fullLabel}${note ? ` (${note})` : ""}${lane.summary ? ` — ${lane.summary}` : ""}`}
        </title>
        <text className="mj-process-lane-name" x={n(lane.x)} y={n(lane.y)}>
          {lane.label}
        </text>
      </a>
    </g>
  );
}

/** An ingredient a route needs, hanging under the lane that consumes it. */
function Feed({ feed, copy }: { feed: FeedStub; copy: MapCopy }): React.ReactElement {
  return (
    <g className="mj-process-feed">
      <a href={feed.href}>
        <title>{`${copy.needs}: ${feed.fullLabel}${feed.summary ? ` — ${feed.summary}` : ""}`}</title>
        <line x1={n(feed.x + 6)} y1={n(feed.y0)} x2={n(feed.x + 6)} y2={n(feed.y1)} />
        <text className="mj-process-feed-name" x={n(feed.x + 11)} y={n(feed.y1 + 2)}>
          {feed.label}
        </text>
      </a>
    </g>
  );
}

/**
 * The canvas.
 *
 * Deliberately **not** `role="img"`: that collapses every destination on it into
 * one alt string, and the whole point is that each shape is its own link. Same
 * call as the strand canvas, D90.2.
 *
 * Z-order is load-bearing. Groups are the backdrop; ties sit under the lines
 * they relate; lines next; circles last, so a circle wins the pointer over the
 * two lines that end on it.
 */
export function ProcessCanvas({
  diagram,
  locale,
  title,
}: {
  diagram: ProcessDiagram;
  locale: "en" | "ja";
  title: string;
}): React.ReactElement {
  const copy = COPY[locale];
  return (
    <div className="mj-process-scroll">
      <svg
        className="mj-process-canvas"
        viewBox={`0 0 ${n(diagram.width)} ${n(diagram.height)}`}
        width={n(diagram.width)}
        height={n(diagram.height)}
        style={
          {
            "--process-w": `${diagram.width}px`,
            "--process-min": `${diagram.width * 0.88}px`,
          } as React.CSSProperties
        }
      >
        <title>{title}</title>
        {diagram.groups.map((group) => (
          <Group key={group.key} group={group} copy={copy} />
        ))}
        {diagram.ties.map((tie, index) => (
          <Tie key={`tie-${index}-${n(tie.x)}-${n(tie.y0)}`} tie={tie} copy={copy} />
        ))}
        {diagram.lanes.map((lane) => (
          <Lane key={lane.key} lane={lane} copy={copy} />
        ))}
        {diagram.processes.map((process) => (
          <Process key={process.key} process={process} copy={copy} />
        ))}
        {diagram.feeds.map((feed) => (
          <Feed key={feed.key} feed={feed} copy={copy} />
        ))}
        {diagram.states.map((state) => (
          <State key={state.key} state={state} copy={copy} />
        ))}
      </svg>
    </div>
  );
}
