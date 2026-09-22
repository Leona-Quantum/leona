"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { QpuBackendInfo, QpuPublishedErrorFigure, QpuPublishedNoiseProfile } from "../../../lib/qpu";
import {
  PreparedCircuitCache,
  estimateDevice,
  finishPreview,
  preparedCircuitKey,
  scheduleAfterPaint,
  type DeviceEstimate,
  type MissingFigure,
  type NoisyPreview,
  type PreparedCircuit,
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
  // The circuit half (a full statevector simulation, close to a second at the
  // 20-qubit tier) never runs during render: it would freeze Studio for that
  // long on every new circuit. It runs in an effect, one macrotask after the
  // next paint, so the placeholder below reaches the screen first. The result
  // is cached by program text and limit VALUES, every dependency is a
  // primitive or a memo of primitives, and the component is memo()'d, so
  // nothing else in Studio re-rendering can start it again.
  const qubitLimit = limits.cpuSimQubits;
  const operationLimit = limits.cpuSimOperations;
  const parseLimits = useMemo(
    () => ({ cpuSimQubits: qubitLimit, cpuSimOperations: operationLimit }),
    [qubitLimit, operationLimit],
  );
  const key = preparedCircuitKey(qasm, parseLimits);
  const [computed, setComputed] = useState<{ key: string; prepared: PreparedCircuit } | null>(null);
  const prepared = !wantsCircuit
    ? null
    : computed?.key === key
      ? computed.prepared
      : PREPARED_CIRCUITS.peek(qasm, parseLimits) ?? null;
  const needsWork = wantsCircuit && prepared === null;

  useEffect(() => {
    if (!needsWork) return;
    // A newer circuit, or unmounting, cancels a run that has not started. A
    // run that already finished is cached and tagged with its own key, and the
    // render above ignores a result whose key is not the current one.
    return scheduleAfterPaint(() => {
      setComputed({ key: preparedCircuitKey(qasm, parseLimits), prepared: PREPARED_CIRCUITS.getOrPrepare(qasm, parseLimits) });
    });
  }, [needsWork, qasm, parseLimits]);

  // The device half stays in render as memos. It is cheap for one machine
  // (about 27 ms at 20 qubits, measured in Node) and grows with the number of
  // machines. Two memos rather than one, so typing a shot count reruns only
  // the shot-noise pass, never the per-machine estimates.
  const device = useMemo((): DeviceEstimate | null => {
    if (!noise) return null;
    if (!wantsCircuit) return { status: "unavailable", reason: "not_gate_model" };
    return prepared ? estimateDevice({ prepared, noise }) : null;
  }, [prepared, noise, wantsCircuit]);
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
