"use client";

import { useMemo, useState } from "react";
import { SyntaxHighlightedCode } from "@majorana/ui";
import {
  getPublicRepositoryVariant,
  PUBLIC_REPOSITORY_FRAMEWORKS,
  type PublicRepositoryClassicalComparison,
  type PublicRepositoryEntry,
  type PublicRepositoryFramework,
} from "../../../lib/public-repository";
import type { PublicLocale } from "../../../lib/public-locale";
import { RepositoryExportAction } from "../repository-export";

const COPY = {
  en: {
    back: "← Back to repository",
    database: "Public research database",
    introduction: "Introduction",
    explanation: "How it works",
    visualization: "Circuit / workflow view",
    outcomes: "Expected outcomes",
    code: "Framework implementation",
    framework: "Framework",
    copy: "Copy code",
    copied: "Copied",
    request: "Request a conversion",
    conversion: "Conversion boundary",
    resources: "Resources",
    metadata: "Metadata",
    verification: "Verification boundary",
    method: "Method",
    result: "Result",
    caveat: "Caveat",
    source: "Source and provenance",
    openSource: "Open source record",
    literature: "Literature and references",
    comparison: "Quantum vs classical",
    baseline: "Classical baseline",
    quantum: "Quantum claim",
    practical: "How to compare in practice",
    industry: "Industry use cases",
    related: "Related entries",
    native: "Native snippet",
    noCode: "No native snippet published yet.",
    library: "Personal Library",
  },
  ja: {
    back: "← リポジトリに戻る",
    database: "公開研究データベース",
    introduction: "概要",
    explanation: "仕組み",
    visualization: "回路 / ワークフロー",
    outcomes: "期待される出力",
    code: "フレームワーク実装",
    framework: "フレームワーク",
    copy: "コードをコピー",
    copied: "コピー済み",
    request: "変換をリクエスト",
    conversion: "変換の境界",
    resources: "リソース",
    metadata: "メタデータ",
    verification: "検証の境界",
    method: "方法",
    result: "結果",
    caveat: "注意点",
    source: "出典と来歴",
    openSource: "公開レコード",
    literature: "文献と参考資料",
    comparison: "量子と古典の比較",
    baseline: "古典ベースライン",
    quantum: "量子側の主張",
    practical: "実務での比較方法",
    industry: "産業ユースケース",
    related: "関連エントリ",
    native: "ネイティブスニペット",
    noCode: "ネイティブスニペットはまだ公開されていません。",
    library: "個人Library",
  },
} as const;
type RepositoryCopy = (typeof COPY)[keyof typeof COPY];

function statusLabel(status: PublicRepositoryEntry["status"], locale: PublicLocale): string {
  if (locale === "ja") {
    if (status === "verified") return "検証済み";
    if (status === "verified_caveats") return "注意付き検証済み";
    return "コミュニティレビュー中";
  }
  if (status === "verified") return "Verified";
  if (status === "verified_caveats") return "Verified with caveats";
  return "Community review";
}

