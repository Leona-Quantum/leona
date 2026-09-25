"use client";

import { useMemo, useState } from "react";
import {
  searchMethods,
  sizeParamChoicesFor,
  stagePositions,
  type BlockCatalog,
  type BlockMethod,
  type BlockRef,
  type StagePosition,
} from "../lib/notebook-blocks";
import type { NOTEBOOK_BLOCK_COPY } from "../lib/workspace-locale";
import type { PublicLocale } from "../lib/public-locale";
import { indexPlannerGraph } from "../lib/workflow-planner/graph.ts";
import { problemById } from "../lib/workflow-planner/problems.ts";
import { parseNumber, withinSpec } from "../lib/workflow-planner/recognise.ts";
import type { ParamKey } from "../lib/workflow-planner/types.ts";

type BlockCopy = (typeof NOTEBOOK_BLOCK_COPY)[PublicLocale];

/**
 * "Add a block" (ai-ops 382, Phase B S1): pick an Atlas method from a search over the
 * layer graph, optionally take its numbers from a planner problem it is a step of (with
 * values for that problem's parameters), and pick which parameter is the size a reader can
 * move. Saves as a reader-authored block cell, the way "Add a check" saves a check.
 *
 * Only inputs are collected here. The card works the numbers out from them every time it
 * renders, so nothing typed here can put a number in front of a reader.
 */
