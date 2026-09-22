"use client";

import { useMemo } from "react";
import type { QpuBackendInfo, QpuPublishedErrorFigure, QpuPublishedNoiseProfile } from "../../../lib/qpu";
import { prepareCircuitForPreview, previewPreparedRun, type MissingFigure, type NoisyPreview } from "../../../lib/qpu-noise";
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
 * The hardware panel's "before you pay" estimate: what the chosen device's
 * published error figures predict for the circuit that would be submitted.
 * `previewNoisyRun` (lib/qpu-noise.ts) is a pure function of its arguments,
 * so this renders a local estimate, not a call to any server and not a
 * prediction of a specific run. It renders nothing for an API that predates
 * `published_noise`, since absence there means "not sent", not "no noise".
 */
export function QpuNoisyPreview({
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
  // Two memos, because the first is a full statevector simulation (close to
  // a second at the 20-qubit tier) and depends only on the circuit, while the
  // second reruns whenever the device or the shot count changes. Keyed on
  // `gate_model` rather than on the device, so moving between gate devices
  // does not simulate the circuit again.
  const wantsCircuit = Boolean(noise?.gate_model);
  const prepared = useMemo(
    () => (wantsCircuit ? prepareCircuitForPreview(qasm, limits) : null),
    [wantsCircuit, qasm, limits],
  );
  const preview = useMemo((): NoisyPreview | null => {
    if (!noise) return null;
    // `prepared` is null exactly when the device is not a gate device.
    if (!prepared) return { status: "unavailable", reason: "not_gate_model" };
    return previewPreparedRun({ prepared, noise, shots });
  }, [prepared, noise, shots]);
  if (!preview) return null;

  const title = copy.hardwarePreviewTitle(backend.access);
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
      <span className="mj-section-label">{copy.hardwarePreviewFigures(shown.machine)}</span>
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
