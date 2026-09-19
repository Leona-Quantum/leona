"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { CircuitDiagram } from "../../../components/circuit-diagram";
import {
  ANGLE_GATES,
  builderGateArity,
  createBuilderStepId,
  customGateDefinitionHasCycle,
  customGateUsageCount,
  type BuilderGate,
  type BuilderStep,
  type BuiltinBuilderGate,
  type CustomGateDefinition,
} from "../../../lib/studio-builder";
import type { PublicLocale } from "../../../lib/public-locale";
import type { WORKSPACE_COPY } from "../../../lib/workspace-locale";
import { ANGLE_OPTIONS, MORE_PALETTE_GATES, PALETTE_GROUPS } from "./studio-workspace";

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

/**
 * A block's definition, opened as its own small canvas.
 *
 * Deliberately not the full `CircuitBuilder`: a definition is just
 * `{ qubitCount, steps }`, with no code tab, drafts, compilation or playhead
 * to keep in sync, so reusing that whole component would drag in state that
 * has no meaning here. What IS reused is `CircuitDiagram` — the same drawing
 * and placement surface the main canvas uses — and the same palette groups
 * (`PALETTE_GROUPS`/`ANGLE_OPTIONS`, exported from studio-workspace.tsx) so
 * this editor looks and behaves like the canvas it is editing a piece of,
 * rather than a second, differently-shaped tool.
 *
 * All edits are local state (`steps`) until Save; Cancel simply discards
 * them, which is this panel's whole undo story — the canvas's own history
 * stack only receives one entry, pushed by the caller right before it
 * commits the saved definition.
 */
