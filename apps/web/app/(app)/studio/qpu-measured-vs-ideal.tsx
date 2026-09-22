"use client";

import { useMemo } from "react";
import { compareMeasuredToIdeal } from "../../../lib/qpu-ideal";
import { mitigatedReadings, type MitigatedReadings } from "../../../lib/qpu-mitigation";
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
 *
 * The mitigated readings (lib/qpu-mitigation.ts, proposal 5 increment 4) sit
 * BESIDE the raw one and never replace it: the raw distance and the raw counts
 * are always shown, and a correction that cannot be made says why instead of
 * falling back to anything.
 */
export function QpuMeasuredVsIdeal({
  qasm,
  submittedFingerprint,
  counts,
  mitigation,
  limits,
  copy,
}: {
  qasm: string;
  submittedFingerprint: string;
  counts: Record<string, number> | null;
  /** The run's stored `mitigation` document, read through `readMitigation`. */
  mitigation?: unknown;
  limits: CpuSimulationLimits;
  copy: StudioCopy;
}) {
  const comparison = useMemo(
    () => compareMeasuredToIdeal({ qasm, submittedFingerprint, counts, limits }),
    [qasm, submittedFingerprint, counts, limits],
  );
  const readings = useMemo<MitigatedReadings | null>(
    () =>
      comparison.status === "computed" && counts
        ? mitigatedReadings({ ideal: comparison.ideal, qubitCount: comparison.qubitCount, rawCounts: counts, mitigation })
        : null,
    [comparison, counts, mitigation],
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
  const corrected = readings?.readout.status === "computed" ? readings.readout.reading.distribution : null;
  const extrapolated = readings?.zne?.status === "computed" ? readings.zne.reading.richardson.distribution : null;
  const shareAt = (distribution: Float64Array, bitstring: string) => distribution[Number.parseInt(bitstring, 2)] ?? 0;

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
        {copy.hardwareIdealShotNoise(comparison.shotNoiseTvd.toFixed(3), comparison.shots.toLocaleString("en-US"))}
      </p>
      {readings ? <QpuMitigatedReadings readings={readings} copy={copy} /> : null}
      {/* Scrolls on its own at phone width once the mitigated columns are in,
          so the page itself never scrolls sideways. */}
      <div className="mj-qpu-ideal-scroll">
        <table className="mj-qpu-ideal-table">
          <thead>
            <tr>
              <th>{copy.hardwareIdealBitstring}</th>
              <th>{copy.hardwareIdealMeasuredShare}</th>
              {corrected ? <th>{copy.hardwareReadoutCorrectedShare}</th> : null}
              {/* The table's ZNE column is the Richardson fit; its heading says so. */}
              {extrapolated ? <th>{copy.hardwareZneRichardson}</th> : null}
              <th>{copy.hardwareIdealIdealShare}</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.bitstring}>
                <td><code>{row.bitstring}</code></td>
                <td>{formatShare(row.measuredShare, "en-US")}</td>
                {corrected ? <td>{formatShare(shareAt(corrected, row.bitstring), "en-US")}</td> : null}
                {extrapolated ? <td>{formatShare(shareAt(extrapolated, row.bitstring), "en-US")}</td> : null}
                <td>{formatShare(row.idealShare, "en-US")}</td>
              </tr>
            ))}
            {showOther ? (
              <tr>
                <td>{copy.hardwareIdealOtherOutcomes}</td>
                <td>{formatShare(comparison.otherMeasuredShare, "en-US")}</td>
                {corrected ? <td>{formatShare(otherShare(corrected, comparison.rows), "en-US")}</td> : null}
                {extrapolated ? <td>{formatShare(otherShare(extrapolated, comparison.rows), "en-US")}</td> : null}
                <td>{formatShare(comparison.otherIdealShare, "en-US")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mj-qpu-note">{copy.hardwareIdealProvenance}</p>
    </div>
  );
}

/** The share of a distribution outside the rows the table shows. */
function otherShare(distribution: Float64Array, rows: readonly { bitstring: string }[]): number {
  const shown = rows.reduce((sum, row) => sum + (distribution[Number.parseInt(row.bitstring, 2)] ?? 0), 0);
  return Math.min(1, Math.max(0, 1 - shown));
}

/**
 * Readout correction and, when the run asked for it, zero-noise extrapolation,
 * each as a distance to the same ideal the raw reading above is measured
 * against. Both fits are shown for ZNE because their disagreement is the most
 * honest error bar this panel can offer.
 */
function QpuMitigatedReadings({ readings, copy }: { readings: MitigatedReadings; copy: StudioCopy }) {
  const { readout, zne } = readings;
  return (
    <div className="mj-qpu-mitigation">
      <span className="mj-section-label">{copy.hardwareMitigationHeading}</span>
      {readout.status === "computed" ? (
        <>
          <dl className="mj-studio-contract">
            <div>
              <dt>{`${copy.hardwareReadoutCorrected} · ${copy.hardwareIdealTvd}`}</dt>
              <dd>{readout.reading.tvd.toFixed(3)}</dd>
            </div>
            <div>
              <dt>{`${copy.hardwareReadoutCorrected} · ${copy.hardwareIdealFidelity}`}</dt>
              <dd>{readout.reading.hellingerFidelity.toFixed(3)}</dd>
            </div>
          </dl>
          {/* Separate paragraphs rather than one joined string: English joins
              sentences with a space and Japanese does not. */}
          <p className="mj-qpu-note">{copy.hardwareReadoutGloss}</p>
          {readout.calibratedAt ? (
            <p className="mj-qpu-note">{copy.hardwareReadoutCalibratedAt(formatCalibration(readout.calibratedAt))}</p>
          ) : null}
          {readout.symmetric ? <p className="mj-qpu-note">{copy.hardwareReadoutSymmetric}</p> : null}
        </>
      ) : (
        <p className="mj-qpu-note">{copy.hardwareMitigationUnavailable(readout.reason)}</p>
      )}
      {zne === null ? null : zne.status === "computed" ? (
        <>
          <dl className="mj-studio-contract">
            <div>
              <dt>{`${copy.hardwareZneRichardson} · ${copy.hardwareIdealTvd}`}</dt>
              <dd>{zne.reading.richardson.tvd.toFixed(3)}</dd>
            </div>
            <div>
              <dt>{`${copy.hardwareZneLinear} · ${copy.hardwareIdealTvd}`}</dt>
              <dd>{zne.reading.linear.tvd.toFixed(3)}</dd>
            </div>
          </dl>
          <p className="mj-qpu-note">{copy.hardwareZneGloss}</p>
          {/* The larger of the two fits' clipped mass: either one going below
              zero is the overshoot the gloss warns about. */}
          {Math.max(zne.reading.richardson.clippedMass, zne.reading.linear.clippedMass) > 0 ? (
            <p className="mj-qpu-note">
              {copy.hardwareZneClipped(
                formatShare(Math.max(zne.reading.richardson.clippedMass, zne.reading.linear.clippedMass), "en-US"),
              )}
            </p>
          ) : null}
          {zne.reading.twoQubitGates && zne.reading.twoQubitGates.length === 3 ? (
            <p className="mj-qpu-note">
              {copy.hardwareZneGates(
                ...(zne.reading.twoQubitGates.map((count) => count.toLocaleString("en-US")) as [string, string, string]),
              )}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mj-qpu-note">{copy.hardwareMitigationUnavailable(zne.reason)}</p>
      )}
      <p className="mj-qpu-note">{copy.hardwareMitigationNote}</p>
    </div>
  );
}

/** The calibration date as a date, in UTC, since IBM stamps it with an offset. */
function formatCalibration(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}
