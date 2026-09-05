/**
 * Reader-facing view of a `GradeReport` — what the workspace shows above a
 * graded notebook.
 *
 * NOT `lib/notebook-mastery.ts`: that counts what RAN (checkpoints whose cell
 * exited without error, exercises that exist). This counts what was GRADED, and
 * the difference is the whole point of the grading lane — a cell can run
 * perfectly and still be the wrong answer.
 *
 * The one rule worth stating: `ungradable` cells are excluded from the
 * denominator, never counted as failures. A grader that crashed has told us
 * nothing about the reader, and folding it into either column reports something
 * the run did not establish.
 */
import type { components } from "@majorana/contracts-gen";

type GradeReport = components["schemas"]["GradeReport"];
type CellGrade = components["schemas"]["CellGrade"];

export interface GradeSummary {
  /** Cells a grade could be formed for — the denominator. Excludes `ungradable`. */
  gradable: number;
  passed: number;
  failed: number;
  /** Gradable cells the reader has not attempted yet. */
  unattempted: number;
  /** Cells whose grader could not run at all. Surfaced, never silently dropped. */
  ungradable: number;
  /** Of the gradable cells, how many were graded by the model rather than deterministically. */
  modelGraded: number;
}

const EMPTY: GradeSummary = {
  gradable: 0,
  passed: 0,
  failed: 0,
  unattempted: 0,
  ungradable: 0,
  modelGraded: 0,
};

export function gradeSummary(report: GradeReport | null | undefined): GradeSummary {
  const cells: readonly CellGrade[] = report?.cells ?? [];
  if (cells.length === 0) return EMPTY;

  let passed = 0;
  let failed = 0;
  let unattempted = 0;
  let ungradable = 0;
  let modelGraded = 0;

  for (const grade of cells) {
    switch (grade.status) {
      case "passed":
        passed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "unattempted":
        unattempted += 1;
        break;
      case "ungradable":
        ungradable += 1;
        break;
    }
    if (grade.status !== "ungradable" && grade.graded_by === "model") modelGraded += 1;
  }

  return { gradable: passed + failed + unattempted, passed, failed, unattempted, ungradable, modelGraded };
}

/**
 * Whether there is a grading story to show at all. A notebook with nothing
 * graded gets no strip rather than an honest-looking "0 of 0".
 */
export function hasGradesToShow(summary: GradeSummary): boolean {
  return summary.gradable > 0 || summary.ungradable > 0;
}

/**
 * Progress as a fraction of ATTEMPTED work, `null` when nothing is gradable.
 *
 * Returns `null` rather than 0 for an empty denominator: a bar at zero reads as
 * "you have got everything wrong", which is a different statement from "there is
 * nothing here to grade", and the caller has to be able to tell them apart.
 */
export function passRate(summary: GradeSummary): number | null {
  const attempted = summary.passed + summary.failed;
  if (attempted === 0) return null;
  return summary.passed / attempted;
}
