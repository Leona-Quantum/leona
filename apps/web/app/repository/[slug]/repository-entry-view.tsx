"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SyntaxHighlightedCode } from "@majorana/ui";
// Leaves, NOT `lib/public-repository`. This is a `"use client"` component, and
// that barrel value-imports all nine `entries-*.ts` files — so importing these
// through it shipped the whole Atlas catalog to anyone opening a single record,
// a page that already receives the one entry it renders as a prop.
// `lib/client-catalog-leak.test.ts` fails if this import comes back.
import { entryVerificationMethods } from "../../../lib/repository/entry-verification";
import { getPublicRepositoryVariant } from "../../../lib/repository/entry-variant";
import {
  PUBLIC_REPOSITORY_FRAMEWORKS,
  type PublicRepositoryClassicalComparison,
  type PublicRepositoryEntry,
  type PublicRepositoryFramework,
} from "../../../lib/repository/types";
import type { PublicLocale } from "../../../lib/public-locale";
import { MarkdownContent } from "../../../components/chat-markdown";
import { StarIcon } from "../../../components/icons";
import { VerificationMethodChips, VerificationTierBadge } from "../../../components/repository-verification";
import { AtlasSection, AtlasSectionNav, atlasNavItemId } from "../../../components/atlas-sections";
import { ATLAS_CHROME_COPY, ATLAS_SECTION_LABELS } from "../../../lib/repository/section-labels";
import { RECORD_SECTION_ORDER, recordSectionHref, recordSections, type RecordSectionId } from "../../../lib/repository/record-card";
import { loadStarredRepositorySlugs, toggleRepositoryStar } from "../../../lib/repository-stars";
import { TOPICS_BY_ID } from "../../../lib/repository/topics";
import { TOPICS_A_CATEGORY_TAB_OWNS } from "../../../lib/repository/topic-filter";
import { isInformative, isPermanentGap, knownGapsState } from "../../../lib/repository/coverage";
import type {
  SourceCoverage,
  SourceCoverageAxis,
  SourceCoverageStatus,
} from "../../../lib/repository/types";
import { RepositoryExportAction } from "../repository-export";
import { AtlasCircuitFigure, AtlasOutcomeBars } from "../../../components/atlas-circuit";
import { AtlasGlance, type AtlasGlanceItem } from "../../../components/atlas-glance";
import { hasAtlasCircuit } from "../../../lib/repository/atlas-circuit-layout";
import { isPlaceholderDiagram } from "../../../lib/repository/placeholder-diagrams";
import { AtlasWorkedExampleComponentNote, AtlasWorkedExampleFigure } from "../../../components/atlas-worked-example";
import type { WorkedExampleSummary } from "../../../lib/atlas-worked-example-summary";
// Type-only: this component never imports worked-examples.ts's value exports
// (WORKED_EXAMPLES/workedExample), only the shape of the one resolved example
// the server already picked. See worked-example-resolution.ts's doc comment.
import type { WorkedExample } from "../../../lib/worked-examples";

