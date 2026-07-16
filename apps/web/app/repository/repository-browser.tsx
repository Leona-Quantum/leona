"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  entryVerificationMethods,
  PUBLIC_REPOSITORY_CATEGORIES,
  PUBLIC_REPOSITORY_FRAMEWORKS,
  type PublicRepositoryCategory,
  type PublicRepositoryEntry,
} from "../../lib/public-repository";
import type { PublicLocale } from "../../lib/public-locale";
import { VerificationTierBadge } from "../../components/repository-verification";
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
    view: "View",
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
    view: "詳細",
    emptyTitle: "条件に一致するエントリがありません。",
    emptyBody: "検索範囲を広げるか、すべての参照セットに戻してください。",
    clear: "条件をクリア",
  },
} as const;

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
  "Hamiltonian simulation": "ハミルトニアンシミュレーション",
  "Hamiltonian / observable": "ハミルトニアン / 観測量",
  "Rotation gate": "回転ゲート",
  "Phase gate": "位相ゲート",
  "Multi-qubit gate": "多量子ビットゲート",
  "Entangled state": "エンタングル状態",
  "Encoded state": "符号化状態",
  "Sampling / benchmarking": "サンプリング / ベンチマーク",
  "Error mitigation": "誤り緩和",
  "Optimization / annealing": "最適化 / アニーリング",
};

function familyLabel(family: string, locale: PublicLocale): string {
  return locale === "ja" ? FAMILY_LABELS_JA[family] ?? family : family;
}

export function RepositoryBrowser({
  entries,
  locale,
  isSignedIn,
  signInHref,
  legend,
}: {
  entries: PublicRepositoryEntry[];
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
  legend?: ReactNode;
}) {
  const copy = COPY[locale];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | PublicRepositoryCategory>("all");
  const [family, setFamily] = useState<string>("");
  const [framework, setFramework] = useState<string>("");

  const families = useMemo(() => Array.from(new Set(entries.map((entry) => entry.algorithmFamily))).sort(), [entries]);
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
      const matchesFamily = !family || entry.algorithmFamily === family;
      const matchesFramework = !framework || entry.framework === framework;
      return matchesQuery && matchesCategory && matchesFamily && matchesFramework;
    });
  }, [category, entries, family, framework, query]);

  function clearFilters() {
    setQuery("");
    setCategory("all");
    setFamily("");
    setFramework("");
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
            <option value="">{copy.allFamilies}</option>
            {families.map((option) => <option key={option} value={option}>{familyLabel(option, locale)}</option>)}
          </select>
        </label>
        <label>
          <span>{copy.framework}</span>
          <select value={framework} onChange={(event) => setFramework(event.target.value)}>
            <option value="">{copy.allFrameworks}</option>
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

      {legend}

      <p className="mj-repository-result-count" aria-live="polite">
        {locale === "ja" ? `${filteredEntries.length}${copy.entries}` : `${filteredEntries.length} public ${filteredEntries.length === 1 ? copy.entry : copy.entries}`}
      </p>

      {filteredEntries.length ? (
        <div className="mj-repo-list">
          {filteredEntries.map((entry) => {
            const title = locale === "ja" ? entry.titleJa : entry.title;
            const description = locale === "ja" ? entry.descriptionJa : entry.description;
            const qubits = entry.resources.find((resource) => resource.label === "Qubits")?.value;
            return (
              <article className="mj-repo-card" key={entry.slug}>
                <div className="mj-repo-card-top">
                  <VerificationTierBadge methods={entryVerificationMethods(entry)} locale={locale} />
                  <span>{locale === "ja" ? entry.categoryLabelJa : entry.categoryLabel}</span>
                  <span>{familyLabel(entry.algorithmFamily, locale)}</span>
                  {qubits ? <span className="mj-repo-card-qubits">{qubits} q</span> : null}
                  <time dateTime={entry.updatedAt}>{entry.updatedAt}</time>
                </div>
                <h3><a href={`/repository/${entry.slug}`}>{title}</a></h3>
                <p>{description}</p>
                <div className="mj-repo-card-foot">
                  <div className="mj-repository-tags" aria-label={locale === "ja" ? "タグ" : "Tags"}>
                    {entry.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                  <div className="mj-repo-card-links">
                    <RepositoryExportAction slug={entry.slug} title={title} isSignedIn={isSignedIn} signInHref={signInHref} locale={locale} />
                    <a className="mj-text-link" href={`/repository/${entry.slug}`}>{copy.view} ↗</a>
                  </div>
                </div>
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
