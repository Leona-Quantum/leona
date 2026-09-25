"use client";

import { useState } from "react";
import {
  buildCheckProperty,
  checkExpectationMode,
  CHECK_DEFAULT_TOLERANCE,
  draftCheckStatement,
  emptyCheckDraft,
  referenceTakesQubitCount,
  STATE_REFERENCE_FAMILIES,
  UNITARY_REFERENCE_FAMILIES,
  validateCheckDraft,
  type CheckBasisRow,
  type CheckDraft,
  type CheckHamiltonianRow,
  type CheckKind,
  type CheckProperty,
  type ReferenceFamily,
} from "../lib/notebook-checks";
import type { NOTEBOOK_CHECK_COPY } from "../lib/workspace-locale";
import type { PublicLocale } from "../lib/public-locale";

type NotebookCheckCopy = (typeof NOTEBOOK_CHECK_COPY)[PublicLocale];

const CHECK_KINDS: readonly CheckKind[] = ["state", "unitary", "distribution", "energy", "value"];

/**
 * "Add a check" (ai-ops 382, DESIGN.md §1): kind, subject, the expected value in whichever
 * of the five shapes the kind takes, tolerance, and an auto-drafted, editable statement.
 * Owns its own draft state (the same shape `NotebookHardwareCard` owns its submission
 * state) rather than lifting every field to `notebook-workspace.tsx` — nothing outside
 * this form needs a keystroke of it until Submit, unlike the per-cell source editor
 * (`NotebookCellEditState`), which the workspace has to hold because Cmd/Ctrl+S and the
 * "unsaved changes" confirm both need to see it from outside.
 *
 * Validates client-side against `validateCheckDraft` (a close mirror of what
 * `CheckProperty` enforces, not a byte-for-byte port of it — see that module's doc
 * comment) before calling `onSubmit`, so a reader sees most mistakes without a round
 * trip. `onSubmit` may still fail (a rule this form did not mirror, a race with another
 * edit); the workspace's own failure banner shows that 400 the same way it already does
 * for a per-cell save, and this form is not told the difference — it just stays open
 * with the draft intact, exactly like the per-cell source editor does on a failed save.
 */
