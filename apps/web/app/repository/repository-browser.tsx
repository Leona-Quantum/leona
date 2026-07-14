"use client";

import { useMemo, useState } from "react";
import {
  PUBLIC_REPOSITORY_CATEGORIES,
  PUBLIC_REPOSITORY_FRAMEWORKS,
  type PublicRepositoryCategory,
  type PublicRepositoryEntry,
} from "../../lib/public-repository";
import type { PublicLocale } from "../../lib/public-locale";

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
    familyLabel: "Family",
    verification: "Verification",
    export: "Export",
    provenance: "Provenance",
    tags: "Tags",
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
    familyLabel: "系統",
    verification: "検証",
    export: "エクスポート",
    provenance: "出典",
    tags: "タグ",
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

export function RepositoryBrowser({
  entries,
  locale,
}: {
  entries: PublicRepositoryEntry[];
  locale: PublicLocale;
}) {
  const copy = COPY[locale];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | PublicRepositoryCategory>("all");
  const [family, setFamily] = useState<string>(copy.allFamilies);
  const [framework, setFramework] = useState<string>(copy.allFrameworks);

  const families = useMemo(
    () => [copy.allFamilies, ...Array.from(new Set(entries.map((entry) => entry.algorithmFamily)))],
    [copy.allFamilies, entries],
  );
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
      <div className="mj-repository-category-nav" aria-label={locale === "ja" ? "カテゴリ" : "Categories"}>
        {PUBLIC_REPOSITORY_CATEGORIES.map((option) => (
          <button
            className={category === option.value ? "is-active" : ""}
            key={option.value}
            type="button"
            aria-pressed={category === option.value}
            onClick={() => setCategory(option.value)}
          >
            {locale === "ja" ? option.labelJa : option.label}
          </button>
        ))}
      </div>

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
            {families.map((option) => <option key={option}>{option}</option>)}
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

      <p className="mj-repository-result-count" aria-live="polite">
        {filteredEntries.length} public {locale === "ja" ? copy.entries : filteredEntries.length === 1 ? copy.entry : copy.entries}
      </p>

      {filteredEntries.length ? (
        <div className="mj-repository-grid">
          {filteredEntries.map((entry) => {
            const title = locale === "ja" ? entry.titleJa : entry.title;
            const description = locale === "ja" ? entry.descriptionJa : entry.description;
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
                      <span>{resource.label}</span>
                      <strong>{resource.value}</strong>
                    </div>
                  ))}
                </div>
                <dl className="mj-repository-evidence">
                  <div><dt>{copy.familyLabel}</dt><dd>{entry.algorithmFamily}</dd></div>
                  <div><dt>{copy.verification}</dt><dd>{entry.verification}</dd></div>
                  <div><dt>{copy.export}</dt><dd>{entry.exportStatus}</dd></div>
                  <div><dt>{copy.provenance}</dt><dd>{entry.provenance}</dd></div>
                </dl>
                <div className="mj-repository-entry-actions">
                  <div className="mj-repository-tags" aria-label={copy.tags}>
                    {entry.tags.map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                  <a className="mj-text-link" href={`/repository/${entry.slug}`}>{copy.view} ↗</a>
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
