"use client";

import { useMemo, useState } from "react";
import {
  getPublicRepositoryLibraryVariant,
  PUBLIC_REPOSITORY_CATEGORIES,
  PUBLIC_REPOSITORY_FRAMEWORKS,
  type PublicRepositoryCategory,
  type PublicRepositoryEntry,
} from "../../lib/public-repository";
import type { PublicLocale } from "../../lib/public-locale";
import { RepositoryExportAction } from "./repository-export";

const COPY = {
  en: {
    search: "Search the repository",
    placeholder: "Search algorithms, frameworks, or tags",
    family: "Algorithm family",
    framework: "Framework",
    allFamilies: "All families",
    allFrameworks: "All frameworks",
    entry: "entry",
    entries: "entries",
    view: "View entry",
    explore: "Explore this record",
    visualization: "Circuit visualization",
    simulation: "Simulation visualization",
    how: "How it works",
    comparison: "Classical comparison",
    code: "Code",
    resources: "Resources and classification",
    source: "Source",
    license: "License",
    familyLabel: "Family",
    verification: "Verification",
    export: "Export",
    provenance: "Provenance",
    tags: "Tags",
    outcomes: "Expected outcomes",
    native: "Native snippet",
    noCode: "No supported native Library snippet is published for this entry yet.",
    emptyTitle: "No entries match those filters.",
    emptyBody: "Try a broader search or return to the full reference set.",
    clear: "Clear filters",
  },
  ja: {
    search: "リポジトリを検索",
    placeholder: "アルゴリズム、フレームワーク、タグを検索",
    family: "アルゴリズム系統",
    framework: "フレームワーク",
    allFamilies: "すべての系統",
    allFrameworks: "すべてのフレームワーク",
    entry: "件",
    entries: "件",
    view: "詳細を見る",
    explore: "レコードを見る",
    visualization: "回路の可視化",
    simulation: "シミュレーションの可視化",
    how: "仕組み",
    comparison: "古典との比較",
    code: "コード",
    resources: "リソースと分類",
    source: "出典",
    license: "ライセンス",
    familyLabel: "系統",
    verification: "検証",
    export: "エクスポート",
    provenance: "出典種別",
    tags: "タグ",
    outcomes: "期待される出力",
    native: "ネイティブスニペット",
    noCode: "Libraryに追加できるネイティブコードはまだ公開されていません。",
    emptyTitle: "条件に一致するエントリがありません。",
    emptyBody: "検索範囲を広げるか、すべての参照セットに戻してください。",
    clear: "条件をクリア",
  },
} as const;

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

const FAMILY_LABELS_JA: Record<string, string> = {
  "Single-qubit gate": "単一量子ビットゲート",
  "Pauli operator": "パウリ演算子",
  "Controlled gate": "制御ゲート",
  "Two-qubit gate": "2量子ビットゲート",
  "Quantum query algorithm": "量子クエリアルゴリズム",
  "Bell / entanglement": "ベル / エンタングルメント",
  "GHZ / entanglement": "GHZ / エンタングルメント",
  QAOA: "QAOA",
  "Amplitude amplification": "振幅増幅",
  "Hidden-period / factoring": "隠れ周期 / 因数分解",
  "Amplitude estimation": "振幅推定",
  "Variational quantum algorithm": "変分量子アルゴリズム",
  "Eigenvalue estimation": "固有値推定",
  "Quantum linear algebra": "量子線形代数",
  "Quantum machine learning": "量子機械学習",
  "Entanglement and communication": "エンタングルメントと通信",
  "Quantum error correction": "量子誤り訂正",
  "Quantum Fourier transform": "量子フーリエ変換",
};

const RESOURCE_LABELS_JA: Record<string, string> = {
  Qubits: "量子ビット",
  Depth: "深さ",
  Outcomes: "出力",
  Shots: "ショット",
  Evidence: "根拠",
  Claim: "主張",
  Output: "出力",
  Target: "対象",
  Access: "アクセス",
  Registers: "レジスタ",
  Precision: "精度",
  Core: "中核",
  Input: "入力",
  Risk: "リスク",
  "Quantum core": "量子コア",
  "Classical post": "古典後処理",
  Readiness: "実用化条件",
  "Classical bits": "古典ビット",
  "Shared resource": "共有リソース",
  Logical: "論理",
  Physical: "物理",
  Corrects: "訂正対象",
  "Quantum role": "量子側の役割",
  "Classical role": "古典側の役割",
  "Main metric": "主指標",
  Queries: "クエリ数",
  "Input register": "入力レジスタ",
  "Output register": "出力レジスタ",
  Samples: "サンプル数",
};

