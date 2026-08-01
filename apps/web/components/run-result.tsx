import type { ReactNode } from "react";

import { formatShare } from "../lib/simulation-visual.ts";
import type { RunResultView } from "../lib/run-result.ts";
import { RunCodeExport } from "./run-code-export";

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
}: {
  result: RunResultView;
  action?: ReactNode;
  /** When the run saved an artifact, its stored QASM is what makes the
   * framework conversions, the circuit diagram and the export possible. */
  artifactId?: string | null;
}) {
  const { distribution } = result;
  return (
    <section className="mj-run-result" aria-label="Run result">
      <header className="mj-run-result-head">
        <p className="mj-run-result-summary">{result.summary}</p>
        <ul className="mj-run-result-badges" aria-label="Result status">
          <li data-tone={result.trust.tone}>{result.trust.label}</li>
          <li data-tone="neutral">{result.saved ? "Saved" : "Not saved"}</li>
        </ul>
      </header>

      {result.notice ? (
        <aside className="mj-run-result-notice" role="note">
          <strong>{result.notice.title}</strong>
          <p>{result.notice.body}</p>
        </aside>
      ) : null}

      {distribution ? (
        <div className="mj-sim-chart">
          <span className="mj-section-label">
            Measured distribution · {distribution.shots.toLocaleString("en-US")} shots
          </span>
          <div className="mj-sim-chart-rows">
            {distribution.data.bars.map((bar) => (
              <div
                className={bar.peak ? "mj-sim-chart-row is-peak" : "mj-sim-chart-row"}
                title={`|${bar.bitstring}⟩ · ${bar.count.toLocaleString("en-US")} / ${distribution.shots.toLocaleString("en-US")} · ${formatShare(bar.share, "en-US")}`}
                key={bar.bitstring}
              >
                <code>{bar.bitstring}</code>
                <span className="mj-sim-chart-track">
                  <span
                    className="mj-sim-chart-fill"
                    style={{ width: `${Math.max(bar.share * 100, 0.75)}%` }}
                  />
                </span>
                <span className="mj-sim-chart-value">{formatShare(bar.share, "en-US")}</span>
              </div>
            ))}
            {distribution.data.otherStates ? (
              <div
                className="mj-sim-chart-row is-other"
                title={`${distribution.data.otherStates} further states · ${distribution.data.otherShots.toLocaleString("en-US")} / ${distribution.shots.toLocaleString("en-US")}`}
              >
                <code>…</code>
                <span className="mj-sim-chart-track">
                  <span
                    className="mj-sim-chart-fill"
                    style={{
                      width: `${Math.max((distribution.data.otherShots / distribution.shots) * 100, 0.75)}%`,
                    }}
                  />
                </span>
                <span className="mj-sim-chart-value">+{distribution.data.otherStates}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {result.values.length ? (
        <dl className="mj-run-result-values">
          {result.values.map((value) => (
            <div key={value.label}>
              <dt>{value.label}</dt>
              <dd>{value.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

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
        />
      ) : null}

      {result.limitations.length ? (
        <details className="mj-run-result-limits">
          <summary>What this run does not establish</summary>
          <p>{result.limitations.join(", ")}.</p>
        </details>
      ) : null}

      {action ? <footer className="mj-run-result-action">{action}</footer> : null}
    </section>
  );
}
