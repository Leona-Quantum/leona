"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type UIEvent } from "react";
import { builderStepLabel, type BuilderStep, type CustomGateDefinition } from "../lib/studio-builder";
import { formatGateParam } from "../lib/gate-param-label";
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
 * merely disabled. */

export interface CircuitDiagramInteraction {
  selectedStepIds: string[];
  pendingQubits: number[];
  /** Label for the currently armed gate, announced on each empty slot. */
  selectedLabel: string;
  onPlaceOnQubit: (qubit: number) => void;
  onSelectStep: (stepId: string, multi: boolean) => void;
  onStepKeyDown: (stepId: string, event: KeyboardEvent<SVGGElement>) => void;
}

/** Geometry is exported so a caller can size a scroll container to the diagram
 * it is about to draw without re-deriving these constants. */
export function circuitDiagramSize(qubitCount: number, stepCount: number): { width: number; height: number } {
  return {
    width: Math.max(560, CIRCUIT_LEFT_PAD + (stepCount + 2) * CIRCUIT_COLUMN_WIDTH + 40),
    height: CIRCUIT_TOP_PAD + qubitCount * CIRCUIT_ROW_HEIGHT + 10,
  };
}

export function CircuitDiagram({
  qubitCount,
  steps,
  customGates,
  ariaLabel,
  interaction,
}: {
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
  ariaLabel: string;
  interaction?: CircuitDiagramInteraction;
}) {
  const { width, height } = circuitDiagramSize(qubitCount, steps.length);
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
    () => circuitDiagramWindow(qubitCount, steps.length, viewport),
    [qubitCount, steps.length, viewport],
  );
  const visibleQubits = useMemo(
    () => Array.from({ length: visible.qubitEnd - visible.qubitStart }, (_, index) => visible.qubitStart + index),
    [visible.qubitEnd, visible.qubitStart],
  );
  const visibleSteps = useMemo(
    () => steps.slice(visible.stepStart, visible.stepEnd).map((step, offset) => ({ step, index: visible.stepStart + offset })),
    [steps, visible.stepEnd, visible.stepStart],
  );

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const stage = event.currentTarget;
    setViewport({ left: stage.scrollLeft, top: stage.scrollTop, width: stage.clientWidth, height: stage.clientHeight });
  }

  return (
    <div ref={stageRef} onScroll={handleScroll} className={`mj-circuit-stage${readOnly ? " mj-circuit-stage--readonly" : ""}`}>
      <svg
        className="mj-circuit-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        style={{ width, height, maxWidth: "none" }}
      >
        {visibleQubits.map((q) => {
          const y = CIRCUIT_TOP_PAD + q * CIRCUIT_ROW_HEIGHT;
          return (
            <g key={q}>
              <text className="mj-circuit-label" x="18" y={y + 5}>q{q}</text>
              <line className="mj-circuit-wire" x1={CIRCUIT_LEFT_PAD - 16} y1={y} x2={width - 24} y2={y} />
              {interaction && visible.stepEnd === steps.length ? (
                <g
                  className={`mj-circuit-gate mj-builder-slot${interaction.pendingQubits.includes(q) ? " is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`q${q}: ${interaction.selectedLabel}`}
                  onClick={() => interaction.onPlaceOnQubit(q)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); interaction.onPlaceOnQubit(q); } }}
                >
                  <rect x={CIRCUIT_LEFT_PAD + steps.length * CIRCUIT_COLUMN_WIDTH - 17} y={y - 17} width="34" height="34" rx="7" strokeDasharray="4 3" fill="transparent" />
                  <text x={CIRCUIT_LEFT_PAD + steps.length * CIRCUIT_COLUMN_WIDTH} y={y + 5}>+</text>
                </g>
              ) : null}
            </g>
          );
        })}
        {visibleSteps.map(({ step, index }) => {
          const { min: minStepQubit, max: maxStepQubit } = step.qubits.reduce(
            (bounds, qubit) => ({ min: Math.min(bounds.min, qubit), max: Math.max(bounds.max, qubit) }),
            { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
          );
          if (maxStepQubit < visible.qubitStart || minStepQubit >= visible.qubitEnd) return null;
          const x = CIRCUIT_LEFT_PAD + index * CIRCUIT_COLUMN_WIDTH;
          const yFor = (q: number) => CIRCUIT_TOP_PAD + q * CIRCUIT_ROW_HEIGHT;
          const selected = interaction ? interaction.selectedStepIds.includes(step.id) : false;
          const label = builderStepLabel(step, customGates);
          const selectProps = interaction
            ? {
                role: "button" as const,
                tabIndex: 0,
                "aria-label": `${label} on ${step.qubits.map((qubit) => `q${qubit}`).join(", ")}`,
                onClick: (event: MouseEvent<SVGGElement>) => interaction.onSelectStep(step.id, event.shiftKey),
                onKeyDown: (event: KeyboardEvent<SVGGElement>) => interaction.onStepKeyDown(step.id, event),
              }
            : ({} as Record<string, never>);

          if (step.gate === "CUSTOM") {
            const custom = customGates.find((gate) => gate.id === step.customGateId);
            const minQubit = Math.min(...step.qubits);
            const maxQubit = Math.max(...step.qubits);
            return (
              <g className={`mj-circuit-gate mj-circuit-custom-gate${selected ? " is-selected" : ""}`} key={step.id} {...selectProps}>
                <title>{label}</title>
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
              <g className={`mj-circuit-gate${selected ? " is-selected" : ""}`} key={step.id} {...selectProps}>
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
            <g className={`mj-circuit-gate${selected ? " is-selected" : ""}`} key={step.id} {...selectProps}>
              <rect x={x - 17} y={y - 17} width="34" height="34" rx="7" />
              <text x={x} y={y + 5}>{step.gate === "M" ? "M" : step.gate}</text>
              {step.param ? (
                // The full angle stays in the code and in the tooltip; only the
                // drawn label is bounded. See lib/gate-param-label.
                <text className="mj-circuit-label" x={x} y={y + 30}>
                  <title>{step.param}</title>
                  {formatGateParam(step.param)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
