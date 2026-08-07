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
  },
};

/** Round to a tenth: full floats make the HTML noticeably bigger for no gain. */
function n(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/**
 * An opened slot: a region with a name, drawn behind everything it contains.
 *
 * Deliberately not a line. `ProcessGroup` exists because the first draft drew
 * one, and it ran straight through every lane inside it.
 */
function Group({ group, copy }: { group: ProcessGroup; copy: MapCopy }): React.ReactElement {
  const label = `${group.fullLabel} — ${copy.opened(group.methodCount)}`;
  return (
    <g className="mj-process-group" data-depth={group.depth}>
      <rect
        className="mj-process-group-field"
        x={n(group.x0)}
        y={n(group.top)}
        width={n(Math.max(0, group.x1 - group.x0))}
        height={n(Math.max(0, group.bottom - group.top))}
        rx="10"
      />
      <a href={group.href}>
        <title>{group.summary ? `${label} — ${group.summary}` : label}</title>
        <rect
          className="mj-process-hit"
          x={n(group.x0)}
          y={n(group.top - 15)}
          width={n(Math.max(0, group.x1 - group.x0))}
          height="15"
        />
        <text className="mj-process-group-name" x={n(group.x0 + 4)} y={n(group.top - 5)}>
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
      <a href={process.href}>
        <title>{title}</title>
        <line
          className="mj-process-hit-line"
          x1={n(process.x0)}
          y1={n(process.y)}
          x2={n(process.x1)}
          y2={n(process.y)}
        />
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

/** A state: a circle with its name centred beneath it. */
function State({ state, copy }: { state: StateBox; copy: MapCopy }): React.ReactElement {
  const note = state.terminal === "entry" ? copy.start : state.terminal === "exit" ? copy.end : null;
  const title = [state.fullLabel, note ? ` (${note})` : "", state.summary ? ` — ${state.summary}` : ""].join(
    "",
  );
  return (
    <g className={`mj-process-state${state.terminal ? " mj-process-state--terminal" : ""}`}>
      <a href={state.href}>
        <title>{title}</title>
        <circle className="mj-process-dot" cx={n(state.cx)} cy={n(state.cy)} r={n(state.r)} />
        <text
          className="mj-process-state-name"
          x={n(state.cx)}
          y={n(state.cy + state.r + 13)}
          textAnchor="middle"
        >
          {state.label}
        </text>
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
