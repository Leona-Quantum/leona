import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { CourseGradebookView } from "../../app/(app)/notebooks/courses/[courseId]/course-gradebook.tsx";
import { CourseModuleCard, CourseWorkspace } from "../../app/(app)/notebooks/courses/[courseId]/course-workspace.tsx";
import { formatDueDate } from "../../lib/course-due-dates.ts";
import type { Course, CourseGradebook, CourseModule } from "../../lib/course-types.ts";
import { WORKSPACE_COPY } from "../../lib/workspace-locale.ts";
import { stubFetch } from "./dom-env.ts";

// Every assertion about a date is about a zone; pin one. Tokyo, where 17:00 on the
// 30th is 08:00 UTC.
process.env.TZ = "Asia/Tokyo";

const copy = WORKSPACE_COPY.en.courses;
const DUE = "2026-09-30T08:00:00Z";

function noop() {}

const generated: CourseModule = {
  id: "m-bell",
  seq: 1,
  slug: "bell-state",
  title: "The Bell state",
  topic: "Entanglement",
  key_concepts: [],
  objectives: [],
  deliverable: "",
  kind: "lesson",
  duration_minutes: 25,
  prerequisites: [],
  brief: "",
  notebook_id: "nb-1",
  status: "ready",
  notebook_version_seq: 1,
  due_at: DUE,
};

function card(module: CourseModule, props: Partial<Parameters<typeof CourseModuleCard>[0]> = {}) {
  return render(
    <CourseModuleCard
      module={module}
      modules={[module]}
      locale="en"
      runId={null}
      generating={false}
      reordering={false}
      canMoveUp={false}
      canMoveDown={false}
      onGenerate={noop}
      onMoveUp={noop}
      onMoveDown={noop}
      onRunTerminal={noop}
      {...props}
    />,
  );
}

// ------------------------------------------------------------------ the creator's card

test("the creator sets a due date in their own time zone and it is sent in UTC", () => {
  const saved: Array<string | null> = [];
  const screen = card({ ...generated, due_at: null }, { canSetDueDate: true, onSaveDueDate: (v) => saved.push(v) });

  const input = screen.getByLabelText(copy.dueDateLabel) as HTMLInputElement;
  assert.equal(input.type, "datetime-local");
  assert.equal(input.value, "", "no due date yet");
  assert.ok(screen.getByText(copy.dueDateHint));
  const save = screen.getByRole("button", { name: copy.saveDueDate }) as HTMLButtonElement;
  assert.equal(save.disabled, true, "nothing to save until a date is entered");
  // No due date to remove yet.
  assert.equal(screen.queryByRole("button", { name: copy.clearDueDate }), null);

  fireEvent.change(input, { target: { value: "2026-09-30T17:00" } });
  assert.equal(save.disabled, false);
  fireEvent.click(save);

  assert.deepEqual(saved, ["2026-09-30T08:00:00.000Z"]);
});

test("the creator sees the stored due date in the input, and can remove it", () => {
  const saved: Array<string | null> = [];
  const screen = card(generated, { canSetDueDate: true, onSaveDueDate: (v) => saved.push(v) });

  const input = screen.getByLabelText(copy.dueDateLabel) as HTMLInputElement;
  assert.equal(input.value, "2026-09-30T17:00", "08:00 UTC, shown as 17:00 in Tokyo");
  // The stored date typed back in is not a change.
  const save = screen.getByRole("button", { name: copy.saveDueDate }) as HTMLButtonElement;
  assert.equal(save.disabled, true);

  fireEvent.click(screen.getByRole("button", { name: copy.clearDueDate }));
  assert.deepEqual(saved, [null], "remove sends an explicit null");
});

test("while a save is in flight the controls are disabled and say so", () => {
  const screen = card(generated, { canSetDueDate: true, savingDueDate: true, onSaveDueDate: noop });
  assert.ok(screen.getByRole("button", { name: copy.savingDueDate }));
  assert.equal((screen.getByLabelText(copy.dueDateLabel) as HTMLInputElement).disabled, true);
  assert.equal((screen.getByRole("button", { name: copy.clearDueDate }) as HTMLButtonElement).disabled, true);
});

// -------------------------------------------------------------------- a member's card

