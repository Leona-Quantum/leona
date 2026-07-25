"use client";

/**
 * Browse UI for the Atlas VQE corpus (ADR-0027, plan Phase 4 "Browse
 * requirements"/"Compare requirements"). Three sub-views over the same
 * static, machine-validated corpus: Papers, Repositories (with the 4-way
 * relation breakdown the plan's own acceptance criterion requires always
 * showing together, not just an official/author total -- see
 * docs/atlas/PHASE2_PROGRESS.md for why that matters), and the 3 Comparison
 * reports. Every unknown/null field renders as an explicit "unknown" pill,
 * never a blank cell (plan: "unknown/conflictを空欄に変換しない").
 */
import { useMemo, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import type {
  VqeComparisonListEntry,
  VqeComponentListEntry,
  VqePaperListEntry,
  VqeRepositoryListEntry,
  VqeRepositoryRelation,
} from "../../../lib/atlas-vqe/types";

const COPY = {
  en: {
    search: "Search papers, methods, or repositories",
    placeholder: "Title, author, method family, or venue",
    tabs: {
      papers: "Papers",
      components: "Components",
      repositories: "Repositories",
      comparisons: "Comparisons",
    },
    methodFamily: "Method family",
    allFamilies: "All method families",
    componentType: "Component type",
    allComponentTypes: "All component types",
    relation: "Relation",
    allRelations: "All relations",
    resultCount: (n: number) => `${n} ${n === 1 ? "record" : "records"}`,
    emptyTitle: "No records match those filters.",
    emptyBody: "Try a broader search or clear the filters.",
    clear: "Clear filters",
    machineValidated: "machine-validated, ADR-0026",
    unknown: "unknown",
    implementationAvailable: "implementation available",
    view: "View",
    compare: "Compare",
    openStudio: "Open executable workflows in Studio",
    manualGold: "manual gold",
    machineGenerated: "machine-generated",
    humanValidated: "human-validated",
    notHumanValidated: "not human-validated",
    relationLabels: {
      official: "Official",
      author: "Author",
      general_framework_library: "General framework/library",
      third_party_reference_implementation: "Third-party reproduction",
    } as Record<VqeRepositoryRelation, string>,
    associatedPapers: (n: number) => `${n} associated paper${n === 1 ? "" : "s"}`,
  },
  ja: {
    search: "論文・手法・実装リポジトリを検索",
    placeholder: "タイトル、著者、手法系統、掲載誌",
    tabs: {
      papers: "論文",
      components: "構成要素",
      repositories: "実装リポジトリ",
      comparisons: "比較",
    },
    methodFamily: "手法系統",
    allFamilies: "すべての手法系統",
    componentType: "構成要素の種類",
    allComponentTypes: "すべての種類",
    relation: "関係",
    allRelations: "すべての関係",
    resultCount: (n: number) => `${n}件`,
    emptyTitle: "条件に一致するレコードがありません。",
    emptyBody: "検索範囲を広げるか、条件をクリアしてください。",
    clear: "条件をクリア",
    machineValidated: "機械検証済み（ADR-0026）",
    unknown: "不明",
    implementationAvailable: "実装あり",
    view: "詳細",
    compare: "比較",
    openStudio: "実行可能WorkflowをStudioで開く",
    manualGold: "人手ゴールド",
    machineGenerated: "機械生成",
    humanValidated: "人手検証済み",
    notHumanValidated: "人手未検証",
    relationLabels: {
      official: "公式",
      author: "著者",
      general_framework_library: "汎用フレームワーク/ライブラリ",
      third_party_reference_implementation: "第三者による再現実装",
    } as Record<VqeRepositoryRelation, string>,
    associatedPapers: (n: number) => `関連論文 ${n}件`,
  },
} as const;

const RELATIONS: VqeRepositoryRelation[] = [
  "official",
  "author",
  "general_framework_library",
  "third_party_reference_implementation",
];

function Badge({ tone, children }: { tone: "ok" | "warn" | "neutral"; children: React.ReactNode }) {
  return (
    <span className="mj-vqe-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function VqeMethodsBrowser({
  papers,
  components,
  repositories,
  comparisons,
  locale,
}: {
  papers: VqePaperListEntry[];
  components: VqeComponentListEntry[];
  repositories: VqeRepositoryListEntry[];
  comparisons: VqeComparisonListEntry[];
  locale: PublicLocale;
}) {
  const copy = COPY[locale];
  const [tab, setTab] = useState<
    "papers" | "components" | "repositories" | "comparisons"
  >("papers");
  const [query, setQuery] = useState("");
  const [methodFamily, setMethodFamily] = useState("");
  const [relation, setRelation] = useState<"" | VqeRepositoryRelation>("");
  const [componentType, setComponentType] = useState("");

  const methodFamilies = useMemo(
    () => Array.from(new Set(papers.flatMap((paper) => paper.method_family))).sort(),
    [papers],
  );

  const filteredPapers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return papers.filter((paper) => {
      const matchesQuery =
        !normalized ||
        [paper.title, ...paper.authors, paper.venue, ...paper.method_family, paper.problem_summary]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      const matchesFamily = !methodFamily || paper.method_family.includes(methodFamily);
      return matchesQuery && matchesFamily;
    });
  }, [papers, query, methodFamily]);

  const filteredRepositories = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return repositories.filter((repo) => {
      const matchesQuery = !normalized || repo.repository_url.toLowerCase().includes(normalized);
      const matchesRelation = !relation || repo.relation === relation;
      return matchesQuery && matchesRelation;
    });
  }, [repositories, query, relation]);

  const componentTypes = useMemo(
    () => Array.from(new Set(components.map((component) => component.component_type))).sort(),
    [components],
  );

  const filteredComponents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return components.filter((component) => {
      const matchesQuery =
        !normalized ||
        [
          component.component_type,
          component.family_or_name,
          component.notes ?? "",
          component.paper_title,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      const matchesType = !componentType || component.component_type === componentType;
      return matchesQuery && matchesType;
    });
  }, [components, componentType, query]);

  const relationBreakdown = useMemo(() => {
    const counts: Record<VqeRepositoryRelation, number> = {
      official: 0,
      author: 0,
      general_framework_library: 0,
      third_party_reference_implementation: 0,
    };
    for (const repo of repositories) counts[repo.relation] += 1;
    return counts;
  }, [repositories]);

  function clearFilters() {
    setQuery("");
    setMethodFamily("");
    setRelation("");
    setComponentType("");
  }

  const paperTitleById = useMemo(() => new Map(papers.map((paper) => [paper.paper_id, paper.title])), [papers]);

  return (
    <div className="mj-repository-browser">
      <div className="mj-repository-actions">
        <a className="mj-primary-button" href="/studio?vqe=1">
          {copy.openStudio}
        </a>
      </div>
      <div className="mj-repository-category-nav" aria-label={locale === "ja" ? "表示" : "View"}>
        {(Object.entries(copy.tabs) as Array<[typeof tab, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? "is-active" : ""}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== "comparisons" ? (
        <div className="mj-repository-controls">
          <label>
            <span>{copy.search}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.placeholder} type="search" />
          </label>
          {tab === "papers" ? (
            <label>
              <span>{copy.methodFamily}</span>
              <select value={methodFamily} onChange={(event) => setMethodFamily(event.target.value)}>
                <option value="">{copy.allFamilies}</option>
                {methodFamilies.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          ) : tab === "components" ? (
            <label>
              <span>{copy.componentType}</span>
              <select
                value={componentType}
                onChange={(event) => setComponentType(event.target.value)}
              >
                <option value="">{copy.allComponentTypes}</option>
                {componentTypes.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              <span>{copy.relation}</span>
              <select value={relation} onChange={(event) => setRelation(event.target.value as "" | VqeRepositoryRelation)}>
                <option value="">{copy.allRelations}</option>
                {RELATIONS.map((option) => (
                  <option key={option} value={option}>{copy.relationLabels[option]}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : null}

      {tab === "repositories" ? (
        <div className="mj-vqe-relation-breakdown" aria-label={locale === "ja" ? "関係の内訳" : "Relation breakdown"}>
          {RELATIONS.map((r) => (
            <span key={r}>
              {copy.relationLabels[r]}: <strong>{relationBreakdown[r]}</strong>
            </span>
          ))}
        </div>
      ) : null}

      {tab === "components" ? (
        <>
          <p className="mj-repository-result-count" aria-live="polite">
            {copy.resultCount(filteredComponents.length)}
          </p>
          {!filteredComponents.length ? (
            <div className="mj-repository-empty">
              <h3>{copy.emptyTitle}</h3>
              <p>{copy.emptyBody}</p>
              <button type="button" onClick={clearFilters}>
                {copy.clear}
              </button>
            </div>
          ) : (
            <div className="mj-repo-list">
              {filteredComponents.map((component) => (
                <article className="mj-repo-card" key={component.observation_key}>
                  <div className="mj-repo-card-top">
                    <Badge tone="neutral">{component.component_type}</Badge>
                    <span>
                      {locale === "ja" ? "論文注釈" : "paper annotation"}
                    </span>
                  </div>
                  <h3>{component.family_or_name}</h3>
                  <p>{component.notes ?? copy.unknown}</p>
                  <div className="mj-repo-card-foot">
                    <a
                      className="mj-text-link"
                      href={`/repository/vqe/${component.paper_id}`}
                    >
                      {component.paper_title} ↗
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === "papers" ? (
        <>
          <p className="mj-repository-result-count" aria-live="polite">{copy.resultCount(filteredPapers.length)}</p>
          {!filteredPapers.length ? (
            <div className="mj-repository-empty">
              <h3>{copy.emptyTitle}</h3>
              <p>{copy.emptyBody}</p>
              <button type="button" onClick={clearFilters}>{copy.clear}</button>
            </div>
          ) : (
            <div className="mj-repo-list">
              {filteredPapers.map((paper) => (
                <article className="mj-repo-card" key={paper.paper_id}>
                  <div className="mj-repo-card-top">
                    <Badge tone={paper.validation_state.state === "machine_validated" ? "ok" : "warn"}>
                      {paper.validation_state.state === "machine_validated" ? copy.machineValidated : paper.validation_state.state}
                    </Badge>
                    <span>{paper.venue} {paper.year}</span>
                    {paper.implementation_ref ? <Badge tone="ok">{copy.implementationAvailable}</Badge> : null}
                  </div>
                  <h3><a href={`/repository/vqe/${paper.paper_id}`}>{paper.title}</a></h3>
                  <p>{paper.problem_summary}</p>
                  <div className="mj-repo-card-foot">
                    <div className="mj-repository-tags">
                      {paper.method_family.map((f) => <span key={f}>{f}</span>)}
                    </div>
                    <a className="mj-text-link" href={`/repository/vqe/${paper.paper_id}`}>{copy.view} ↗</a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === "repositories" ? (
        <>
          <p className="mj-repository-result-count" aria-live="polite">{copy.resultCount(filteredRepositories.length)}</p>
          {!filteredRepositories.length ? (
            <div className="mj-repository-empty">
              <h3>{copy.emptyTitle}</h3>
              <p>{copy.emptyBody}</p>
              <button type="button" onClick={clearFilters}>{copy.clear}</button>
            </div>
          ) : (
            <div className="mj-repo-list">
              {filteredRepositories.map((repo) => (
                <article className="mj-repo-card" key={repo.repo_id}>
                  <div className="mj-repo-card-top">
                    <Badge tone={repo.relation === "official" || repo.relation === "author" ? "ok" : "neutral"}>
                      {copy.relationLabels[repo.relation]}
                    </Badge>
                    <span>{copy.associatedPapers(repo.associated_paper_ids.length)}</span>
                  </div>
                  <h3>
                    <a href={repo.repository_url} target="_blank" rel="noreferrer">{repo.repo_id}</a>
                  </h3>
                  <p>
                    {locale === "ja" ? "ライセンス" : "License"}: {repo.license_state === "unknown" ? copy.unknown : repo.license_state}
                    {" · "}
                    {locale === "ja" ? "環境の完全性" : "Environment completeness"}:{" "}
                    {repo.environment_completeness === "unknown" ? copy.unknown : repo.environment_completeness}
                  </p>
                  <div className="mj-repo-card-foot">
                    <div className="mj-repository-tags">
                      {repo.associated_paper_ids.slice(0, 3).map((paperId) => (
                        <a key={paperId} href={`/repository/vqe/${paperId}`}>
                          {paperTitleById.get(paperId) ?? paperId}
                        </a>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === "comparisons" ? (
        <>
          <p className="mj-repository-result-count" aria-live="polite">{copy.resultCount(comparisons.length)}</p>
          {!comparisons.length ? (
            <div className="mj-repository-empty">
              <h3>{copy.emptyTitle}</h3>
              <p>{copy.emptyBody}</p>
            </div>
          ) : (
            <div className="mj-repo-list">
              {comparisons.map((comparison) => (
                <article className="mj-repo-card" key={comparison.comparison_id}>
                  <div className="mj-repo-card-top">
                    <Badge
                      tone={
                        comparison.classification === "strict"
                          ? "ok"
                          : comparison.classification === "invalid"
                            ? "warn"
                            : "neutral"
                      }
                    >
                      {comparison.classification}
                    </Badge>
                    <Badge tone="neutral">{comparison.is_manual_gold ? copy.manualGold : copy.machineGenerated}</Badge>
                    <Badge tone={comparison.human_validated ? "ok" : "neutral"}>
                      {comparison.human_validated ? copy.humanValidated : copy.notHumanValidated}
                    </Badge>
                  </div>
                  <h3>
                    <a href={`/repository/vqe/compare/${comparison.comparison_id}`}>
                      {comparison.source_record_ids.map((id) => paperTitleById.get(id) ?? id).join(" vs. ")}
                    </a>
                  </h3>
                  <div className="mj-repo-card-foot">
                    <a className="mj-text-link" href={`/repository/vqe/compare/${comparison.comparison_id}`}>
                      {copy.compare} ↗
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
