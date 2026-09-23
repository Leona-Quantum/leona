"use client";

// "How it grows, and what machine it needs" on the Atlas workflow planner.
//
// Two halves, and they differ in what they need:
//
// 1. The logical curves are the planner's own cited formulas evaluated at a
//    range of sizes (`lib/workflow-planner/scaling.ts`). Client-side, anonymous,
//    free — the same arithmetic the table above already does at one size.
// 2. The physical curves turn those counts into qubits and hours under a named
//    hardware assumption set. That is `POST /v1/estimates/logical`, signed-in
//    only (a route that costs any body it is sent is gated when anonymous), so
//    a signed-out reader gets a sign-in link where the button would be.
//
// One quantity per chart. Logical qubits and Toffoli counts differ by six
// orders of magnitude, and two scales on one plot is how a chart lies.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PublicLocale } from "../lib/public-locale";
import type { Stage } from "../lib/workflow-planner/assemble.ts";
import { formatPlain } from "../lib/workflow-planner/costs.ts";
import {
  ASSUMPTION_SETS,
  fetchPhysicalEstimate,
  type AssumptionSetKey,
  type PhysicalEstimate,
  type PhysicalOutcome,
} from "../lib/workflow-planner/physical.ts";
import {
  physicalRequestPoints,
  scalingSeries,
  sweepableParams,
  type Scaling,
  type SeriesKey,
} from "../lib/workflow-planner/scaling.ts";
import type { CostKind, ParamKey, ParamValues, ProblemId } from "../lib/workflow-planner/types.ts";
import type { SourceKey } from "../lib/workflow-planner/sources.ts";

const COPY = {
  en: {
    heading: "How it grows, and what machine it needs",
    intro: "These are the formulas from the table above, evaluated across a range of sizes.",
    axis: "Vary",
    held: "The other values stay where you set them.",
    series: {
      logicalQubits: "Logical qubits",
      toffolis: "Toffoli gates",
      tGates: "T gates",
      queries: "Queries",
      serialDepth: "Serial depth",
    } satisfies Record<SeriesKey, string>,
    published: "Published at this size",
    yours: "Your value",
    showNumbers: "Show the numbers",
    noCurve: "None of this problem's numbers moves with a parameter you have set, so there is no curve to draw.",
    physicalHeading: "Physical qubits and runtime",
    physicalIntro:
      "Leona's estimator turns the logical counts above into a surface-code machine under a named set of hardware assumptions. It is arithmetic on the counts, so it inherits their kind: a leading-order count gives a leading-order machine.",
    hardware: "Hardware assumptions",
    run: "Estimate the machine",
    running: "Estimating…",
    signIn: "Sign in to estimate the machine",
    signedOut: "Your session has ended. Sign in again to estimate the machine.",
    failed: "The estimate could not be loaded. Try again in a moment.",
    nothingToCost:
      "This plan has no Toffoli or T count at any size yet, so there is no magic-state cost to turn into a machine. Setting the missing values above may give it one.",
    fastest: "Physical qubits, fastest useful machine",
    runtime: "Runtime",
    atYourSize: "At your size",
    fastestMachine: "Fastest useful machine",
    smallestMachine: "One magic-state factory",
    factories: (n: number) => `${formatPlain(n)} ${n === 1 ? "factory" : "factories"}`,
    distance: (d: number) => `code distance ${d}`,
    reactionBound: "Limited by the serial depth: more factories would not make it faster.",
    throughputBound:
      "No serial depth is stated for this algorithm, so this is what one factory delivers. More factories would shorten it, down to a floor the source does not give.",
    depthUsed: "Serial depth is Gidney and Ekerå's measurement depth, the chain their reaction time applies to.",
    frontier: "Across hardware",
    frontierColumns: ["Assumptions", "Factories", "Physical qubits", "Runtime"],
    refused: "Not costed",
    under: "Under",
    omitted: (n: number) => `${n} point${n === 1 ? "" : "s"} had no gate count to cost and ${n === 1 ? "is" : "are"} left out.`,
  },
  ja: {
    heading: "規模に応じた伸びと、必要な機械",
    intro: "上の表と同じ式を、いくつかのサイズで評価しています。",
    axis: "変化させる量",
    held: "ほかの値はあなたが設定したままです。",
    series: {
      logicalQubits: "論理量子ビット",
      toffolis: "Toffoli ゲート",
      tGates: "T ゲート",
      queries: "クエリ",
      serialDepth: "直列深さ",
    } satisfies Record<SeriesKey, string>,
    published: "このサイズで公表されている値",
    yours: "あなたの値",
    showNumbers: "数値を表示",
    noCurve: "この問題の数値は、設定済みのどのパラメータでも変わらないため、描く曲線がありません。",
    physicalHeading: "物理量子ビットと実行時間",
    physicalIntro:
      "Leona の見積もりは、上の論理コストを、名前のついたハードウェア前提のもとで表面符号の機械に換算します。コストに対する算術なので、その種類を引き継ぎます。主要項のコストからは主要項の機械が出てきます。",
    hardware: "ハードウェア前提",
    run: "機械を見積もる",
    running: "見積もり中…",
    signIn: "サインインして機械を見積もる",
    signedOut: "セッションが切れました。もう一度サインインしてください。",
    failed: "見積もりを読み込めませんでした。少し待ってからもう一度お試しください。",
    nothingToCost:
      "この計画にはまだどのサイズでも Toffoli や T の数がないため、機械に換算できる魔法状態のコストがありません。上で足りない値を設定すると出る場合があります。",
    fastest: "物理量子ビット（最速の有用な機械）",
    runtime: "実行時間",
    atYourSize: "あなたのサイズで",
    fastestMachine: "最速の有用な機械",
    smallestMachine: "魔法状態工場 1 基",
    factories: (n: number) => `工場 ${formatPlain(n)} 基`,
    distance: (d: number) => `符号距離 ${d}`,
    reactionBound: "直列深さで律速されています。工場を増やしても速くなりません。",
    throughputBound:
      "このアルゴリズムには直列深さが示されていないため、これは工場 1 基での値です。工場を増やせば短くなりますが、その下限は出典に書かれていません。",
    depthUsed: "直列深さには Gidney と Ekerå の測定深さを使っています。反応時間がかかる連鎖です。",
    frontier: "ハードウェアごとの比較",
    frontierColumns: ["前提", "工場", "物理量子ビット", "実行時間"],
    refused: "見積もり不可",
    under: "前提",
    omitted: (n: number) => `ゲート数のない ${n} 点は除いています。`,
  },
} as const;

