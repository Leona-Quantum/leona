"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { QpuBackendInfo, QpuPublishedErrorFigure, QpuPublishedNoise, QpuPublishedNoiseProfile } from "../../../lib/qpu";
import {
  PreparedCircuitCache,
  deviceEstimateFor,
  finishPreview,
  peekDeviceEstimate,
  preparedCircuitKey,
  scheduleAfterPaint,
  type DeviceEstimate,
  type MissingFigure,
  type NoisyPreview,
} from "../../../lib/qpu-noise";
import { formatShare } from "../../../lib/simulation-visual";
import type { CpuSimulationLimits } from "../../../lib/studio-simulation";
import type { PublicLocale } from "../../../lib/public-locale";
import type { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

const FIGURE_FIELDS: { kind: MissingFigure; field: keyof Omit<QpuPublishedNoiseProfile, "machine"> }[] = [
  { kind: "two_qubit", field: "two_qubit_gate_error" },
  { kind: "one_qubit", field: "one_qubit_gate_error" },
  { kind: "readout", field: "readout_error" },
];

/**
 * Prepared circuits (parse, gate tally, ideal distribution), shared by every
 * mount of the preview. Three entries bound the memory at 3 x 8 MB at the
 * 20-qubit tier and cover the realistic case: a person moving between a
 * couple of saved versions.
 */
const PREPARED_CIRCUITS = new PreparedCircuitCache(3);

const NOT_GATE_MODEL: DeviceEstimate = { status: "unavailable", reason: "not_gate_model" };

/**
 * The hardware panel's "before you pay" estimate: what the chosen device's
 * published error figures predict for the circuit that would be submitted.
 * Everything it renders comes from pure functions in lib/qpu-noise.ts, so
 * this is a local estimate, not a call to any server and not a
 * prediction of a specific run. It renders nothing for an API that predates
 * `published_noise`, since absence there means "not sent", not "no noise".
 */
export const QpuNoisyPreview = memo(QpuNoisyPreviewPanel);

function QpuNoisyPreviewPanel({
  backend,
  qasm,
  shots,
  limits,
  copy,
}: {
  backend: QpuBackendInfo;
  qasm: string;
  shots: number;
  limits: CpuSimulationLimits;
  copy: StudioCopy;
}) {
  const noise = backend.published_noise ?? null;
  const wantsCircuit = Boolean(noise?.gate_model);
  // Nothing expensive runs during render. The circuit half (a full statevector
  // simulation, 720 ms at 20 qubits and 400 gates in headless Chromium) and the
  // device half (210 ms for IBM's seven candidate machines at the same size)
  // run in an effect, one macrotask after the next paint, so the placeholder
  // below reaches the screen first. Both are cached: circuits by program text
  // and limit VALUES, device estimates per circuit and noise object. Render
  // only reads those caches, every dependency is a primitive, a memo of
  // primitives, or a catalog object that keeps its identity, and the component
  // is memo()'d, so nothing else in Studio re-rendering starts any of it again.
  const qubitLimit = limits.cpuSimQubits;
  const operationLimit = limits.cpuSimOperations;
  const parseLimits = useMemo(
    () => ({ cpuSimQubits: qubitLimit, cpuSimOperations: operationLimit }),
    [qubitLimit, operationLimit],
  );
  const circuitKey = preparedCircuitKey(qasm, parseLimits);
  const [computed, setComputed] = useState<{ circuitKey: string; noise: QpuPublishedNoise; device: DeviceEstimate } | null>(null);

  let device: DeviceEstimate | null = null;
  if (noise && !wantsCircuit) {
    device = NOT_GATE_MODEL;
  } else if (noise) {
    if (computed?.circuitKey === circuitKey && computed.noise === noise) {
      device = computed.device;
    } else {
      const cachedCircuit = PREPARED_CIRCUITS.peek(qasm, parseLimits);
      device = cachedCircuit ? peekDeviceEstimate(cachedCircuit, noise) ?? null : null;
    }
  }
  const needsWork = noise !== null && wantsCircuit && device === null;

  useEffect(() => {
    if (!needsWork || !noise) return;
    // A newer circuit or device, or unmounting, cancels a run that has not
    // started. A run that already finished is cached and tagged with its own
    // circuit and noise, and the render above ignores one that does not match.
    return scheduleAfterPaint(() => {
      const prepared = PREPARED_CIRCUITS.getOrPrepare(qasm, parseLimits);
      setComputed({ circuitKey: preparedCircuitKey(qasm, parseLimits), noise, device: deviceEstimateFor(prepared, noise) });
    });
  }, [needsWork, qasm, parseLimits, noise]);

  // Only the shot-noise pass reads `shots`, so typing a shot count reruns one
  // pass over the ideal distribution and never the per-machine estimates.
  const preview = useMemo((): NoisyPreview | null => (device ? finishPreview(device, shots) : null), [device, shots]);

  const title = copy.hardwarePreviewTitle(backend.access);
  if (!noise) return null;
  if (!preview) {
    return (
      <div className="mj-qpu-ideal mj-qpu-preview" aria-busy="true">
        <span className="mj-section-label">{title}</span>
        <p className="mj-qpu-note" role="status">{copy.hardwarePreviewComputing}</p>
      </div>
    );
  }
  if (preview.status === "unavailable") {
    return (
      <div className="mj-qpu-ideal mj-qpu-preview">
        <span className="mj-section-label">{title}</span>
        <p className="mj-qpu-note">{copy.hardwarePreviewUnavailable(preview.reason)}</p>
      </div>
    );
  }

  const { shown } = preview;
  const share = preview.shareTowardNoise === null ? "" : `${Math.round(preview.shareTowardNoise * 100)}%`;
  const showOther = preview.otherIdealShare > 0 || preview.otherEstimatedShare > 0;

  return (
    <div className="mj-qpu-ideal mj-qpu-preview">
      <span className="mj-section-label">{title}</span>
      <dl className="mj-studio-contract">
        <div>
          <dt>{copy.hardwarePreviewTvd}</dt>
          <dd>{shown.tvd.toFixed(3)}</dd>
        </div>
        <div>
          <dt>{copy.hardwarePreviewUniform}</dt>
          <dd>{preview.uniformTvd.toFixed(3)}</dd>
        </div>
      </dl>
      <p className="mj-qpu-note">{copy.hardwarePreviewReading(preview.reading, share, preview.shots.toLocaleString("en-US"))}</p>
      {preview.machineChosenAtSubmit && preview.machines.length > 1 ? (
        <p className="mj-qpu-note">
          {copy.hardwarePreviewRange(
            preview.machines.length,
            preview.tvdRange.min.toFixed(3),
            preview.tvdRange.max.toFixed(3),
            shown.machine,
          )}
        </p>
      ) : null}
      <table className="mj-qpu-ideal-table">
        <thead>
          <tr>
            <th>{copy.hardwareIdealBitstring}</th>
            <th>{copy.hardwareIdealIdealShare}</th>
            <th>{copy.hardwarePreviewEstimated}</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr key={row.bitstring}>
              <td><code>{row.bitstring}</code></td>
              <td>{formatShare(row.idealShare, "en-US")}</td>
              <td>{formatShare(row.estimatedShare, "en-US")}</td>
            </tr>
          ))}
          {showOther ? (
            <tr>
              <td>{copy.hardwareIdealOtherOutcomes}</td>
              <td>{formatShare(preview.otherIdealShare, "en-US")}</td>
              <td>{formatShare(preview.otherEstimatedShare, "en-US")}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="mj-qpu-note">
        {copy.hardwarePreviewGates(
          preview.tally.twoQubit.toLocaleString("en-US"),
          preview.tally.oneQubit.toLocaleString("en-US"),
          preview.tally.measuredQubits,
        )}
      </p>
      {/* A note, not a .mj-section-label: that class uppercases, and a backend
          name like ibm_miami is an identifier that must read as written. */}
      <p className="mj-qpu-note">{copy.hardwarePreviewFigures(shown.machine)}</p>
      <ul className="mj-qpu-figures">
        {FIGURE_FIELDS.map(({ kind, field }) => (
          <li key={kind}>
            <FigureLine label={copy.hardwarePreviewFigureLabel(kind)} figure={shown.profile[field]} copy={copy} />
          </li>
        ))}
      </ul>
      {preview.machines.length > 1 ? (
        <details className="mj-qpu-machines">
          <summary>{copy.hardwarePreviewMachines}</summary>
          <ul className="mj-qpu-figures">
            {preview.machines.map((machine) => (
              <li key={machine.machine}>{machine.machine}: {machine.tvd.toFixed(3)}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mj-qpu-note">{copy.hardwarePreviewCaveat}</p>
    </div>
  );
}

function FigureLine({ label, figure, copy }: { label: string; figure: QpuPublishedErrorFigure | null; copy: StudioCopy }) {
  if (!figure) return <>{label}: {copy.hardwarePreviewNotPublished}</>;
  return (
    <>
      <span title={figure.published_as}>
        {label}: {formatErrorRate(figure.value)} {copy.hardwarePreviewFigureMeta(copy.hardwarePreviewStatistic(figure.statistic), figure.read_on)}
      </span>{" "}
      <a href={figure.source_url} target="_blank" rel="noreferrer">{copy.hardwarePreviewSource} ↗</a>
    </>
  );
}

/** A per-operation error as a percentage to two significant figures: 0.0049
 * reads as 0.49%, 0.00034 as 0.034%. */
function formatErrorRate(value: number): string {
  return `${Number((value * 100).toPrecision(2))}%`;
}
