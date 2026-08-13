import { formatShare } from "../lib/simulation-visual.ts";
import {
  formatResultNumber,
  type ResultChartSeries,
  type ResultChartView,
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

const CHART_WIDTH = 640;
const CHART_HEIGHT = 300;
const CHART_MARGIN = { top: 16, right: 18, bottom: 54, left: 64 } as const;

function extent(values: readonly number[], includeZero = false): [number, number] {
  let minimum = includeZero ? Math.min(0, ...values) : Math.min(...values);
  let maximum = includeZero ? Math.max(0, ...values) : Math.max(...values);
  if (minimum === maximum) {
    const padding = Math.abs(minimum) > 0 ? Math.abs(minimum) * 0.1 : 1;
    minimum -= padding;
    maximum += padding;
  } else if (!includeZero) {
    const padding = (maximum - minimum) * 0.05;
    minimum -= padding;
    maximum += padding;
  }
  return [minimum, maximum];
}

function chartSummary(chart: ResultChartView, locale: PublicLocale): string {
  const pointCount = chart.series.reduce((total, series) => total + series.points.length, 0);
  const series = chart.series.map((item) => item.label).join(", ");
  return locale === "ja"
    ? `${chart.title}。${chart.series.length}系列、${pointCount}点。系列: ${series}。`
    : `${chart.title}. ${chart.series.length} series and ${pointCount} points. Series: ${series}.`;
}

function chartKindLabel(kind: ResultChartView["kind"], locale: PublicLocale): string {
  if (locale !== "ja") return kind;
  return { bar: "棒グラフ", line: "折れ線グラフ", scatter: "散布図" }[kind];
}

function NumericSeries({
  chart,
  series,
  seriesIndex,
  scaleX,
  scaleY,
}: {
  chart: ResultChartView;
  series: ResultChartSeries;
  seriesIndex: number;
  scaleX: (value: number) => number;
  scaleY: (value: number) => number;
}) {
  const points = series.points.map((point) => ({
    x: scaleX(point.x as number),
    y: scaleY(point.y),
    rawX: point.x as number,
    rawY: point.y,
  }));
  return (
    <g data-series={seriesIndex}>
      {chart.kind === "line" ? (
        <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
      ) : null}
      {points.map((point, pointIndex) => (
        <circle cx={point.x} cy={point.y} r={chart.kind === "scatter" ? 4 : 2.5} key={pointIndex}>
          <title>{`${series.label}: ${point.rawX}, ${point.rawY}`}</title>
        </circle>
      ))}
    </g>
  );
}

function GenericChart({ chart, locale }: { chart: ResultChartView; locale: PublicLocale }) {
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const yValues = chart.series.flatMap((series) => series.points.map((point) => point.y));
  const [yMinimum, yMaximum] = extent(yValues, chart.kind === "bar");
  const scaleY = (value: number) =>
    CHART_MARGIN.top + ((yMaximum - value) / (yMaximum - yMinimum)) * plotHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) =>
    yMaximum - (index * (yMaximum - yMinimum)) / 4);
  const numericX = chart.kind !== "bar"
    ? chart.series.flatMap((series) => series.points.map((point) => point.x as number))
    : [];
  const [xMinimum, xMaximum] = numericX.length ? extent(numericX) : [0, 1];
  const scaleX = (value: number) =>
    CHART_MARGIN.left + ((value - xMinimum) / (xMaximum - xMinimum)) * plotWidth;
  const xTicks = chart.kind !== "bar"
    ? Array.from({ length: 5 }, (_, index) => xMinimum + (index * (xMaximum - xMinimum)) / 4)
    : [];
  const categories = chart.kind === "bar"
    ? [...new Set(chart.series.flatMap((series) => series.points.map((point) => String(point.x))))]
    : [];
  const categoryWidth = categories.length ? plotWidth / categories.length : plotWidth;
  const barWidth = Math.max(2, Math.min(30, categoryWidth / (chart.series.length + 0.7)));
  const categoryLabelStep = Math.max(1, Math.ceil(categories.length / 12));

  return (
    <section className="mj-result-visual mj-generic-chart" aria-label={chart.title}>
      <div className="mj-result-visual-head">
        <span className="mj-section-label">{chart.title}</span>
        <span>{chartKindLabel(chart.kind, locale)}</span>
      </div>
      <svg
        role="img"
        aria-label={chartSummary(chart, locale)}
        preserveAspectRatio="xMidYMid meet"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        {yTicks.map((tick) => {
          const y = scaleY(tick);
          return (
            <g className="mj-generic-chart-grid" key={tick}>
              <line x1={CHART_MARGIN.left} x2={CHART_WIDTH - CHART_MARGIN.right} y1={y} y2={y} />
              <text x={CHART_MARGIN.left - 10} y={y + 4} textAnchor="end">{formatResultNumber(tick, locale)}</text>
            </g>
          );
        })}
        {chart.kind === "bar" ? (
          <>
            {chart.series.map((series, seriesIndex) => series.points.map((point, pointIndex) => {
              const categoryIndex = categories.indexOf(String(point.x));
              const groupWidth = barWidth * chart.series.length;
              const x = CHART_MARGIN.left
                + categoryIndex * categoryWidth
                + (categoryWidth - groupWidth) / 2
                + seriesIndex * barWidth;
              const valueY = scaleY(point.y);
              const zeroY = scaleY(0);
              return (
                <rect
                  data-series={seriesIndex}
                  height={Math.max(1, Math.abs(zeroY - valueY))}
                  key={`${series.label}-${pointIndex}`}
                  width={Math.max(1, barWidth - 2)}
                  x={x}
                  y={Math.min(valueY, zeroY)}
                >
                  <title>{`${series.label} · ${point.x}: ${point.y}`}</title>
                </rect>
              );
            }))}
            {categories.map((category, index) => index % categoryLabelStep === 0 ? (
              <text
                className="mj-generic-chart-category"
                key={category}
                textAnchor="middle"
                x={CHART_MARGIN.left + (index + 0.5) * categoryWidth}
                y={CHART_HEIGHT - CHART_MARGIN.bottom + 18}
              >
                {category.length > 12 ? `${category.slice(0, 11)}…` : category}
              </text>
            ) : null)}
          </>
        ) : (
          <>
            {xTicks.map((tick) => (
              <text
                className="mj-generic-chart-tick"
                key={tick}
                textAnchor="middle"
                x={scaleX(tick)}
                y={CHART_HEIGHT - CHART_MARGIN.bottom + 18}
              >
                {formatResultNumber(tick, locale)}
              </text>
            ))}
            {chart.series.map((series, seriesIndex) => (
              <NumericSeries
                chart={chart}
                key={`${series.label}-${seriesIndex}`}
                scaleX={scaleX}
                scaleY={scaleY}
                series={series}
                seriesIndex={seriesIndex}
              />
            ))}
          </>
        )}
        {chart.xLabel ? (
          <text className="mj-generic-chart-axis-label" textAnchor="middle" x={CHART_MARGIN.left + plotWidth / 2} y={CHART_HEIGHT - 7}>
            {chart.xLabel}
          </text>
        ) : null}
        {chart.yLabel ? (
          <text
            className="mj-generic-chart-axis-label"
            textAnchor="middle"
            transform={`rotate(-90 14 ${CHART_MARGIN.top + plotHeight / 2})`}
            x={14}
            y={CHART_MARGIN.top + plotHeight / 2}
          >
            {chart.yLabel}
          </text>
        ) : null}
      </svg>
      <ul className="mj-generic-chart-legend" aria-label={locale === "ja" ? "系列" : "Series"}>
        {chart.series.map((series, index) => (
          <li data-series={index} key={`${series.label}-${index}`}><span aria-hidden="true" />{series.label}</li>
        ))}
      </ul>
    </section>
  );
}

export function ResultVisualizations({
  distribution,
  traces,
  charts,
  values,
  locale = "en",
}: {
  distribution: ResultDistributionView | null;
  traces: readonly ResultTraceView[];
  charts: readonly ResultChartView[];
  values: readonly ResultValueView[];
  locale?: PublicLocale;
}) {
  if (!distribution && !traces.length && !charts.length && !values.length) return null;
  return (
    <div className="mj-result-visualizations">
      {distribution ? <DistributionChart distribution={distribution} locale={locale} /> : null}
      {traces.map((trace) => <TraceChart key={trace.key} trace={trace} locale={locale} />)}
      {charts.map((chart) => <GenericChart chart={chart} key={chart.key} locale={locale} />)}
      {values.length ? (
        <dl className="mj-run-result-values">
          {values.map((value) => (
            <div key={value.key}>
              <dt>{value.label}</dt>
              <dd>{value.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
