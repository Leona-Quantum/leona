"use client";

import type { components } from "@majorana/contracts-gen";
import { notebookReviewView } from "../lib/notebook-review";
import type { PublicLocale } from "../lib/public-locale";
import { WORKSPACE_COPY } from "../lib/workspace-locale";

type NotebookReview = components["schemas"]["NotebookReview"];

/**
 * Nala's advisory review (accuracy/pedagogy/code/safety/structure/style
 * findings — never a save-blocker, design doc §3), collapsed under the
 * version header. The contract carries no per-category NUMERIC score, so
 * findings render as severity pills grouped by category rather than meters
 * — see `lib/notebook-review.ts` for why. A version with no review (an
 * import, a rerun that skipped the stage) says so instead of showing an
 * empty panel a reader might mistake for "reviewed, nothing found".
 */
export function NotebookReviewPanel({ review, locale = "en" }: { review: NotebookReview | null | undefined; locale?: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].notebooks;
  const view = notebookReviewView(review);

  return (
    <details className="mj-notebook-review">
      <summary>{copy.reviewLabel}{view ? ` — ${copy.reviewVerdict[view.verdict]}` : ""}</summary>
      {!view ? (
        <p className="mj-notebook-review-none">{copy.reviewNoReview}</p>
      ) : (
        <div className="mj-notebook-review-body">
          {view.findings.length > 0 ? (
            <div>
              <h3>{copy.reviewFindingsLabel}</h3>
              <ul className="mj-notebook-review-findings">
                {view.findings.map((finding, index) => (
                  <li key={index}>
                    <span className={`mj-notebook-review-pill mj-notebook-review-pill--${finding.severity}`}>
                      {copy.reviewSeverity[finding.severity]}
                    </span>
                    <span className="mj-notebook-review-category">{copy.reviewCategory[finding.category]}</span>
                    {finding.cellId ? <span className="mj-mono-muted">{finding.cellId}</span> : null}
                    <p>{finding.finding}</p>
                    {finding.suggestion ? <p className="mj-notebook-review-suggestion">{finding.suggestion}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {view.notEstablished.length > 0 ? (
            <div>
              <h3>{copy.reviewNotEstablishedLabel}</h3>
              <ul>
                {view.notEstablished.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </details>
  );
}
