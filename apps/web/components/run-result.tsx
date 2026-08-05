import type { ReactNode } from "react";

import type { RunResultView } from "../lib/run-result.ts";
import { ResultVisualizations } from "./result-visualization";
import { RunCodeExport } from "./run-code-export";
import type { PublicLocale } from "../lib/public-locale";

/**
 * The end of a run: what it measured, what it reported, and the best program it
 * produced. Rejected candidates stay visible with a warning trust marker.
 *
 * Deliberately not a verdict card. The distribution and the code are the content and
 * are open by default; the trust marker is one badge, and the unverified claims sit
 * behind a disclosure so the page states them without leading with them.
 */
export function RunResult({
  result,
  action,
  artifactId = null,
  locale = "en",
  showSummary = true,
}: {
  result: RunResultView;
  action?: ReactNode;
  /** When the run saved an artifact, its stored QASM is what makes the
   * framework conversions, the circuit diagram and the export possible. */
  artifactId?: string | null;
  locale?: PublicLocale;
  /** The Run conversation renders its prose summary as a normal assistant
   * message immediately before this structured result card. */
  showSummary?: boolean;
}) {
  const { distribution } = result;
  return (
    <section className="mj-run-result" aria-label={locale === "ja" ? "実行結果" : "Run result"}>
      <header className={`mj-run-result-head${showSummary ? "" : " mj-run-result-head--badges-only"}`}>
        {showSummary ? <p className="mj-run-result-summary">{result.summary}</p> : null}
        <ul className="mj-run-result-badges" aria-label={locale === "ja" ? "結果の状態" : "Result status"}>
          <li data-tone={result.trust.tone}>{result.trust.label}</li>
          <li data-tone="neutral">{result.saved ? locale === "ja" ? "保存済み" : "Saved" : locale === "ja" ? "未保存" : "Not saved"}</li>
        </ul>
      </header>

      {result.notice ? (
        <aside className="mj-run-result-notice" role="note">
          <strong>{result.notice.title}</strong>
          <p>{result.notice.body}</p>
        </aside>
      ) : null}

      <ResultVisualizations
        distribution={distribution}
        traces={result.traces}
        values={result.values}
        locale={locale}
      />

      {result.facts.length ? (
        <ul className="mj-run-result-facts">
          {result.facts.map((fact) => (
            <li key={fact.label}>
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
            </li>
          ))}
        </ul>
      ) : null}

      {result.code || artifactId ? (
        <RunCodeExport
          artifactId={artifactId}
          title={result.summary}
          fallback={result.code}
          locale={locale}
        />
      ) : null}

      {result.limitations.length ? (
        <details className="mj-run-result-limits">
          <summary>{locale === "ja" ? "この実行で確認できていないこと" : "What this run does not establish"}</summary>
          <p>{result.limitations.join(", ")}.</p>
        </details>
      ) : null}

      {action ? <footer className="mj-run-result-action">{action}</footer> : null}
    </section>
  );
}