test("a member sees the due date, and Overdue once it has passed with no attempt", () => {
  const label = copy.dueLabel(formatDueDate(DUE, "en"));
  const overdue = card(generated, { overdue: true });
  assert.ok(overdue.getByText(label));
  assert.match(label, /Wed, Sep 30, 5:00\s?PM GMT\+9/);
  assert.ok(overdue.getByText(copy.dueOverdue));
  const time = overdue.container.querySelector("time");
  assert.equal(time?.getAttribute("datetime"), DUE, "machine-readable, in UTC");
  // A member is never offered the creator's control.
  assert.equal(overdue.queryByLabelText(copy.dueDateLabel), null);
  assert.equal(overdue.queryByRole("button", { name: copy.saveDueDate }), null);
  overdue.unmount();

  const onTime = card(generated, { overdue: false });
  assert.ok(onTime.getByText(label));
  assert.equal(onTime.queryByText(copy.dueOverdue), null);
  onTime.unmount();

  // No due date: no line at all, not "Due" with a blank.
  const none = card({ ...generated, due_at: null });
  assert.equal(none.container.querySelector(".mj-course-module-due"), null);
});

test("canSetDueDate without a save handler renders no control rather than a dead one", () => {
  const screen = card(generated, { canSetDueDate: true });
  assert.equal(screen.queryByLabelText(copy.dueDateLabel), null);
});

// ------------------------------------------------------------------------- gradebook

const book: CourseGradebook = {
  course_id: "c1",
  visibility: "all_members",
  modules: [
    { id: "m1", seq: 1, slug: "bell", title: "The Bell state", notebook_id: "nb-1", graded_cells: 2, due_at: DUE },
    { id: "m2", seq: 2, slug: "teleport", title: "Teleportation", notebook_id: "nb-2", graded_cells: 3, due_at: null },
  ],
  rows: [
    {
      user_id: "u-ana",
      email: "ana@example.test",
      display_name: "Ana",
      entries: [
        {
          module_id: "m1",
          passed: 2,
          failed: 0,
          attempted: 2,
          graded_cells: 2,
          version_seq: 1,
          stale: false,
          run_id: "r1",
          graded_at: "2026-09-30T09:00:00Z",
          late: true,
        },
      ],
      total_passed: 2,
      total_graded_cells: 5,
      last_graded_at: "2026-09-30T09:00:00Z",
      missing_module_ids: [],
    },
    {
      user_id: "u-cy",
      email: "cy@example.test",
      display_name: "Cy",
      entries: [],
      total_passed: 0,
      total_graded_cells: 5,
      last_graded_at: null,
      missing_module_ids: ["m1"],
    },
  ],
};

function gradebook(value: CourseGradebook, locale: "en" | "ja" = "en") {
  return render(
    <CourseGradebookView
      book={value}
      locale={locale}
      loading={false}
      error={null}
      downloading={false}
      downloadError={null}
      onRetry={noop}
      onDownload={noop}
    />,
  );
}

test("the gradebook marks a late attempt and a missing module, and explains both", () => {
  const screen = gradebook(book);

  // The due date sits under its module's title in the column header.
  const header = screen.getByRole("columnheader", { name: /The Bell state/ });
  assert.match(header.textContent ?? "", /Due Wed, Sep 30/);
  assert.doesNotMatch(screen.getByRole("columnheader", { name: /Teleportation/ }).textContent ?? "", /Due/);

  const anaCells = [...(screen.getByRole("rowheader", { name: /Ana/ }).closest("tr")?.querySelectorAll("td") ?? [])];
  assert.match(anaCells[0]?.textContent ?? "", new RegExp(copy.gradebookLate));
  assert.equal(anaCells[0]?.querySelector(".mj-course-gradebook-flag--late")?.getAttribute("title"),
    copy.gradebookLateHint(formatDueDate(DUE, "en")));
  // Ana has not started module 2, which has no due date: plain "Not started".
  assert.equal(anaCells[1]?.textContent, copy.gradebookNotStarted);

  // Cy is missing module 1 (past due, not started) and simply not started on module 2.
  const cyCells = [...(screen.getByRole("rowheader", { name: /Cy/ }).closest("tr")?.querySelectorAll("td") ?? [])];
  assert.equal(cyCells[0]?.textContent, copy.gradebookMissing, "Missing replaces Not started");
  assert.equal(cyCells[1]?.textContent, copy.gradebookNotStarted);

  assert.ok(screen.getByText(copy.gradebookLegend));
  assert.equal(screen.getAllByText(copy.gradebookLate).length, 1);
  assert.equal(screen.getAllByText(copy.gradebookMissing).length, 1);
});

