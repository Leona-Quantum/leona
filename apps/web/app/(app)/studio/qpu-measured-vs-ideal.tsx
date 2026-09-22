"use client";

import { useMemo } from "react";
import { compareMeasuredToIdeal } from "../../../lib/qpu-ideal";
import { formatShare } from "../../../lib/simulation-visual";
import type { CpuSimulationLimits } from "../../../lib/studio-simulation";
import type { PublicLocale } from "../../../lib/public-locale";
import type { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

/**
 * The hardware panel's "measured against ideal" readout. Everything here runs
 * in this component alone — `compareMeasuredToIdeal` (lib/qpu-ideal.ts) is a
 * pure function of its arguments, so this is a local reading of the exact
 * circuit that was submitted, not a second verification pass and not a call
 * to any server.
 */
export function QpuMeasuredVsIdeal({
  qasm,
  submittedFingerprint,
  counts,
  limits,
  copy,
}: {
  qasm: string;
  submittedFingerprint: string;
  counts: Record<string, number> | null;
  limits: CpuSimulationLimits;
  copy: StudioCopy;
}) {
  const comparison = useMemo(
    () => compareMeasuredToIdeal({ qasm, submittedFingerprint, counts, limits }),
    [qasm, submittedFingerprint, counts, limits],
  );

  if (comparison.status === "unavailable") {
    return (
      <div className="mj-qpu-ideal">
        <span className="mj-section-label">{copy.hardwareIdealComparison}</span>
        <p className="mj-qpu-note">{copy.hardwareIdealUnavailable(comparison.reason)}</p>
      </div>
    );
  }

  const showOther = comparison.otherMeasuredShare > 0 || comparison.otherIdealShare > 0;

  return (
    <div className="mj-qpu-ideal">
      <span className="mj-section-label">{copy.hardwareIdealComparison}</span>
      <dl className="mj-studio-contract">
        <div>
          <dt>{copy.hardwareIdealTvd}</dt>
          <dd>{comparison.tvd.toFixed(3)}</dd>
        </div>
        <div>
          <dt>{copy.hardwareIdealFidelity}</dt>
          <dd>{comparison.hellingerFidelity.toFixed(3)}</dd>
        </div>
      </dl>
      <p className="mj-qpu-note">{copy.hardwareIdealTvdGloss}</p>
      <p className="mj-qpu-note">
        {copy.hardwareIdealShotNoise(formatShare(comparison.shotNoiseTvd, "en-US"), comparison.shots.toLocaleString("en-US"))}
      </p>
      <table className="mj-qpu-ideal-table">
        <thead>
          <tr>
            <th>{copy.hardwareIdealBitstring}</th>
            <th>{copy.hardwareIdealMeasuredShare}</th>
            <th>{copy.hardwareIdealIdealShare}</th>
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row) => (
            <tr key={row.bitstring}>
              <td><code>{row.bitstring}</code></td>
              <td>{formatShare(row.measuredShare, "en-US")}</td>
              <td>{formatShare(row.idealShare, "en-US")}</td>
            </tr>
          ))}
          {showOther ? (
            <tr>
              <td>{copy.hardwareIdealOtherOutcomes}</td>
              <td>{formatShare(comparison.otherMeasuredShare, "en-US")}</td>
              <td>{formatShare(comparison.otherIdealShare, "en-US")}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="mj-qpu-note">{copy.hardwareIdealProvenance}</p>
    </div>
  );
}
