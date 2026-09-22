"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { IdealComparison } from "../../../lib/qpu-ideal";
import type { MitigatedReadings } from "../../../lib/qpu-mitigation";
import { formatShare } from "../../../lib/simulation-visual";
import { simulator } from "../../../lib/simulator-client";
import type { CpuSimulationLimits } from "../../../lib/studio-simulation";
import type { PublicLocale } from "../../../lib/public-locale";
import type { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

/** A comparison whose job threw in the simulator: the kernel refusing the
 * circuit, which is what `unparsable` already tells the reader. */
const COULD_NOT_COMPARE: IdealComparison = { status: "unavailable", reason: "unparsable" };

/** A comparison the simulator stopped at its time budget. */
const TIMED_OUT: IdealComparison = { status: "unavailable", reason: "timed_out" };

/**
 * The hardware panel's "measured against ideal" readout. Everything here runs
 * in this component alone — `compareMeasuredToIdeal` (lib/qpu-ideal.ts) is a
 * pure function of its arguments, so this is a local reading of the exact
 * circuit that was submitted, not a second verification pass and not a call
 * to any server.
 *
 * `comparison`, when given, is used as-is instead of being computed here. The
 * hardware-runs page passes the one it already worked out off the render path
 * (`workThroughComparisons`); Studio's single run computes its own, in the
 * simulator worker (lib/simulator-client.ts), and shows `workingOut` until it
 * arrives. It used to compute it during render, which at the 20-qubit tier
 * froze Studio for a second or more whenever the panel was handed a new job
 * or new counts.
 *
 * `readings` works the same way for the mitigated readings (proposal 5,
 * increment 4). Where they are not handed over, they come from the same
 * worker job as the comparison (`compare_mitigated`): they need the dense
 * ideal distribution, which stays in the worker, and they sit BESIDE the raw
 * reading, never replacing it. A correction that cannot be made says why
 * instead of falling back to anything.
 */
export function QpuMeasuredVsIdeal({
  qasm,
  submittedFingerprint,
  counts,
  mitigation,
  limits,
  copy,
  workingOut,
  comparison: precomputed,
  readings: precomputedReadings,
}: {
  qasm: string;
  submittedFingerprint: string;
  counts: Record<string, number> | null;
  /** The run's stored `mitigation` document, read through `readMitigation`. */
  mitigation?: unknown;
  limits: CpuSimulationLimits;
  copy: StudioCopy;
  /** The placeholder while the comparison is worked out. */
  workingOut: string;
  comparison?: IdealComparison;
  readings?: MitigatedReadings | null;
}) {
  const consumer = `qpu-measured-vs-ideal:${useId()}`;
  // Keyed by VALUE, not by object identity: a poll that hands over an equal
  // counts object must neither restart the simulation nor flash the
  // placeholder again.
  const job = useMemo(
    () => ({ kind: "compare_mitigated" as const, qasm, submittedFingerprint, counts, limits, mitigation: mitigation ?? null }),
    [qasm, submittedFingerprint, counts, limits, mitigation],
  );
  const jobKey = useMemo(() => JSON.stringify(job), [job]);
  const [computed, setComputed] = useState<{
    jobKey: string;
    comparison: IdealComparison;
    readings: MitigatedReadings | null;
  } | null>(null);
  const current = computed?.jobKey === jobKey ? computed : null;
  const comparison = precomputed ?? current?.comparison ?? null;
  // Handed over with a precomputed comparison, or worked out beside this one.
  const readings = precomputed ? (precomputedReadings ?? null) : (current?.readings ?? null);
  const needsWork = !comparison;

  useEffect(() => {
    if (!needsWork) return;
    let live = true;
    // `job` is read from the render that scheduled this effect; its value is
    // exactly what `jobKey` names, which is why `jobKey` is the dependency.
    void simulator.run(consumer, job).then((outcome) => {
      if (!live || outcome.status === "superseded") return;
      if (outcome.status === "done") {
        setComputed({ jobKey, comparison: outcome.result.comparison, readings: outcome.result.readings });
        return;
      }
      setComputed({ jobKey, comparison: outcome.status === "timed_out" ? TIMED_OUT : COULD_NOT_COMPARE, readings: null });
    });
    return () => {
      live = false;
      simulator.cancel(consumer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `job` is value-equal whenever `jobKey` is
  }, [needsWork, jobKey, consumer]);

  if (!comparison) {
    return (
      <div className="mj-qpu-ideal" aria-busy="true">
        <span className="mj-section-label">{copy.hardwareIdealComparison}</span>
        <p className="mj-qpu-note" role="status">{workingOut}</p>
      </div>
    );
  }

  if (comparison.status === "unavailable") {
    return (
      <div className="mj-qpu-ideal">
        <span className="mj-section-label">{copy.hardwareIdealComparison}</span>
        <p className="mj-qpu-note">{copy.hardwareIdealUnavailable(comparison.reason)}</p>
      </div>
    );
  }

  const showOther = comparison.otherMeasuredShare > 0 || comparison.otherIdealShare > 0;
  // The worker sends the mitigated shares of exactly the rows this table shows,
  // plus the rest as one figure (qpu-mitigation.ts's `DistanceReading`).
  const corrected = readings?.readout.status === "computed" ? readings.readout.reading : null;
  const extrapolated = readings?.zne?.status === "computed" ? readings.zne.reading.richardson : null;

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
                {corrected ? <td>{formatShare(corrected.shares[row.bitstring] ?? 0, "en-US")}</td> : null}
                {extrapolated ? <td>{formatShare(extrapolated.shares[row.bitstring] ?? 0, "en-US")}</td> : null}
                <td>{formatShare(row.idealShare, "en-US")}</td>
              </tr>
            ))}
            {showOther ? (
              <tr>
                <td>{copy.hardwareIdealOtherOutcomes}</td>
                <td>{formatShare(comparison.otherMeasuredShare, "en-US")}</td>
                {corrected ? <td>{formatShare(corrected.otherShare, "en-US")}</td> : null}
                {extrapolated ? <td>{formatShare(extrapolated.otherShare, "en-US")}</td> : null}
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
