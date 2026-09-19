"use client";

import { useState } from "react";
import { BLOCK_TEMPLATES, validateBlockParams, type BlockCategory, type BlockParams, type BlockTemplate } from "../../../lib/circuit-blocks";
import { blockParamsFromForm, defaultBlockParamFormValues, type BlockParamFormValues } from "../../../lib/block-param-form";
import type { PublicLocale } from "../../../lib/public-locale";
import type { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

const CATEGORY_ORDER: BlockCategory[] = ["state-preparation", "transforms", "oracles", "arithmetic", "simulation", "variational"];

function groupByCategory(templates: readonly BlockTemplate[]): Array<{ category: BlockCategory; templates: BlockTemplate[] }> {
  return CATEGORY_ORDER.map((category) => ({ category, templates: templates.filter((t) => t.category === category) }))
    .filter((group) => group.templates.length > 0);
}

/**
 * The block library, grouped by category, with a live-validated parameter
 * form per template. Insertion is one call to the caller's `onInsert` — this
 * component only parses and validates the form; `instantiateBlock`, the undo
 * push, and growing the register when the circuit is too narrow all live in
 * `CircuitBuilder`, the same place every other canvas mutation does.
 */
export function BlocksPanel({
  qubitCount,
  onInsert,
  onGrowQubits,
  onClose,
  copy,
}: {
  qubitCount: number;
  onInsert: (template: BlockTemplate, params: BlockParams, startQubit: number, requiredQubits: number) => void;
  /** Grow the register by this many qubits, keeping the panel open so Insert can be retried. */
  onGrowQubits: (by: number) => void;
  onClose: () => void;
  copy: StudioCopy;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, BlockParamFormValues>>({});
  const [startQubit, setStartQubit] = useState(0);

  function valuesFor(template: BlockTemplate): BlockParamFormValues {
    return formValues[template.key] ?? defaultBlockParamFormValues(template.params);
  }

  function setField(template: BlockTemplate, key: string, value: string) {
    setFormValues((current) => ({ ...current, [template.key]: { ...valuesFor(template), [key]: value } }));
  }

  const groups = groupByCategory(BLOCK_TEMPLATES);

  return (
    <div className="mj-edit-block-overlay" role="presentation">
      <div className="mj-edit-block-panel mj-blocks-panel" role="dialog" aria-modal="true" aria-label={copy.blocksPanelTitle}>
        <header className="mj-edit-block-head">
          <h3>{copy.blocksPanelTitle}</h3>
          <button className="mj-secondary-button" type="button" onClick={onClose}>{copy.editBlockCancel}</button>
        </header>
        <div className="mj-blocks-list">
          {groups.map((group) => (
            <section key={group.category} className="mj-blocks-category">
              <h4>{copy.blockCategoryLabel[group.category]}</h4>
              {group.templates.map((template) => {
                const values = valuesFor(template);
                const parsed = blockParamsFromForm(template.params, values);
                const reason = parsed.ok ? validateBlockParams(template, parsed.params) : parsed.reason;
                const required = parsed.ok ? template.qubitCount(parsed.params) : null;
                const tooNarrow = required !== null && startQubit + required > qubitCount;
                const open = openKey === template.key;
                return (
                  <div className="mj-block-card" key={template.key}>
                    <button
                      type="button"
                      className="mj-block-card-head"
                      aria-expanded={open}
                      onClick={() => setOpenKey(open ? null : template.key)}
                    >
                      <strong>{template.name}</strong>
                      <span className="mj-mono-muted">{template.summary}</span>
                    </button>
                    {open ? (
                      <div className="mj-block-card-body">
                        {template.params.map((spec) => (
                          <label className="mj-block-param" key={spec.key}>
                            <span>{spec.label}</span>
                            <input
                              value={values[spec.key] ?? ""}
                              onChange={(event) => setField(template, spec.key, event.target.value)}
                            />
                          </label>
                        ))}
                        <label className="mj-block-param">
                          <span>{copy.insertAtQubit}</span>
                          <input
                            type="number"
                            min={0}
                            value={startQubit}
                            onChange={(event) => setStartQubit(Math.max(0, Number(event.target.value) || 0))}
                          />
                        </label>
                        {reason ? <p className="mj-circuit-sync mj-circuit-sync--unrepresentable" role="alert">{reason}</p> : null}
                        {!reason && tooNarrow && required !== null ? (
                          <p className="mj-circuit-sync mj-circuit-sync--unrepresentable" role="alert">
                            {copy.blockTooNarrow(required, qubitCount - startQubit)}
                          </p>
                        ) : null}
                        <div className="mj-builder-controls">
                          <button
                            className="mj-primary-button"
                            type="button"
                            disabled={Boolean(reason) || tooNarrow}
                            onClick={() => parsed.ok && required !== null && onInsert(template, parsed.params, startQubit, required)}
                          >
                            {copy.insertBlock}
                          </button>
                          {!reason && tooNarrow && required !== null ? (
                            <button
                              className="mj-secondary-button"
                              type="button"
                              onClick={() => onGrowQubits(startQubit + required - qubitCount)}
                            >
                              {copy.addQubitsForBlock}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
