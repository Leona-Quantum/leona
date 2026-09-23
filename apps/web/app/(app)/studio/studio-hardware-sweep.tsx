"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import {
  fetchQpuBackends,
  fetchQpuEstimate,
  fetchQpuRun,
  fetchQpuSubmissionGate,
  formatUsd,
  isPricedOnly,
  isUnfinishedRun,
  QpuSubmissionRefused,
  QPU_RUN_POLL_MS,
  submitQpuRun,
  type QpuBackendInfo,
  type QpuCostEstimate,
  type QpuRunRecord,
} from "../../../lib/qpu";
import {
  buildHardwareSweepBindings,
  HARDWARE_SWEEP_MAX_BINDINGS,
  HARDWARE_SWEEP_MIN_BINDINGS,
  type HardwareSweepBinding,
} from "../../../lib/studio-hardware-sweep";
import { sweepAngleSteps, sweepCircuitIssue } from "../../../lib/studio-parameter-sweep";
import { idealProbabilities } from "../../../lib/statevector-kernel";
import { sourceFingerprint } from "../../../lib/studio-simulation";
import type { ParsedBuilderCircuit } from "../../../lib/studio-parse";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";

const DEFAULT_SHOTS = 1024;

/** A Studio parameter sweep submitted to hardware as one job (ai-ops 349).
 * Available exactly where the local ideal sweep is (same circuit, same swept
 * gate), so the two panels share one predicate for "can this circuit sweep at
 * all" and diverge only on what happens to each point once it is built. */