export function NotebookAddCheckForm({
  afterId,
  subjectHint,
  copy,
  busy = false,
  onCancel,
  onSubmit,
}: {
  afterId: string;
  subjectHint: string;
  copy: NotebookCheckCopy;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (property: CheckProperty) => void;
}) {
  const [draft, setDraft] = useState<CheckDraft>(() => emptyCheckDraft("state", subjectHint));
  const [errors, setErrors] = useState<string[]>([]);
  // `draftCheckStatement`'s labels: `copy.statement`'s per-kind sentences plus
  // `copy.referenceFamilyOption` doing double duty as the reference's human name —
  // the same words the picker's own dropdown shows, so the auto-drafted sentence
  // ("Check that qc prepares GHZ state.") always agrees with what the reader picked.
  const statementLabels = { ...copy.statement, referenceLabel: copy.referenceFamilyOption };

  function update(patch: Partial<CheckDraft>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (!next.statementTouched) next.statement = draftCheckStatement(next, statementLabels);
      return next;
    });
  }

  function changeKind(kind: CheckKind) {
    // A fresh draft for the new kind, not a patch — the fields of one kind (a
    // Hamiltonian's terms, an amplitude table) mean nothing for another, and carrying
    // them across would validate the wrong thing invisibly.
    const fresh = emptyCheckDraft(kind, draft.subject);
    fresh.statement = draftCheckStatement(fresh, statementLabels);
    setDraft(fresh);
    setErrors([]);
  }

  function submit() {
    const problems = validateCheckDraft(draft);
    setErrors(problems);
    if (problems.length > 0) return;
    onSubmit(buildCheckProperty(draft));
  }

  const mode = checkExpectationMode(draft);
  const referenceFamilies = draft.kind === "unitary" ? UNITARY_REFERENCE_FAMILIES : STATE_REFERENCE_FAMILIES;

  return (
    <div className="mj-notebook-add-check" data-after={afterId}>
      <p className="mj-notebook-add-check-title">{copy.addCheckTitle}</p>

      <label className="mj-notebook-add-check-field">
        <span>{copy.kindLabel}</span>
        <select value={draft.kind} disabled={busy} onChange={(event) => changeKind(event.target.value as CheckKind)}>
          {CHECK_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {copy.kindOption[kind]}
            </option>
          ))}
        </select>
      </label>

      <label className="mj-notebook-add-check-field">
        <span>{copy.subjectLabel}</span>
        <input
          type="text"
          value={draft.subject}
          placeholder={copy.subjectPlaceholder}
          disabled={busy}
          onChange={(event) => update({ subject: event.target.value })}
        />
      </label>

      {draft.kind === "state" ? (
        <label className="mj-notebook-add-check-field">
          <span>{copy.expectationModeLabel}</span>
          <select
            value={draft.stateMode}
            disabled={busy}
            onChange={(event) => update({ stateMode: event.target.value as "reference" | "amplitudes" })}
          >
            <option value="reference">{copy.expectationModeOption.reference}</option>
            <option value="amplitudes">{copy.expectationModeOption.amplitudes}</option>
          </select>
        </label>
      ) : null}

      {mode === "reference" ? (
        <>
          <label className="mj-notebook-add-check-field">
            <span>{copy.referenceLabel}</span>
            <select
              value={draft.referenceFamily}
              disabled={busy}
              onChange={(event) => update({ referenceFamily: event.target.value as ReferenceFamily })}
            >
              {referenceFamilies.map((family) => (
                <option key={family} value={family}>
                  {copy.referenceFamilyOption[family]}
                </option>
              ))}
            </select>
          </label>
          {referenceTakesQubitCount(draft.referenceFamily) ? (
            <label className="mj-notebook-add-check-field">
              <span>{copy.referenceQubitsLabel}</span>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={draft.referenceQubits}
                disabled={busy}
                onChange={(event) => update({ referenceQubits: event.target.value })}
              />
            </label>
          ) : null}
        </>
      ) : null}

      {mode === "amplitudes" ? (
        <CheckBasisTable
          label={copy.amplitudesLabel}
          valueLabel={copy.amplitudeValueLabel}
          bitstringLabel={copy.bitstringLabel}
          addRowLabel={copy.addRow}
          removeRowLabel={copy.removeRow}
          rows={draft.amplitudes}
          busy={busy}
          onChange={(rows) => update({ amplitudes: rows })}
        />
      ) : null}

      {mode === "probabilities" ? (
        <CheckBasisTable
          label={copy.probabilitiesLabel}
          valueLabel={copy.probabilityValueLabel}
          bitstringLabel={copy.bitstringLabel}
          addRowLabel={copy.addRow}
          removeRowLabel={copy.removeRow}
          rows={draft.probabilities}
          busy={busy}
          onChange={(rows) => update({ probabilities: rows })}
        />
      ) : null}

      {mode === "hamiltonian" ? (
        <>
          <CheckHamiltonianTable
            copy={copy}
            rows={draft.hamiltonian}
            busy={busy}
            onChange={(rows) => update({ hamiltonian: rows })}
          />
          <label className="mj-notebook-add-check-field">
            <span>{copy.targetLabel}</span>
            <select value={draft.target} disabled={busy} onChange={(event) => update({ target: event.target.value as "ground" | "number" })}>
              <option value="ground">{copy.targetOption.ground}</option>
              <option value="number">{copy.targetOption.number}</option>
            </select>
          </label>
          {draft.target === "number" ? (
            <label className="mj-notebook-add-check-field">
              <span>{copy.targetValueLabel}</span>
              <input
                type="text"
                inputMode="decimal"
                value={draft.targetValue}
                disabled={busy}
                onChange={(event) => update({ targetValue: event.target.value })}
              />
            </label>
          ) : null}
        </>
      ) : null}

      {mode === "value" ? (
        <label className="mj-notebook-add-check-field">
          <span>{copy.valueLabel}</span>
          <input
            type="text"
            inputMode="decimal"
            value={draft.value}
            placeholder={copy.valuePlaceholder}
            disabled={busy}
            onChange={(event) => update({ value: event.target.value })}
          />
        </label>
      ) : null}

      <label className="mj-notebook-add-check-field">
        <span>{copy.toleranceLabel}</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft.tolerance}
          placeholder={String(CHECK_DEFAULT_TOLERANCE[draft.kind])}
          disabled={busy}
          onChange={(event) => update({ tolerance: event.target.value })}
        />
      </label>
      {/* Outside the `<label>`, deliberately: a `<label>` wrapping an input takes its
          WHOLE text content as the accessible name, so a hint sentence inside it would
          fold into "Tolerance Default for this kind: 0.000001" instead of "Tolerance" —
          the exact mistake `getByLabelText("Tolerance")` caught in this form's own test. */}
      <p className="mj-notebook-add-check-hint mj-mono-muted">
        {copy.toleranceDefaultHint(String(CHECK_DEFAULT_TOLERANCE[draft.kind]))}
      </p>

      <label className="mj-notebook-add-check-field">
        <span>{copy.statementLabel}</span>
        <input
          type="text"
          value={draft.statement}
          disabled={busy}
          onChange={(event) => setDraft((current) => ({ ...current, statement: event.target.value, statementTouched: true }))}
        />
      </label>

      {errors.length > 0 ? (
        <div className="mj-notebook-add-check-errors" role="alert">
          <p>{copy.validationHeading}</p>
          <ul>
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mj-notebook-add-check-actions">
        <button type="button" className="mj-secondary-button" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </button>
        <button type="button" className="mj-primary-button" disabled={busy} onClick={submit}>
          {busy ? copy.submitting : copy.submit}
        </button>
      </div>
    </div>
  );
}