function variantLabel(status: "native" | "conversion" | "unsupported", locale: PublicLocale): string {
  if (locale === "ja") {
    if (status === "native") return "ネイティブ";
    if (status === "conversion") return "変換待ち";
    return "未対応";
  }
  if (status === "native") return "Native";
  if (status === "conversion") return "Conversion pending";
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
  "Universal role": "万能性での役割",
  "Native form": "ネイティブ形式",
  Decomposition: "分解",
  Role: "役割",
  Promise: "約束条件",
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

function familyLabel(label: string, locale: PublicLocale): string {
  if (locale !== "ja") return label;
  const labels: Record<string, string> = {
    "Single-qubit gate": "単一量子ビットゲート",
    "Pauli operator": "パウリ演算子",
    "Controlled gate": "制御ゲート",
    "Two-qubit gate": "2量子ビットゲート",
    "Quantum query algorithm": "量子クエリアルゴリズム",
    "Hidden-period / factoring": "隠れ周期 / 因数分解",
    "Entanglement and communication": "エンタングルメントと通信",
  };
  return labels[label] ?? label;
}

function outcomeLabel(label: string, locale: PublicLocale): string {
  if (locale !== "ja") return label;
  return label.replace("Control 0", "制御0").replace("Control 1", "制御1").replace("secret s", "秘密文字列 s");
}

export function RepositoryEntryView({
  entry,
  locale,
  isSignedIn,
  signInHref,
}: {
  entry: PublicRepositoryEntry;
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
}) {
  const copy = COPY[locale];
  const [framework, setFramework] = useState<PublicRepositoryFramework>(entry.framework);
  const [copied, setCopied] = useState(false);
  const variant = useMemo(() => getPublicRepositoryVariant(entry, framework), [entry, framework]);
  const title = locale === "ja" ? entry.titleJa : entry.title;
  const description = locale === "ja" ? entry.descriptionJa : entry.description;
  const introduction = locale === "ja" ? entry.introductionJa : entry.introduction;
  const explanation = locale === "ja" ? entry.explanationJa : entry.explanation;

  async function copyCode() {
    if (!variant.code) return;
    await navigator.clipboard.writeText(variant.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <section className="mj-repository-detail-hero">
        <a className="mj-back-link" href="/repository">{copy.back}</a>
        <div className="mj-repository-detail-kicker">
          <span className="mj-repository-status" data-status={entry.status}>{statusLabel(entry.status, locale)}</span>
          <span>{locale === "ja" ? entry.categoryLabelJa : entry.categoryLabel}</span>
          <span>{familyLabel(entry.algorithmFamily, locale)}</span>
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="mj-repository-tags" aria-label={locale === "ja" ? "タグ" : "Tags"}>
          {entry.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
        <div className="mj-repository-detail-actions">
          <RepositoryExportAction slug={entry.slug} title={title} isSignedIn={isSignedIn} signInHref={signInHref} locale={locale} />
          <span className="mj-repository-detail-action-note">{copy.library}: {locale === "ja" ? "アカウント専用" : "private to your account"}</span>
        </div>
      </section>

      <div className="mj-repository-detail-layout">
        <main className="mj-repository-detail-main">
          <section className="mj-repository-detail-section">
            <p className="mj-section-label">{copy.introduction}</p>
            <p className="mj-repository-detail-lede">{introduction}</p>
          </section>

          <section className="mj-repository-detail-section" aria-labelledby="visualization-heading">
            <div className="mj-repository-detail-heading">
              <div>
                <p className="mj-section-label">{copy.visualization}</p>
                <h2 id="visualization-heading">{title}</h2>
              </div>
              <span className="mj-mono-muted">{entry.updatedAt}</span>
            </div>
            <CircuitDiagram entry={entry} locale={locale} />
            <div className="mj-repository-outcomes" aria-label={copy.outcomes}>
              {entry.visualization.outcomes.map((outcome) => (
                <div className="mj-repository-outcome" key={outcome.label}>
                  <div className="mj-repository-outcome-label"><span>{outcomeLabel(outcome.label, locale)}</span><strong>{Math.round(outcome.probability * 100)}%</strong></div>
                  <div className="mj-repository-outcome-track"><span style={{ width: `${Math.max(0, Math.min(1, outcome.probability)) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </section>

          <section className="mj-repository-detail-section" aria-labelledby="explanation-heading">
            <p className="mj-section-label">{copy.explanation}</p>
            <h2 id="explanation-heading">{locale === "ja" ? "何が起きているか" : "What the circuit is claiming"}</h2>
            <p className="mj-repository-detail-copy">{explanation}</p>
          </section>

          <ClassicalComparison comparison={entry.classicalComparison ?? defaultClassicalComparison(entry)} locale={locale} copy={copy} />

          <section className="mj-repository-detail-section" aria-labelledby="code-heading">
            <div className="mj-repository-detail-heading">
              <div>
                <p className="mj-section-label">{copy.code}</p>
                <h2 id="code-heading">{framework}</h2>
              </div>
              <span className={`mj-repository-variant-status mj-repository-variant-status--${variant.status}`}>{variantLabel(variant.status, locale)}</span>
            </div>
            <label className="mj-repository-framework-picker">
              <span>{copy.framework}</span>
              <select value={framework} onChange={(event) => setFramework(event.target.value as PublicRepositoryFramework)}>
                {PUBLIC_REPOSITORY_FRAMEWORKS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
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
                <strong>{copy.noCode}</strong>
                <p>{variant.note}</p>
                <a className="mj-secondary-button" href="/contact">{copy.request}</a>
              </div>
            )}
            {variant.note && variant.code ? <p className="mj-repository-code-note">{variant.note}</p> : null}
          </section>

          {entry.literature?.length ? (
            <section className="mj-repository-detail-section" aria-labelledby="literature-heading">
              <p className="mj-section-label">{copy.literature}</p>
              <h2 id="literature-heading">{locale === "ja" ? "この記録を読むための文献" : "Literature behind the record"}</h2>
              <div className="mj-repository-literature-list">
                {entry.literature.map((citation) => (
                  <article key={citation.url}>
                    <div><strong>{citation.title}</strong><span>{citation.year} · {citation.authors}</span></div>
                    <p>{locale === "ja" ? citation.relevanceJa : citation.relevance}</p>
                    <a className="mj-text-link" href={citation.url} target="_blank" rel="noreferrer">{citation.url.replace(/^https?:\/\//, "")} ↗</a>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </main>

        <aside className="mj-repository-detail-aside">
          <DetailList title={copy.resources} rows={entry.resources} locale={locale} />
          <DetailList title={copy.metadata} rows={entry.metadata} locale={locale} />
          <section className="mj-repository-aside-card">
            <p className="mj-section-label">{copy.verification}</p>
            <span className="mj-repository-status" data-status={entry.status}>{statusLabel(entry.status, locale)}</span>
            <dl className="mj-repository-detail-dl">
              <div><dt>{copy.method}</dt><dd>{entry.verificationDetails.method}</dd></div>
              <div><dt>{copy.result}</dt><dd>{entry.verificationDetails.result}</dd></div>
              {entry.verificationDetails.caveat ? <div><dt>{copy.caveat}</dt><dd>{entry.verificationDetails.caveat}</dd></div> : null}
            </dl>
          </section>
          <section className="mj-repository-aside-card">
            <p className="mj-section-label">{copy.source}</p>
            <a className="mj-repository-source-title" href={entry.source.url} target="_blank" rel="noreferrer">{entry.source.title} ↗</a>
            <dl className="mj-repository-detail-dl">
              <div><dt>{locale === "ja" ? "種別" : "Kind"}</dt><dd>{locale === "ja" ? entry.source.kind === "curated_reference" ? "キュレーション参照" : entry.source.kind === "verified_run" ? "検証済み実行" : "コミュニティ投稿" : entry.source.kind.replaceAll("_", " ")}</dd></div>
              {entry.source.contributor ? <div><dt>{locale === "ja" ? "投稿者" : "Contributor"}</dt><dd>{entry.source.contributor}</dd></div> : null}
              {entry.source.reviewedBy ? <div><dt>{locale === "ja" ? "レビュー" : "Reviewed by"}</dt><dd>{entry.source.reviewedBy}</dd></div> : null}
              <div><dt>{locale === "ja" ? "ライセンス" : "License"}</dt><dd>{entry.source.license}</dd></div>
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
          <section className="mj-repository-aside-card">
            <p className="mj-section-label">{copy.openSource}</p>
            <p>{locale === "ja" ? "このページのコードとメタデータは公開参照用です。非公開Libraryのデータは含みません。" : "Code and metadata on this page are public reference material. Private Library data is not included."}</p>
            <span className="mj-mono-muted">{entry.updatedAt}</span>
          </section>
        </aside>
      </div>

      <section className="mj-repository-related" aria-labelledby="related-heading">
        <div className="mj-repository-detail-heading">
          <div>
            <p className="mj-section-label">{copy.related}</p>
            <h2 id="related-heading">{locale === "ja" ? "次に読む" : "Continue through the corpus"}</h2>
          </div>
          <a className="mj-text-link" href="/repository">{copy.database} ↗</a>
        </div>
        <div className="mj-repository-related-grid">
          {entry.relatedSlugs.map((slug) => {
            return <RelatedEntry key={slug} slug={slug} locale={locale} />;
          })}
        </div>
      </section>
    </>
  );
}

function DetailList({ title, rows, locale }: { title: string; rows: Array<{ label: string; value: string }>; locale: PublicLocale }) {
  return (
    <section className="mj-repository-aside-card">
      <p className="mj-section-label">{title}</p>
      <dl className="mj-repository-detail-dl">
        {rows.map((row) => <div key={row.label}><dt>{dataLabel(row.label, locale)}</dt><dd>{row.value}</dd></div>)}
      </dl>
    </section>
  );
}

function ClassicalComparison({ comparison, locale, copy }: { comparison: NonNullable<PublicRepositoryEntry["classicalComparison"]>; locale: PublicLocale; copy: RepositoryCopy }) {
  return (
    <section className="mj-repository-detail-section mj-repository-comparison" aria-labelledby="comparison-heading">
      <p className="mj-section-label">{copy.comparison}</p>
      <h2 id="comparison-heading">{locale === "ja" ? "速さだけではなく、同じ問題を比べる" : "Compare the problem, not just the circuit"}</h2>
      <div className="mj-repository-comparison-grid">
        <div><h3>{copy.baseline}</h3><p>{locale === "ja" ? comparison.baselineJa : comparison.baseline}</p></div>
        <div><h3>{copy.quantum}</h3><p>{locale === "ja" ? comparison.quantumClaimJa : comparison.quantumClaim}</p></div>
        <div><h3>{copy.practical}</h3><p>{locale === "ja" ? comparison.practicalReadJa : comparison.practicalRead}</p></div>
      </div>
    </section>
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

function CircuitDiagram({ entry, locale }: { entry: PublicRepositoryEntry; locale: PublicLocale }) {
  return (
    <div className="mj-repository-circuit" role="img" aria-label={`${locale === "ja" ? entry.titleJa : entry.title}${locale === "ja" ? "の回路またはワークフロー図" : " circuit or workflow diagram"}`}>
      {entry.visualization.wires.map((wire, index) => (
        <div className="mj-repository-circuit-row" key={wire}>
          <span className="mj-repository-circuit-wire">{wire}</span>
          <div className="mj-repository-circuit-line">
            {entry.visualization.operations.filter((operation) => operation.qubits.includes(index)).map((operation, operationIndex) => (
              <span className={`mj-repository-circuit-op mj-repository-circuit-op--${operation.tone}`} key={`${operation.label}-${operationIndex}`}>
                {operation.label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RelatedEntry({ slug, locale }: { slug: string; locale: PublicLocale }) {
  // The server has already validated related slugs; keep this client component link-only.
  const label = slug.replaceAll("-", " ");
  return <a className="mj-repository-related-card" href={`/repository/${slug}`}><span>{locale === "ja" ? "参照" : "Entry"}</span><strong>{label}</strong><span>↗</span></a>;
}
