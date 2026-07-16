"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import { VerificationMethodChips, VerificationTierBadge } from "../../../components/repository-verification";
import { RepositoryExportAction } from "../repository-export";

const COPY = {
  en: {
    back: "← Repository",
    circuit: "Circuit & simulation",
    outcomes: "Expected outcomes",
    how: "How it works",
    code: "Implementation",
    framework: "Framework",
    copy: "Copy code",
    copied: "Copied",
    request: "Request a conversion",
    resources: "Facts",
    verification: "Verification",
    method: "Method",
    result: "Result",
    caveat: "Caveat",
    source: "Source",
    literature: "Literature & references",
    comparison: "Quantum vs classical",
    baseline: "Classical baseline",
    quantum: "Quantum claim",
    practical: "How to compare",
    industry: "Industry use cases",
    related: "Related entries",
    noCode: "No native snippet published yet.",
    kind: "Kind",
    contributor: "Contributor",
    reviewedBy: "Reviewed by",
    license: "License",
  },
  ja: {
    back: "← リポジトリ",
    circuit: "回路とシミュレーション",
    outcomes: "期待される出力",
    how: "仕組み",
    code: "実装",
    framework: "フレームワーク",
    copy: "コードをコピー",
    copied: "コピー済み",
    request: "変換をリクエスト",
    resources: "基本情報",
    verification: "検証",
    method: "方法",
    result: "結果",
    caveat: "注意点",
    source: "出典",
    literature: "文献と参考資料",
    comparison: "量子と古典の比較",
    baseline: "古典ベースライン",
    quantum: "量子側の主張",
    practical: "比較の方法",
    industry: "産業ユースケース",
    related: "関連エントリ",
    noCode: "ネイティブスニペットはまだ公開されていません。",
    kind: "種別",
    contributor: "投稿者",
    reviewedBy: "レビュー",
    license: "ライセンス",
  },
} as const;
type RepositoryCopy = (typeof COPY)[keyof typeof COPY];

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
}: {
  entry: PublicRepositoryEntry;
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
  related: RelatedEntrySummary[];
}) {
  const copy = COPY[locale];
  const [framework, setFramework] = useState<PublicRepositoryFramework>(entry.framework);
  const [copied, setCopied] = useState(false);
  const variant = useMemo(() => getPublicRepositoryVariant(entry, framework), [entry, framework]);
  const methods = entryVerificationMethods(entry);
  const title = locale === "ja" ? entry.titleJa : entry.title;
  const description = locale === "ja" ? entry.descriptionJa : entry.description;
  const introduction = locale === "ja" ? entry.introductionJa : entry.introduction;
  const explanation = locale === "ja"
    ? entry.explanationMdJa ?? entry.explanationJa
    : entry.explanationMd ?? entry.explanation;

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
          <span>{entry.algorithmFamily}</span>
          <time dateTime={entry.updatedAt}>{entry.updatedAt}</time>
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="mj-repo-detail-hero-foot">
          <div className="mj-repository-tags" aria-label={locale === "ja" ? "タグ" : "Tags"}>
            {entry.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <RepositoryExportAction slug={entry.slug} title={title} isSignedIn={isSignedIn} signInHref={signInHref} locale={locale} />
        </div>
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
              <span className={`mj-repository-variant-status mj-repository-variant-status--${variant.status}`}>{variantLabel(variant.status, locale)}</span>
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
                <strong>{copy.noCode}</strong>
                <p>{variant.note}</p>
                <a className="mj-secondary-button" href="/contact">{copy.request}</a>
              </div>
            )}
            {variant.note && variant.code ? <p className="mj-repository-code-note">{variant.note}</p> : null}
          </DetailSection>

          <DetailSection title={copy.comparison}>
            <ClassicalComparison comparison={entry.classicalComparison ?? defaultClassicalComparison(entry)} locale={locale} copy={copy} />
          </DetailSection>

          {entry.literature?.length ? (
            <DetailSection title={copy.literature}>
              <div className="mj-repository-literature-list">
                {entry.literature.map((citation) => (
                  <article key={citation.url}>
                    <div><strong>{citation.title}</strong><span>{citation.year} · {citation.authors}</span></div>
                    <p>{locale === "ja" ? citation.relevanceJa : citation.relevance}</p>
                    <a className="mj-text-link" href={citation.url} target="_blank" rel="noreferrer">{citation.url.replace(/^https?:\/\//, "")} ↗</a>
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
              <div><dt>{copy.kind}</dt><dd>{locale === "ja" ? entry.source.kind === "curated_reference" ? "キュレーション参照" : entry.source.kind === "verified_run" ? "検証済み実行" : "コミュニティ投稿" : entry.source.kind.replaceAll("_", " ")}</dd></div>
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

function ClassicalComparison({ comparison, locale, copy }: { comparison: NonNullable<PublicRepositoryEntry["classicalComparison"]>; locale: PublicLocale; copy: RepositoryCopy }) {
  return (
    <div className="mj-repo-comparison">
      <div><h3>{copy.baseline}</h3><p>{locale === "ja" ? comparison.baselineJa : comparison.baseline}</p></div>
      <div><h3>{copy.quantum}</h3><p>{locale === "ja" ? comparison.quantumClaimJa : comparison.quantumClaim}</p></div>
      <div><h3>{copy.practical}</h3><p>{locale === "ja" ? comparison.practicalReadJa : comparison.practicalRead}</p></div>
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
