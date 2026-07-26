import type { ReactNode } from "react";

import { SyntaxHighlightedCode } from "./code-block";

export type RunOutcomeTone = "ok" | "warn" | "err" | "neutral";
export type RunOutcomeCheckState = "pass" | "fail" | "unavailable";

export interface RunOutcomeBadge {
  label: string;
  tone: RunOutcomeTone;
}

export interface RunOutcomeFact {
  label: string;
  value: string;
}

export interface RunOutcomeCheck {
  label: string;
  state: RunOutcomeCheckState;
}

export interface RunOutcomeView {
  tone: RunOutcomeTone;
  eyebrow: string;
  title: string;
  description: string;
  badges: RunOutcomeBadge[];
  facts: RunOutcomeFact[];
  callout?: {
    title: string;
    body: string;
  };
  checks?: RunOutcomeCheck[];
  code?: {
    label: string;
    language: string;
    source: string;
  };
}

const OUTCOME_GLYPH: Record<RunOutcomeTone, string> = {
  ok: "✓",
  warn: "–",
  err: "×",
  neutral: "–",
};

const CHECK_LABEL: Record<RunOutcomeCheckState, string> = {
  pass: "Passed",
  fail: "Failed",
  unavailable: "Unavailable",
};

export function RunOutcome({
  outcome,
  action,
}: {
  outcome: RunOutcomeView;
  action?: ReactNode;
}): ReactNode {
  return (
    <section
      className="mj-run-outcome"
      data-tone={outcome.tone}
      aria-label={`${outcome.eyebrow}. ${outcome.title}`}
    >
      <header className="mj-run-outcome-head">
        <div className="mj-run-outcome-identity">
          <span className="mj-run-outcome-glyph" aria-hidden="true">
            {OUTCOME_GLYPH[outcome.tone]}
          </span>
          <div className="mj-run-outcome-heading">
            <span>{outcome.eyebrow}</span>
            <h2>{outcome.title}</h2>
          </div>
        </div>
        {outcome.badges.length ? (
          <ul className="mj-run-outcome-badges" aria-label="Result status">
            {outcome.badges.map((badge) => (
              <li data-tone={badge.tone} key={badge.label}>
                {badge.label}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="mj-run-outcome-body">
        <p className="mj-run-outcome-description">{outcome.description}</p>

        {outcome.facts.length ? (
          <dl className="mj-run-outcome-facts">
            {outcome.facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {outcome.callout ? (
          <div className="mj-run-outcome-callout">
            <strong>{outcome.callout.title}</strong>
            <p>{outcome.callout.body}</p>
          </div>
        ) : null}

        {outcome.checks?.length ? (
          <details className="mj-run-outcome-details">
            <summary>
              <span>Evidence</span>
              <span>{outcome.checks.length} checks</span>
            </summary>
            <ul>
              {outcome.checks.map((check, index) => (
                <li key={`${check.label}-${index}`}>
                  <span className="mj-run-outcome-check" data-state={check.state}>
                    {CHECK_LABEL[check.state]}
                  </span>
                  <code>{check.label}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {outcome.code ? (
          <details className="mj-run-outcome-details mj-run-outcome-code">
            <summary>
              <span>{outcome.code.label}</span>
              <span>{outcome.code.language}</span>
            </summary>
            {/* Focusable and labelled: when the block overflows, a keyboard-only
                user has no other way to scroll it. Mirrors CodeStage in
                live-run.tsx, which renders the same content. */}
            <pre tabIndex={0} role="region" aria-label={`${outcome.code.label} source`}>
              <SyntaxHighlightedCode
                code={outcome.code.source}
                language={outcome.code.language}
              />
            </pre>
          </details>
        ) : null}

        {action ? <footer className="mj-run-outcome-action">{action}</footer> : null}
      </div>
    </section>
  );
}
