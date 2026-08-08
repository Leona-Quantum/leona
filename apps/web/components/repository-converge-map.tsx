// The convergence canvas: one circle per state, and the ways across bowing
// between them.
//
// Same constraints as the process canvas beside it (D88.2, D90.3): every shape
// is an `<a href>` in HTML that arrives from the origin, there is no
// `"use client"`, no measurement API, and the geometry is solved in
// `converge-layout.ts` before this file sees it. A crawler gets every
// destination, a reader with JavaScript off gets the same page, and the whole
// thing is checkable with `curl`.
//
// ## What the shapes mean here, and how it differs from the process canvas
//
// - A **circle** is a state, drawn **once**. The process canvas draws one circle
//   per route per state — `?focus=nonlinear-ode-solve` drew `nonlinear-ivp` four
//   times — and joins the copies with a dotted tie. Here the copies are one
//   circle, and the lanes reaching it reach *it*. That is the whole surface.
// - A **bowed line** is a way across. Every lane of a fan starts and ends on the
//   same two circles and differs only in how far it bows, which is why they
//   cannot cross: see the proof in `converge-layout.ts`'s header.
// - The **straight lane through the middle** of an odd fan is not special-cased
//   — it is the lane whose bow is zero.
// - A lane drawn **dashed** is one no recorded source walks. It is a real
//   composition of two authored contracts and it says out loud that nobody has
//   published it, which is the D96.3 distinction: derived is not invented, and
//   neither is it a paper.
import type { ConvergeDiagram, ConvergeLane, ConvergeState } from "../lib/repository/converge-layout";
import type { PublicLocale } from "../lib/public-locale";

interface ConvergeCopy {
  start: string;
  end: string;
  meets: (arriving: number, leaving: number) => string;
  ways: (n: number) => string;
  unpublished: string;
  unpinned: string;
  readAbout: string;
}

const COPY: Record<"en" | "ja", ConvergeCopy> = {
  en: {
    start: "you start here",
    end: "you finish here",
    meets: (arriving: number, leaving: number) =>
      `${arriving} way${arriving === 1 ? "" : "s"} arrive here, ${leaving} lead on`,
    ways: (n: number) => `${n} way${n === 1 ? "" : "s"} through`,
    unpublished: "no recorded source takes this path",
    unpinned: "recorded, but no source names which method",
    readAbout: "read the write-up",
  },
  ja: {
    start: "ここから始まります",
    end: "ここで終わります",
    meets: (arriving: number, leaving: number) =>
      `${arriving} 本がここに到達し、${leaving} 本がここから続きます`,
    ways: (n: number) => `通り道 ${n} 件`,
    unpublished: "この経路をたどる記録された出典はありません",
    unpinned: "記録はありますが、どの手法かを述べた出典はありません",
    readAbout: "解説を読む",
  },
};

/** Trim a float for the DOM. Same helper and same reason as the process canvas. */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

function Hub({ state, copy }: { state: ConvergeState; copy: ConvergeCopy }): React.ReactElement {
  const note = state.terminal
    ? state.arriving === 0
      ? copy.start
      : copy.end
    : copy.meets(state.arriving, state.leaving);
  return (
    <g
      className={`mj-converge-hub${state.terminal ? " mj-converge-hub--terminal" : ""}${
        state.arriving > 1 || state.leaving > 1 ? " mj-converge-hub--shared" : ""
      }`}
    >
      <a href={state.href} aria-label={state.label}>
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

function Lane({ lane, copy }: { lane: ConvergeLane; copy: ConvergeCopy }): React.ReactElement {
  const standingNote =
    lane.standing === "unpublished"
      ? ` — ${copy.unpublished}`
      : lane.standing === "unpinned"
        ? ` — ${copy.unpinned}`
        : "";
  const waysNote = lane.ways > 0 ? ` · ${copy.ways(lane.ways)}` : "";
  return (
    <g className={`mj-converge-lane mj-converge-lane--${lane.standing}`}>
      <a href={lane.href} aria-label={`${lane.fullLabel} — ${copy.readAbout}`}>
        <title>{`${lane.fullLabel}${waysNote}${standingNote}`}</title>
        <path className="mj-converge-strand" d={lane.d} />
        {/* A fat transparent stroke of the same curve, so the hit target is the
            shape a reader aims at rather than a 2px line. The process canvas
            does the same with `mj-process-hit-line`. */}
        <path className="mj-converge-strand-hit" d={lane.d} />
        <text
          className="mj-converge-lane-name"
          x={n(lane.labelX)}
          y={n(lane.labelY)}
          textAnchor="middle"
        >
          {lane.label}
        </text>
      </a>
    </g>
  );
}

/**
 * The canvas.
 *
 * **No view-transition name yet, deliberately.** The process canvas pairs its
 * figure with the one on the page a reader lands on, so moving between them
 * reads as a zoom; this surface does not, because the recentre gesture that
 * would pair with it is not built (NEXT.md §b). An earlier draft of this comment
 * described a `subjectId` prop that the component never accepted and nothing
 * ever passed — a doc comment for a feature that did not exist, which is worse
 * than no comment because it reads as wiring somebody already did.
 */
export function ConvergeCanvas({
  diagram,
  locale,
  title,
  scale = null,
}: {
  diagram: ConvergeDiagram;
  locale: PublicLocale;
  title: string;
  /** null means "fit the box". A number is the reader's chosen size. */
  scale?: number | null;
}): React.ReactElement | null {
  if (diagram.empty) return null;
  const copy = COPY[locale === "ja" ? "ja" : "en"];
  const drawn = diagram.width * (scale ?? 1);
  return (
    <div className="mj-converge-scroll">
      <svg
        className="mj-converge-canvas"
        viewBox={`0 0 ${n(diagram.width)} ${n(diagram.height)}`}
        width={n(drawn)}
        height={n(diagram.height * (scale ?? 1))}
        style={
          {
            "--converge-w": `${drawn}px`,
            "--converge-min": `${scale === null ? diagram.width * 0.88 : drawn}px`,
          } as React.CSSProperties
        }
      >
        <title>{title}</title>
        {/* Lanes first, hubs last: a hub is the thing two lanes share, so it has
            to sit on top of both of them or the shared circle reads as two lines
            passing behind a dot. */}
        {diagram.lanes.map((lane) => (
          <Lane key={lane.key} lane={lane} copy={copy} />
        ))}
        {diagram.states.map((state) => (
          <Hub key={state.key} state={state} copy={copy} />
        ))}
      </svg>
    </div>
  );
}
