"use client";

import { useMemo, type CSSProperties } from "react";
import type { BuilderStep, CustomGateDefinition } from "../../../lib/studio-builder";
import { formatShare } from "../../../lib/simulation-visual";
import { MAX_LIVE_PROBABILITY_QUBITS, playheadReading } from "../../../lib/studio-playhead";
import type { PublicLocale } from "../../../lib/public-locale";
import type { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

/**
 * The transport and the live probability bars beside the circuit.
 *
 * "end" is a real position, not the last number: at the end the playhead
 * follows the circuit as gates are placed, which is what makes the bars live.
 * Scrubbing back pins it to a moment until it is moved to the end again.
 */
export function PlayheadPanel({
  qubitCount,
  steps,
  customGates,
  columns,
  count,
  moment,
  onMoment,
  copy,
}: {
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
  columns: number[];
  count: number;
  moment: number;
  onMoment: (next: number | "end") => void;
  copy: StudioCopy;
}) {
  const reading = useMemo(
    () => playheadReading({ qubitCount, steps, customGates, columns, moment }),
    [qubitCount, steps, customGates, columns, moment],
  );
  const go = (next: number) => onMoment(next >= count ? "end" : Math.max(0, next));
  const position = moment === 0 ? copy.playheadStart : copy.playheadAfter(Math.min(moment, count), count);

  return (
    <section className="mj-playhead" aria-labelledby="studio-playhead-title" data-tour="studio-playhead">
      <header className="mj-playhead-head">
        <h3 id="studio-playhead-title">{copy.playheadTitle}</h3>
        <span className="mj-playhead-position" aria-live="polite">{position}</span>
      </header>
      <div className="mj-playhead-transport">
        <button className="mj-icon-button" type="button" onClick={() => go(0)} disabled={moment === 0} aria-label={copy.playheadToStart} title={copy.playheadToStart}>
          <span aria-hidden="true">⏮</span>
        </button>
        <button className="mj-icon-button" type="button" onClick={() => go(moment - 1)} disabled={moment === 0} aria-label={copy.playheadStepBack} title={`${copy.playheadStepBack} · [`}>
          <span aria-hidden="true">◀</span>
        </button>
        <input
          className="mj-playhead-slider"
          type="range"
          min={0}
          max={count}
          step={1}
          value={Math.min(moment, count)}
          onChange={(event) => go(Number(event.target.value))}
          aria-label={copy.playheadSlider}
          aria-valuetext={position}
          disabled={count === 0}
        />
        <button className="mj-icon-button" type="button" onClick={() => go(moment + 1)} disabled={moment >= count} aria-label={copy.playheadStepForward} title={`${copy.playheadStepForward} · ]`}>
          <span aria-hidden="true">▶</span>
        </button>
        <button className="mj-icon-button" type="button" onClick={() => go(count)} disabled={moment >= count} aria-label={copy.playheadToEnd} title={copy.playheadToEnd}>
          <span aria-hidden="true">⏭</span>
        </button>
      </div>
      {reading.kind === "ok" ? (
        <>
          {/* Every row is its own grid, so the bitstring column is sized from the
              register width rather than from its content: rows line up. */}
          <ol className="mj-playhead-bars" style={{ "--playhead-bits": `${Math.max(3, qubitCount + 1)}ch` } as CSSProperties}>
            {reading.bars.map((bar) => (
              <li key={bar.bitstring}>
                <code>{bar.bitstring}</code>
                <span className="mj-playhead-track" aria-hidden="true">
                  <span className="mj-playhead-fill" style={{ transform: `scaleX(${bar.probability})` }} />
                </span>
                <span className="mj-playhead-value">{formatShare(bar.probability, "en-US")}</span>
              </li>
            ))}
            {reading.otherStates ? (
              <li className="is-other">
                <code title={copy.simulationOtherBar(reading.otherStates)}>+{reading.otherStates}</code>
                <span className="sr-only">{copy.simulationOtherBar(reading.otherStates)}</span>
                <span className="mj-playhead-track" aria-hidden="true">
                  <span className="mj-playhead-fill" style={{ transform: `scaleX(${reading.otherProbability})` }} />
                </span>
                <span className="mj-playhead-value">{formatShare(reading.otherProbability, "en-US")}</span>
              </li>
            ) : null}
          </ol>
          {qubitCount > 1 ? <p className="mj-playhead-order">{copy.playheadBitOrder(qubitCount - 1)}</p> : null}
        </>
      ) : (
        <p className="mj-playhead-note" role="status">{copy.playheadUnavailable(reading.reason, MAX_LIVE_PROBABILITY_QUBITS)}</p>
      )}
      <p className="mj-playhead-boundary">{copy.playheadBoundary}</p>
    </section>
  );
}