export function EditBlockPanel({
  definition,
  topLevelSteps,
  customGates,
  copy,
  onSave,
  onCancel,
}: {
  definition: CustomGateDefinition;
  /** The canvas's own top-level steps — only used for the "N uses" count. */
  topLevelSteps: BuilderStep[];
  customGates: CustomGateDefinition[];
  copy: StudioCopy;
  onSave: (steps: BuilderStep[]) => void;
  onCancel: () => void;
}) {
  const [steps, setSteps] = useState<BuilderStep[]>(definition.steps);
  const [armedGate, setArmedGate] = useState<string>("H");
  const [pendingQubits, setPendingQubits] = useState<number[]>([]);
  const [angle, setAngle] = useState("pi/2");
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // A block cannot place another instance of itself — the palette hides it,
  // and `customGateDefinitionHasCycle` below is the authoritative guard for
  // an indirect cycle through some other block.
  const availableCustomGates = customGates.filter((gate) => gate.id !== definition.id);
  const armedCustomId = armedGate.startsWith("custom:") ? armedGate.slice("custom:".length) : null;
  const armedCustom = armedCustomId ? availableCustomGates.find((gate) => gate.id === armedCustomId) ?? null : null;
  const armed: BuilderGate = armedCustom ? "CUSTOM" : (armedGate as BuilderGate);
  const requiredQubits = armedCustom?.qubitCount ?? builderGateArity(armed as BuiltinBuilderGate);
  const rotationArmed = ANGLE_GATES.includes(armed as (typeof ANGLE_GATES)[number]);
  const angleGroupId: "rotations" | "more" = MORE_PALETTE_GATES.includes(armed as BuiltinBuilderGate) ? "more" : "rotations";

  function place(step: BuilderStep) {
    setSteps((current) => [...current, step]);
    setError(null);
  }

  function placeOnQubit(qubit: number) {
    if (requiredQubits > 1) {
      if (pendingQubits.includes(qubit)) {
        setPendingQubits((current) => current.filter((item) => item !== qubit));
        return;
      }
      const nextQubits = [...pendingQubits, qubit];
      if (nextQubits.length < requiredQubits) {
        setPendingQubits(nextQubits);
        return;
      }
      place(armed === "CUSTOM" && armedCustom
        ? { id: createBuilderStepId(), gate: "CUSTOM", customGateId: armedCustom.id, qubits: nextQubits }
        : { id: createBuilderStepId(), gate: armed, qubits: nextQubits, ...(rotationArmed ? { param: angle } : {}) });
      setPendingQubits([]);
      return;
    }
    place({ id: createBuilderStepId(), gate: armed, qubits: [qubit], ...(rotationArmed ? { param: angle } : {}) });
  }

  function selectStep(stepId: string, multi: boolean) {
    setSelectedStepIds((current) => {
      if (!multi) return [stepId];
      return current.includes(stepId) ? current.filter((id) => id !== stepId) : [...current, stepId];
    });
  }

  function deleteSelected() {
    if (!selectedStepIds.length) return;
    const selected = new Set(selectedStepIds);
    setSteps((current) => current.filter((step) => !selected.has(step.id)));
    setSelectedStepIds([]);
  }

  function handleStepKeyDown(stepId: string, event: KeyboardEvent<SVGGElement>) {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      setSteps((current) => current.filter((step) => step.id !== stepId));
      setSelectedStepIds((current) => current.filter((id) => id !== stepId));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectStep(stepId, false);
    }
  }

  function save() {
    if (customGateDefinitionHasCycle(definition.id, steps, customGates)) {
      setError(copy.editBlockCycleError);
      return;
    }
    onSave(steps);
  }

  const uses = customGateUsageCount(definition.id, topLevelSteps, customGates);

  return (
    <div className="mj-edit-block-overlay" role="presentation">
      <div className="mj-edit-block-panel" role="dialog" aria-modal="true" aria-label={copy.editBlockTitle(definition.name)}>
        <header className="mj-edit-block-head">
          <h3>{copy.editBlockTitle(definition.name)}</h3>
          <span className="mj-mono-muted">{copy.editBlockUses(uses)}</span>
        </header>

        <div className="mj-builder-palette" role="toolbar" aria-label={copy.palette}>
          {PALETTE_GROUPS.map((group) => (
            <div className="mj-builder-palette-group" role="group" aria-label={copy.paletteGroups[group.id]} key={group.id}>
              <span className="mj-builder-palette-label" aria-hidden="true">{copy.paletteGroups[group.id]}</span>
              <div className="mj-builder-palette-gates">
                {group.gates.map((gate) => (
                  <button
                    key={gate}
                    type="button"
                    className={`mj-builder-gate${armed === gate ? " is-active" : ""}`}
                    data-family={group.family}
                    aria-pressed={armed === gate}
                    title={copy.gateNames[gate] ?? gate}
                    onClick={() => { setArmedGate(gate); setPendingQubits([]); }}
                  >
                    {gate}
                  </button>
                ))}
                {group.id === angleGroupId ? (
                  <label className="mj-builder-angle" data-armed={rotationArmed ? "true" : undefined}>
                    <span className="sr-only">{copy.angleLabel}</span>
                    <select value={angle} onChange={(event) => setAngle(event.target.value)} disabled={!rotationArmed} title={copy.angleLabel}>
                      {ANGLE_OPTIONS.map((option) => <option key={option} value={option}>{option.replace("pi", "π").replace("*", "")}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {availableCustomGates.length ? (
          <div className="mj-builder-custom-gates" aria-label={copy.customGates}>
            <span className="mj-section-label">{copy.customGates}</span>
            {availableCustomGates.map((gate) => (
              <button
                key={gate.id}
                type="button"
                className={`mj-builder-gate${armedGate === `custom:${gate.id}` ? " is-active" : ""}`}
                aria-pressed={armedGate === `custom:${gate.id}`}
                onClick={() => { setArmedGate(`custom:${gate.id}`); setPendingQubits([]); }}
              >
                {gate.name}<small>{gate.qubitCount}q</small>
              </button>
            ))}
          </div>
        ) : null}

        <div className="mj-builder-controls">
          <button className="mj-secondary-button" type="button" onClick={deleteSelected} disabled={!selectedStepIds.length}>{copy.deleteSelected}</button>
        </div>

        <div className="mj-circuit-workbench mj-circuit-workbench--solo">
          <CircuitDiagram
            qubitCount={definition.qubitCount}
            steps={steps}
            customGates={customGates}
            ariaLabel={copy.editBlockTitle(definition.name)}
            interaction={{
              selectedStepIds,
              pendingQubits,
              selectedLabel: armed === "CUSTOM" ? armedCustom?.name ?? copy.customGateLabel : armed,
              onPlaceOnQubit: placeOnQubit,
              onSelectStep: selectStep,
              onStepKeyDown: handleStepKeyDown,
            }}
          />
        </div>

        {error ? <p className="mj-circuit-sync mj-circuit-sync--unrepresentable" role="alert">{error}</p> : null}

        <div className="mj-builder-controls">
          <button className="mj-primary-button" type="button" onClick={save}>{copy.editBlockSave}</button>
          <button className="mj-secondary-button" type="button" onClick={onCancel}>{copy.editBlockCancel}</button>
        </div>
      </div>
    </div>
  );
}
