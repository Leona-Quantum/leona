// The fault-tolerant cost panel on a /repository entry (E4).
//
// A server component: it takes an already-fetched estimate and renders it. No
// state, no effects, nothing to hydrate — the numbers do not change until the
// assumption set does.
//
// **The intermediates are the argument; the total is just their product.** A
// panel that showed only "168,640 physical qubits" would be a black box, and
// worse than that on this particular page: for a small circuit, nearly all of
// that figure is magic-state factories bought to reach a chosen speed, and a
// reader shown only the sum concludes the estimator is broken. So every layer
// is on the page, the footprint is split into the parts that scale differently,
// and both runtime terms are shown next to the one that actually binds.
//
// The refusals get the same care as the numbers. Two of the four bases carry no
// cost at all, and most published entries land on one of them (163 of the
// then-283, measured 2026-07).
import type { ReactNode } from "react";
import type { PublicLocale } from "../lib/public-locale";
import type { RepositoryEstimate } from "../lib/repository/estimate";

// Re-exported so a page importing the panel gets its renderability rule from the
// same module, without reaching past it.
export { hasVisibleEstimate } from "../lib/repository/estimate";

const COPY = {
  en: {
    title: "Fault-tolerant cost",
    exact: "Counted exactly",
    estimated: "Estimated under a stated precision",
    refused: "Cost not stated",
    noCircuit: "No circuit to cost",
    exactBlurb:
      "Every operation in this circuit comes from a closed vocabulary, so its magic-state cost is counted rather than approximated.",
    cliffordBlurb:
      "This circuit is Clifford-only: it consumes no magic states at all. That is a measured property of the circuit, not a missing number.",
    estimatedBlurb:
      "This circuit's cost is dominated by arbitrary-angle rotations, which have no T-count until a synthesis precision is named. The figures below hold under the precision stated at the bottom of this panel and move with it.",
    physicalQubits: "Physical qubits",
    runtime: "Runtime",
    runtimeUnstated: "Not stated",
    magicStates: "Magic states",
    logicalQubits: "Logical qubits",
    none: "None",
    tradeTitle: "Two machines, not one number",
    tradeBlurb:
      "This circuit does not have a cost; it has a cost per machine, and almost all of the difference is magic-state factories — hardware bought for speed, not asked for by the circuit. Neither end below was chosen by anyone: one factory is the fewest the estimator will cost a magic-state circuit on, and the other is the crossover, derived. Only the footprint and the wall-clock move between them; everything else on this page is a property of the circuit and reads the same on both.",
    smallestMachine: "Smallest machine",
    smallestMachineNote: "The fewest factories this circuit can run on at all.",
    fastestMachine: "Fastest useful machine",
    fastestMachineNote: "Past this count, the reaction time binds and more factories change nothing.",
    factoryCount: "Factories",
    sameOnBoth: "Same on both machines.",
    detailNote: "The layers below cost the fastest useful machine — the right-hand column above.",
    layer1: "What the algorithm needs",
    layer1Note: "Architecture-independent. Nothing here mentions hardware.",
    layer2: "Error correction",
    layer3: "Physical footprint",
    layer4: "Wall-clock",
    tCount: "T gates",
    ofWhichSynthesis: "of which from rotation synthesis",
    toffoli: "Toffoli gates",
    nonCliffordDepth: "Serial non-Clifford depth",
    depthNote: "The one number no amount of hardware improves.",
    cliffordCount: "Clifford operations",
    codeDistance: "Code distance",
    codeDistanceNote:
      "The smallest distance whose logical error rate clears the target across every operation in the circuit.",
    logicalOperations: "Logical operations protected",
    errorBudget: "Error per operation",
    required: "needed",
    achieved: "achieved",
    dataPatches: "Circuit qubits",
    routing: "Routing space",
    factories: "Magic-state factories",
    factoryQubits: "Factory qubits",
    total: "Total",
    factoryNote:
      "Factories are hardware bought for speed, not for the circuit. Cost them separately from the circuit's own patches — for a small circuit they are nearly the whole figure.",
    throughputTerm: "Distillation throughput",
    reactionTerm: "Reaction-limited floor",
    binds: "binds",
    crossover: "Useful factory ceiling",
    crossoverNote:
      "Past this count the control system's feed-forward latency binds instead, and more factories change nothing.",
    unstatedRuntime:
      "Both runtime terms are magic-state terms, so a circuit that consumes none has no wall-clock under this model. Reporting zero would say it runs instantly.",
    assumptionsTitle: "Computed under",
    precision: "Rotation synthesis precision",
    perRotation: "T gates per rotation",
    perToffoli: "Magic states per Toffoli",
    errorRate: "Physical error rate",
    targetFailure: "Target failure probability",
    comparability:
      "Two estimates may be compared only when this identity matches. Change the precision or the hardware set and every number above is a different claim.",
    notesTitle: "Stated caveats",
    seconds: "s",
    ms: "ms",
    us: "µs",
    ns: "ns",
    hours: "h",
    days: "d",
    years: "y",
  },
  ja: {
    title: "誤り耐性計算のコスト",
    exact: "厳密にカウント",
    estimated: "指定精度のもとでの推定値",
    refused: "コストを提示できません",
    noCircuit: "コスト計算の対象となる回路がありません",
    exactBlurb:
      "この回路のすべての操作は既知の語彙に含まれるため、マジックステートのコストは近似ではなく厳密にカウントされています。",
    cliffordBlurb:
      "この回路はCliffordゲートのみで構成され、マジックステートを一切消費しません。これは数値の欠落ではなく、回路の測定された性質です。",
    estimatedBlurb:
      "この回路のコストは任意角度の回転が支配しており、合成精度を指定するまでT個数は定まりません。以下の数値はパネル下部に示した精度のもとで成り立ち、その値とともに変化します。",
    physicalQubits: "物理量子ビット",
    runtime: "実行時間",
    runtimeUnstated: "提示できません",
    magicStates: "マジックステート",
    logicalQubits: "論理量子ビット",
    none: "なし",
    tradeTitle: "1つの数値ではなく、2種類のマシン",
    tradeBlurb:
      "この回路に単一のコストはなく、マシンごとのコストがあります。その差のほとんどはマジックステート工場、すなわち回路が要求したものではなく速度のために用意するハードウェアです。以下の2つの端点はいずれも恣意的な選択ではありません。工場1つはマジックステートを消費する回路に対して見積もりが許す下限であり、もう一方は導出されたクロスオーバーです。両者で変わるのは規模と実時間だけであり、このページの他の数値は回路の性質としてどちらでも同じ値になります。",
    smallestMachine: "最小構成のマシン",
    smallestMachineNote: "この回路が動作しうる最少の工場数です。",
    fastestMachine: "有効な最速のマシン",
    fastestMachineNote: "これを超えると反応時間が律速となり、工場を増やしても変わりません。",
    factoryCount: "工場数",
    sameOnBoth: "どちらのマシンでも同じです。",
    detailNote: "以下の各層は「有効な最速のマシン」、つまり上の右列を対象としています。",
    layer1: "アルゴリズムが必要とするもの",
    layer1Note: "ハードウェアに依存しない量です。",
    layer2: "誤り訂正",
    layer3: "物理的な規模",
    layer4: "実時間",
    tCount: "Tゲート",
    ofWhichSynthesis: "うち回転合成に由来",
    toffoli: "Toffoliゲート",
    nonCliffordDepth: "非Clifford直列深さ",
    depthNote: "ハードウェアをいくら増やしても改善できない唯一の量です。",
    cliffordCount: "Clifford操作",
    codeDistance: "符号距離",
    codeDistanceNote:
      "回路中のすべての操作にわたって目標誤り率を満たす最小の距離です。",
    logicalOperations: "保護対象の論理操作数",
    errorBudget: "操作あたりの誤り率",
    required: "必要",
    achieved: "達成",
    dataPatches: "回路の量子ビット",
    routing: "ルーティング領域",
    factories: "マジックステート工場",
    factoryQubits: "工場の量子ビット",
    total: "合計",
    factoryNote:
      "工場は回路のためではなく速度のために用意するハードウェアです。回路自身のパッチとは分けて考えてください。小規模な回路では合計のほとんどを占めます。",
    throughputTerm: "蒸留スループット",
    reactionTerm: "反応時間による下限",
    binds: "律速",
    crossover: "工場数の有効上限",
    crossoverNote:
      "これを超えると制御系のフィードフォワード遅延が律速となり、工場を増やしても変わりません。",
    unstatedRuntime:
      "実行時間の2つの項はいずれもマジックステートに由来するため、マジックステートを消費しない回路の実時間はこのモデルでは提示できません。ゼロと報告すれば瞬時に終わると主張することになります。",
    assumptionsTitle: "計算の前提",
    precision: "回転合成の精度",
    perRotation: "回転1つあたりのTゲート",
    perToffoli: "Toffoli 1つあたりのマジックステート",
    errorRate: "物理誤り率",
    targetFailure: "目標失敗確率",
    comparability:
      "この識別子が一致する場合にのみ、2つの推定値を比較できます。精度やハードウェア前提を変えると、上のすべての数値は別の主張になります。",
    notesTitle: "明示された注意点",
    seconds: "秒",
    ms: "ミリ秒",
    us: "マイクロ秒",
    ns: "ナノ秒",
    hours: "時間",
    days: "日",
    years: "年",
  },
} as const;

