/**
 * Maps the version's stored `NotebookReview` (Nala's advisory pass — accuracy,
 * pedagogy, code, safety, structure, style findings, never a save-blocker) to
 * what the "Nala's review" panel renders.
 *
 * The contract carries no per-category NUMERIC score (no accuracy/pedagogy/
 * code/safety meters to draw) — a `ReviewFinding` carries a `category`
 * (`accuracy | pedagogy | code | structure | safety | style`) and a
 * `severity` (`blocker | should-fix | nit`), both enums. So this renders as
 * pills, not meters: the categorical branch of the brief, because the
 * numeric branch has nothing in the data to feed it.
 */
import type { components } from "@majorana/contracts-gen";

type NotebookReview = components["schemas"]["NotebookReview"];
type ReviewFinding = components["schemas"]["ReviewFinding"];
type ReviewSeverity = ReviewFinding["severity"];
type ReviewCategory = ReviewFinding["category"];

export interface NotebookReviewFindingView {
  cellId: string | null;
  severity: ReviewSeverity;
  category: ReviewCategory;
  finding: string;
  suggestion: string;
}

export interface NotebookReviewView {
  verdict: NotebookReview["verdict"];
  findings: NotebookReviewFindingView[];
  notEstablished: string[];
  severityCounts: Record<ReviewSeverity, number>;
}

/** `null` means "this version has no review" — an import, an unreviewed
 * rerun, or any other path that never called the REVIEW stage. The panel is
 * responsible for saying so; this function does not invent a placeholder. */
export function notebookReviewView(review: NotebookReview | null | undefined): NotebookReviewView | null {
  if (!review) return null;
  const findings: NotebookReviewFindingView[] = (review.findings ?? []).map((finding) => ({
    cellId: finding.cell_id ?? null,
    severity: finding.severity,
    category: finding.category,
    finding: finding.finding,
    suggestion: finding.suggestion ?? "",
  }));
  const severityCounts: Record<ReviewSeverity, number> = { blocker: 0, "should-fix": 0, nit: 0 };
  for (const finding of findings) severityCounts[finding.severity] += 1;
  return {
    verdict: review.verdict,
    findings,
    notEstablished: review.what_this_notebook_does_not_establish ?? [],
    severityCounts,
  };
}
