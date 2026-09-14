"use client";

/**
 * The Atlas circuit figure: a record's drawing, large, with a playhead.
 *
 * UX pass 6. Readers told the owner the Atlas was mostly text and *"the circuit
 * example should stand out more"*, and he asked for something new. So the
 * drawing a record already carries (`visualization.wires` and `.operations`)
 * moves out of a tab nobody opened and becomes the first thing on the page:
 *
 * - hover or click a step and its wires light up, with a caption naming the
 *   step, its position and the wires it acts on — all three read off the
 *   record, and nothing more, because a label like "Oracle" has no standard
 *   meaning this component could supply;
 * - play steps through the record's operations in order, and a scrubber does
 *   the same from the keyboard;
 * - the whole drawing and every step caption are in the server HTML, so the
 *   figure reads without JavaScript and only the stepping needs it.
 *
 * Geometry lives in `lib/repository/atlas-circuit-layout.ts`, where the one
 * rule that could quietly invent something — never pack two operations into a
 * shared moment — is tested.
 *
 * Motion: the playhead glides between steps unless the reader prefers reduced
 * motion, when it jumps (CSS), and the stage scrolls without smoothing (here).
 * Nothing moves until the reader presses play.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PublicLocale } from "../lib/public-locale";
import {
  layoutAtlasCircuit,
  type AtlasCircuitSource,
  type AtlasCircuitStep,
} from "../lib/repository/atlas-circuit-layout";

const COPY = {
  en: {
    figure: (title: string) => `${title}: circuit or workflow diagram`,
    overview: (steps: number, wires: number) =>
      `${steps} ${steps === 1 ? "step" : "steps"} across ${wires} ${wires === 1 ? "wire" : "wires"}. Hover a step, or press play to go through them in order.`,
    step: (n: number, total: number) => `Step ${n} of ${total}`,
    on: "on",
    previous: "Previous step",
    next: "Next step",
    play: "Play",
    pause: "Pause",
    replay: "Play again",
    scrub: "Step through the diagram",
    whole: "Whole diagram",
    skipped: (n: number) =>
      `${n} ${n === 1 ? "operation names a wire" : "operations name wires"} this drawing does not have, so ${n === 1 ? "it is" : "they are"} not shown.`,
    unnamed: (n: number) =>
      `${n} ${n === 1 ? "operation has" : "operations have"} no name in the record, so ${n === 1 ? "it is" : "they are"} not shown.`,
  },
  ja: {
    figure: (title: string) => `${title}の回路またはワークフロー図`,
    overview: (steps: number, wires: number) =>
      `${wires} 本のワイヤーにまたがる ${steps} ステップです。ステップにカーソルを合わせるか、再生で順番に見られます。`,
    step: (n: number, total: number) => `ステップ ${n} / ${total}`,
    on: "対象：",
    previous: "前のステップ",
    next: "次のステップ",
    play: "再生",
    pause: "一時停止",
    replay: "もう一度再生",
    scrub: "図をステップごとに見る",
    whole: "図の全体",
    skipped: (n: number) => `${n} 件の操作は、この図にないワイヤーを指しているため表示していません。`,
    unnamed: (n: number) => `${n} 件の操作は、項目に名前が記されていないため表示していません。`,
  },
} as const;

const STEP_MS = 1100;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function stepCaption(
  step: AtlasCircuitStep,
  position: number,
  total: number,
  wires: readonly string[],
  locale: PublicLocale,
): string {
  const copy = COPY[locale];
  const names = step.wires.map((wire) => wires[wire]).join(locale === "ja" ? "、" : ", ");
  return `${copy.step(position + 1, total)} · ${step.label} · ${copy.on} ${names}`;
}

export function AtlasCircuitFigure({
  source,
  title,
  locale,
  caption,
  aside,
}: {
  source: AtlasCircuitSource;
  title: string;
  locale: PublicLocale;
  /** Where the drawing comes from — the record it belongs to. */
  caption?: ReactNode;
  /** Drawn beside the stage on a wide screen and under it on a narrow one. */
  aside?: ReactNode;
}): React.ReactElement | null {
  const copy = COPY[locale];
  const layout = useMemo(() => layoutAtlasCircuit(source, "hero"), [source]);
  const total = layout.steps.length;
  const [pinned, setPinned] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(false);

  const shown = hover ?? pinned;
  const current = shown === null ? null : layout.steps[shown];
  const lit = new Set(current?.wires ?? []);

  // Play is a chain of timeouts rather than an interval, so the last step can
  // stop the chain without a state update from inside another one.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(
      () => {
        if (pinned === null || pinned < total - 1) {
          followRef.current = true;
          setPinned(pinned === null ? 0 : pinned + 1);
        } else {
          setPlaying(false);
        }
      },
      pinned === null ? 0 : STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [playing, pinned, total]);

  // Keep the pinned step in view on a drawing wider than its stage. Only for a
  // step the controls chose: a hovered step is already under the pointer.
  useEffect(() => {
    const stage = stageRef.current;
    if (!followRef.current || pinned === null || !stage) return;
    followRef.current = false;
    const step = layout.steps[pinned];
    const left = stage.scrollLeft;
    if (step.box.x < left + 24 || step.box.x + step.box.width > left + stage.clientWidth - 24) {
      stage.scrollTo({
        left: Math.max(0, step.center - stage.clientWidth / 2),
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }, [pinned, layout]);

  if (total === 0) return null;

  function go(next: number | null) {
    setPlaying(false);
    followRef.current = true;
    setPinned(next);
  }

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    setHover(null);
    if (pinned !== null && pinned >= total - 1) setPinned(null);
    setPlaying(true);
  }

  const atEnd = !playing && pinned !== null && pinned >= total - 1;
  const live = current ? stepCaption(current, shown!, total, source.wires, locale) : copy.overview(total, source.wires.length);

  return (
    <figure className="mj-atlas-figure" data-playing={playing || undefined}>
      <div className="mj-atlas-figure-main">
        <div
          className="mj-atlas-stage"
          ref={stageRef}
          // A wide drawing scrolls sideways, so the region takes focus for the
          // scroll to be reachable from a keyboard (axe: scrollable-region-focusable).
          tabIndex={0}
          role="region"
          aria-label={copy.figure(title)}
        >
          <svg
            className="mj-atlas-svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width={layout.width}
            height={layout.height}
            role="img"
            aria-label={`${copy.figure(title)}. ${copy.overview(total, source.wires.length)}`}
            onMouseLeave={() => setHover(null)}
          >
            {source.wires.map((wire, index) => (
              <g key={`${wire}-${index}`} className="mj-atlas-wire" data-lit={lit.has(index) || undefined}>
                <line x1={layout.labelWidth - 8} x2={layout.width - 10} y1={layout.wireY[index]} y2={layout.wireY[index]} />
                <text x={layout.labelWidth - 16} y={layout.wireY[index]} textAnchor="end" dominantBaseline="central">
                  {wire}
                </text>
              </g>
            ))}
            <g
              className="mj-atlas-playhead"
              data-hidden={current ? undefined : "true"}
              style={{ transform: `translateX(${current ? current.center : layout.labelWidth}px)` }}
            >
              <line x1={0} x2={0} y1={6} y2={layout.height - 6} />
            </g>
            {layout.steps.map((step, position) => {
              const state = shown === null ? undefined : position === shown ? "on" : position < shown ? "past" : "ahead";
              // One box per step, from its first wire to its last, named. A
              // wire in between that the step does not act on is drawn across
              // the box, dimmed — the circuit-diagram convention for a gate on
              // non-adjacent wires — so no box is ever drawn without a name.
              return (
                <g
                  key={step.index}
                  className="mj-atlas-op"
                  data-tone={step.tone}
                  data-state={state}
                  data-wires={step.wires.join(" ")}
                  onMouseEnter={() => setHover(position)}
                  onClick={() => go(position)}
                >
                  <title>{stepCaption(step, position, total, source.wires, locale)}</title>
                  <rect x={step.box.x} y={step.box.y} width={step.box.width} height={step.box.height} rx={9} />
                  {step.passes.map((wire) => (
                    <line
                      key={wire}
                      className="mj-atlas-op-pass"
                      x1={step.box.x}
                      x2={step.box.x + step.box.width}
                      y1={layout.wireY[wire]}
                      y2={layout.wireY[wire]}
                    />
                  ))}
                  <text x={step.center} y={step.labelY} textAnchor="middle" dominantBaseline="central">
                    {step.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="mj-atlas-controls">
          <button type="button" className="mj-atlas-control" onClick={() => go(shown === null || shown === 0 ? null : shown - 1)} aria-label={copy.previous}>
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10 3 5 8l5 5" /></svg>
          </button>
          <button type="button" className="mj-atlas-control mj-atlas-control--play" onClick={togglePlay} aria-pressed={playing}>
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              {playing ? <path d="M5 3v10M11 3v10" /> : <path d="M5 3.5v9l7.5-4.5z" />}
            </svg>
            {playing ? copy.pause : atEnd ? copy.replay : copy.play}
          </button>
          <button
            type="button"
            className="mj-atlas-control"
            onClick={() => go(shown === null ? 0 : Math.min(total - 1, shown + 1))}
            aria-label={copy.next}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m6 3 5 5-5 5" /></svg>
          </button>
          <input
            className="mj-atlas-scrub"
            type="range"
            min={0}
            max={total}
            step={1}
            value={shown === null ? 0 : shown + 1}
            onChange={(event) => {
              const value = Number(event.target.value);
              go(value === 0 ? null : value - 1);
            }}
            aria-label={copy.scrub}
            aria-valuetext={current ? stepCaption(current, shown!, total, source.wires, locale) : copy.whole}
          />
        </div>
        <p className="mj-atlas-live" aria-live="polite">
          {live}
        </p>
        {caption || layout.skipped > 0 || layout.unnamed > 0 ? (
          <figcaption className="mj-atlas-figcaption">
            {caption}
            {layout.skipped > 0 ? <span className="mj-atlas-skipped"> {copy.skipped(layout.skipped)}</span> : null}
            {layout.unnamed > 0 ? <span className="mj-atlas-skipped"> {copy.unnamed(layout.unnamed)}</span> : null}
          </figcaption>
        ) : null}
      </div>
      {aside ? <div className="mj-atlas-figure-aside">{aside}</div> : null}
    </figure>
  );
}

/** A record's expected outcomes as bars — the values the record states, rounded to a percent. */
export function AtlasOutcomeBars({
  outcomes,
  label,
}: {
  outcomes: readonly { label: string; probability: number }[];
  label: string;
}): React.ReactElement | null {
  if (outcomes.length === 0) return null;
  return (
    <div className="mj-atlas-outcomes">
      <p className="mj-atlas-outcomes-label">{label}</p>
      <ul>
        {outcomes.map((outcome, index) => {
          const share = Math.max(0, Math.min(1, outcome.probability));
          return (
            <li key={`${outcome.label}-${index}`}>
              <span className="mj-atlas-outcome-name">{outcome.label}</span>
              <strong>{Math.round(share * 100)}%</strong>
              <span className="mj-atlas-outcome-track" aria-hidden="true">
                <span style={{ width: `${share * 100}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The same drawing at card size: boxes on wires, no labels, no interaction.
 * Decorative — the card's title is the name — so it is hidden from assistive
 * technology. Past its column cap it ends in three dots rather than squeezing
 * eighty steps into a thumbnail.
 */
export function AtlasCircuitThumb({ source }: { source: AtlasCircuitSource }): React.ReactElement | null {
  const layout = layoutAtlasCircuit(source, "thumb");
  if (layout.steps.length === 0) return null;
  const lastBox = layout.steps[layout.steps.length - 1].box;
  const midY = layout.height / 2;
  return (
    <svg
      className="mj-atlas-thumb"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {layout.wireY.map((y, index) => (
        <line key={index} className="mj-atlas-thumb-wire" x1={2} x2={layout.width - 2} y1={y} y2={y} />
      ))}
      {layout.steps.map((step) => (
        // Same rule as the hero: one box per step, the skipped wire across it.
        <g key={step.index} className="mj-atlas-thumb-op" data-tone={step.tone}>
          <rect x={step.box.x} y={step.box.y} width={step.box.width} height={step.box.height} rx={2.5} />
          {step.passes.map((wire) => (
            <line
              key={wire}
              className="mj-atlas-thumb-pass"
              x1={step.box.x}
              x2={step.box.x + step.box.width}
              y1={layout.wireY[wire]}
              y2={layout.wireY[wire]}
            />
          ))}
        </g>
      ))}
      {layout.hidden > 0
        ? [0, 1, 2].map((dot) => (
            <circle key={dot} className="mj-atlas-thumb-more" cx={lastBox.x + lastBox.width + 6 + dot * 4} cy={midY} r={1.2} />
          ))
        : null}
    </svg>
  );
}