function CheckBasisTable({
  label,
  valueLabel,
  bitstringLabel,
  addRowLabel,
  removeRowLabel,
  rows,
  busy,
  onChange,
}: {
  label: string;
  valueLabel: string;
  bitstringLabel: string;
  addRowLabel: string;
  removeRowLabel: string;
  rows: CheckBasisRow[];
  busy: boolean;
  onChange: (rows: CheckBasisRow[]) => void;
}) {
  function setRow(index: number, patch: Partial<CheckBasisRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }
  return (
    <fieldset className="mj-notebook-add-check-table">
      <legend>{label}</legend>
      {rows.map((row, index) => (
        <div className="mj-notebook-add-check-row" key={index}>
          <label>
            <span className="sr-only">{bitstringLabel}</span>
            <input
              type="text"
              value={row.bitstring}
              placeholder={bitstringLabel}
              disabled={busy}
              onChange={(event) => setRow(index, { bitstring: event.target.value })}
            />
          </label>
          <label>
            <span className="sr-only">{valueLabel}</span>
            <input
              type="text"
              value={row.expr}
              placeholder={valueLabel}
              disabled={busy}
              onChange={(event) => setRow(index, { expr: event.target.value })}
            />
          </label>
          <button type="button" className="mj-secondary-button" disabled={busy} onClick={() => removeRow(index)}>
            {removeRowLabel}
          </button>
        </div>
      ))}
      <button type="button" className="mj-secondary-button" disabled={busy} onClick={() => onChange([...rows, { bitstring: "", expr: "" }])}>
        {addRowLabel}
      </button>
    </fieldset>
  );
}

function CheckHamiltonianTable({
  copy,
  rows,
  busy,
  onChange,
}: {
  copy: NotebookCheckCopy;
  rows: CheckHamiltonianRow[];
  busy: boolean;
  onChange: (rows: CheckHamiltonianRow[]) => void;
}) {
  function setRow(index: number, patch: Partial<CheckHamiltonianRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }
  return (
    <fieldset className="mj-notebook-add-check-table">
      <legend>{copy.hamiltonianLabel}</legend>
      {rows.map((row, index) => (
        <div className="mj-notebook-add-check-row" key={index}>
          <label>
            <span className="sr-only">{copy.pauliLabel}</span>
            <input
              type="text"
              value={row.pauli}
              placeholder={copy.pauliLabel}
              disabled={busy}
              onChange={(event) => setRow(index, { pauli: event.target.value })}
            />
          </label>
          <label>
            <span className="sr-only">{copy.coefficientLabel}</span>
            <input
              type="text"
              inputMode="decimal"
              value={row.coefficient}
              placeholder={copy.coefficientLabel}
              disabled={busy}
              onChange={(event) => setRow(index, { coefficient: event.target.value })}
            />
          </label>
          <button type="button" className="mj-secondary-button" disabled={busy} onClick={() => removeRow(index)}>
            {copy.removeRow}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="mj-secondary-button"
        disabled={busy}
        onClick={() => onChange([...rows, { pauli: "", coefficient: "" }])}
      >
        {copy.addTerm}
      </button>
    </fieldset>
  );
}