test("with no due dates there is no legend and nothing is marked", () => {
  const plain: CourseGradebook = {
    ...book,
    modules: book.modules!.map((module) => ({ ...module, due_at: null })),
    rows: book.rows!.map((row) => ({
      ...row,
      missing_module_ids: [],
      entries: (row.entries ?? []).map((entry) => ({ ...entry, late: false })),
    })),
  };
  const screen = gradebook(plain);
  assert.equal(screen.queryByText(copy.gradebookLegend), null);
  assert.equal(screen.queryByText(copy.gradebookLate), null);
  assert.equal(screen.queryByText(copy.gradebookMissing), null);
});

test("the Japanese gradebook uses the Japanese markers, legend and date", () => {
  const ja = WORKSPACE_COPY.ja.courses;
  const screen = gradebook(book, "ja");
  assert.ok(screen.getByText(ja.gradebookLate));
  assert.ok(screen.getByText(ja.gradebookMissing));
  assert.ok(screen.getByText(ja.gradebookLegend));
  assert.match(screen.getByRole("columnheader", { name: /The Bell state/ }).textContent ?? "", /提出期限 9月30日/);
});

test("reader-facing due-date copy has no em dashes in either language", () => {
  for (const locale of ["en", "ja"] as const) {
    const strings = WORKSPACE_COPY[locale].courses;
    const texts = [
      strings.dueLabel("x"),
      strings.dueOverdue,
      strings.dueDateLabel,
      strings.dueDateHint,
      strings.saveDueDate,
      strings.savingDueDate,
      strings.clearDueDate,
      strings.dueDateSaveFailed,
      strings.gradebookLate,
      strings.gradebookLateHint("x"),
      strings.gradebookMissing,
      strings.gradebookMissingHint("x"),
      strings.gradebookLegend,
    ];
    for (const text of texts) assert.doesNotMatch(text, /[–—]/, `${locale}: ${text}`);
  }
});

// ----------------------------------------------------- a save that outlives its course

function courseFixture(id: string, title: string): Course {
  return {
    id,
    slug: id,
    title,
    summary: "",
    brief: "",
    kind: "course",
    audience: { level: "engineer" } as Course["audience"],
    style: {} as Course["style"],
    framework: { name: "qiskit", version: ">=2.5,<2.6", execution: "local-statevector" } as Course["framework"],
    language: "en",
    status: "ready",
    plan_run_id: null,
    owner_user_id: "u-teacher",
    modules: [{ ...generated, id: `${id}-m1`, slug: `${id}-week-01`, due_at: null }],
    module_count: 1,
    ready_count: 1,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };
}

test("a due-date save that returns after the reader moved to another course is dropped", async () => {
  // Review on PR 969. The stub never honours the abort, which is the worst case: the
  // old course's response DOES arrive, and only the component can refuse it.
  const first = courseFixture("c1", "First course");
  const second = courseFixture("c2", "Second course");
  let releasePatch: (() => void) | null = null;
  const stub = stubFetch((request) => {
    if (request.url.endsWith("/api/me")) return { status: 200, body: { user_id: "u-teacher" } };
    if (request.url.endsWith("/turns")) return { status: 200, body: { items: [] } };
    if (request.url.endsWith("/gradebook")) {
      return { status: 200, body: { course_id: "x", visibility: "all_members", modules: [], rows: [] } };
    }
    if (request.method === "PATCH") {
      return new Promise((resolve) => {
        releasePatch = () => resolve({ status: 200, body: { ...first, title: "First course, saved" } });
      });
    }
    if (request.url.endsWith("/api/courses/c1")) return { status: 200, body: first };
    if (request.url.endsWith("/api/courses/c2")) return { status: 200, body: second };
    return { status: 404, body: { title: "not stubbed" } };
  });
  try {
    const view = render(<CourseWorkspace courseId="c1" locale="en" />);
    const input = (await waitFor(() => view.getByLabelText(copy.dueDateLabel))) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-09-30T17:00" } });
    fireEvent.click(view.getByRole("button", { name: copy.saveDueDate }));
    await waitFor(() => assert.ok(releasePatch, "the PATCH is in flight"));

    view.rerender(<CourseWorkspace courseId="c2" locale="en" />);
    await waitFor(() => assert.ok(view.getByRole("button", { name: "Second course" })));

    await act(async () => {
      releasePatch?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Still the second course, not the first one's saved body and not "Loading".
    assert.ok(view.getByRole("button", { name: "Second course" }));
    assert.equal(view.queryByText(copy.loading), null);
    assert.equal(view.queryByText("First course, saved"), null);
    // And the second course's editor is not left saying "Saving…".
    assert.ok(view.getByRole("button", { name: copy.saveDueDate }));
    assert.equal(view.queryByRole("button", { name: copy.savingDueDate }), null);
  } finally {
    stub.restore();
  }
});
