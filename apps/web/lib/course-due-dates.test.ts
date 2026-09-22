// Pinned before any Date is made: every assertion below is about a zone, and the
// machine running the suite may be in any of them. Node re-reads TZ when it is set.
process.env.TZ = "Asia/Tokyo";

import assert from "node:assert/strict";
import test from "node:test";

import {
  dueDateChanged,
  dueDateFromInput,
  dueDateInputValue,
  dueDatePatchBody,
  formatDueDate,
  gradebookHasDueDates,
  moduleOverdue,
  ownGradebookRow,
  viewerCreatedCourse,
} from "./course-due-dates.ts";
import type { CourseGradebook, GradebookRow } from "./course-types.ts";

// 17:00 on Wednesday 30 September in Tokyo is 08:00 UTC.
const STORED = "2026-09-30T08:00:00Z";

test("the input shows a stored due date in the viewer's zone, to the minute", () => {
  assert.equal(dueDateInputValue(STORED), "2026-09-30T17:00");
  assert.equal(dueDateInputValue("2026-09-30T08:00:00+00:00"), "2026-09-30T17:00");
  assert.equal(dueDateInputValue(null), "");
  assert.equal(dueDateInputValue(undefined), "");
  assert.equal(dueDateInputValue("not a date"), "", "an unparseable value reads as unset, not as a wrong date");
});

test("what the input holds is sent as the same instant in UTC", () => {
  assert.equal(dueDateFromInput("2026-09-30T17:00"), "2026-09-30T08:00:00.000Z");
  assert.equal(dueDateFromInput(" 2026-09-30T17:00:30 "), "2026-09-30T08:00:30.000Z");
  // Across midnight and a month end, in a zone ahead of UTC.
  assert.equal(dueDateFromInput("2026-10-01T03:00"), "2026-09-30T18:00:00.000Z");
  // Round trip: nothing drifts by the zone offset.
  assert.equal(dueDateInputValue(dueDateFromInput("2026-09-30T17:00")), "2026-09-30T17:00");
});

test("an empty or partial input is not a due date", () => {
  for (const value of ["", "   ", "2026-09-30", "17:00", "2026-13-45T99:99", "tomorrow"]) {
    assert.equal(dueDateFromInput(value), null, JSON.stringify(value));
  }
});

test("the same zone read elsewhere: London sees 09:00 on the same day", () => {
  process.env.TZ = "Europe/London";
  try {
    assert.equal(dueDateInputValue(STORED), "2026-09-30T09:00");
    assert.match(formatDueDate(STORED, "en"), /9:00\s?AM/);
  } finally {
    process.env.TZ = "Asia/Tokyo";
  }
});

test("a due date is formatted by the locale's own formatter, with the zone named", () => {
  const en = formatDueDate(STORED, "en");
  assert.match(en, /Wed/);
  assert.match(en, /Sep 30/);
  assert.match(en, /5:00\s?PM/);
  assert.match(en, /GMT\+9/);
  const ja = formatDueDate(STORED, "ja");
  assert.match(ja, /9月30日/);
  assert.match(ja, /17:00/);
  assert.match(ja, /JST/);
  assert.equal(formatDueDate("nonsense", "en"), "nonsense");
});

test("clearing sends an explicit null, which the control plane reads as 'remove'", () => {
  const body = dueDatePatchBody("m1", null);
  assert.equal(JSON.stringify(body), '{"modules":[{"id":"m1","due_at":null}]}');
  assert.deepEqual(dueDatePatchBody("m1", "2026-09-30T08:00:00.000Z"), {
    modules: [{ id: "m1", due_at: "2026-09-30T08:00:00.000Z" }],
  });
});

test("a change is a different instant, not a different spelling of the same one", () => {
  assert.equal(dueDateChanged("2026-09-30T17:00", STORED), false);
  assert.equal(dueDateChanged("2026-09-30T17:01", STORED), true);
  assert.equal(dueDateChanged("2026-09-30T17:00", null), true);
  assert.equal(dueDateChanged("", STORED), false, "an empty input is cleared with Remove, not saved");
  assert.equal(dueDateChanged("", null), false);
});

function row(missing: string[]): GradebookRow {
  return {
    user_id: "u",
    email: "u@example.test",
    display_name: null,
    entries: [],
    total_passed: 0,
    total_graded_cells: 2,
    last_graded_at: null,
    missing_module_ids: missing,
  };
}

test("overdue comes from the viewer's own row, and only when the gradebook is theirs alone", () => {
  const modules: CourseGradebook["modules"] = [
    { id: "m1", seq: 1, slug: "a", title: "A", notebook_id: "nb", graded_cells: 2, due_at: STORED },
  ];
  const own: CourseGradebook = { course_id: "c", visibility: "own_row", modules, rows: [row(["m1"])] };
  const everyone: CourseGradebook = { ...own, visibility: "all_members" };

  assert.equal(moduleOverdue(ownGradebookRow(own), "m1"), true);
  assert.equal(moduleOverdue(ownGradebookRow(own), "m2"), false);
  // The creator's gradebook lists the whole class; there is no one learner to mark.
  assert.equal(ownGradebookRow(everyone), null);
  assert.equal(moduleOverdue(ownGradebookRow(everyone), "m1"), false);
  assert.equal(moduleOverdue(null, "m1"), false, "no gradebook yet: nothing is overdue");
});

test("the legend is shown only when some module has a due date", () => {
  const base = { id: "m1", seq: 1, slug: "a", title: "A", notebook_id: "nb", graded_cells: 2 };
  assert.equal(gradebookHasDueDates({ modules: [{ ...base, due_at: null }] }), false);
  assert.equal(gradebookHasDueDates({ modules: [{ ...base, due_at: STORED }] }), true);
  assert.equal(gradebookHasDueDates({ modules: [] }), false);
});

test("the due-date controls are offered to the course's creator and no one else", () => {
  const course = { owner_user_id: "u-teacher" };
  assert.equal(viewerCreatedCourse(course, "u-teacher"), true);
  assert.equal(viewerCreatedCourse(course, "u-ana"), false);
  // Before /api/me answers, and for a course that names no creator: not offered.
  assert.equal(viewerCreatedCourse(course, null), false);
  assert.equal(viewerCreatedCourse({ owner_user_id: null }, null), false, "null must not equal null here");
  assert.equal(viewerCreatedCourse({ owner_user_id: null }, "u-ana"), false);
  assert.equal(viewerCreatedCourse(null, "u-teacher"), false);
});