type Copy = (typeof COPY)[PublicLocale];

export function formatDuration(seconds: number, locale: PublicLocale): string {
  const units: [number, string, string][] = [
    [365.25 * 86400, "years", "年"],
    [86400, "days", "日"],
    [3600, "hours", "時間"],
    [60, "minutes", "分"],
    [1, "seconds", "秒"],
  ];
  for (const [size, en, ja] of units) {
    if (seconds >= size || size === 1) {
      const value = formatPlain(Number((seconds / size).toPrecision(3)));
      return locale === "ja" ? `${value} ${ja}` : `${value} ${en}`;
    }
  }
  return String(seconds);
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
/** An axis label: plain up to 100, a power of ten past it, so one axis never mixes "1,000" with "10⁵". */
function tick(value: number): string {
  if (value >= 1e3 || value < 1e-2) {
    const exponent = Math.round(Math.log10(value));
    const sign = exponent < 0 ? "⁻" : "";
    return `10${sign}${String(Math.abs(exponent)).split("").map((d) => SUPERSCRIPT[Number(d)]).join("")}`;
  }
  return formatPlain(value);
}

interface ChartPoint {
  x: number;
  y: number | null;
}

interface ChartMark {
  x: number;
  y: number;
  title: string;
}

const W = 320;
const H = 176;
const PAD = { left: 44, right: 10, top: 10, bottom: 26 };

function logExtent(values: number[]): [number, number] {
  const positive = values.filter((v) => v > 0 && Number.isFinite(v));
  if (positive.length === 0) return [1, 10];
  const lo = Math.floor(Math.log10(Math.min(...positive)));
  const hi = Math.ceil(Math.log10(Math.max(...positive)));
  return hi === lo ? [lo - 0.5, hi + 0.5] : [lo, hi];
}

/**
 * A log-log line with its points, the reader's own x ringed, and published
 * marks drawn as diamonds that are never joined to the line. Hovering or
 * focusing reads the nearest point out beside the chart.
 */
function LogChart({
  title,
  points,
  marks,
  current,
  formatY,
  formatX,
}: {
  title: string;
  points: ChartPoint[];
  marks: ChartMark[];
  current: number;
  formatY: (v: number) => string;
  formatX: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const xs = points.map((p) => p.x);
  const ys = [...points.map((p) => p.y).filter((y): y is number => y !== null), ...marks.map((m) => m.y)];
  const [x0, x1] = logExtent(xs);
  const [y0, y1] = logExtent(ys);
  const sx = (x: number) => PAD.left + ((Math.log10(x) - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  const sy = (y: number) => H - PAD.bottom - ((Math.log10(y) - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);
  const drawn = points.filter((p): p is { x: number; y: number } => p.y !== null && p.y > 0);
  const path = drawn.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const yTicks: number[] = [];
  const yStep = Math.max(1, Math.ceil((y1 - y0) / 4));
  for (let e = Math.ceil(y0); e <= y1; e += yStep) yTicks.push(10 ** e);
  const xTicks = [points[0]?.x, points[Math.floor(points.length / 2)]?.x, points[points.length - 1]?.x].filter(
    (v, i, all): v is number => v !== undefined && all.indexOf(v) === i,
  );
  const active = hover ?? current;
  const readout = points[active];

  function nearest(clientX: number, rect: DOMRect) {
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(sx(p.x) - x) < Math.abs(sx(points[best].x) - x)) best = i;
    });
    setHover(best);
  }

  return (
    <figure className="mj-plan-chart">
      <figcaption>
        <span className="mj-plan-chart-title">{title}</span>
        {readout ? (
          <span className="mj-plan-chart-readout" aria-live="polite">
            {formatX(readout.x)}: {readout.y === null ? "—" : formatY(readout.y)}
          </span>
        ) : null}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
        onMouseMove={(event) => nearest(event.clientX, event.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line className="mj-plan-chart-grid" x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} />
            <text className="mj-plan-chart-tick" x={PAD.left - 6} y={sy(v)} textAnchor="end" dominantBaseline="middle">
              {tick(v)}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={`x${v}`} className="mj-plan-chart-tick" x={sx(v)} y={H - 8} textAnchor="middle">
            {/* Sweep values, not decades: 2,048 is not 10³. */}
            {formatPlain(v)}
          </text>
        ))}
        {hover !== null && points[hover] ? (
          <line className="mj-plan-chart-cross" x1={sx(points[hover].x)} x2={sx(points[hover].x)} y1={PAD.top} y2={H - PAD.bottom} />
        ) : null}
        <path className="mj-plan-chart-line" d={path} />
        {drawn.map((p) => (
          <circle
            key={`p${p.x}`}
            className={p.x === points[current]?.x ? "mj-plan-chart-point mj-plan-chart-current" : "mj-plan-chart-point"}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={p.x === points[current]?.x ? 5 : 4}
          />
        ))}
        {marks.map((m) => (
          <path
            key={`m${m.x}-${m.y}`}
            className="mj-plan-chart-mark"
            d={`M${sx(m.x)},${sy(m.y) - 6} l6,6 l-6,6 l-6,-6 z`}
          >
            <title>{m.title}</title>
          </path>
        ))}
      </svg>
    </figure>
  );
}

