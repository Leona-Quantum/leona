"use client";

import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type UIEvent } from "react";
import { builderStepLabel, type BuilderStep, type CustomGateDefinition } from "../lib/studio-builder";
import { formatGateParam } from "../lib/gate-param-label";
import { circuitMoments } from "../lib/circuit-moments";
import { gateFamily } from "../lib/gate-inspector";
import {
  CIRCUIT_COLUMN_WIDTH,
  CIRCUIT_LEFT_PAD,
  CIRCUIT_ROW_HEIGHT,
  CIRCUIT_TOP_PAD,
  circuitDiagramWindow,
  type CircuitDiagramViewport,
} from "../lib/circuit-diagram-window";

/** The circuit SVG, shared by every surface that draws a circuit.
 *
 * This used to live inline in Studio's `CircuitBuilder`, which meant the
 * artifact-detail view — the one place a saved circuit is read rather than
 * edited — could only show code and metadata. Extracting it here is deliberately
 * a *move*, not a reimplementation: a second drawing routine would drift from
 * the first, and the two surfaces would disagree about what the same circuit
 * looks like.
 *
 * Interaction is optional and absence is the read-only signal. There is no
 * `readOnly` boolean, because a boolean lets a caller ask for read-only while
 * still passing handlers — the shape makes the invalid combination
 * unrepresentable instead. With `interaction` omitted, no gate slot, no
 * selection target, and no keyboard affordance is rendered at all; they are not
 * merely disabled.
 *
 * Columns are moments (lib/circuit-moments), not one column per operation, so
 * parallel gates line up the way they execute (UX pass 6). */

export interface CircuitDiagramInteraction {
  selectedStepIds: string[];
  pendingQubits: number[];
  /** Label for the currently armed gate, announced on each empty slot. */
  selectedLabel: string;
  onPlaceOnQubit: (qubit: number) => void;
  onSelectStep: (stepId: string, multi: boolean) => void;
  onStepKeyDown: (stepId: string, event: KeyboardEvent<SVGGElement>) => void;
}

/** What a hovered or focused gate reports, so a caller can explain it. */
export interface CircuitDiagramInspection {
  step: BuilderStep;
  index: number;
  /** Zero-based moment the gate is drawn in. */
  column: number;
  /** The gate's box in viewport coordinates, for placing a popover beside it. */
  rect: DOMRect;
}

/** Geometry is exported so a caller can size a scroll container to the diagram
 * it is about to draw without re-deriving these constants. */
export function circuitDiagramSize(qubitCount: number, columnCount: number): { width: number; height: number } {
  return {
    width: Math.max(560, CIRCUIT_LEFT_PAD + (columnCount + 2) * CIRCUIT_COLUMN_WIDTH + 40),
    height: CIRCUIT_TOP_PAD + qubitCount * CIRCUIT_ROW_HEIGHT + 10,
  };
}

