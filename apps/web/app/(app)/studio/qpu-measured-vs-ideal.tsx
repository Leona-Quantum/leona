"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { IdealComparison } from "../../../lib/qpu-ideal";
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
 */
export function QpuMeasuredVsIdeal({
  qasm,
  submittedFingerprint,
  counts,
  limits,
  copy,
  workingOut,
  comparison: precomputed,
}: {
  qasm: string;
  submittedFingerprint: string;
  counts: Record<string, number> | null;
  limits: CpuSimulationLimits;
  copy: StudioCopy;
  /** The placeholder while the comparison is worked out. */
  workingOut: string;
  comparison?: IdealComparison;
}) {
  const consumer = `qpu-measured-vs-ideal:${useId()}`;
  // Keyed by VALUE, not by object identity: a poll that hands over an equal
  // counts object must neither restart the simulation nor flash the
  // placeholder again.
  const job = useMemo(
    () => ({ kind: "compare_ideal" as const, qasm, submittedFingerprint, counts, limits }),
    [qasm, submittedFingerprint, counts, limits],
  );
  const jobKey = useMemo(() => JSON.stringify(job), [job]);
  const [computed, setComputed] = useState<{ jobKey: string; comparison: IdealComparison } | null>(null);
  const comparison = precomputed ?? (computed?.jobKey === jobKey ? computed.comparison : null);
  const needsWork = !comparison;

  useEffect(() => {
    if (!needsWork) return;
    let live = true;
    // `job` is read from the render that scheduled this effect; its value is
    // exactly what `jobKey` names, which is why `jobKey` is the dependency.
    void simulator.run(consumer, job).then((outcome) => {
      if (!live || outcome.status === "superseded") return;
      const comparison = outcome.status === "done" ? outcome.result : outcome.status === "timed_out" ? TIMED_OUT : COULD_NOT_COMPARE;
      setComputed({ jobKey, comparison });
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