export function StudioHardwareSweep({ circuit, synchronized, complete, sourceCode, locale }: {
  circuit: ParsedBuilderCircuit;
  synchronized: boolean;
  complete: boolean;
  sourceCode: string;
  locale: PublicLocale;
}) {
  const copy = WORKSPACE_COPY[locale].studio.hardwareSweep;
  const id = useId();
  const issue = useMemo(() => sweepCircuitIssue(circuit), [circuit]);
  const gates = useMemo(() => issue ? [] : sweepAngleSteps(circuit), [circuit, issue]);
  const [selectedStepId, setSelectedStepId] = useState("");
  const step = gates.find((item) => item.id === selectedStepId) ?? gates[0] ?? null;
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("360");
  const [pointCount, setPointCount] = useState("5");
  const [shots, setShots] = useState(String(DEFAULT_SHOTS));

  const [backends, setBackends] = useState<QpuBackendInfo[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [gateOpen, setGateOpen] = useState<boolean | null>(null);
  const [selectedDevice, setSelectedDevice] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchQpuBackends(), fetchQpuSubmissionGate()])
      .then(([backendList, gate]) => {
        if (cancelled) return;
        const submittable = backendList.filter((backend) => !isPricedOnly(backend));
        setBackends(submittable);
        setGateOpen(gate.submission_available);
        setSelectedDevice((current) => current || submittable[0]?.device_id || "");
      })
      .catch(() => {
        if (!cancelled) setCatalogError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const parsedPoints = Number(pointCount);
  const parsedShots = Number(shots);
  const validShots = Number.isInteger(parsedShots) && parsedShots >= 1;

  const bindings = useMemo(() => {
    if (!step || !synchronized || !complete || issue) return null;
    const startDegrees = Number(start);
    const endDegrees = Number(end);
    if (!Number.isFinite(startDegrees) || !Number.isFinite(endDegrees) || startDegrees >= endDegrees) return null;
    return buildHardwareSweepBindings({
      circuit, stepId: step.id, startDegrees, endDegrees, points: parsedPoints,
    });
  }, [circuit, step, start, end, parsedPoints, synchronized, complete, issue]);

  const buildIssue = bindings && !Array.isArray(bindings) ? bindings : null;
  const points: HardwareSweepBinding[] | null = bindings && Array.isArray(bindings) ? bindings : null;

  const [estimate, setEstimate] = useState<QpuCostEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState(false);

  useEffect(() => {
    if (!points || !selectedDevice || !validShots) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    setEstimating(true);
    setEstimateError(false);
    fetchQpuEstimate(selectedDevice, parsedShots, { sweepBindings: points.length })
      .then((result) => {
        if (!cancelled) setEstimate(result);
      })
      .catch(() => {
        if (!cancelled) {
          setEstimate(null);
          setEstimateError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setEstimating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [points, selectedDevice, parsedShots, validShots]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [run, setRun] = useState<QpuRunRecord | null>(null);
  const [submittedPoints, setSubmittedPoints] = useState<HardwareSweepBinding[] | null>(null);

  useEffect(() => {
    if (!run || !isUnfinishedRun(run)) return;
    const polledId = run.id;
    let cancelled = false;
    const timer = window.setInterval(() => {
      fetchQpuRun(polledId)
        .then((next) => {
          if (!cancelled) setRun((current) => (current && current.id === polledId ? next : current));
        })
        .catch(() => undefined);
    }, QPU_RUN_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [run]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!points || !selectedDevice || !validShots || !step || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    submitQpuRun({
      device_id: selectedDevice,
      shots: parsedShots,
      qasm: points[0].qasm,
      source_fingerprint: sourceFingerprint(points[0].qasm),
      sweep: {
        parameter_label: `${step.gate} · q${step.qubits.join(", q")}`,
        bindings: points.map((point) => ({ label: point.label, qasm: point.qasm })),
      },
    })
      .then((record) => {
        setRun(record);
        setSubmittedPoints(points);
      })
      .catch((cause: unknown) => {
        setSubmitError(
          cause instanceof QpuSubmissionRefused ? cause.message
            : cause instanceof Error ? cause.message
              : copy.submitFailed,
        );
      })
      .finally(() => setSubmitting(false));
  }

  const measuredQubit = step ? Math.max(0, ...step.qubits) : 0;
  const idealForPoint = (point: HardwareSweepBinding): number => {
    if (!step) return 0;
    const steps = circuit.steps.map((item) => item.id === step.id ? { ...item, param: String(point.angleRadians) } : item);
    const probabilities = idealProbabilities({ qubitCount: circuit.qubitCount, steps });
    let pOne = 0;
    for (let basis = 0; basis < probabilities.length; basis += 1) {
      if ((basis & (1 << measuredQubit)) !== 0) pOne += probabilities[basis];
    }
    return Math.max(0, Math.min(1, pOne));
  };

  const sweepDocument = run?.sweep as { counts?: Array<Record<string, number> | null> } | undefined;
  const resultRows = run && submittedPoints && sweepDocument?.counts
    ? submittedPoints.map((point, index) => {
        const counts = sweepDocument.counts?.[index] ?? null;
        const measuredTotal = counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : 0;
        const measuredOnes = counts
          ? Object.entries(counts).reduce((sum, [bitstring, value]) => {
              const bit = bitstring.trim().replaceAll(" ", "");
              const bitAt = bit.length - 1 - measuredQubit;
              return bitAt >= 0 && bit[bitAt] === "1" ? sum + value : sum;
            }, 0)
          : 0;
        return {
          label: point.label,
          ideal: idealForPoint(point),
          measured: measuredTotal > 0 ? measuredOnes / measuredTotal : null,
          counts,
        };
      })
    : null;

  const canSubmit = Boolean(points && selectedDevice && validShots && gateOpen && !submitting && !run);

  return (
    <details className="mj-sim-details mj-studio-sweep mj-studio-hardware-sweep">
      <summary>{copy.heading}</summary>
      <div className="mj-studio-sweep-body">
        <p>{copy.intro}</p>
        {!complete ? <p role="status">{WORKSPACE_COPY[locale].studio.sweep.incomplete}</p> : null}
        {complete && !synchronized ? <p role="status">{copy.outOfSync}</p> : null}
        {complete && synchronized && issue ? <p role="status">{copy.unavailable[issue]}</p> : null}
        {complete && synchronized && !issue && !step ? <p role="status">{copy.noAngle}</p> : null}
        {complete && synchronized && !issue && step ? (
          <form onSubmit={submit}>
            <div className="mj-studio-sweep-fields">
              <label htmlFor={`${id}-gate`}>{copy.gate}
                <select id={`${id}-gate`} value={step.id} onChange={(event) => setSelectedStepId(event.target.value)} disabled={Boolean(run)}>
                  {gates.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.gate}({item.param}) · q{item.qubits.join(", q")}</option>)}
                </select>
              </label>
              <label htmlFor={`${id}-start`}>{copy.start}<input id={`${id}-start`} type="number" step="any" min={-3600} max={3600} value={start} onChange={(event) => setStart(event.target.value)} disabled={Boolean(run)} required /></label>
              <label htmlFor={`${id}-end`}>{copy.end}<input id={`${id}-end`} type="number" step="any" min={-3600} max={3600} value={end} onChange={(event) => setEnd(event.target.value)} disabled={Boolean(run)} required /></label>
              <label htmlFor={`${id}-points`}>{copy.points}<input id={`${id}-points`} type="number" step={1} min={HARDWARE_SWEEP_MIN_BINDINGS} max={HARDWARE_SWEEP_MAX_BINDINGS} value={pointCount} onChange={(event) => setPointCount(event.target.value)} disabled={Boolean(run)} required /></label>
              <label htmlFor={`${id}-shots`}>{copy.shots}<input id={`${id}-shots`} type="number" step={1} min={1} value={shots} onChange={(event) => setShots(event.target.value)} disabled={Boolean(run)} required /></label>
              <label htmlFor={`${id}-device`}>{copy.device}
                <select id={`${id}-device`} value={selectedDevice} onChange={(event) => setSelectedDevice(event.target.value)} disabled={Boolean(run) || !backends?.length}>
                  {(backends ?? []).map((backend) => <option key={backend.device_id} value={backend.device_id}>{backend.display_name}</option>)}
                </select>
              </label>
            </div>

            {catalogError ? <p role="alert">{copy.catalogUnavailable}</p> : null}
            {!catalogError && !backends ? <p role="status">{copy.catalogLoading}</p> : null}
            {backends && backends.length === 0 ? <p role="status">{copy.noSubmittableDevice}</p> : null}
            {gateOpen === false ? <p role="status">{copy.gateClosed}</p> : null}
            {buildIssue ? <p role="status">{copy.unavailable[buildIssue]}</p> : null}

            {points ? (
              <div className="mj-studio-hardware-sweep-preview">
                <h4>{copy.previewHeading}</h4>
                {estimating ? <p role="status">{copy.previewing}</p> : null}
                {estimateError ? <p role="alert">{copy.previewFailed}</p> : null}
                {estimate ? (
                  estimate.total_usd !== null ? (
                    <dl className="mj-studio-contract">
                      <div><dt>{copy.previewPerPoint(formatUsd(estimate.total_usd / points.length))}</dt><dd /></div>
                      <div><dt><strong>{copy.previewTotal(formatUsd(estimate.total_usd))}</strong></dt><dd /></div>
                      <div><dt>{copy.previewTotalShots(points.length, ((estimate.total_shots ?? estimate.shots * points.length)).toLocaleString("en-US"))}</dt><dd /></div>
                    </dl>
                  ) : (
                    <p>{copy.previewAllowance}</p>
                  )
                ) : null}
              </div>
            ) : null}

            <button type="submit" className="mj-primary-button" disabled={!canSubmit}>
              {submitting ? copy.submitting : copy.submit}
            </button>
            {submitError ? <p role="alert">{submitError}</p> : null}
          </form>
        ) : null}

        {run ? (
          <div className="mj-studio-hardware-sweep-run" role="status">
            <p>
              {run.status === "queued" ? copy.jobQueued
                : run.status === "running" ? copy.jobRunning
                  : run.status === "done" ? copy.jobDone
                    : run.error ? copy.jobError(run.error) : run.status}
            </p>
            {resultRows ? (
              <div className="mj-studio-sweep-table-wrap">
                <h4>{copy.resultHeading}</h4>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{copy.resultLabelColumn}</th>
                      <th scope="col">{copy.resultIdealColumn}</th>
                      <th scope="col">{copy.resultMeasuredColumn}</th>
                      <th scope="col">{copy.resultCountsColumn}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultRows.map((row, index) => (
                      <tr key={index}>
                        <td>{row.label}</td>
                        <td>{row.ideal.toFixed(6)}</td>
                        <td>{row.measured === null ? "—" : row.measured.toFixed(6)}</td>
                        <td>{row.counts ? Object.entries(row.counts).map(([bits, count]) => `${bits}: ${count}`).join(", ") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="mj-studio-simulation-boundary">{copy.boundary}</p>
      </div>
    </details>
  );
}