const COPY = {
  en: {
    back: "← Atlas",
    openMap: "Open on the map",
    updated: "Updated",
    keywords: "Keywords",
    sectionsLabel: "Sections of this record",
    structure: "Circuit structure",
    cost: "Fault-tolerant cost",
    outcomes: "Expected outcomes",
    framework: "Framework",
    copy: "Copy code",
    copied: "Copied",
    request: "Request a conversion",
    star: "Star",
    unstar: "Unstar",
    starNote: "Atlas stars stay in the public catalog. Saving this entry to your workspace starts an unstarred private copy.",
    verification: "Verification",
    method: "Method",
    result: "Result",
    caveat: "Caveat",
    source: "Source",
    coverage: "What the source documents",
    coverageTheory: "Theory",
    coverageSimulation: "Simulation",
    coverageHardware: "Hardware",
    coverageReported: "reported",
    coverageAbsent: "not in this source",
    coverageUnknown: "not checked",
    coverageNote:
      "What the source itself reports \u2014 not how Leona verified this record. \u201cNot checked\u201d means nobody has read the source for that axis; \u201cnot in this source\u201d means somebody has, and it is not there.",
    gapsNone: "Reviewed against the source, and no gaps were found.",
    gapsUnreviewed: "Nobody has reviewed this record for gaps yet.",
    gapPermanent: "permanent",
    gapReason_not_stated_in_source: "not stated in the source",
    gapReason_closable_from_bibliography: "closable from the bibliography",
    gapReason_field_disagrees: "the field genuinely disagrees",
    gapReason_nisq_specific: "specific to that paper\u2019s device",
    gapRole_problem: "Problem",
    gapRole_input: "Input",
    gapRole_input_mapping: "Input mapping",
    gapRole_algorithm: "Algorithm",
    gapRole_readout: "Readout",
    gapRole_output: "Output",
    comparison: "Quantum vs classical",
    baseline: "Classical baseline",
    quantum: "Quantum claim",
    practical: "How to compare",
    metricLabel: "Metric",
    metricClassical: "Classical",
    metricQuantum: "Quantum",
    industry: "Industry use cases",
    related: "Related entries",
    noCode: "No native snippet published yet.",
    notCircuit: "This record is not a concrete circuit.",
    kind: "Kind",
    contributor: "Contributor",
    reviewedBy: "Reviewed by",
    license: "License",
    // UX pass 6: the figure and the strip under it.
    glance: "At a glance",
    steps: "Steps",
    wires: "Wires",
    papers: "Papers",
    onWires: "on",
    sourceReports: "Source reports",
  },
  ja: {
    back: "← Atlas",
    openMap: "地図で開く",
    updated: "更新日",
    keywords: "キーワード",
    sectionsLabel: "この項目のセクション",
    structure: "回路の構造",
    cost: "誤り耐性計算のコスト",
    outcomes: "期待される出力",
    framework: "フレームワーク",
    copy: "コードをコピー",
    copied: "コピー済み",
    request: "変換をリクエスト",
    star: "スターを付ける",
    unstar: "スターを外す",
    starNote: "スターはAtlasに保存されます。ワークスペースに追加したコピーには引き継がれません。",
    verification: "検証",
    method: "方法",
    result: "結果",
    caveat: "注意点",
    source: "出典",
    coverage: "\u51fa\u5178\u304c\u8a18\u8f09\u3057\u3066\u3044\u308b\u7bc4\u56f2",
    coverageTheory: "\u7406\u8ad6",
    coverageSimulation: "\u30b7\u30df\u30e5\u30ec\u30fc\u30b7\u30e7\u30f3",
    coverageHardware: "\u5b9f\u6a5f",
    coverageReported: "\u8a18\u8f09\u3042\u308a",
    coverageAbsent: "\u3053\u306e\u51fa\u5178\u306b\u306f\u306a\u3057",
    coverageUnknown: "\u672a\u78ba\u8a8d",
    coverageNote:
      "\u51fa\u5178\u81ea\u8eab\u304c\u4f55\u3092\u5831\u544a\u3057\u3066\u3044\u308b\u304b\u3067\u3042\u308a\u3001Leona \u304c\u3069\u3046\u691c\u8a3c\u3057\u305f\u304b\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002\u300c\u672a\u78ba\u8a8d\u300d\u306f\u305d\u306e\u8ef8\u306b\u3064\u3044\u3066\u8ab0\u3082\u51fa\u5178\u3092\u8aad\u3093\u3067\u3044\u306a\u3044\u3053\u3068\u3001\u300c\u3053\u306e\u51fa\u5178\u306b\u306f\u306a\u3057\u300d\u306f\u8aad\u3093\u3060\u4e0a\u3067\u5b58\u5728\u3057\u306a\u3044\u3053\u3068\u3092\u610f\u5473\u3057\u307e\u3059\u3002",
    gapsNone: "\u51fa\u5178\u3068\u7167\u5408\u6e08\u307f\u3067\u3001\u6b20\u843d\u306f\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f\u3002",
    gapsUnreviewed: "\u3053\u306e\u9805\u76ee\u306f\u307e\u3060\u6b20\u843d\u306e\u78ba\u8a8d\u304c\u884c\u308f\u308c\u3066\u3044\u307e\u305b\u3093\u3002",
    gapPermanent: "\u6052\u4e45\u7684",
    gapReason_not_stated_in_source: "\u51fa\u5178\u306b\u8a18\u8f09\u304c\u306a\u3044",
    gapReason_closable_from_bibliography: "\u53c2\u8003\u6587\u732e\u304b\u3089\u88dc\u3048\u308b",
    gapReason_field_disagrees: "\u5206\u91ce\u5185\u3067\u898b\u89e3\u304c\u5206\u304b\u308c\u3066\u3044\u308b",
    gapReason_nisq_specific: "\u305d\u306e\u8ad6\u6587\u306e\u5b9f\u6a5f\u56fa\u6709",
    gapRole_problem: "\u554f\u984c",
    gapRole_input: "\u5165\u529b",
    gapRole_input_mapping: "\u5165\u529b\u5909\u63db",
    gapRole_algorithm: "\u30a2\u30eb\u30b4\u30ea\u30ba\u30e0",
    gapRole_readout: "\u8aad\u307f\u51fa\u3057",
    gapRole_output: "\u51fa\u529b",
    comparison: "量子と古典の比較",
    baseline: "古典ベースライン",
    quantum: "量子手法で期待されること",
    practical: "比較の方法",
    metricLabel: "指標",
    metricClassical: "古典",
    metricQuantum: "量子",
    industry: "活用が考えられる分野",
    related: "関連エントリ",
    noCode: "このフレームワーク向けのコードはまだ公開されていません。",
    notCircuit: "この項目には実行可能な回路がありません。",
    kind: "種別",
    contributor: "投稿者",
    reviewedBy: "確認者",
    license: "ライセンス",
    glance: "概要",
    steps: "ステップ",
    wires: "ワイヤー",
    papers: "論文",
    onWires: "対象：",
    sourceReports: "出典の記載",
  },
} as const;
type RepositoryCopy = (typeof COPY)[keyof typeof COPY];

