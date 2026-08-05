import { formatShare } from "../lib/simulation-visual.ts";
import {
  formatResultNumber,
  type ResultDistributionView,
  type ResultTraceView,
  type ResultValueView,
} from "../lib/result-visualization.ts";
import type { PublicLocale } from "../lib/public-locale.ts";

function distributionTotal(distribution: ResultDistributionView, locale: PublicLocale): string {
  const numberLocale = locale === "ja" ? "ja-JP" : "en-US";
  if (distribution.kind === "counts") {
    return locale === "ja"
      ? `${distribution.total.toLocaleString(numberLocale)}ショット`
      : `${distribution.total.toLocaleString(numberLocale)} shots`;
  }
  if (distribution.kind === "probabilities") {
    return locale === "ja"
      ? `報告値の合計 ${formatShare(distribution.total, numberLocale)}・正規化済み`
      : `reported total ${formatShare(distribution.total, numberLocale)} · normalized`;
  }
  return locale === "ja"
    ? `報告値の合計 ${formatResultNumber(distribution.total, locale)}・正規化済み`
    : `reported total ${formatResultNumber(distribution.total, locale)} · normalized`;
}

function DistributionChart({ distribution, locale }: { distribution: ResultDistributionView; locale: PublicLocale }) {
  const numberLocale = locale === "ja" ? "ja-JP" : "en-US";
  return (
    <section className="mj-result-visual mj-sim-chart" aria-label={distribution.label}>
      <div className="mj-result-visual-head">
        <span className="mj-section-label">{distribution.label}</span>
        <span>{distributionTotal(distribution, locale)}</span>
      </div>
      <div className="mj-sim-chart-rows">
        {distribution.data.bars.map((bar) => (
          <div
            className={bar.peak ? "mj-sim-chart-row is-peak" : "mj-sim-chart-row"}
            title={`|${bar.bitstring}⟩ · ${formatShare(bar.share, numberLocale)}`}
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
                  {bar.count.toLocaleString(numberLocale)}
                  <small>{formatShare(bar.share, numberLocale)}</small>
                </>
              ) : formatShare(bar.share, numberLocale)}
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
              {formatShare(distribution.data.otherShots / distribution.total, numberLocale)}
            </span>
          </div>
        ) : null}
      </div>
      {distribution.data.otherStates ? (
        <p className="mj-result-visual-note">
          {locale === "ja"
            ? `${distribution.data.distinctStates.toLocaleString(numberLocale)}件の結果のうち、重みが大きい${distribution.data.bars.length}件を表示しています。`
            : `Showing the ${distribution.data.bars.length} heaviest of ${distribution.data.distinctStates.toLocaleString(numberLocale)} reported outcomes.`}
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

function TraceChart({ trace, locale }: { trace: ResultTraceView; locale: PublicLocale }) {
  const numberLocale = locale === "ja" ? "ja-JP" : "en-US";
  const label = locale === "ja"
    ? `${trace.label}: ${trace.pointCount.toLocaleString(numberLocale)}点。開始値 ${formatResultNumber(trace.start, locale)}、終了値 ${formatResultNumber(trace.end, locale)}、範囲 ${formatResultNumber(trace.minimum, locale)}〜${formatResultNumber(trace.maximum, locale)}。`
    : `${trace.label}: ${trace.pointCount.toLocaleString(numberLocale)} reported points; starts at ${formatResultNumber(trace.start, locale)}, ends at ${formatResultNumber(trace.end, locale)}, range ${formatResultNumber(trace.minimum, locale)} to ${formatResultNumber(trace.maximum, locale)}.`;
  return (
    <section className="mj-result-visual mj-result-trace">
      <div className="mj-result-visual-head">
        <span className="mj-section-label">{trace.label}</span>
        <span>{trace.pointCount.toLocaleString(numberLocale)}{locale === "ja" ? "点" : " points"}</span>
      </div>
      <div className="mj-result-trace-chart">
        <span>{formatResultNumber(trace.maximum, locale)}</span>
        <svg role="img" aria-label={label} preserveAspectRatio="none" viewBox="0 0 100 36">
          <line x1="0" x2="100" y1="33" y2="33" />
          <polyline points={tracePolyline(trace)} />
        </svg>
        <span>{formatResultNumber(trace.minimum, locale)}</span>
      </div>
      <dl className="mj-result-trace-summary">
        <div><dt>{locale === "ja" ? "開始" : "Start"}</dt><dd>{formatResultNumber(trace.start, locale)}</dd></div>
        <div><dt>{locale === "ja" ? "最新" : "Latest"}</dt><dd>{formatResultNumber(trace.end, locale)}</dd></div>
        <div>
          <dt>{locale === "ja" ? "変化量" : "Net change"}</dt>
          <dd>{formatResultNumber(trace.end - trace.start, locale)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function ResultVisualizations({
  distribution,
  traces,
  values,
  locale = "en",
}: {
  distribution: ResultDistributionView | null;
  traces: readonly ResultTraceView[];
  values: readonly ResultValueView[];
  locale?: PublicLocale;
}) {
  if (!distribution && !traces.length && !values.length) return null;
  return (
    <div className="mj-result-visualizations">
      {distribution ? <DistributionChart distribution={distribution} locale={locale} /> : null}
      {traces.map((trace) => <TraceChart key={trace.label} trace={trace} locale={locale} />)}
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
