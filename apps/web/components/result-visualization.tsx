import { formatShare } from "../lib/simulation-visual.ts";
import {
  formatResultNumber,
  type ResultDistributionView,
  type ResultTraceView,
  type ResultValueView,
} from "../lib/result-visualization.ts";

function distributionTotal(distribution: ResultDistributionView): string {
  if (distribution.kind === "counts") {
    return `${distribution.total.toLocaleString("en-US")} shots`;
  }
  if (distribution.kind === "probabilities") {
    return `reported total ${formatShare(distribution.total, "en-US")} · normalized`;
  }
  return `reported total ${formatResultNumber(distribution.total)} · normalized`;
}

function DistributionChart({ distribution }: { distribution: ResultDistributionView }) {
  return (
    <section className="mj-result-visual mj-sim-chart" aria-label={distribution.label}>
      <div className="mj-result-visual-head">
        <span className="mj-section-label">{distribution.label}</span>
        <span>{distributionTotal(distribution)}</span>
      </div>
      <div className="mj-sim-chart-rows">
        {distribution.data.bars.map((bar) => (
          <div
            className={bar.peak ? "mj-sim-chart-row is-peak" : "mj-sim-chart-row"}
            title={`|${bar.bitstring}⟩ · ${formatShare(bar.share, "en-US")}`}
            key={bar.bitstring}
          >
            <code>{bar.bitstring}</code>
            <span className="mj-sim-chart-track" aria-hidden="true">
              <span
                className="mj-sim-chart-fill"
                style={{ width: `${Math.max(bar.share * 100, 0.75)}%` }}
              />
            </span>
            <span className="mj-sim-chart-value">
              {distribution.kind === "counts" ? (
                <>
                  {bar.count.toLocaleString("en-US")}
                  <small>{formatShare(bar.share, "en-US")}</small>
                </>
              ) : formatShare(bar.share, "en-US")}
            </span>
          </div>
        ))}
        {distribution.data.otherStates ? (
          <div className="mj-sim-chart-row is-other">
            <code>…</code>
            <span className="mj-sim-chart-track" aria-hidden="true">
              <span
                className="mj-sim-chart-fill"
                style={{
                  width: `${Math.max((distribution.data.otherShots / distribution.total) * 100, 0.75)}%`,
                }}
              />
            </span>
            <span className="mj-sim-chart-value">
              {formatShare(distribution.data.otherShots / distribution.total, "en-US")}
            </span>
          </div>
        ) : null}
      </div>
      {distribution.data.otherStates ? (
        <p className="mj-result-visual-note">
          Showing the {distribution.data.bars.length} heaviest of{
            ` ${distribution.data.distinctStates.toLocaleString("en-US")}`
          } reported outcomes.
        </p>
      ) : null}
    </section>
  );
}

function tracePolyline(trace: ResultTraceView): string {
  const span = trace.maximum - trace.minimum;
  const lastIndex = Math.max(1, trace.pointCount - 1);
  return trace.points.map((point) => {
    const x = (point.index / lastIndex) * 100;
    const y = span === 0 ? 18 : 33 - ((point.value - trace.minimum) / span) * 30;
    return `${x.toFixed(3)},${y.toFixed(3)}`;
  }).join(" ");
}

function TraceChart({ trace }: { trace: ResultTraceView }) {
  const label = `${trace.label}: ${trace.pointCount.toLocaleString("en-US")} reported points; `
    + `starts at ${formatResultNumber(trace.start)}, ends at ${formatResultNumber(trace.end)}, `
    + `range ${formatResultNumber(trace.minimum)} to ${formatResultNumber(trace.maximum)}.`;
  return (
    <section className="mj-result-visual mj-result-trace">
      <div className="mj-result-visual-head">
        <span className="mj-section-label">{trace.label}</span>
        <span>{trace.pointCount.toLocaleString("en-US")} points</span>
      </div>
      <div className="mj-result-trace-chart">
        <span>{formatResultNumber(trace.maximum)}</span>
        <svg role="img" aria-label={label} preserveAspectRatio="none" viewBox="0 0 100 36">
          <line x1="0" x2="100" y1="33" y2="33" />
          <polyline points={tracePolyline(trace)} />
        </svg>
        <span>{formatResultNumber(trace.minimum)}</span>
      </div>
      <dl className="mj-result-trace-summary">
        <div><dt>Start</dt><dd>{formatResultNumber(trace.start)}</dd></div>
        <div><dt>Latest</dt><dd>{formatResultNumber(trace.end)}</dd></div>
        <div>
          <dt>Net change</dt>
          <dd>{formatResultNumber(trace.end - trace.start)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function ResultVisualizations({
  distribution,
  traces,
  values,
}: {
  distribution: ResultDistributionView | null;
  traces: readonly ResultTraceView[];
  values: readonly ResultValueView[];
}) {
  if (!distribution && !traces.length && !values.length) return null;
  return (
    <div className="mj-result-visualizations">
      {distribution ? <DistributionChart distribution={distribution} /> : null}
      {traces.map((trace) => <TraceChart key={trace.label} trace={trace} />)}
      {values.length ? (
        <dl className="mj-run-result-values">
          {values.map((value) => (
            <div key={value.label}>
              <dt>{value.label}</dt>
              <dd>{value.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
