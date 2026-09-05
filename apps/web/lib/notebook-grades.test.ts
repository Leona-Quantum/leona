import assert from "node:assert/strict";
import { test } from "node:test";

import { gradeSummary, hasGradesToShow, passRate } from "./notebook-grades.ts";

import type { components } from "@majorana/contracts-gen";

type CellGrade = components["schemas"]["CellGrade"];
type GradeReport = components["schemas"]["GradeReport"];

const grade = (
  id: string,
  status: CellGrade["status"],
  graded_by: CellGrade["graded_by"] = "deterministic",
): CellGrade => ({ id, status, graded_by, message: "", hint: "", detail: "" });

const report = (...cells: CellGrade[]): GradeReport => ({ notebook_slug: "s", cells });

test("counts each status into its own column", () => {
  const s = gradeSummary(
    report(
      grade("a", "passed"),
      grade("b", "passed"),
      grade("c", "failed"),
      grade("d", "unattempted"),
    ),
  );
  assert.equal(s.passed, 2);
  assert.equal(s.failed, 1);
  assert.equal(s.unattempted, 1);
  assert.equal(s.gradable, 4);
});

test("an ungradable cell is excluded from the denominator, not counted as a failure", () => {
  const s = gradeSummary(report(grade("a", "passed"), grade("b", "ungradable")));
  assert.equal(s.gradable, 1, "the crashed grader must not enlarge the denominator");
  assert.equal(s.failed, 0, "and it must not be read as the reader getting it wrong");
  assert.equal(s.ungradable, 1, "but it must still be visible");
});

test("model-graded cells are counted so their provenance can be shown", () => {
  const s = gradeSummary(report(grade("a", "passed", "model"), grade("b", "passed")));
  assert.equal(s.modelGraded, 1);
});

test("an ungradable cell is not counted as model-graded even though only a model could grade it", () => {
  const s = gradeSummary(report(grade("a", "ungradable", "model")));
  assert.equal(s.modelGraded, 0);
});

test("pass rate is over ATTEMPTED work, so it does not fall as a notebook grows", () => {
  const s = gradeSummary(report(grade("a", "passed"), grade("b", "failed"), grade("c", "unattempted")));
  assert.equal(passRate(s), 0.5);
});

test("pass rate is null rather than zero when nothing has been attempted", () => {
  assert.equal(passRate(gradeSummary(report(grade("a", "unattempted")))), null);
  assert.equal(passRate(gradeSummary(report())), null);
});

test("a notebook with nothing graded shows no strip", () => {
  assert.equal(hasGradesToShow(gradeSummary(report())), false);
  assert.equal(hasGradesToShow(gradeSummary(report(grade("a", "ungradable")))), true);
});

test("an empty or missing report is the empty summary, not a crash", () => {
  assert.equal(gradeSummary(null).gradable, 0);
  assert.equal(gradeSummary(undefined).gradable, 0);
});