export function CircuitDiagram({
  qubitCount,
  steps,
  customGates,
  ariaLabel,
  interaction,
  playhead = null,
  onInspect,
}: {
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
  ariaLabel: string;
  interaction?: CircuitDiagramInteraction;
  /** Moment boundary to draw a playhead at; gates at or past it are dimmed. */
  playhead?: number | null;
  onInspect?: (target: CircuitDiagramInspection | null) => void;
}) {
  const moments = useMemo(() => circuitMoments(qubitCount, steps), [qubitCount, steps]);
  const { width, height } = circuitDiagramSize(qubitCount, moments.count);
  const readOnly = !interaction;
  const stageRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<CircuitDiagramViewport>({ left: 0, top: 0, width: 1024, height: 640 });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const syncViewport = () => setViewport({
      left: stage.scrollLeft,
      top: stage.scrollTop,
      width: stage.clientWidth,
      height: stage.clientHeight,
    });
    syncViewport();
    const observer = new ResizeObserver(syncViewport);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const visible = useMemo(
    () => circuitDiagramWindow(qubitCount, moments.count, viewport),
    [qubitCount, moments.count, viewport],
  );
  const visibleQubits = useMemo(
    () => Array.from({ length: visible.qubitEnd - visible.qubitStart }, (_, index) => visible.qubitStart + index),
    [visible.qubitEnd, visible.qubitStart],
  );
  // The window is in columns now; a step is drawn when its moment is on screen.
  const visibleSteps = useMemo(() => {
    const drawn: Array<{ step: BuilderStep; index: number; column: number }> = [];
    for (let index = 0; index < steps.length; index += 1) {
      const column = moments.columns[index];
      if (column >= visible.stepStart && column < visible.stepEnd) drawn.push({ step: steps[index], index, column });
    }
    return drawn;
  }, [steps, moments.columns, visible.stepStart, visible.stepEnd]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const stage = event.currentTarget;
    setViewport({ left: stage.scrollLeft, top: stage.scrollTop, width: stage.clientWidth, height: stage.clientHeight });
    // A popover anchored to a gate that just scrolled away would point at nothing.
    onInspect?.(null);
  }

  const columnX = (column: number) => CIRCUIT_LEFT_PAD + column * CIRCUIT_COLUMN_WIDTH;
  const yFor = (q: number) => CIRCUIT_TOP_PAD + q * CIRCUIT_ROW_HEIGHT;
  const playheadMoment = typeof playhead === "number" ? playhead : null;
  const showPlayhead = playheadMoment !== null;
  const ticks = showPlayhead
    ? Array.from({ length: Math.max(0, Math.min(visible.stepEnd, moments.count) - visible.stepStart) }, (_, offset) => visible.stepStart + offset)
    : [];

  return (
    <div ref={stageRef} onScroll={handleScroll} className={`mj-circuit-stage${readOnly ? " mj-circuit-stage--readonly" : ""}`}>
      <svg
        className="mj-circuit-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        style={{ width, height, maxWidth: "none" }}
      >
        {ticks.map((column) => (
          <text key={`tick-${column}`} className="mj-circuit-tick" x={columnX(column)} y={10} aria-hidden="true">{column + 1}</text>
        ))}
        {visibleQubits.map((q) => {
          const y = yFor(q);
          const slotColumn = moments.frontier[q] ?? 0;
          const slotVisible = interaction && slotColumn >= visible.stepStart && slotColumn <= visible.stepEnd;
          return (
            <g key={q}>
              <text className="mj-circuit-label" x="18" y={y + 5}>q{q}</text>
              <line className="mj-circuit-wire" x1={CIRCUIT_LEFT_PAD - 16} y1={y} x2={width - 24} y2={y} />
              {slotVisible ? (
                <g
                  className={`mj-circuit-gate mj-builder-slot${interaction.pendingQubits.includes(q) ? " is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`q${q}: ${interaction.selectedLabel}`}
                  onClick={() => interaction.onPlaceOnQubit(q)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); interaction.onPlaceOnQubit(q); } }}
                >
                  <rect x={columnX(slotColumn) - 17} y={y - 17} width="34" height="34" rx="7" strokeDasharray="4 3" fill="transparent" />
                  <text x={columnX(slotColumn)} y={y + 5}>+</text>
                </g>
              ) : null}
            </g>
          );
        })}
        {visibleSteps.map(({ step, index, column }) => {
          const { min: minStepQubit, max: maxStepQubit } = step.qubits.reduce(
            (bounds, qubit) => ({ min: Math.min(bounds.min, qubit), max: Math.max(bounds.max, qubit) }),
            { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
          );
          if (maxStepQubit < visible.qubitStart || minStepQubit >= visible.qubitEnd) return null;
          const x = columnX(column);
          const selected = interaction ? interaction.selectedStepIds.includes(step.id) : false;
          const future = playheadMoment !== null && column >= playheadMoment;
          const label = builderStepLabel(step, customGates);
          const className = `mj-circuit-gate${selected ? " is-selected" : ""}${future ? " is-future" : ""}`;
          const selectProps = interaction
            ? {
                role: "button" as const,
                tabIndex: 0,
                "aria-label": `${label} on ${step.qubits.map((qubit) => `q${qubit}`).join(", ")}`,
                onClick: (event: MouseEvent<SVGGElement>) => interaction.onSelectStep(step.id, event.shiftKey),
                onKeyDown: (event: KeyboardEvent<SVGGElement>) => interaction.onStepKeyDown(step.id, event),
              }
            : ({} as Record<string, never>);
          const report = (element: SVGGElement) => onInspect?.({ step, index, column, rect: element.getBoundingClientRect() });
          const inspectProps = onInspect
            ? {
                onPointerEnter: (event: PointerEvent<SVGGElement>) => report(event.currentTarget),
                onPointerLeave: () => onInspect(null),
                onFocus: (event: FocusEvent<SVGGElement>) => report(event.currentTarget),
                onBlur: () => onInspect(null),
              }
            : {};
          const shared = { className, "data-family": gateFamily(step.gate), ...selectProps, ...inspectProps };
          // A native tooltip only where nothing richer explains the gate.
          const title = onInspect ? null : <title>{label}</title>;

          if (step.gate === "CUSTOM") {
            const custom = customGates.find((gate) => gate.id === step.customGateId);
            const minQubit = Math.min(...step.qubits);
            const maxQubit = Math.max(...step.qubits);
            return (
              <g key={step.id} {...shared} className={`${className} mj-circuit-custom-gate`}>
                {onInspect ? null : <title>{label}</title>}
                <line className="mj-circuit-control" x1={x} y1={yFor(minQubit)} x2={x} y2={yFor(maxQubit)} />
                {step.qubits.map((qubit, qubitIndex) => ({ qubit, qubitIndex }))
                  .filter(({ qubit }) => qubit >= visible.qubitStart && qubit < visible.qubitEnd)
                  .map(({ qubit, qubitIndex }) => (
                  <g key={`${step.id}-${qubit}`}>
                    <rect x={x - 17} y={yFor(qubit) - 17} width="34" height="34" rx="7" />
                    <text x={x} y={yFor(qubit) + 5}>{qubitIndex === 0 ? (custom?.name ?? "CG").slice(0, 5) : "·"}</text>
                  </g>
                  ))}
              </g>
            );
          }
          if (step.gate === "CX" || step.gate === "CZ" || step.gate === "SWAP") {
            const [control, target] = step.qubits;
            return (
              <g key={step.id} {...shared}>
                {title}
                {/* A wide transparent hit area, so the thin connector is easy to hover. */}
                <rect className="mj-circuit-hit" x={x - 17} y={Math.min(yFor(control), yFor(target)) - 17} width="34" height={Math.abs(yFor(target) - yFor(control)) + 34} rx="7" />
                <line className="mj-circuit-control" x1={x} y1={yFor(control)} x2={x} y2={yFor(target)} />
                {step.gate === "SWAP" ? (
                  <>
                    <path d={`M${x - 7} ${yFor(control) - 7}l14 14M${x - 7} ${yFor(control) + 7}l14 -14`} />
                    <path d={`M${x - 7} ${yFor(target) - 7}l14 14M${x - 7} ${yFor(target) + 7}l14 -14`} />
                  </>
                ) : (
                  <>
                    <circle className="mj-circuit-control-dot" cx={x} cy={yFor(control)} r="6" />
                    {step.gate === "CX" ? (
                      <>
                        <circle className="mj-circuit-target" cx={x} cy={yFor(target)} r="13" />
                        <path d={`M${x} ${yFor(target) - 9}v18M${x - 9} ${yFor(target)}h18`} />
                      </>
                    ) : (
                      <circle className="mj-circuit-control-dot" cx={x} cy={yFor(target)} r="6" />
                    )}
                  </>
                )}
              </g>
            );
          }
          const y = yFor(step.qubits[0]);
          return (
            // `key` before the spread: after it, the JSX transform falls back to
            // createElement and React warns that these static children need keys.
            <g key={step.id} {...shared}>
              {title}
              <rect x={x - 17} y={y - 17} width="34" height="34" rx="7" />
              {step.gate === "M" ? (
                // A meter, the way measurement is drawn in every textbook,
                // rather than a letter that reads like one more gate.
                <>
                  <path className="mj-circuit-meter" d={`M${x - 10} ${y + 6}a10 10 0 0 1 20 0`} />
                  <path className="mj-circuit-meter" d={`M${x} ${y + 6}l7 -11`} />
                </>
              ) : (
                <text x={x} y={y + 5}>{step.gate}</text>
              )}
              {step.param ? (
                // The full angle stays in the code and in the tooltip; only the
                // drawn label is bounded. See lib/gate-param-label.
                <text className="mj-circuit-label mj-circuit-param" x={x} y={y + 30}>
                  <title>{step.param}</title>
                  {formatGateParam(step.param)}
                </text>
              ) : null}
            </g>
          );
        })}
        {playheadMoment !== null ? (
          <g className="mj-circuit-playhead" aria-hidden="true">
            <line x1={columnX(playheadMoment) - CIRCUIT_COLUMN_WIDTH / 2} x2={columnX(playheadMoment) - CIRCUIT_COLUMN_WIDTH / 2} y1={14} y2={height - 4} />
            <path d={`M${columnX(playheadMoment) - CIRCUIT_COLUMN_WIDTH / 2 - 5} 13h10l-5 6z`} />
          </g>
        ) : null}
      </svg>
    </div>
  );
}
