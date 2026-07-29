import type { ReactNode } from "react";
import type { PublicLocale } from "../../../../lib/public-locale";
import type { VqeComparisonRecord, VqePaperRecord, VqeRepositoryRecord } from "../../../../lib/atlas-vqe/types";

const COPY = {
  en: {
    back: "← Atlas",
    validationState: "Validation state",
    machineValidated: "machine-validated (ADR-0027): sourced and schema-checked, not human-confirmed",
    problem: "Problem",
    components: "Components (literature-level annotation)",
    workflow: "Workflow composition",
    sources: "Sources verified",
    unknowns: "Unknown or ambiguous fields",
    conflicts: "Conflicting fields",
    negativeResults: "Negative results / missing implementation",
    implementations: "Implementation repositories",
    comparisons: "Comparison reports involving this paper",
    noImplementation: "No implementation repository is linked to this paper in the corpus.",
    noComparisons: "No comparison report in this MVP corpus involves this paper.",
    doi: "DOI",
    arxiv: "arXiv",
    none: "none recorded",
    unknown: "unknown",
    manualGold: "manual gold",
    machineGenerated: "machine-generated",
    humanValidated: "human-validated",
    notHumanValidated: "not human-validated",
  },
  ja: {
    back: "← Atlas",
    validationState: "検証状態",
    machineValidated: "機械検証済み（ADR-0027）：出典記録・スキーマ検査は通過、人手による内容確認は未実施",
    problem: "問題設定",
    components: "コンポーネント（文献レベルの注釈）",
    workflow: "ワークフロー構成",
    sources: "出典（検証済み）",
    unknowns: "不明・曖昧なフィールド",
    conflicts: "矛盾するフィールド",
    negativeResults: "否定的な結果・未実装",
    implementations: "実装リポジトリ",
    comparisons: "この論文が関わる比較レポート",
    noImplementation: "corpus内でこの論文に紐づく実装リポジトリはありません。",
    noComparisons: "このMVP corpusにこの論文が関わる比較レポートはありません。",
    doi: "DOI",
    arxiv: "arXiv",
    none: "記録なし",
    unknown: "不明",
    manualGold: "人手ゴールド",
    machineGenerated: "機械生成",
    humanValidated: "人手検証済み",
    notHumanValidated: "人手未検証",
  },
} as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="mj-repo-section" open>
      <summary>{title}</summary>
      <div className="mj-repo-section-body">{children}</div>
    </details>
  );
}

export function VqePaperDetail({
  paper,
  repositories,
  comparisons,
  locale,
}: {
  paper: VqePaperRecord;
  repositories: VqeRepositoryRecord[];
  comparisons: VqeComparisonRecord[];
  locale: PublicLocale;
}) {
  const copy = COPY[locale];

  return (
    <>
      <section className="mj-repo-detail-hero">
        <a className="mj-back-link" href="/repository">{copy.back}</a>
        <div className="mj-repository-detail-kicker">
          <span className="mj-vqe-badge" data-tone={paper.validation_state.state === "machine_validated" ? "ok" : "warn"}>
            {paper.validation_state.state}
          </span>
          <span>{paper.venue} {paper.year}</span>
          <span>{copy.doi}: {paper.doi ?? copy.unknown}</span>
          <span>{copy.arxiv}: {paper.arxiv_id ?? copy.unknown}</span>
        </div>
        <h1>{paper.title}</h1>
        <p>{paper.authors.join(", ")}</p>
        <div className="mj-repo-detail-hero-foot">
          <div className="mj-repository-tags" aria-label={locale === "ja" ? "手法系統" : "Method family"}>
            {paper.method_family.map((family) => <span key={family}>{family}</span>)}
          </div>
        </div>
        <p className="mj-vqe-validation-note">{copy.machineValidated}</p>
      </section>

      <div className="mj-repository-detail-main">
        <p className="mj-repo-detail-lede">{paper.problem_summary}</p>

        <Section title={copy.components}>
          <div
            className="mj-repo-table-scroll"
            role="region"
            aria-label={copy.components}
            tabIndex={0}
          >
            <table className="mj-repo-comparison-table">
              <thead>
                <tr>
                  <th>{locale === "ja" ? "種別" : "Type"}</th>
                  <th>{locale === "ja" ? "名称/系統" : "Family / name"}</th>
                  <th>{locale === "ja" ? "注記" : "Notes"}</th>
                  <th>{locale === "ja" ? "根拠箇所" : "Evidence locator"}</th>
                </tr>
              </thead>
              <tbody>
                {paper.components.map((component, index) => (
                  <tr key={`${component.component_type}-${index}`}>
                    <td>{component.component_type}</td>
                    <td>{component.family_or_name}</td>
                    <td>{component.notes ?? copy.unknown}</td>
                    <td>{component.evidence_locator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {paper.workflow_composition_notes ? (
            <p className="mj-repo-detail-lede">{paper.workflow_composition_notes}</p>
          ) : null}
        </Section>

        <Section title={copy.implementations}>
          {repositories.length ? (
            <div className="mj-repo-list">
              {repositories.map((repo) => (
                <article className="mj-repo-card" key={repo.repo_id}>
                  <div className="mj-repo-card-top">
                    <span className="mj-vqe-badge" data-tone={repo.relation === "official" || repo.relation === "author" ? "ok" : "neutral"}>
                      {repo.relation}
                    </span>
                  </div>
                  <h3><a href={repo.repository_url} target="_blank" rel="noreferrer">{repo.repo_id}</a></h3>
                </article>
              ))}
            </div>
          ) : (
            <p>{copy.noImplementation}</p>
          )}
        </Section>

        <Section title={copy.comparisons}>
          {comparisons.length ? (
            <div className="mj-repo-list">
              {comparisons.map((comparison) => (
                <article className="mj-repo-card" key={comparison.comparison_id}>
                  <div className="mj-repo-card-top">
                    <span className="mj-vqe-badge" data-tone="neutral">{comparison.classification}</span>
                    <span className="mj-vqe-badge" data-tone="neutral">
                      {comparison.is_manual_gold ? copy.manualGold : copy.machineGenerated}
                    </span>
                    <span className="mj-vqe-badge" data-tone={comparison.human_validated ? "ok" : "neutral"}>
                      {comparison.human_validated ? copy.humanValidated : copy.notHumanValidated}
                    </span>
                  </div>
                  <h3><a href={`/repository/vqe/compare/${comparison.comparison_id}`}>{comparison.comparison_id}</a></h3>
                </article>
              ))}
            </div>
          ) : (
            <p>{copy.noComparisons}</p>
          )}
        </Section>

        <Section title={copy.sources}>
          <ul className="mj-vqe-plain-list">
            {paper.sources_verified.map((url) => (
              <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>
            ))}
          </ul>
        </Section>

        <Section title={copy.unknowns}>
          {paper.unknown_or_ambiguous_fields.length ? (
            <ul className="mj-vqe-plain-list">
              {paper.unknown_or_ambiguous_fields.map((field) => <li key={field}>{field}</li>)}
            </ul>
          ) : (
            <p>{copy.none}</p>
          )}
        </Section>

        <Section title={copy.conflicts}>
          {paper.conflicting_fields.length ? (
            <ul className="mj-vqe-plain-list">
              {paper.conflicting_fields.map((field) => <li key={field}>{field}</li>)}
            </ul>
          ) : (
            <p>{copy.none}</p>
          )}
        </Section>

        <Section title={copy.negativeResults}>
          <p>{paper.negative_results_or_missing_implementation ?? copy.none}</p>
        </Section>
      </div>
    </>
  );
}