function variantLabel(status: "native" | "conversion" | "source" | "unsupported", locale: PublicLocale): string {
  if (locale === "ja") {
    if (status === "native") return "ネイティブ";
    if (status === "conversion") return "変換済み";
    if (status === "source") return "元ソース";
    return "未対応";
  }
  if (status === "native") return "Native";
  if (status === "conversion") return "Converted";
  if (status === "source") return "Source reference";
  return "Unsupported";
}

const DATA_LABELS_JA: Record<string, string> = {
  Qubits: "量子ビット",
  Depth: "深さ",
  Outcomes: "出力",
  Shots: "ショット",
  Queries: "クエリ数",
  Phase: "位相",
  "Rotation layers": "回転レイヤー",
  "Gate family": "ゲート系統",
  "Bit order": "ビット順",
  Export: "エクスポート",
  Matrix: "行列",
  Rotation: "回転",
  Square: "二乗",
  Power: "累乗",
  Family: "系統",
  Control: "制御",
  Target: "対象",
  "Universal role": "普遍量子計算での役割",
  "Native form": "ネイティブ形式",
  Decomposition: "分解",
  Role: "役割",
  Promise: "前提条件",
  "Quantum queries": "量子クエリ",
  "Classical queries": "古典クエリ",
  Function: "関数",
  "Input register": "入力レジスタ",
  "Output register": "出力レジスタ",
  Samples: "サンプル数",
  Constraint: "制約",
  Encoding: "符号化",
  Transmission: "送信",
  Readout: "読み出し",
};

function dataLabel(label: string, locale: PublicLocale): string {
  return locale === "ja" ? DATA_LABELS_JA[label] ?? label : label;
}

const ALGORITHM_FAMILY_LABELS_JA: Record<string, string> = {
  "Single-qubit gate": "単一量子ビットゲート",
  "Pauli operator": "パウリ演算子",
  "Controlled gate": "制御ゲート",
  "Two-qubit gate": "2量子ビットゲート",
  "Quantum query algorithm": "量子クエリアルゴリズム",
  "Bell / entanglement": "ベル状態・量子もつれ",
  "GHZ / entanglement": "GHZ状態・量子もつれ",
  "Amplitude amplification": "振幅増幅",
  "Hidden-period / factoring": "隠れ周期・因数分解",
  "Amplitude estimation": "振幅推定",
  "Variational quantum algorithm": "変分量子アルゴリズム",
  "Eigenvalue estimation": "固有値推定",
  "Quantum linear algebra": "量子線形代数",
  "Quantum machine learning": "量子機械学習",
  "Entanglement and communication": "量子もつれと通信",
  "Quantum error correction": "量子誤り訂正",
  "Quantum Fourier transform": "量子フーリエ変換",
  "Hamiltonian simulation": "ハミルトニアンシミュレーション",
  "Hamiltonian / observable": "ハミルトニアン・観測量",
  "Rotation gate": "回転ゲート",
  "Phase gate": "位相ゲート",
  "Multi-qubit gate": "多量子ビットゲート",
  "Entangled state": "量子もつれ状態",
  "Encoded state": "符号化状態",
  "Sampling / benchmarking": "サンプリング・ベンチマーク",
  "Error mitigation": "誤り緩和",
  "Optimization / annealing": "最適化・アニーリング",
};

function algorithmFamilyLabel(family: string, locale: PublicLocale): string {
  return locale === "ja" ? ALGORITHM_FAMILY_LABELS_JA[family] ?? family : family;
}

export interface RelatedEntrySummary {
  slug: string;
  title: string;
  titleJa: string;
  categoryLabel: string;
  categoryLabelJa: string;
}