export interface PlanScalingProps {
  locale: PublicLocale;
  problem: ProblemId;
  params: ParamValues;
  root: Stage | null;
  paramName: (key: ParamKey) => string;
  cite: (source: SourceKey | null) => ReactNode;
  kindLabel: (kind: CostKind) => string;
  signedIn: boolean;
  sessionReady: boolean;
  signInHref: string | null;
  /** Injected in tests; the page uses the real fetch. */
  fetcher?: typeof fetch;
}

export function PlanScaling({
  locale,
  problem,
  params,
  root,
  paramName,
  cite,
  kindLabel,
  signedIn,
  sessionReady,
  signInHref,
  fetcher,
}: PlanScalingProps) {
  const copy: Copy = COPY[locale];
  const axes = useMemo(() => sweepableParams(problem, params, root), [problem, params, root]);
  const [chosen, setChosen] = useState<ParamKey | null>(null);
  const axis = chosen && axes.includes(chosen) ? chosen : axes[0] ?? null;
  const scaling: Scaling | null = useMemo(
    () => (axis ? scalingSeries(problem, params, root, axis) : null),
    [problem, params, root, axis],
  );

  const [hardware, setHardware] = useState<AssumptionSetKey>(ASSUMPTION_SETS[0]);
  const [outcome, setOutcome] = useState<PhysicalOutcome | null>(null);
  const [pending, setPending] = useState(false);
  const requestPoints = useMemo(
    () => (scaling ? physicalRequestPoints(scaling, (x) => `${paramName(scaling.param)} = ${formatPlain(x)}`) : []),
    [scaling, paramName],
  );
  // A physical estimate belongs to the curve it was asked for. Any change to
  // the plan, the axis or the hardware withdraws it rather than leaving
  // qubits for yesterday's inputs beside today's formulas.
  const requestKey = JSON.stringify([requestPoints, hardware]);
  useEffect(() => {
    setOutcome(null);
  }, [requestKey]);

  if (!scaling) {
    return axes.length === 0 ? (
      <section className="mj-plan-section" aria-labelledby="plan-scale-heading">
        <h2 id="plan-scale-heading">{copy.heading}</h2>
        <p className="mj-plan-muted">{copy.noCurve}</p>
      </section>
    ) : null;
  }

  const formatX = (x: number) => `${paramName(scaling.param)} = ${formatPlain(x)}`;
  const describe = (key: SeriesKey): string => {
    const series = scaling.series.find((s) => s.key === key);
    const point = series?.points[scaling.current] ?? series?.points.find((p) => p.y !== null);
    return point?.kind ? kindLabel(point.kind) : "";
  };

  async function estimate() {
    setPending(true);
    setOutcome(await fetchPhysicalEstimate(requestPoints, hardware, fetcher));
    setPending(false);
  }

  const physical: PhysicalEstimate | null = outcome?.status === "ok" ? outcome.estimate : null;
  const byX = new Map(physical?.points.map((p) => [p.parameterValue, p]) ?? []);
  const here = byX.get(scaling.xs[scaling.current]) ?? null;
  const omitted = scaling.xs.length - requestPoints.length;
  const usesDepth = requestPoints.some((p) => p.non_clifford_depth > 0);

  return (
    <section className="mj-plan-section" aria-labelledby="plan-scale-heading">
      <h2 id="plan-scale-heading">{copy.heading}</h2>
      <p className="mj-plan-muted">{copy.intro}</p>
      <label className="mj-plan-scale-axis">
        {copy.axis}
        <select value={scaling.param} onChange={(event) => setChosen(event.target.value as ParamKey)}>
          {axes.map((key) => (
            <option key={key} value={key}>
              {paramName(key)}
            </option>
          ))}
        </select>
        <span className="mj-plan-muted">{copy.held}</span>
      </label>

      <div className="mj-plan-charts">
        {scaling.series.map((series) => {
          const marks = scaling.published
            .filter((m) => m.series === series.key)
            .map((m) => ({ x: m.x, y: m.y, title: `${locale === "ja" ? m.label.ja : m.label.en}: ${formatPlain(m.y)}` }));
          const first = series.points.find((p) => p.y !== null);
          return (
            <div key={series.key} className="mj-plan-chart-cell">
              <LogChart
                title={copy.series[series.key]}
                points={series.points.map((p) => ({ x: p.x, y: p.y }))}
                marks={marks}
                current={scaling.current}
                formatX={formatX}
                formatY={(v) => formatPlain(v)}
              />
              <p className="mj-plan-chart-source">
                {describe(series.key)} · {cite(first?.source ?? null)}
                {marks.length > 0 ? <span className="mj-plan-chart-key"> ◆ {copy.published}</span> : null}
              </p>
            </div>
          );
        })}
      </div>

      <details className="mj-plan-cost">
        <summary>{copy.showNumbers}</summary>
        <div className="mj-plan-table-wrap">
          <table className="mj-plan-table">
            <thead>
              <tr>
                <th scope="col">{paramName(scaling.param)}</th>
                {scaling.series.map((s) => (
                  <th key={s.key} scope="col">
                    {copy.series[s.key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scaling.xs.map((x, i) => (
                <tr key={x}>
                  <th scope="row" className="mj-plan-value">
                    {formatPlain(x)}
                    {i === scaling.current ? <span className="mj-plan-note">{copy.yours}</span> : null}
                  </th>
                  {scaling.series.map((s) => (
                    <td key={s.key} className="mj-plan-value">
                      {s.points[i].y === null ? "—" : formatPlain(s.points[i].y as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <h3 className="mj-plan-subheading">{copy.physicalHeading}</h3>
      <p className="mj-plan-muted">{copy.physicalIntro}</p>
      {requestPoints.length === 0 ? (
        <p className="mj-plan-callout">{copy.nothingToCost}</p>
      ) : (
        <>
          <div className="mj-plan-scale-controls">
            <label className="mj-plan-scale-axis">
              {copy.hardware}
              <select value={hardware} onChange={(event) => setHardware(event.target.value as AssumptionSetKey)}>
                {ASSUMPTION_SETS.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
            {signedIn ? (
              <button type="button" className="mj-plan-chip" onClick={estimate} disabled={pending}>
                {pending ? copy.running : copy.run}
              </button>
            ) : sessionReady ? (
              <a className="mj-plan-chip" href={signInHref ?? "/sign-in"}>
                {copy.signIn}
              </a>
            ) : (
              <button type="button" className="mj-plan-chip" disabled>
                {copy.run}
              </button>
            )}
          </div>
          {omitted > 0 ? <p className="mj-plan-muted">{copy.omitted(omitted)}</p> : null}
          {outcome?.status === "signed-out" ? (
            <p className="mj-plan-callout">
              <a href={signInHref ?? "/sign-in"}>{copy.signedOut}</a>
            </p>
          ) : null}
          {outcome?.status === "error" ? <p className="mj-plan-callout">{copy.failed}</p> : null}
          {physical ? (
            <PhysicalResult
              copy={copy}
              locale={locale}
              physical={physical}
              scaling={scaling}
              here={here}
              formatX={formatX}
              usesDepth={usesDepth}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function PhysicalResult({
  copy,
  locale,
  physical,
  scaling,
  here,
  formatX,
  usesDepth,
}: {
  copy: Copy;
  locale: PublicLocale;
  physical: PhysicalEstimate;
  scaling: Scaling;
  here: PhysicalEstimate["points"][number] | null;
  formatX: (x: number) => string;
  usesDepth: boolean;
}) {
  const byX = new Map(physical.points.map((p) => [p.parameterValue, p]));
  const qubits: ChartPoint[] = scaling.xs.map((x) => ({ x, y: byX.get(x)?.fastest?.totalPhysicalQubits ?? null }));
  const runtime: ChartPoint[] = scaling.xs.map((x) => ({ x, y: byX.get(x)?.fastest?.seconds ?? null }));
  const machine = (label: string, m: NonNullable<PhysicalEstimate["points"][number]["fastest"]>) => (
    <div>
      <dt>{label}</dt>
      <dd>{formatPlain(m.totalPhysicalQubits)}</dd>
      <dd className="mj-plan-muted">
        {m.seconds === null ? "—" : formatDuration(m.seconds, locale)} · {copy.factories(m.factoryCount)}
      </dd>
    </div>
  );
  return (
    <div className="mj-plan-physical">
      <details className="mj-plan-cost">
        <summary>
          {copy.under} <code>{physical.assumptionSet}</code>
        </summary>
        <p>{physical.citation}</p>
      </details>
      <div className="mj-plan-charts">
        <div className="mj-plan-chart-cell">
          <LogChart
            title={copy.fastest}
            points={qubits}
            marks={[]}
            current={scaling.current}
            formatX={formatX}
            formatY={(v) => formatPlain(v)}
          />
        </div>
        <div className="mj-plan-chart-cell">
          <LogChart
            title={copy.runtime}
            points={runtime}
            marks={[]}
            current={scaling.current}
            formatX={formatX}
            formatY={(v) => formatDuration(v, locale)}
          />
        </div>
      </div>
      {here ? (
        <>
          <h4 className="mj-plan-subheading">
            {copy.atYourSize} ({formatX(scaling.xs[scaling.current])})
          </h4>
          {here.refused ? (
            <p className="mj-plan-callout">
              {copy.refused}: {here.refused}
            </p>
          ) : here.fastest ? (
            <>
              <dl className="mj-plan-tiles">
                {machine(copy.fastestMachine, here.fastest)}
                {here.smallest ? machine(copy.smallestMachine, here.smallest) : null}
              </dl>
              <p className="mj-plan-muted">
                {here.codeDistance !== null ? `${copy.distance(here.codeDistance)}. ` : ""}
                {here.fastest.bindingTerm === "reaction" ? copy.reactionBound : copy.throughputBound}
                {usesDepth ? ` ${copy.depthUsed}` : ""}
              </p>
              {here.frontier.length > 0 ? (
                <div className="mj-plan-table-wrap">
                  <table className="mj-plan-table">
                    <caption className="mj-plan-muted">{copy.frontier}</caption>
                    <thead>
                      <tr>
                        {copy.frontierColumns.map((c) => (
                          <th key={c} scope="col">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {here.frontier.map((p) => (
                        <tr key={`${p.assumptionSet}-${p.factoryCount}`}>
                          <th scope="row">
                            <code title={physical.citations[p.assumptionSet]}>{p.assumptionSet}</code>
                          </th>
                          <td className="mj-plan-value">{formatPlain(p.factoryCount)}</td>
                          <td className="mj-plan-value">{formatPlain(p.totalPhysicalQubits)}</td>
                          <td className="mj-plan-value">{formatDuration(p.runtimeSeconds, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