function familyLabel(family: string, locale: PublicLocale): string {
  return locale === "ja" ? FAMILY_LABELS_JA[family] ?? family : family;
}

function resourceLabel(label: string, locale: PublicLocale): string {
  return locale === "ja" ? RESOURCE_LABELS_JA[label] ?? label : label;
}

export function RepositoryBrowser({
  entries,
  locale,
  isSignedIn,
  signInHref,
}: {
  entries: PublicRepositoryEntry[];
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
}) {
  const copy = COPY[locale];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | PublicRepositoryCategory>("all");
  const [family, setFamily] = useState<string>(copy.allFamilies);
  const [framework, setFramework] = useState<string>(copy.allFrameworks);

  const families = useMemo(() => Array.from(new Set(entries.map((entry) => entry.algorithmFamily))), [entries]);
  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesQuery = !normalizedQuery || [
        entry.title,
        entry.titleJa,
        entry.algorithmFamily,
        entry.framework,
        entry.description,
        entry.descriptionJa,
        entry.provenance,
        ...entry.tags,
      ].join(" ").toLowerCase().includes(normalizedQuery);
      const matchesCategory = category === "all" || entry.category === category;
      const matchesFamily = family === copy.allFamilies || entry.algorithmFamily === family;
      const matchesFramework = framework === copy.allFrameworks || entry.framework === framework;
      return matchesQuery && matchesCategory && matchesFamily && matchesFramework;
    });
  }, [category, copy.allFamilies, copy.allFrameworks, entries, family, framework, query]);

  function clearFilters() {
    setQuery("");
    setCategory("all");
    setFamily(copy.allFamilies);
    setFramework(copy.allFrameworks);
  }

  return (
    <div className="mj-repository-browser">
      <div className="mj-repository-controls">
        <label>
          <span>{copy.search}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.placeholder}
            type="search"
          />
        </label>
        <label>
          <span>{copy.family}</span>
          <select value={family} onChange={(event) => setFamily(event.target.value)}>
            <option value={copy.allFamilies}>{copy.allFamilies}</option>
            {families.map((option) => <option key={option} value={option}>{familyLabel(option, locale)}</option>)}
          </select>
        </label>
        <label>
          <span>{copy.framework}</span>
          <select value={framework} onChange={(event) => setFramework(event.target.value)}>
            <option>{copy.allFrameworks}</option>
            {PUBLIC_REPOSITORY_FRAMEWORKS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
      </div>

      <div className="mj-repository-category-nav" aria-label={locale === "ja" ? "カテゴリ" : "Categories"}>
        {PUBLIC_REPOSITORY_CATEGORIES.map((option) => (
          <button
            className={category === option.value ? "is-active" : ""}
            key={option.value}
            type="button"
            aria-pressed={category === option.value}
            title={locale === "ja" ? option.labelJa : option.label}
            onClick={() => setCategory(option.value)}
          >
            {locale === "ja" ? option.labelJa : option.label}
          </button>
        ))}
      </div>

      <p className="mj-repository-result-count" aria-live="polite">
        {locale === "ja" ? `${filteredEntries.length}${copy.entries}` : `${filteredEntries.length} public ${filteredEntries.length === 1 ? copy.entry : copy.entries}`}
      </p>

      {filteredEntries.length ? (
        <div className="mj-repository-grid">
          {filteredEntries.map((entry) => {
            const title = locale === "ja" ? entry.titleJa : entry.title;
            const description = locale === "ja" ? entry.descriptionJa : entry.description;
            const libraryVariant = getPublicRepositoryLibraryVariant(entry);
            return (
              <article className="mj-repository-entry" key={entry.slug}>
                <div className="mj-repository-entry-head">
                  <div className="mj-repository-status-row">
                    <span className="mj-repository-status" data-status={entry.status}>
                      {statusLabel(entry.status, locale)}
                    </span>
                    <span>{locale === "ja" ? entry.categoryLabelJa : entry.categoryLabel}</span>
                    <span>{entry.framework}</span>
                  </div>
                  <time dateTime={entry.updatedAt}>{entry.updatedAt}</time>
                </div>
                <h3><a href={`/repository/${entry.slug}`}>{title}</a></h3>
                <p>{description}</p>
                <div className="mj-repository-resource-row">
                  {entry.resources.map((resource) => (
                    <div key={resource.label}>
                      <span>{resourceLabel(resource.label, locale)}</span>
                      <strong>{resource.value}</strong>
                    </div>
                  ))}
                </div>
                <dl className="mj-repository-evidence">
                  <div><dt>{copy.familyLabel}</dt><dd>{familyLabel(entry.algorithmFamily, locale)}</dd></div>
                  <div><dt>{copy.verification}</dt><dd>{entry.verification}</dd></div>
                  <div><dt>{copy.export}</dt><dd>{entry.exportStatus}</dd></div>
                  <div><dt>{copy.provenance}</dt><dd>{entry.provenance}</dd></div>
                </dl>
                <div className="mj-repository-entry-actions">
                  <div className="mj-repository-tags" aria-label={copy.tags}>
                    {entry.tags.map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                  <div className="mj-repository-entry-links">
                    <RepositoryExportAction slug={entry.slug} title={title} isSignedIn={isSignedIn} signInHref={signInHref} locale={locale} />
                    <a className="mj-text-link" href={`/repository/${entry.slug}`}>{copy.view} ↗</a>
                  </div>
                </div>

                <details className="mj-repository-entry-details">
                  <summary>{copy.explore}</summary>
                  <div className="mj-repository-entry-sections">
                    <details>
                      <summary>{copy.visualization}</summary>
                      <div className="mj-repository-mini-circuit">
                        {entry.visualization.operations.map((operation, index) => <span key={`${operation.label}-${index}`} data-tone={operation.tone}>{operation.label} · q{operation.qubits.join(", q")}</span>)}
                      </div>
                    </details>
                    <details>
                      <summary>{copy.simulation}</summary>
                      <div className="mj-repository-mini-outcomes" aria-label={copy.outcomes}>
                        {entry.visualization.outcomes.map((outcome) => (
                          <div key={outcome.label}>
                            <span>{outcome.label}</span><strong>{Math.round(outcome.probability * 100)}%</strong>
                            <span className="mj-repository-mini-outcome-track"><span style={{ width: `${Math.max(0, Math.min(1, outcome.probability)) * 100}%` }} /></span>
                          </div>
                        ))}
                      </div>
                    </details>
                    <details>
                      <summary>{copy.how}</summary>
                      <p>{locale === "ja" ? entry.explanationJa : entry.explanation}</p>
                    </details>
                    <details>
                      <summary>{copy.comparison}</summary>
                      <p>{entry.classicalComparison
                        ? locale === "ja" ? entry.classicalComparison.practicalReadJa : entry.classicalComparison.practicalRead
                        : "A matched classical baseline is not published for this reference record yet."}</p>
                    </details>
                    <details>
                      <summary>{copy.code}</summary>
                      {libraryVariant ? (
                        <>
                          <span className="mj-repository-mini-code-label">{copy.native}: {libraryVariant.framework}</span>
                          <pre className="mj-repository-mini-code"><code>{libraryVariant.code}</code></pre>
                        </>
                      ) : <p>{copy.noCode}</p>}
                    </details>
                    <details>
                      <summary>{copy.resources}</summary>
                      <dl className="mj-repository-mini-dl">
                        {[...entry.metadata, { label: copy.source, value: entry.source.title }, { label: copy.license, value: entry.source.license }].map((row) => (
                          <div key={`${row.label}-${row.value}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>
                        ))}
                      </dl>
                    </details>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mj-repository-empty">
          <h3>{copy.emptyTitle}</h3>
          <p>{copy.emptyBody}</p>
          <button type="button" onClick={clearFilters}>{copy.clear}</button>
        </div>
      )}
    </div>
  );
}