export function RepositoryEntryView({
  entry,
  locale,
  isSignedIn,
  signInHref,
  related,
  estimate,
  profile,
  connections,
  layers,
  hasLayers = false,
  mapHref = null,
  section = null,
  workedExample = null,
  workedExampleComponents = [],
}: {
  entry: PublicRepositoryEntry;
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
  /**
   * The worked example this record's first resolvable link names, when its
   * relation is `"instance"` — resolved server-side (worked-example-resolution.ts)
   * and passed down as plain data, never re-derived here. Replaces the plain
   * circuit hero; null on every record with no resolvable instance link (most
   * of them — 84 of the then-284 records have any link at all, and a link's
   * example may not exist yet).
   */
  workedExample?: WorkedExample | null;
  /**
   * Every resolvable `"component"`- or `"used-in"`-relation link, in the
   * record's own order — never an instance of the record itself, and never
   * the full figure. `"component"` is this record's method using the
   * example; `"used-in"` is the reverse, the example's algorithm using this
   * record. Each gets its own note wording (atlas-worked-example.tsx).
   */
  workedExampleComponents?: readonly WorkedExampleSummary[];
  /**
   * The cost panel, rendered on the server and passed in as a slot.
   *
   * A slot rather than a fetch because this component is a client component and
   * the estimate comes from the anonymous catalog API, which by standing policy
   * (see lib/repository-source.ts) is read only by server code — proxying it to
   * the browser would create a second unauthenticated surface for no gain.
   * Null when there is no estimate to show; Performance then draws without it.
   */
  estimate?: ReactNode;
  /**
   * The circuit-structure panel (R1), on the same slot terms as `estimate`
   * above and for the same reason. Null when the entry carries no circuit.
   */
  profile?: ReactNode;
  /**
   * The interface panel — what this entry takes and returns, and what meets it.
   *
   * A slot like the two above, but passed unconditionally: an entry with no
   * ports has an answer ("not a pipeline stage"), and most records are in that
   * position (121 of the then-283, measured 2026-07). Drawn under **both**
   * Input and Output, the way the card draws its contract under both — one
   * field read twice, so the two names cannot disagree about it.
   */
  connections?: ReactNode;
  /**
   * Where the layer graph names this record, or null when it does not.
   *
   * Null on most records (279 of the then-283, measured 2026-07). It sits in
   * the *In the Atlas* section beside the related records, and `hasLayers`
   * says whether it drew anything, so the section can be an honest gap.
   */
  layers?: ReactNode;
  /** Whether `layers` draws anything — `entryLayerPresence`, computed by the page. */
  hasLayers?: boolean;
  /** The map, opened on the card that names this record, or null when none does. */
  mapHref?: string | null;
  /**
   * Which section `?sec=` named, or null for the first — resolved on the server
   * against the record's own list, exactly as the card resolves its own.
   */
  section?: RecordSectionId | null;
  related: RelatedEntrySummary[];
}) {
  const copy = COPY[locale];
  const chrome = ATLAS_CHROME_COPY[locale];
  const labels = ATLAS_SECTION_LABELS[locale];
  const ja = locale === "ja";
  const [framework, setFramework] = useState<PublicRepositoryFramework>(entry.framework);
  const [copied, setCopied] = useState(false);
  const [starred, setStarred] = useState(false);
  const [showing, setShowing] = useState<RecordSectionId>(section ?? RECORD_SECTION_ORDER[0]);
  const variant = useMemo(() => getPublicRepositoryVariant(entry, framework), [entry, framework]);
  const methods = entryVerificationMethods(entry);
  // Resolved through the vocabulary rather than rendered from the ids, so an id
  // the API knows and this build does not is dropped instead of printed raw.
  //
  // The four topics a category tab owns are dropped as well (ai-ops 75). The
  // eyebrow above the name already says which kind this is; a chip saying it
  // again, linking onto a smaller number, was the second answer to one question.
  const topics = (entry.topics ?? [])
    .filter((id) => !TOPICS_A_CATEGORY_TAB_OWNS.has(id))
    .map((id) => TOPICS_BY_ID.get(id))
    .filter((topic): topic is NonNullable<typeof topic> => topic !== undefined);
  const title = ja ? entry.titleJa : entry.title;
  const description = ja ? entry.descriptionJa : entry.description;
  const introduction = ja ? entry.introductionJa : entry.introduction;
  const explanation = ja ? entry.explanationMdJa ?? entry.explanationJa : entry.explanationMd ?? entry.explanation;
  const hasProfile = profile !== null && profile !== undefined;
  const hasEstimate = estimate !== null && estimate !== undefined;
  // Held or gap is decided in `record-card.ts`, where a test can read it.
  const sections = useMemo(
    () =>
      recordSections({
        entry,
        locale,
        hasProfile,
        hasEstimate,
        hasLayers,
        relatedCount: related.length,
        words: { unreviewed: copy.gapsUnreviewed, notCircuit: copy.notCircuit },
      }),
    [entry, locale, hasProfile, hasEstimate, hasLayers, related.length, copy],
  );
  const base = `/repository/${entry.slug}`;

  useEffect(() => {
    setStarred(loadStarredRepositorySlugs().has(entry.slug));
  }, [entry.slug]);

  // A navigation that names a section wins over whatever a click chose before it.
  useEffect(() => {
    if (section !== null) setShowing(section);
  }, [section]);

  function handleStar() {
    setStarred(toggleRepositoryStar(entry.slug));
  }

  // A click switches sections without a round trip and leaves the address
  // behind it, so the page a reader reloads or shares is the one they saw.
  // The link still carries the address for a reader with JavaScript off.
  function select(id: string) {
    const next = RECORD_SECTION_ORDER.find((candidate) => candidate === id);
    if (next === undefined) return;
    setShowing(next);
    window.history.replaceState(window.history.state, "", recordSectionHref(base, next));
  }

  async function copyCode() {
    if (!variant.code) return;
    await navigator.clipboard.writeText(variant.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const facts = [...entry.resources, ...entry.metadata];
  const industry = ja ? entry.industryUseCasesJa ?? entry.industryUseCases : entry.industryUseCases;
  // UX pass 6: the drawing leads the page, and a strip under it says what the
  // record holds. Every tile is a field of this record read as it is — the step
  // and wire counts are the lengths of its own lists, the resource rows are its
  // own labels and values — and a field it does not carry gives no tile.
  const drawing = entry.visualization;
  // A stock placeholder diagram (§ isPlaceholderDiagram) is not a drawing of
  // this record — it is the schema's default, identical across 177 unrelated
  // records — so it draws nothing here: no hero figure, no steps/wires glance
  // tiles. The "example" section makes the matching call in `record-card.ts`.
  const hasDrawing = hasAtlasCircuit(drawing) && !isPlaceholderDiagram(drawing);
  const reported = [
    entry.sourceCoverage?.simulation === "reported" ? copy.coverageSimulation : null,
    entry.sourceCoverage?.hardware === "reported" ? copy.coverageHardware : null,
  ].filter((axis): axis is NonNullable<typeof axis> => axis !== null);
  const glance: AtlasGlanceItem[] = [
    ...(hasDrawing
      ? [
          { key: "steps", label: copy.steps, value: String(drawing.operations.length) },
          { key: "wires", label: copy.wires, value: String(drawing.wires.length) },
        ]
      : []),
    ...entry.resources.map((row) => ({ key: `resource-${row.label}`, label: dataLabel(row.label, locale), value: row.value })),
    ...(reported.length > 0
      ? [{ key: "source-reports", label: copy.sourceReports, value: reported.join(ja ? "・" : ", "), tone: "ok" as const }]
      : []),
    ...(entry.literature?.length
      ? [{ key: "papers", label: copy.papers, value: String(entry.literature.length), href: "#mj-record-references" }]
      : []),
  ];

  function body(id: RecordSectionId): ReactNode {
    switch (id) {
      case "when-it-applies":
        return <p>{introduction}</p>;
      case "input":
      case "output":
        return connections;
      case "theory":
        return <MarkdownContent source={explanation} className="mj-repo-markdown" />;
      case "requires":
        return (
          <dl className="mj-card-dl">
            {facts.map((row) => (
              <div key={`${row.label}-${row.value}`}>
                <dt>{dataLabel(row.label, locale)}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        );
      case "example":
        return (
          <>
            {/* The drawing leads the page now, above these sections, so this
                section lists its steps in words instead of drawing it twice —
                the reading a screen reader, a copy-paste and a crawler get. */}
            <ol className="mj-atlas-steplist">
              {entry.visualization.operations.map((operation, index) => (
                <li key={`${operation.label}-${index}`}>
                  <code>{operation.label}</code>{" "}
                  <span>
                    {copy.onWires}{" "}
                    {operation.qubits
                      .map((qubit) => entry.visualization.wires[qubit])
                      .filter((wire): wire is string => wire !== undefined)
                      .join(ja ? "、" : ", ")}
                  </span>
                </li>
              ))}
            </ol>
            {entry.visualization.outcomes.length > 0 ? (
              <div className="mj-repository-outcomes" aria-label={copy.outcomes}>
                {entry.visualization.outcomes.map((outcome) => (
                  <div className="mj-repository-outcome" key={outcome.label}>
                    <div className="mj-repository-outcome-label">
                      <span>{outcome.label}</span>
                      <strong>{Math.round(outcome.probability * 100)}%</strong>
                    </div>
                    <div className="mj-repository-outcome-track">
                      <span style={{ width: `${Math.max(0, Math.min(1, outcome.probability)) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        );
      case "performance":
        return (
          <>
            {/* Structure before cost: the cost is computed from the structure. */}
            {hasProfile ? (
              <>
                <h2 className="mj-record-subhead">{copy.structure}</h2>
                {profile}
              </>
            ) : null}
            {hasEstimate ? (
              <>
                <h2 className="mj-record-subhead">{copy.cost}</h2>
                {estimate}
              </>
            ) : null}
            <h2 className="mj-record-subhead">{copy.comparison}</h2>
            <ClassicalComparison
              comparison={entry.classicalComparison ?? defaultClassicalComparison(entry)}
              locale={locale}
              copy={copy}
            />
          </>
        );
      case "contested":
        return <KnownGapsBody gaps={entry.knownGaps} locale={locale} copy={copy} />;
      case "implementations":
        return (
          <>
            <div className="mj-repo-code-controls">
              <label className="mj-repository-framework-picker">
                <span>{copy.framework}</span>
                <select value={framework} onChange={(event) => setFramework(event.target.value as PublicRepositoryFramework)}>
                  {PUBLIC_REPOSITORY_FRAMEWORKS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <span
                className={`mj-repository-variant-status mj-repository-variant-status--${variant.status === "source" ? "conversion" : variant.status}`}
              >
                {variantLabel(variant.status, locale)}
              </span>
            </div>
            {variant.code ? (
              <div className="mj-code">
                <div className="mj-code-head">
                  <span className="mj-code-file">{variant.filename}</span>
                  <button className="mj-code-copy" type="button" onClick={copyCode}>
                    {copied ? copy.copied : copy.copy}
                  </button>
                </div>
                <pre className="mj-code-body" tabIndex={0} role="region" aria-label={`${title} ${framework} source code`}>
                  <SyntaxHighlightedCode code={variant.code} language={variant.language} />
                </pre>
              </div>
            ) : (
              <div className="mj-repository-code-placeholder">
                <strong>{variant.status === "unsupported" ? copy.notCircuit : copy.noCode}</strong>
                <p>{variant.note}</p>
                {variant.status !== "unsupported" ? (
                  <a className="mj-secondary-button" href="/contact">
                    {copy.request}
                  </a>
                ) : null}
              </div>
            )}
            {variant.note && variant.code ? <p className="mj-repository-code-note">{variant.note}</p> : null}
          </>
        );
      case "records":
        return (
          <>
            {layers}
            {related.length > 0 ? (
              <>
                <h2 className="mj-record-subhead">{copy.related}</h2>
                <ul className="mj-card-list">
                  {related.map((item) => (
                    <li key={item.slug}>
                      <a href={`/repository/${item.slug}`}>{ja ? item.titleJa : item.title}</a>
                      <p className="mj-card-list-blurb">{ja ? item.categoryLabelJa : item.categoryLabel}</p>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        );
      default: {
        const unreachable: never = id;
        return unreachable;
      }
    }
  }

  return (
    <div className="mj-record-page">
      {/* The card, as a page. Eyebrow, name, lede, the way onward, then the row
          of section names and one section under it — the anatomy of
          `MapCardPanel`, drawn by the same `atlas-sections.tsx` functions. The
          hero, the two-column layout and the stack of disclosures this page
          used to have went in the 2026-09-10 Atlas pass. */}
      <article className="mj-card mj-card--page" aria-labelledby="mj-record-title">
        <a className="mj-back-link" href="/repository">
          {copy.back}
        </a>
        <p className="mj-card-eyebrow">
          {ja ? entry.categoryLabelJa : entry.categoryLabel} · {algorithmFamilyLabel(entry.algorithmFamily, locale)}
        </p>
        <h1 id="mj-record-title">{title}</h1>
        <p className="mj-card-lede">{description}</p>
        <p className="mj-card-refinement">
          <VerificationTierBadge methods={methods} locale={locale} />
          <span>
            {copy.updated} <time dateTime={entry.updatedAt}>{entry.updatedAt}</time>
          </span>
        </p>
        {/* The closed vocabulary, each term carrying its definition on hover —
            a vocabulary whose terms a reader has to guess at is a vocabulary
            they will read wrong. The free keywords sit in the Source card below;
            they are a different kind of claim, and 217 of the corpus's 307 are
            worn by exactly one record. */}
        {topics.length > 0 ? (
          <div className="mj-repository-topics" aria-label={ja ? "トピック" : "Topics"} data-tour="atlas-entry-topics">
            {topics.map((topic) => (
              <a
                key={topic.id}
                className={`mj-repository-topic mj-repository-topic--${topic.facet}`}
                href={`/repository?topic=${encodeURIComponent(topic.id)}`}
                title={ja ? topic.definitionJa : topic.definition}
              >
                {ja ? topic.labelJa : topic.label}
              </a>
            ))}
          </div>
        ) : null}
        <p className="mj-card-onward">
          {mapHref !== null ? <a href={mapHref} data-tour="atlas-entry-map">{copy.openMap}</a> : null}
          <button
            className={`mj-star-toggle${starred ? " is-starred" : ""}`}
            type="button"
            aria-pressed={starred}
            title={starred ? copy.unstar : copy.star}
            onClick={handleStar}
          >
            <StarIcon size={14} filled={starred} />
            {starred ? copy.unstar : copy.star}
          </button>
          <RepositoryExportAction slug={entry.slug} title={title} isSignedIn={isSignedIn} signInHref={signInHref} locale={locale} />
        </p>

        {workedExample || hasDrawing || glance.length > 0 ? (
          <section className="mj-atlas-hero" aria-label={copy.glance}>
            {workedExample ? (
              // A worked example of the record itself, in place of the plain
              // circuit drawing — whether that drawing exists or is a
              // placeholder. The glance strip (resources, papers, source
              // reports) below is unrelated to which drawing this is, and
              // stays either way.
              <AtlasWorkedExampleFigure example={workedExample} locale={locale} isSignedIn={isSignedIn} signInHref={signInHref} />
            ) : hasDrawing ? (
              <AtlasCircuitFigure
                source={drawing}
                title={title}
                locale={locale}
                aside={
                  drawing.outcomes.length > 0 ? (
                    <AtlasOutcomeBars outcomes={drawing.outcomes} label={copy.outcomes} />
                  ) : undefined
                }
              />
            ) : null}
            <AtlasGlance items={glance} label={copy.glance} />
          </section>
        ) : null}

        {workedExampleComponents.map((component) => (
          <AtlasWorkedExampleComponentNote
            key={component.exampleId}
            summary={component}
            locale={locale}
            isSignedIn={isSignedIn}
            signInHref={signInHref}
          />
        ))}

        <div className="mj-card-sections">
          <AtlasSectionNav
            prefix="mj-record"
            items={sections.map((item) => ({ id: item.id, label: labels[item.id], held: item.held }))}
            showing={showing}
            hrefFor={(id) => recordSectionHref(base, id as RecordSectionId)}
            label={copy.sectionsLabel}
            onSelect={select}
          />
          <div className="mj-card-body">
            {sections.map((item) => (
              <AtlasSection
                key={item.id}
                id={item.id}
                held={item.held}
                gap={item.gap}
                reason={item.reason}
                showing={item.id === showing}
                labelledBy={atlasNavItemId("mj-record", item.id)}
                words={chrome}
              >
                {body(item.id)}
              </AtlasSection>
            ))}

            {/* References below the sections and not among them, as on the
                card — the owner's *"it isn't needed for papers to be their
                own section"*. */}
            {entry.literature?.length ? (
              <section className="mj-card-references" id="mj-record-references">
                <h2>{chrome.references}</h2>
                <ul className="mj-card-list">
                  {entry.literature.map((citation) => (
                    <li key={citation.url}>
                      <a href={citation.url} target="_blank" rel="noreferrer">
                        {citation.title}
                      </a>
                      <p className="mj-card-list-blurb">
                        {citation.authors} · {citation.year}
                      </p>
                      {(ja ? citation.relevanceJa : citation.relevance) ? (
                        <p className="mj-card-list-blurb">{ja ? citation.relevanceJa : citation.relevance}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </article>

      {/* What the card has no section for — how this record was verified,
          where it came from, where it is used — sits under it rather than
          among its sections, so the sections stay the card's. */}
      <div className="mj-record-aside">
        <section className="mj-repository-aside-card">
          <p className="mj-section-label">{copy.verification}</p>
          <VerificationTierBadge methods={methods} locale={locale} />
          <VerificationMethodChips methods={methods} locale={locale} />
          <dl className="mj-repository-detail-dl">
            <div>
              <dt>{copy.method}</dt>
              <dd>{entry.verificationDetails.method}</dd>
            </div>
            <div>
              <dt>{copy.result}</dt>
              <dd>{entry.verificationDetails.result}</dd>
            </div>
            {entry.verificationDetails.caveat ? (
              <div>
                <dt>{copy.caveat}</dt>
                <dd>{entry.verificationDetails.caveat}</dd>
              </div>
            ) : null}
          </dl>
        </section>
        <section className="mj-repository-aside-card">
          <p className="mj-section-label">{copy.source}</p>
          <a className="mj-repository-source-title" href={entry.source.url} target="_blank" rel="noreferrer" data-tour="atlas-entry-source">
            {entry.source.title} ↗
          </a>
          <dl className="mj-repository-detail-dl">
            <div>
              <dt>{copy.kind}</dt>
              <dd>{sourceKindLabel(entry.source.kind, locale)}</dd>
            </div>
            {entry.source.contributor ? (
              <div>
                <dt>{copy.contributor}</dt>
                <dd>{entry.source.contributor}</dd>
              </div>
            ) : null}
            {entry.source.reviewedBy ? (
              <div>
                <dt>{copy.reviewedBy}</dt>
                <dd>{entry.source.reviewedBy}</dd>
              </div>
            ) : null}
            <div>
              <dt>{copy.license}</dt>
              <dd>{entry.source.license}</dd>
            </div>
          </dl>
          {/* Rendered only when the record says something. Three "not checked"
              chips on every page would teach a reader to skip the panel, and
              the one page that does carry a claim would lose by association. */}
          {isInformative(entry.sourceCoverage) ? (
            <>
              <p className="mj-section-label">{copy.coverage}</p>
              <SourceCoveragePanel coverage={entry.sourceCoverage!} copy={copy} />
            </>
          ) : null}
          {entry.tags.length > 0 ? (
            <div className="mj-repository-tags" aria-label={copy.keywords}>
              {entry.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          ) : null}
        </section>
        {industry?.length ? (
          <section className="mj-repository-aside-card">
            <p className="mj-section-label">{copy.industry}</p>
            <ul className="mj-repository-bullet-list">
              {industry.map((useCase) => (
                <li key={useCase}>{useCase}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <p className="mj-repository-star-note">{copy.starNote}</p>
    </div>
  );
}

function sourceKindLabel(kind: PublicRepositoryEntry["source"]["kind"], locale: PublicLocale): string {
  if (locale === "ja") {
    if (kind === "curated_reference") return "運営が確認した資料";
    if (kind === "verified_run") return "検証済みの実行";
    return "コミュニティ投稿";
  }
  return kind.replaceAll("_", " ");
}

/**
 * What the SOURCE documents, on three axes (roadmap §3.6).
 *
 * The note under the chips is not decoration. Without it a reader has no way to
 * tell this panel from the verification badge above it, and the two answer
 * opposite questions — this one is about the paper, that one is about us.
 */
function SourceCoveragePanel({ coverage, copy }: { coverage: SourceCoverage; copy: RepositoryCopy }) {
  const axes: Array<[SourceCoverageAxis, string]> = [
    ["theory", copy.coverageTheory],
    ["simulation", copy.coverageSimulation],
    ["hardware", copy.coverageHardware],
  ];
  const statusLabel: Record<SourceCoverageStatus, string> = {
    reported: copy.coverageReported,
    absent: copy.coverageAbsent,
    unknown: copy.coverageUnknown,
  };
  return (
    <div className="mj-repo-coverage">
      <dl className="mj-repo-coverage-axes">
        {axes.map(([axis, label]) => (
          <div key={axis} className={`mj-repo-coverage-axis mj-repo-coverage-axis--${coverage[axis]}`}>
            <dt>{label}</dt>
            <dd>{statusLabel[coverage[axis]]}</dd>
          </div>
        ))}
      </dl>
      <p className="mj-repo-coverage-note">{copy.coverageNote}</p>
    </div>
  );
}

/**
 * Declared gaps, in three states that must stay apart.
 *
 * `knownGapsState` resolves them rather than each call site testing
 * `gaps?.length`, which renders nothing for both `[]` and `undefined` — and
 * silence in a gap-disclosure panel reads as "this record has no gaps". A
 * record nobody has examined would be asserting it is complete, which is the
 * one thing §3.6 exists to prevent.
 *
 * The unreviewed state renders as a sentence rather than as an empty panel for
 * the same reason: "nobody has looked" is information a reader can act on.
 */
function KnownGapsBody({
  gaps,
  locale,
  copy,
}: {
  gaps: PublicRepositoryEntry["knownGaps"];
  locale: PublicLocale;
  copy: RepositoryCopy;
}) {
  const state = knownGapsState(gaps);
  // The unreviewed state is the section's gap sentence — `record-card.ts`
  // marks the section not held and hands the words to `AtlasSection` — so this
  // branch is only reached if the two ever disagree, and then it still says
  // the true thing rather than nothing.
  if (state.kind === "unreviewed") {
    return <p className="mj-repo-gaps-empty mj-repo-gaps-empty--unreviewed">{copy.gapsUnreviewed}</p>;
  }
  if (state.kind === "none") {
    return <p className="mj-repo-gaps-empty">{copy.gapsNone}</p>;
  }
  return (
    <div className="mj-repo-gaps">
      {state.gaps.map((gap, index) => (
        <article key={`${gap.role}-${index}`} className="mj-repo-gap">
          <header>
            <strong>{copy[`gapRole_${gap.role}`]}</strong>
            <span className="mj-repo-gap-reason">{copy[`gapReason_${gap.reason}`]}</span>
            {/* A permanent reason renders as permanent (§3.6): the field
                disagreeing, or an implementation being tied to one paper's
                device, is not a backlog item and must not read like one. */}
            {isPermanentGap(gap.reason) ? <span className="mj-repo-gap-permanent">{copy.gapPermanent}</span> : null}
          </header>
          <p>{locale === "ja" ? gap.detailJa : gap.detail}</p>
          {gap.citations?.length ? (
            <ul className="mj-repo-gap-citations">
              {gap.citations.map((citation) => (
                <li key={citation.url}>
                  <a href={citation.url} rel="noreferrer noopener" target="_blank">
                    {citation.title}
                  </a>
                  <span>
                    {" "}
                    · {citation.authors}, {citation.year}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ClassicalComparison({ comparison, locale, copy }: { comparison: NonNullable<PublicRepositoryEntry["classicalComparison"]>; locale: PublicLocale; copy: RepositoryCopy }) {
  return (
    <div className="mj-repo-comparison">
      {comparison.metrics && comparison.metrics.length ? (
        <table className="mj-repo-comparison-table">
          <thead>
            <tr>
              <th scope="col">{copy.metricLabel}</th>
              <th scope="col">{copy.metricClassical}</th>
              <th scope="col">{copy.metricQuantum}</th>
            </tr>
          </thead>
          <tbody>
            {comparison.metrics.map((metric) => (
              <tr key={metric.label}>
                <th scope="row">{locale === "ja" ? metric.labelJa : metric.label}</th>
                <td>{metric.classical}</td>
                <td>{metric.quantum}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="mj-repo-comparison-prose">
        <div><h3>{copy.baseline}</h3><p>{locale === "ja" ? comparison.baselineJa : comparison.baseline}</p></div>
        <div><h3>{copy.quantum}</h3><p>{locale === "ja" ? comparison.quantumClaimJa : comparison.quantumClaim}</p></div>
        <div><h3>{copy.practical}</h3><p>{locale === "ja" ? comparison.practicalReadJa : comparison.practicalRead}</p></div>
      </div>
    </div>
  );
}

function defaultClassicalComparison(entry: PublicRepositoryEntry): PublicRepositoryClassicalComparison {
  if (entry.category === "algorithms") {
    return {
      baseline: `Compare ${entry.algorithmFamily} with the strongest classical method for the same instance, input budget, and output metric.`,
      baselineJa: `同じ問題、入力予算、出力指標で、${entry.algorithmFamily}と最も強い古典手法を比較します。`,
      quantumClaim: "This reference exposes a quantum circuit pattern; it does not imply an application-level speedup without a matched benchmark.",
      quantumClaimJa: "この参照は量子回路のパターンを示しますが、対応するベンチマークなしに応用上の高速化を意味しません。",
      practicalRead: "Report input loading, circuit depth, repetitions, classical preprocessing, post-processing, and wall-clock time together.",
      practicalReadJa: "入力ロード、回路深さ、反復回数、古典前処理・後処理、実時間を一緒に報告します。",
    };
  }
  return {
    baseline: "Use a classical state-vector or matrix simulation at the same width, precision, and measurement objective.",
    baselineJa: "同じ幅、精度、測定目的で、古典状態ベクトルまたは行列シミュレーションを比較します。",
    quantumClaim: "The quantum record demonstrates a state or operator behavior; it does not make classical simulation or communication costs disappear.",
    quantumClaimJa: "量子レコードは状態・演算子の挙動を示しますが、古典シミュレーションや通信コストを消すものではありません。",
    practicalRead: "Compare fidelity, samples, gate depth, noise, memory, and the cost of preparing and reading the state.",
    practicalReadJa: "忠実度、サンプル数、ゲート深さ、ノイズ、メモリ、状態の準備・読み出しコストを比較します。",
  };
}
