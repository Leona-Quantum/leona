"use client";

import type { CircuitDiagramInspection } from "../../../components/circuit-diagram";
import type { CustomGateDefinition } from "../../../lib/studio-builder";
import { formatAmplitude, gateAngleRadians, gateFamily, gateUnitary } from "../../../lib/gate-inspector";
import { formatGateParam } from "../../../lib/gate-param-label";
import type { PublicLocale } from "../../../lib/public-locale";
import type { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

/** Height the card can reach, used only to decide whether it fits below the gate. */
const CARD_ROOM = 240;

/**
 * Hover or focus a placed gate: what it is, where it acts, and its matrix.
 *
 * The gate description used to live in a folded "Selected gate: H" disclosure
 * under the edit controls, describing the palette selection rather than the gate
 * under the pointer. The matrix is the CPU lane's own (lib/gate-inspector).
 */
export function GateInspectorCard({
  inspection,
  customGates,
  copy,
}: {
  inspection: CircuitDiagramInspection;
  customGates: CustomGateDefinition[];
  copy: StudioCopy;
}) {
  const { step, column, rect } = inspection;
  const custom = step.gate === "CUSTOM" ? customGates.find((gate) => gate.id === step.customGateId) ?? null : null;
  const name = step.gate === "CUSTOM" ? custom?.name ?? copy.customGateLabel : copy.gateNames[step.gate] ?? step.gate;
  const symbol = step.gate === "CUSTOM" ? (custom?.name ?? "CG").slice(0, 4) : step.gate;
  const description = step.gate === "CUSTOM" ? null : copy.gateDescriptions[step.gate] ?? null;
  const unitary = gateUnitary(step);
  const radians = step.param ? gateAngleRadians(step.param) : null;
  const qubits = step.qubits.map((qubit) => `q${qubit}`).join(", ");
  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  const below = rect.bottom + CARD_ROOM < viewportHeight;
  const style = {
    left: Math.round(rect.left + rect.width / 2),
    top: Math.round(below ? rect.bottom + 8 : rect.top - 8),
  };

  return (
    <div className="mj-gate-inspector" data-family={gateFamily(step.gate)} data-placement={below ? "below" : "above"} style={style} role="tooltip">
      <div className="mj-gate-inspector-head">
        <span className="mj-gate-inspector-symbol" aria-hidden="true">{symbol}</span>
        <div>
          <strong>{name}</strong>
          <span>{copy.inspectorActsOn(qubits)} · {copy.inspectorMoment(column + 1)}</span>
        </div>
      </div>
      {description ? <p className="mj-gate-inspector-description">{description}</p> : null}
      {step.param ? (
        <p className="mj-gate-inspector-angle">
          <span>{copy.inspectorAngle}</span>
          <code>{formatGateParam(step.param)}{radians !== null ? ` = ${radians.toFixed(4)} rad` : ""}</code>
        </p>
      ) : null}
      {unitary ? (
        <figure className="mj-gate-inspector-matrix">
          <figcaption>
            <span>{copy.inspectorMatrix}</span>
            {unitary.size === 4 ? <small>{copy.inspectorBasis(`q${step.qubits[0]}`, `q${step.qubits[1]}`)}</small> : null}
          </figcaption>
          <div className="mj-gate-inspector-grid" data-size={unitary.size}>
            {unitary.rows.flatMap((row, rowIndex) => row.map((cell, cellIndex) => {
              const text = formatAmplitude(cell);
              return <span key={`${rowIndex}-${cellIndex}`} data-zero={text === "0" ? "true" : undefined}>{text}</span>;
            }))}
          </div>
        </figure>
      ) : (
        <p className="mj-gate-inspector-note">
          {step.gate === "M"
            ? copy.inspectorNoMatrixMeasure
            : step.gate === "CUSTOM"
              ? copy.inspectorNoMatrixCustom(step.qubits.length)
              : copy.inspectorNoMatrixAngle}
        </p>
      )}
      {step.gate === "CUSTOM" && custom?.opaque ? <p className="mj-gate-inspector-note">{copy.blockOpaqueNote}</p> : null}
    </div>
  );
}