export function NotebookAddBlockForm({
  afterId,
  catalog,
  locale,
  copy,
  busy = false,
  onCancel,
  onSubmit,
}: {
  afterId: string;
  /** `null` while the Atlas slice loads; the form says so and waits. */
  catalog: BlockCatalog | null;
  locale: PublicLocale;
  copy: BlockCopy;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (ref: BlockRef) => void;
}) {
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<BlockMethod | null>(null);
  const [position, setPosition] = useState<number>(-1);
  // A Map, not an object written through a computed key: the keys come from a closed union,
  // but the planner's own modules avoid that shape too (`recognise.ts`, `readParams`).
  const [values, setValues] = useState<ReadonlyMap<ParamKey, string>>(new Map());
  const [sizeParam, setSizeParam] = useState<ParamKey | "">("");
  const [errors, setErrors] = useState<string[]>([]);

  const index = useMemo(() => (catalog ? indexPlannerGraph(catalog.graph) : null), [catalog]);
  const matches = useMemo(() => (catalog && !method ? searchMethods(catalog.methods, query) : []), [catalog, method, query]);
  const positions: StagePosition[] = useMemo(
    () => (index && method ? stagePositions(index, method.id) : []),
    [index, method],
  );
  const chosen = position >= 0 ? (positions[position] ?? null) : null;
  const problem = chosen ? problemById(chosen.problem) : undefined;
  // The sizes a reader could move, at the values typed so far: only parameters that move
  // the qubit count, when any do (the card would ignore any other choice).
  const sizeChoices = useMemo(() => {
    if (!index || !chosen || !problem) return [];
    const typed = Object.fromEntries(
      problem.params.flatMap((spec) => {
        const value = parseNumber((values.get(spec.key) ?? "").trim());
        return value !== null && withinSpec(spec, value) ? [[spec.key, value]] : [];
      }),
    );
    return sizeParamChoicesFor(index, chosen.problem, typed, chosen.choices);
  }, [index, chosen, problem, values]);
  const offeredSizeParam = sizeParam && sizeChoices.includes(sizeParam) ? sizeParam : "";

  function pick(next: BlockMethod | null) {
    setMethod(next);
    setPosition(-1);
    setValues(new Map());
    setSizeParam("");
    setErrors([]);
  }

  function submit() {
    if (!method) {
      setErrors([copy.pickMethodFirst]);
      return;
    }
    if (!chosen || !problem) {
      onSubmit({ method: method.id, plan: null, size_param: null, author: "user", citation: "", accepted: true });
      return;
    }
    const problems: string[] = [];
    const entries: [ParamKey, number][] = [];
    for (const spec of problem.params) {
      const raw = (values.get(spec.key) ?? "").trim();
      if (!raw) continue;
      const value = parseNumber(raw);
      if (value === null || !withinSpec(spec, value)) {
        problems.push(copy.invalidParam(locale === "ja" ? spec.label.ja : spec.label.en));
        continue;
      }
      entries.push([spec.key, value]);
    }
    const params = Object.fromEntries(entries);
    setErrors(problems);
    if (problems.length > 0) return;
    onSubmit({
      method: method.id,
      plan: { problem: chosen.problem, params, choices: chosen.choices },
      size_param: offeredSizeParam || null,
      author: "user",
      citation: "",
      accepted: true,
    });
  }

  return (
    <div className="mj-notebook-add-check mj-notebook-add-block" data-after={afterId}>
      <p className="mj-notebook-add-check-title">{copy.addBlockTitle}</p>
      {!catalog ? (
        <p className="mj-notebook-add-check-hint" role="status">
          {copy.loading}
        </p>
      ) : method ? (
        <div className="mj-notebook-add-block-chosen">
          <span className="mj-notebook-add-check-hint">{copy.chosenLabel}</span>
          <strong>{method.label}</strong>
          <button type="button" className="mj-secondary-button" disabled={busy} onClick={() => pick(null)}>
            {copy.change}
          </button>
        </div>
      ) : (
        <>
          <label className="mj-notebook-add-check-field">
            <span>{copy.searchLabel}</span>
            <input
              type="search"
              value={query}
              placeholder={copy.searchPlaceholder}
              disabled={busy}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {query.trim() ? (
            matches.length > 0 ? (
              <ul className="mj-notebook-add-block-results" aria-label={copy.searchLabel}>
                {matches.map((candidate) => (
                  <li key={candidate.id}>
                    <button type="button" className="mj-secondary-button" disabled={busy} onClick={() => pick(candidate)}>
                      {candidate.label}
                    </button>
                    {candidate.capabilityLabel ? (
                      <span className="mj-notebook-add-check-hint"> {candidate.capabilityLabel}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mj-notebook-add-check-hint">{copy.noMatches}</p>
            )
          ) : null}
        </>
      )}

      {method ? (
        positions.length > 0 ? (
          <label className="mj-notebook-add-check-field">
            <span>{copy.numbersLabel}</span>
            <select
              value={String(position)}
              disabled={busy}
              onChange={(event) => {
                setPosition(Number(event.target.value));
                setValues(new Map());
                setSizeParam("");
              }}
            >
              <option value="-1">{copy.numbersNone}</option>
              {positions.map((option, i) => (
                <option key={`${option.problem}|${option.path}`} value={String(i)}>
                  {copy.numbersOption(locale === "ja" ? option.problemLabel.ja : option.problemLabel.en, option.capabilityLabel)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="mj-notebook-add-check-hint">{copy.noPositions}</p>
        )
      ) : null}

      {problem && problem.params.length > 0 ? (
        <fieldset className="mj-notebook-add-check-table">
          <legend>{copy.paramsHeading}</legend>
          {problem.params.map((spec) => (
            <label key={spec.key} className="mj-notebook-add-check-field">
              <span>{locale === "ja" ? spec.label.ja : spec.label.en}</span>
              <input
                type="text"
                inputMode="decimal"
                value={values.get(spec.key) ?? ""}
                placeholder={spec.assumed ? String(spec.assumed.value) : ""}
                disabled={busy}
                onChange={(event) => {
                  const typed = event.target.value;
                  setValues((current) => new Map(current).set(spec.key, typed));
                }}
              />
            </label>
          ))}
          <p className="mj-notebook-add-check-hint">{copy.paramsHint}</p>
          <label className="mj-notebook-add-check-field">
            <span>{copy.sizeParamLabel}</span>
            <select value={offeredSizeParam} disabled={busy} onChange={(event) => setSizeParam(event.target.value as ParamKey | "")}>
              <option value="">{copy.sizeParamAuto}</option>
              {problem.params.filter((spec) => sizeChoices.includes(spec.key)).map((spec) => (
                <option key={spec.key} value={spec.key}>
                  {locale === "ja" ? spec.label.ja : spec.label.en}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      ) : null}

      {errors.length > 0 ? (
        <div className="mj-notebook-add-check-errors" role="alert">
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mj-notebook-add-check-actions">
        <button type="button" className="mj-secondary-button" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </button>
        <button type="button" className="mj-primary-button" disabled={busy || !catalog} onClick={submit}>
          {busy ? copy.submitting : copy.submit}
        </button>
      </div>
    </div>
  );
}