/**
 * Widened from the `as const` literals on purpose: the two locales share a key
 * set, not a value set, so keying off `typeof COPY["en"]` would make every
 * Japanese string a type error rather than a translation.
 */
type Copy = { readonly [K in keyof (typeof COPY)["en"]]: string };

function count(value: number, locale: PublicLocale): string {
  return value.toLocaleString(locale === "ja" ? "ja-JP" : "en-US");
}

/**
 * A duration a person can hold in their head.
 *
 * Deliberately not `toLocaleString` on a raw seconds value: these span
 * microseconds to millions of years across the corpus, and both ends read as
 * noise in the other's unit. Years are the top unit rather than the largest
 * that fits, because past a few thousand years the distinction stops carrying
 * information — the answer is "not in your lifetime" either way.
 */
export function formatDuration(seconds: number, copy: Copy): string {
  const abs = Math.abs(seconds);
  if (abs < 1e-6) return `${(seconds * 1e9).toPrecision(3)} ${copy.ns}`;
  if (abs < 1e-3) return `${(seconds * 1e6).toPrecision(3)} ${copy.us}`;
  if (abs < 1) return `${(seconds * 1e3).toPrecision(3)} ${copy.ms}`;
  if (abs < 3600) return `${seconds.toPrecision(3)} ${copy.seconds}`;
  if (abs < 86_400) return `${(seconds / 3600).toPrecision(3)} ${copy.hours}`;
  if (abs < 31_557_600) return `${(seconds / 86_400).toPrecision(3)} ${copy.days}`;
  return `${(seconds / 31_557_600).toPrecision(3)} ${copy.years}`;
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "accent" | "muted";
}) {
  return (
    <div className={`mj-estimate-stat${tone ? ` mj-estimate-stat--${tone}` : ""}`}>
      <span className="mj-estimate-stat-label">{label}</span>
      <strong className="mj-estimate-stat-value">{value}</strong>
      {hint ? <span className="mj-estimate-stat-hint">{hint}</span> : null}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="mj-estimate-row">
      <dt>
        {label}
        {hint ? <span className="mj-estimate-row-hint">{hint}</span> : null}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * One end of the factory trade: a named machine and what this circuit costs on it.
 *
 * Factories, qubits and seconds are on the same column on purpose. Presented as
 * two ranges instead — "8,800 to 836,800 qubits" beside "20 µs to 6.9 ms" — the
 * two would read as correlated, and they are the opposite: the small machine is
 * the slow one. Pairing them per column is what makes that legible.
 */
function Machine({
  name,
  note,
  factories,
  qubits,
  runtime,
  copy,
  emphasis,
}: {
  name: string;
  note: string;
  factories: string;
  qubits: string;
  runtime: string;
  copy: Copy;
  emphasis?: boolean;
}) {
  return (
    <div className={`mj-estimate-machine${emphasis ? " mj-estimate-machine--primary" : ""}`}>
      <h5 className="mj-estimate-machine-name">{name}</h5>
      <dl className="mj-estimate-rows">
        <Row label={copy.factoryCount} value={factories} />
        <Row label={copy.physicalQubits} value={qubits} />
        <Row label={copy.runtime} value={runtime} />
      </dl>
      <p className="mj-estimate-machine-note">{note}</p>
    </div>
  );
}

function Layer({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mj-estimate-layer">
      <h4>{title}</h4>
      {note ? <p className="mj-estimate-layer-note">{note}</p> : null}
      <dl className="mj-estimate-rows">{children}</dl>
    </section>
  );
}

/**
 * The whole panel, or nothing.
 *
 * Returns null in exactly the cases `hasVisibleEstimate` rejects. That is
 * belt-and-braces, not the guard: by the time this renders the call site has
 * already decided there is a section to fill.
 */
export function RepositoryEstimatePanel({
  estimate,
  locale,
}: {
  estimate: RepositoryEstimate | null;
  locale: PublicLocale;
}) {
  if (estimate === null) return null;
  const copy = COPY[locale === "ja" ? "ja" : "en"];

  // Nothing was attempted and nothing failed. Rendering a refusal here would
  // invent a doubt about 163 literature and operator records that carry no
  // circuit by design.
  if (estimate.basis === "no_circuit") return null;

  if (estimate.basis === "refused") {
    return (
      <div className="mj-estimate mj-estimate--refused">
        <p className="mj-estimate-verdict">{copy.refused}</p>
        <p className="mj-estimate-reason">{estimate.reason}</p>
      </div>
    );
  }

  const { logical, distance, footprint, runtime, smallestMachine, assumptions } = estimate;
  // The parser guarantees these are present for a priced basis; the guard is
  // for the type checker and costs nothing.
  if (!logical || !distance || !footprint || !runtime) return null;

  const isClifford = logical.magicStates === 0;
  const isEstimated = estimate.basis === "estimated";
  const circuitQubits = footprint.dataPatchQubits + footprint.routingQubits;
  const duration = (seconds: number | null) =>
    seconds === null ? copy.runtimeUnstated : formatDuration(seconds, copy);

  return (
    <div className={`mj-estimate mj-estimate--${estimate.basis}`}>
      <p className="mj-estimate-verdict">{isEstimated ? copy.estimated : copy.exact}</p>
      <p className="mj-estimate-blurb">
        {isEstimated ? copy.estimatedBlurb : isClifford ? copy.cliffordBlurb : copy.exactBlurb}
      </p>

      {/* Two machines when there are two, one headline when there is only one.
          The single-figure headline is not wrong on the 64 Clifford-only entries
          — they buy no factories, so there is no trade and nothing to compare —
          but on the 56 that do have one, a single number IS the misreading this
          panel exists to prevent, so the comparison replaces it rather than
          sitting under it. */}
      {smallestMachine === null ? (
        <div className="mj-estimate-headline">
          <Stat
            label={copy.physicalQubits}
            value={count(footprint.totalPhysicalQubits, locale)}
            tone="accent"
          />
          <Stat label={copy.runtime} value={duration(runtime.seconds)} tone={runtime.seconds === null ? "muted" : undefined} />
          <Stat
            label={copy.magicStates}
            value={logical.magicStates === 0 ? copy.none : count(logical.magicStates, locale)}
            tone={logical.magicStates === 0 ? "muted" : undefined}
          />
        </div>
      ) : (
        <section className="mj-estimate-trade">
          <h4>{copy.tradeTitle}</h4>
          <p className="mj-estimate-layer-note">{copy.tradeBlurb}</p>
          <div className="mj-estimate-machines">
            <Machine
              name={copy.smallestMachine}
              note={copy.smallestMachineNote}
              factories={count(smallestMachine.runtime.factoryCount, locale)}
              qubits={count(smallestMachine.footprint.totalPhysicalQubits, locale)}
              runtime={duration(smallestMachine.runtime.seconds)}
              copy={copy}
            />
            <Machine
              name={copy.fastestMachine}
              note={copy.fastestMachineNote}
              factories={count(runtime.factoryCount, locale)}
              qubits={count(footprint.totalPhysicalQubits, locale)}
              runtime={duration(runtime.seconds)}
              copy={copy}
              emphasis
            />
          </div>
          <dl className="mj-estimate-rows">
            <Row
              label={copy.magicStates}
              value={count(logical.magicStates, locale)}
              hint={copy.sameOnBoth}
            />
          </dl>
        </section>
      )}

      <Layer title={copy.layer1} note={copy.layer1Note}>
        <Row label={copy.logicalQubits} value={count(logical.logicalQubits, locale)} />
        <Row
          label={copy.tCount}
          value={
            logical.tFromSynthesis > 0
              ? `${count(logical.tCount, locale)} (${count(logical.tFromSynthesis, locale)} ${copy.ofWhichSynthesis})`
              : count(logical.tCount, locale)
          }
        />
        <Row label={copy.toffoli} value={count(logical.toffoliCount, locale)} />
        <Row
          label={copy.nonCliffordDepth}
          value={count(logical.nonCliffordDepth, locale)}
          hint={copy.depthNote}
        />
        <Row label={copy.cliffordCount} value={count(logical.cliffordCount, locale)} />
      </Layer>

      <Layer title={copy.layer2}>
        <Row
          label={copy.codeDistance}
          value={`d = ${distance.codeDistance}`}
          hint={copy.codeDistanceNote}
        />
        <Row label={copy.logicalOperations} value={count(distance.logicalOperations, locale)} />
        <Row
          label={copy.errorBudget}
          value={`${distance.achievedErrorPerOperation.toExponential(2)} ${copy.achieved} · ${distance.requiredErrorPerOperation.toExponential(2)} ${copy.required}`}
        />
      </Layer>

      {/* Which machine the remaining layers describe. Without this the reader
          has just been shown two footprints and then meets a third heading
          called "Physical footprint" with one number under it. */}
      <Layer
        title={copy.layer3}
        note={
          smallestMachine !== null
            ? `${copy.detailNote} ${copy.factoryNote}`
            : footprint.factoryQubits > 0
              ? copy.factoryNote
              : undefined
        }
      >
        <Row label={copy.dataPatches} value={count(circuitQubits, locale)} />
        <Row
          label={copy.factoryQubits}
          value={
            footprint.factoryQubits === 0
              ? copy.none
              : `${count(footprint.factoryQubits, locale)} (${count(runtime.factoryCount, locale)} × ${copy.factories.toLowerCase()})`
          }
        />
        <Row label={copy.total} value={count(footprint.totalPhysicalQubits, locale)} />
      </Layer>

      <Layer title={copy.layer4} note={runtime.seconds === null ? copy.unstatedRuntime : undefined}>
        {runtime.seconds === null ? null : (
          <>
            <Row
              label={copy.throughputTerm}
              value={
                runtime.throughputSeconds === null
                  ? copy.runtimeUnstated
                  : `${formatDuration(runtime.throughputSeconds, copy)}${runtime.bindingTerm === "throughput" ? ` — ${copy.binds}` : ""}`
              }
            />
            <Row
              label={copy.reactionTerm}
              value={`${formatDuration(runtime.reactionLimitedSeconds, copy)}${runtime.bindingTerm === "reaction" ? ` — ${copy.binds}` : ""}`}
            />
          </>
        )}
        {runtime.factoryCrossover === null ? null : (
          <Row
            label={copy.crossover}
            value={count(runtime.factoryCrossover, locale)}
            hint={copy.crossoverNote}
          />
        )}
      </Layer>

      {estimate.notes.length > 0 ? (
        <section className="mj-estimate-notes">
          <h4>{copy.notesTitle}</h4>
          <ul>
            {estimate.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mj-estimate-assumptions">
        <h4>{copy.assumptionsTitle}</h4>
        <p className="mj-estimate-identity">
          <code>{assumptions.identity}</code>
        </p>
        <dl className="mj-estimate-rows">
          {assumptions.rotationSynthesisEpsilon === null ? null : (
            <Row
              label={copy.precision}
              value={`ε = ${assumptions.rotationSynthesisEpsilon.toExponential(0)}`}
            />
          )}
          {assumptions.tPerRotation === null ? null : (
            <Row label={copy.perRotation} value={count(assumptions.tPerRotation, locale)} />
          )}
          <Row label={copy.perToffoli} value={count(assumptions.tPerToffoli, locale)} />
          <Row label={copy.errorRate} value={assumptions.physicalErrorRate.toExponential(0)} />
          {estimate.targetFailureProbability === null ? null : (
            <Row
              label={copy.targetFailure}
              value={estimate.targetFailureProbability.toExponential(0)}
            />
          )}
        </dl>
        <p className="mj-estimate-citation">{assumptions.citation}</p>
        <p className="mj-estimate-comparability">{copy.comparability}</p>
      </section>
    </div>
  );
}
