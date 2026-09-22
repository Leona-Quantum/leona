"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { simulator } from "../../../lib/simulator-client";
import { sourceFingerprint } from "../../../lib/studio-simulation";
import {
  parameterSweepCsv,
  sweepAngleSteps,
  sweepCircuitIssue,
  SWEEP_MAX_POINTS,
  SWEEP_MAX_WORK,
  SWEEP_MIN_POINTS,
  type ParameterSweepResult,
} from "../../../lib/studio-parameter-sweep";
import type { ParsedBuilderCircuit } from "../../../lib/studio-parse";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";

/** Studio's reproducible, local angle experiment. It never changes the circuit. */
export function StudioParameterSweep({ circuit, synchronized, complete, sourceCode, locale, onOpenVisual }: {
  circuit: ParsedBuilderCircuit;
  synchronized: boolean;
  complete: boolean;
  sourceCode: string;
  locale: PublicLocale;
  onOpenVisual: () => void;
}) {
  const copy = WORKSPACE_COPY[locale].studio.sweep;
  const id = useId();
  const consumer = `studio-parameter-sweep:${id}`;
  const issue = useMemo(() => sweepCircuitIssue(circuit), [circuit]);
  const gates = useMemo(() => issue ? [] : sweepAngleSteps(circuit), [circuit, issue]);
  const [selectedStepId, setSelectedStepId] = useState("");
  const step = gates.find((item) => item.id === selectedStepId) ?? gates[0] ?? null;
  const [measuredQubit, setMeasuredQubit] = useState(0);
  const qubit = Math.min(measuredQubit, circuit.qubitCount - 1);
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("360");
  const [pointCount, setPointCount] = useState("25");
  const [busy, setBusy] = useState(false);
  const runningRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{ key: string; result: ParameterSweepResult } | null>(null);
  const fingerprint = sourceFingerprint(sourceCode);
  const key = JSON.stringify([fingerprint, circuit, synchronized, complete, step?.id, qubit, start, end, pointCount]);
  const keyRef = useRef(key);
  keyRef.current = key;
  const result = completed?.key === key ? completed.result : null;
  const parsedPoints = Number(pointCount);
  const tooLarge = Number.isInteger(parsedPoints)
    && 2 ** circuit.qubitCount * Math.max(circuit.steps.length, 1) * parsedPoints > SWEEP_MAX_WORK;

  useEffect(() => {
    setBusy(false);
    setError(null);
    return () => {
      simulator.cancel(consumer);
      runningRef.current = false;
    };
  }, [consumer, key]);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!synchronized || !complete || issue || !step || tooLarge || runningRef.current) return;
    const startDegrees = Number(start);
    const endDegrees = Number(end);
    const points = Number(pointCount);
    if (!Number.isFinite(startDegrees) || !Number.isFinite(endDegrees)
      || Math.abs(startDegrees) > 3600 || Math.abs(endDegrees) > 3600 || startDegrees >= endDegrees
      || !Number.isInteger(points) || points < SWEEP_MIN_POINTS || points > SWEEP_MAX_POINTS) {
      setError(locale === "ja" ? "角度の範囲と点数を確認してください。" : "Check the angle range and point count.");
      return;
    }
    const runKey = key;
    runningRef.current = true;
    setBusy(true);
    setError(null);
    const outcome = await simulator.run(consumer, {
      kind: "parameter_sweep",
      request: { circuit, stepId: step.id, measuredQubit: qubit, startDegrees, endDegrees, points },
    });
    if (keyRef.current !== runKey) return;
    runningRef.current = false;
    setBusy(false);
    if (outcome.status === "done") setCompleted({ key: runKey, result: outcome.result });
    else if (outcome.status === "failed") setError(outcome.error);
    else if (outcome.status === "timed_out") setError(copy.timedOut);
  }

  function download(format: "csv" | "json") {
    if (!result) return;
    const content = format === "csv"
      ? parameterSweepCsv(result, fingerprint)
      : JSON.stringify({
          schema: "leona.studio.parameter_sweep.v1",
          model: "exact_ideal_statevector",
          sourceFingerprint: fingerprint,
          sourceCode,
          circuit: result.circuit,
          variedGate: { stepId: result.stepId, gate: result.gate, originalAngle: result.originalAngle },
          measuredQubit: result.measuredQubit,
          angleUnit: "degrees",
          rows: result.rows,
          evidence: "local_exploration_only",
        }, null, 2) + "\n";
    const objectUrl = URL.createObjectURL(new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `leona-parameter-sweep-${fingerprint}.${format}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  const plot = result ? result.rows.map((row, index) => `${40 + 530 * index / (result.rows.length - 1)},${135 - 110 * row.pOne}`).join(" ") : "";

  return (
    <details className="mj-sim-details mj-studio-sweep">
      <summary>{copy.heading}</summary>
      <div className="mj-studio-sweep-body">
        <p>{copy.intro}</p>
        {!complete ? <p role="status">{copy.incomplete}</p> : null}
        {!synchronized ? <p role="status">{copy.outOfSync} <button type="button" className="mj-text-button" onClick={onOpenVisual}>{copy.openVisual} →</button></p> : null}
        {complete && synchronized && issue ? <p role="status">{copy.unavailable[issue]}</p> : null}
        {complete && synchronized && !issue && !step ? <p role="status">{copy.noAngle} <button type="button" className="mj-text-button" onClick={onOpenVisual}>{copy.openVisual} →</button></p> : null}
        {complete && synchronized && !issue && step ? (
          <form onSubmit={(event) => void run(event)}>
            <div className="mj-studio-sweep-fields">
              <label htmlFor={`${id}-gate`}>{copy.gate}
                <select id={`${id}-gate`} value={step.id} onChange={(event) => setSelectedStepId(event.target.value)}>
                  {gates.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.gate}({item.param}) · q{item.qubits.join(", q")}</option>)}
                </select>
              </label>
              <label htmlFor={`${id}-qubit`}>{copy.qubit}
                <select id={`${id}-qubit`} value={qubit} onChange={(event) => setMeasuredQubit(Number(event.target.value))}>
                  {Array.from({ length: circuit.qubitCount }, (_, index) => <option key={index} value={index}>q{index}</option>)}
                </select>
              </label>
              <label htmlFor={`${id}-start`}>{copy.start}<input id={`${id}-start`} type="number" step="any" min={-3600} max={3600} value={start} onChange={(event) => setStart(event.target.value)} required /></label>
              <label htmlFor={`${id}-end`}>{copy.end}<input id={`${id}-end`} type="number" step="any" min={-3600} max={3600} value={end} onChange={(event) => setEnd(event.target.value)} required /></label>
              <label htmlFor={`${id}-points`}>{copy.points}<input id={`${id}-points`} type="number" step={1} min={SWEEP_MIN_POINTS} max={SWEEP_MAX_POINTS} value={pointCount} onChange={(event) => setPointCount(event.target.value)} required /></label>
            </div>
            {tooLarge ? <p role="status">{copy.tooLarge}</p> : null}
            <button type="submit" className="mj-secondary-button" disabled={busy || tooLarge}>{busy ? copy.running : copy.run}</button>
          </form>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <p className="mj-studio-simulation-boundary">{copy.boundary}</p>
        {result ? (
          <div className="mj-studio-sweep-result">
            <div className="mj-studio-sweep-result-head">
              <strong role="status">{result.gate} · q{result.measuredQubit} · {result.rows.length} {copy.points.toLowerCase()}</strong>
              <div>
                <button type="button" className="mj-secondary-button" onClick={() => download("csv")}>{copy.downloadCsv}</button>
                <button type="button" className="mj-secondary-button" onClick={() => download("json")}>{copy.downloadJson}</button>
              </div>
            </div>
            <svg className="mj-studio-sweep-chart" viewBox="0 0 600 160" role="img" aria-label={copy.chart}>
              <title>{copy.chart}</title>
              <line x1="40" y1="25" x2="570" y2="25" />
              <line x1="40" y1="80" x2="570" y2="80" />
              <line x1="40" y1="135" x2="570" y2="135" />
              <polyline points={plot} />
              <text x="2" y="29">1</text><text x="2" y="84">.5</text><text x="2" y="139">0</text>
              <text x="40" y="156">{result.startDegrees}°</text>
              <text x="570" y="156" textAnchor="end">{result.endDegrees}°</text>
            </svg>
            <div className="mj-studio-sweep-table-wrap">
              <table>
                <caption>{copy.chart}</caption>
                <thead><tr><th scope="col">{copy.angleColumn}</th><th scope="col">{copy.probabilityColumn}</th><th scope="col">{copy.expectationColumn}</th></tr></thead>
                <tbody>{result.rows.map((row, index) => <tr key={index}><td>{row.angleDegrees.toFixed(2)}</td><td>{row.pOne.toFixed(6)}</td><td>{row.zExpectation.toFixed(6)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
