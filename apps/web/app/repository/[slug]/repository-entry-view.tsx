"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SyntaxHighlightedCode } from "@majorana/ui";
import {
  entryVerificationMethods,
  getPublicRepositoryVariant,
  PUBLIC_REPOSITORY_FRAMEWORKS,
  type PublicRepositoryClassicalComparison,
  type PublicRepositoryEntry,
  type PublicRepositoryFramework,
} from "../../../lib/public-repository";
import type { PublicLocale } from "../../../lib/public-locale";
import { MarkdownContent } from "../../../components/chat-markdown";
import { StarIcon } from "../../../components/icons";
import { VerificationMethodChips, VerificationTierBadge } from "../../../components/repository-verification";
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

const COPY = {
  en: {
    back: "← Atlas",
    circuit: "Circuit & simulation",
    structure: "Circuit structure",
    connections: "What this takes and returns",
    cost: "Fault-tolerant cost",
    outcomes: "Expected outcomes",
    how: "How it works",
    code: "Implementation",
    framework: "Framework",
    copy: "Copy code",
    copied: "Copied",
    request: "Request a conversion",
    star: "Star",
    unstar: "Unstar",
    starNote: "Atlas stars stay in the public catalog. Saving this entry to your workspace starts an unstarred private copy.",
    resources: "Facts",
    verification: "Verification",
    method: "Method",
    result: "Result",
    caveat: "Caveat",
    source: "Source",
    literature: "Literature & references",
    coverage: "What the source documents",
    coverageTheory: "Theory",
    coverageSimulation: "Simulation",
    coverageHardware: "Hardware",
    coverageReported: "reported",
    coverageAbsent: "not in this source",
    coverageUnknown: "not checked",
    coverageNote:
      "What the source itself reports \u2014 not how Leona verified this record. \u201cNot checked\u201d means nobody has read the source for that axis; \u201cnot in this source\u201d means somebody has, and it is not there.",
    gaps: "Declared gaps",
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
  },
  ja: {
    back: "← Atlas",
    circuit: "回路とシミュレーション",
    structure: "回路の構造",
    connections: "入力と出力",
    cost: "誤り耐性計算のコスト",
    outcomes: "期待される出力",
    how: "仕組み",
    code: "実装",
    framework: "フレームワーク",
    copy: "コードをコピー",
    copied: "コピー済み",
    request: "変換をリクエスト",
    star: "スターを付ける",
    unstar: "スターを外す",
    starNote: "スターはAtlasに保存されます。ワークスペースに追加したコピーには引き継がれません。",
    resources: "基本情報",
    verification: "検証",
    method: "方法",
    result: "結果",
    caveat: "注意点",
    source: "出典",
    literature: "文献と参考資料",
    coverage: "\u51fa\u5178\u304c\u8a18\u8f09\u3057\u3066\u3044\u308b\u7bc4\u56f2",
    coverageTheory: "\u7406\u8ad6",
    coverageSimulation: "\u30b7\u30df\u30e5\u30ec\u30fc\u30b7\u30e7\u30f3",
    coverageHardware: "\u5b9f\u6a5f",
    coverageReported: "\u8a18\u8f09\u3042\u308a",
    coverageAbsent: "\u3053\u306e\u51fa\u5178\u306b\u306f\u306a\u3057",
    coverageUnknown: "\u672a\u78ba\u8a8d",
    coverageNote:
      "\u51fa\u5178\u81ea\u8eab\u304c\u4f55\u3092\u5831\u544a\u3057\u3066\u3044\u308b\u304b\u3067\u3042\u308a\u3001Leona \u304c\u3069\u3046\u691c\u8a3c\u3057\u305f\u304b\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002\u300c\u672a\u78ba\u8a8d\u300d\u306f\u305d\u306e\u8ef8\u306b\u3064\u3044\u3066\u8ab0\u3082\u51fa\u5178\u3092\u8aad\u3093\u3067\u3044\u306a\u3044\u3053\u3068\u3001\u300c\u3053\u306e\u51fa\u5178\u306b\u306f\u306a\u3057\u300d\u306f\u8aad\u3093\u3060\u4e0a\u3067\u5b58\u5728\u3057\u306a\u3044\u3053\u3068\u3092\u610f\u5473\u3057\u307e\u3059\u3002",
    gaps: "\u5ba3\u8a00\u3055\u308c\u305f\u6b20\u843d",
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
  connectionsOpen,
  layers,
}: {
  entry: PublicRepositoryEntry;
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
  /**
   * The cost panel, rendered on the server and passed in as a slot.
   *
   * A slot rather than a fetch because this component is a client component and
   * the estimate comes from the anonymous catalog API, which by standing policy
   * (see lib/repository-source.ts) is read only by server code — proxying it to
   * the browser would create a second unauthenticated surface for no gain.
   * Null when there is no estimate to show, and the section then does not
   * render at all.
   */
  estimate?: ReactNode;
  /**
   * The circuit-structure panel (R1), on the same slot terms as `estimate`
   * above and for the same reason. Null when the entry carries no circuit, and
   * the section then does not render at all.
   */
  profile?: ReactNode;
  /**
   * The interface panel — what this entry takes and returns, and what meets it.
   *
   * A slot like the two above, but passed unconditionally: an entry with no
   * ports has an answer ("not a pipeline stage"), and most records are in that
   * position (121 of the then-283, measured 2026-07). A missing section would
   * leave a reader looking for
   * something to compose to infer it from silence.
   */
  connections?: ReactNode;
  /**
   * Whether `?port=` named an end, which forces the connections section open.
   *
   * Without this the address is decorative: `?port=in` expands a `<details>`
   * *inside* a section that is itself collapsed by default, so a reader
   * following the link arrives at a page where the thing they were linked to is
   * hidden — and `curl | grep` still shows `open=""` on the inner element, so
   * the check that proves the param works passes either way. Found by looking
   * at the rendered page rather than at the markup.
   */
  connectionsOpen?: boolean;
  /**
   * Where the layer graph names this record, or null when it does not.
   *
   * Null on most records (279 of the then-283, measured 2026-07), and unlike every panel on the Layers surface
   * itself this one renders **nothing** in that case. The difference is
   * deliberate: over there an empty list is the finding — it says which part of
   * the literature the corpus has not reached — and here it would be the same
   * sentence repeated on almost every record, which is noise wearing honesty's
   * clothes.
   */
  layers?: ReactNode;
  related: RelatedEntrySummary[];
}) {
  const copy = COPY[locale];
  const [framework, setFramework] = useState<PublicRepositoryFramework>(entry.framework);
  const [copied, setCopied] = useState(false);
  const [starred, setStarred] = useState(false);
  const variant = useMemo(() => getPublicRepositoryVariant(entry, framework), [entry, framework]);
  const methods = entryVerificationMethods(entry);
  // Resolved through the vocabulary rather than rendered from the ids, so an id
  // the API knows and this build does not is dropped instead of printed raw.
  //
  // The four topics a category tab owns are dropped as well (ai-ops#75). On this
  // page they were the worst case of that collision rather than the mildest: the
  // kicker two elements up already prints `categoryLabel` — "Gates" — and the
  // chip beside it said "Gate" and linked to `?topic=gate-primitive`, a list of
  // 27 under a word the tabs answer with 29. In Japanese the kicker and the chip
  // were the same string. Nothing is lost by dropping it, because the kicker is
  // still there saying which kind this is; what goes is the second, quieter
  // answer and the link onto the smaller number.
  const topics = (entry.topics ?? [])
    .filter((id) => !TOPICS_A_CATEGORY_TAB_OWNS.has(id))
    .map((id) => TOPICS_BY_ID.get(id))
    .filter((topic): topic is NonNullable<typeof topic> => topic !== undefined);
  const title = locale === "ja" ? entry.titleJa : entry.title;
  const description = locale === "ja" ? entry.descriptionJa : entry.description;
  const introduction = locale === "ja" ? entry.introductionJa : entry.introduction;
  const explanation = locale === "ja"
    ? entry.explanationMdJa ?? entry.explanationJa
    : entry.explanationMd ?? entry.explanation;

  useEffect(() => {
    setStarred(loadStarredRepositorySlugs().has(entry.slug));
  }, [entry.slug]);

  function handleStar() {
    setStarred(toggleRepositoryStar(entry.slug));
  }

  async function copyCode() {
    if (!variant.code) return;
    await navigator.clipboard.writeText(variant.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <section className="mj-repo-detail-hero">
        <a className="mj-back-link" href="/repository">{copy.back}</a>
        <div className="mj-repository-detail-kicker">
          <VerificationTierBadge methods={methods} locale={locale} />
          <span>{locale === "ja" ? entry.categoryLabelJa : entry.categoryLabel}</span>
          <span>{algorithmFamilyLabel(entry.algorithmFamily, locale)}</span>
          <time dateTime={entry.updatedAt}>{entry.updatedAt}</time>
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
        {/* The closed vocabulary above the free keywords, and separated from
            them, because they are different kinds of claim: a topic is one of a
            fixed set of values the whole corpus is classified against and is
            offered as a filter on /repository; a tag is a keyword this record
            happens to wear, and 217 of the 307 in the corpus are worn by
            exactly one entry.
            Each topic carries its definition on hover — a vocabulary whose terms
            a reader has to guess at is a vocabulary they will read wrong. */}
        {topics.length > 0 ? (
          <div className="mj-repository-topics" aria-label={locale === "ja" ? "トピック" : "Topics"}>
            {topics.map((topic) => (
              <a
                key={topic.id}
                className={`mj-repository-topic mj-repository-topic--${topic.facet}`}
                href={`/repository?topic=${encodeURIComponent(topic.id)}`}
                title={locale === "ja" ? topic.definitionJa : topic.definition}
              >
                {locale === "ja" ? topic.labelJa : topic.label}
              </a>
            ))}
          </div>
        ) : null}
        <div className="mj-repo-detail-hero-foot">
          <div className="mj-repository-tags" aria-label={locale === "ja" ? "タグ" : "Tags"}>
            {entry.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <button className={`mj-star-toggle${starred ? " is-starred" : ""}`} type="button" aria-pressed={starred} title={starred ? copy.unstar : copy.star} onClick={handleStar}>
            <StarIcon size={14} filled={starred} />
            {starred ? copy.unstar : copy.star}
          </button>
          <RepositoryExportAction slug={entry.slug} title={title} isSignedIn={isSignedIn} signInHref={signInHref} locale={locale} />
        </div>
        <p className="mj-repository-star-note">{copy.starNote}</p>
      </section>

      <div className="mj-repository-detail-layout">
        <main className="mj-repository-detail-main">
          <p className="mj-repo-detail-lede">{introduction}</p>

          <DetailSection title={copy.circuit} defaultOpen>
            <CircuitDiagram entry={entry} locale={locale} />
            <div className="mj-repository-outcomes" aria-label={copy.outcomes}>
              {entry.visualization.outcomes.map((outcome) => (
                <div className="mj-repository-outcome" key={outcome.label}>
                  <div className="mj-repository-outcome-label"><span>{outcome.label}</span><strong>{Math.round(outcome.probability * 100)}%</strong></div>
                  <div className="mj-repository-outcome-track"><span style={{ width: `${Math.max(0, Math.min(1, outcome.probability)) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </DetailSection>

          {/* Structure before cost: these are measurements of the circuit
              rendered directly above, and the cost is computed FROM them. */}
          {profile ? <DetailSection title={copy.structure}>{profile}</DetailSection> : null}

          {estimate ? <DetailSection title={copy.cost}>{estimate}</DetailSection> : null}

          {/* After the cost rather than beside the structure. The two panels
              above answer "what is this circuit"; this one answers "what could
              it be part of", which is a different question and the one a reader
              has to have finished the first two to ask. */}
          {connections ? (
            <DetailSection title={copy.connections} defaultOpen={connectionsOpen}>
              {connections}
            </DetailSection>
          ) : null}

          {/* Directly under the connections panel, and not inside a
              `DetailSection`. The panel above answers "what meets this record's
              edges"; this answers "what is this record an instance of", which is
              one level up and is the only route from a record into the layer
              graph. Behind a collapsed disclosure it would be a door nobody
              opens — the failure the gates surface already paid for twice. */}
          {layers}

          <DetailSection title={copy.how} defaultOpen>
            <MarkdownContent source={explanation} className="mj-repo-markdown" />
          </DetailSection>

          <DetailSection title={copy.code} defaultOpen>
            <div className="mj-repo-code-controls">
              <label className="mj-repository-framework-picker">
                <span>{copy.framework}</span>
                <select value={framework} onChange={(event) => setFramework(event.target.value as PublicRepositoryFramework)}>
                  {PUBLIC_REPOSITORY_FRAMEWORKS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <span className={`mj-repository-variant-status mj-repository-variant-status--${variant.status === "source" ? "conversion" : variant.status}`}>{variantLabel(variant.status, locale)}</span>
            </div>
            {variant.code ? (
              <div className="mj-code">
                <div className="mj-code-head">
                  <span className="mj-code-file">{variant.filename}</span>
                  <button className="mj-code-copy" type="button" onClick={copyCode}>{copied ? copy.copied : copy.copy}</button>
                </div>
                <pre className="mj-code-body" tabIndex={0} role="region" aria-label={`${title} ${framework} source code`}>
                  <SyntaxHighlightedCode code={variant.code} language={variant.language} />
                </pre>
              </div>
            ) : (
              <div className="mj-repository-code-placeholder">
                <strong>{variant.status === "unsupported" ? copy.notCircuit : copy.noCode}</strong>
                <p>{variant.note}</p>
                {variant.status !== "unsupported" ? <a className="mj-secondary-button" href="/contact">{copy.request}</a> : null}
              </div>
            )}
            {variant.note && variant.code ? <p className="mj-repository-code-note">{variant.note}</p> : null}
          </DetailSection>

          <DetailSection title={copy.comparison}>
            <ClassicalComparison comparison={entry.classicalComparison ?? defaultClassicalComparison(entry)} locale={locale} copy={copy} />
          </DetailSection>

          {/* Rendered only when the record says something. On a corpus where
              almost nothing is authored yet, three "not checked" chips on 282
              pages teach a reader to skip the panel, and the one page that does
              carry a claim loses by association. When the field goes backwards —
              a repopulation dropping the authored records — the panel
              disappears, which is visible, rather than staying put and saying
              nothing, which is not. */}
          {isInformative(entry.sourceCoverage) ? (
            <DetailSection title={copy.coverage}>
              <SourceCoveragePanel coverage={entry.sourceCoverage!} copy={copy} />
            </DetailSection>
          ) : null}

          <KnownGapsSection gaps={entry.knownGaps} locale={locale} copy={copy} />

          {entry.literature?.length ? (
            <DetailSection title={copy.literature}>
              <div className="mj-repository-literature-list">
                {entry.literature.map((citation) => (
                  <article key={citation.url}>
                    <div><strong>{citation.title}</strong><span>{citation.year} · {citation.authors}</span></div>
                    <p>{locale === "ja" ? citation.relevanceJa : citation.relevance}</p>
                    {/* --url: the link text here is a citation URL, so its
                        length is data. The base class is nowrap, which suits
                        the fixed labels it was written for and overflowed this
                        card silently. */}
                    <a className="mj-text-link mj-text-link--url" href={citation.url} target="_blank" rel="noreferrer">{citation.url.replace(/^https?:\/\//, "")} ↗</a>
                  </article>
                ))}
              </div>
            </DetailSection>
          ) : null}
        </main>

        <aside className="mj-repository-detail-aside">
          <section className="mj-repository-aside-card">
            <p className="mj-section-label">{copy.verification}</p>
            <VerificationTierBadge methods={methods} locale={locale} />
            <VerificationMethodChips methods={methods} locale={locale} />
            <dl className="mj-repository-detail-dl">
              <div><dt>{copy.method}</dt><dd>{entry.verificationDetails.method}</dd></div>
              <div><dt>{copy.result}</dt><dd>{entry.verificationDetails.result}</dd></div>
              {entry.verificationDetails.caveat ? <div><dt>{copy.caveat}</dt><dd>{entry.verificationDetails.caveat}</dd></div> : null}
            </dl>
          </section>
          <section className="mj-repository-aside-card">
            <p className="mj-section-label">{copy.resources}</p>
            <dl className="mj-repository-detail-dl">
              {[...entry.resources, ...entry.metadata].map((row) => (
                <div key={`${row.label}-${row.value}`}><dt>{dataLabel(row.label, locale)}</dt><dd>{row.value}</dd></div>
              ))}
            </dl>
          </section>
          <section className="mj-repository-aside-card">
            <p className="mj-section-label">{copy.source}</p>
            <a className="mj-repository-source-title" href={entry.source.url} target="_blank" rel="noreferrer">{entry.source.title} ↗</a>
            <dl className="mj-repository-detail-dl">
              <div><dt>{copy.kind}</dt><dd>{locale === "ja" ? entry.source.kind === "curated_reference" ? "運営が確認した資料" : entry.source.kind === "verified_run" ? "検証済みの実行" : "コミュニティ投稿" : entry.source.kind.replaceAll("_", " ")}</dd></div>
              {entry.source.contributor ? <div><dt>{copy.contributor}</dt><dd>{entry.source.contributor}</dd></div> : null}
              {entry.source.reviewedBy ? <div><dt>{copy.reviewedBy}</dt><dd>{entry.source.reviewedBy}</dd></div> : null}
              <div><dt>{copy.license}</dt><dd>{entry.source.license}</dd></div>
            </dl>
          </section>
          {entry.industryUseCases?.length ? (
            <section className="mj-repository-aside-card">
              <p className="mj-section-label">{copy.industry}</p>
              <ul className="mj-repository-bullet-list">
                {(locale === "ja" ? entry.industryUseCasesJa ?? entry.industryUseCases : entry.industryUseCases).map((useCase) => <li key={useCase}>{useCase}</li>)}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>

      {related.length ? (
        <section className="mj-repository-related" aria-label={copy.related}>
          <p className="mj-section-label">{copy.related}</p>
          <div className="mj-repository-related-grid">
            {related.map((item) => (
              <a className="mj-repository-related-card" key={item.slug} href={`/repository/${item.slug}`}>
                <span>{locale === "ja" ? item.categoryLabelJa : item.categoryLabel}</span>
                <strong>{locale === "ja" ? item.titleJa : item.title}</strong>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function DetailSection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="mj-repo-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="mj-repo-section-body">{children}</div>
    </details>
  );
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
function KnownGapsSection({
  gaps,
  locale,
  copy,
}: {
  gaps: PublicRepositoryEntry["knownGaps"];
  locale: PublicLocale;
  copy: RepositoryCopy;
}) {
  const state = knownGapsState(gaps);
  if (state.kind === "none") {
    return (
      <DetailSection title={copy.gaps}>
        <p className="mj-repo-gaps-empty">{copy.gapsNone}</p>
      </DetailSection>
    );
  }
  if (state.kind === "unreviewed") {
    return (
      <DetailSection title={copy.gaps}>
        <p className="mj-repo-gaps-empty mj-repo-gaps-empty--unreviewed">{copy.gapsUnreviewed}</p>
      </DetailSection>
    );
  }
  return (
    <DetailSection title={copy.gaps} defaultOpen>
      <div className="mj-repo-gaps">
        {state.gaps.map((gap, index) => (
          <article key={`${gap.role}-${index}`} className="mj-repo-gap">
            <header>
              <strong>{copy[`gapRole_${gap.role}`]}</strong>
              <span className="mj-repo-gap-reason">{copy[`gapReason_${gap.reason}`]}</span>
              {/* A permanent reason renders as permanent (§3.6): the field
                  disagreeing, or an implementation being tied to one paper's
                  device, is not a backlog item and must not read like one. */}
              {isPermanentGap(gap.reason) ? (
                <span className="mj-repo-gap-permanent">{copy.gapPermanent}</span>
              ) : null}
            </header>
            <p>{locale === "ja" ? gap.detailJa : gap.detail}</p>
            {gap.citations?.length ? (
              <ul className="mj-repo-gap-citations">
                {gap.citations.map((citation) => (
                  <li key={citation.url}>
                    <a href={citation.url} rel="noreferrer noopener" target="_blank">
                      {citation.title}
                    </a>
                    <span> · {citation.authors}, {citation.year}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </DetailSection>
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

/**
 * Moment-aligned circuit rendering: each operation occupies its own column so
 * multi-qubit gates line up vertically, with a connector spanning the involved
 * wires — a readable approximation of a standard circuit diagram without a
 * drawing library.
 */
function CircuitDiagram({ entry, locale }: { entry: PublicRepositoryEntry; locale: PublicLocale }) {
  const { wires, operations } = entry.visualization;
  return (
    <div
      className="mj-repo-circuit"
      role="img"
      aria-label={`${locale === "ja" ? entry.titleJa : entry.title}${locale === "ja" ? "の回路またはワークフロー図" : " circuit or workflow diagram"}`}
    >
      {wires.map((wire, wireIndex) => (
        <div className="mj-repo-circuit-row" key={wire}>
          <span className="mj-repo-circuit-wire">{wire}</span>
          <div className="mj-repo-circuit-track">
            {operations.map((operation, opIndex) => {
              const involved = operation.qubits.includes(wireIndex);
              const spanMin = Math.min(...operation.qubits);
              const spanMax = Math.max(...operation.qubits);
              const insideSpan = wireIndex > spanMin && wireIndex < spanMax;
              return (
                <span
                  className="mj-repo-circuit-cell"
                  data-connector={!involved && insideSpan ? "true" : undefined}
                  key={`${operation.label}-${opIndex}`}
                >
                  {involved ? (
                    <span className="mj-repo-circuit-op" data-tone={operation.tone}>{operation.label}</span>
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
