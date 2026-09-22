import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react";
import { CourseGradebookView } from "../../app/(app)/notebooks/courses/[courseId]/course-gradebook.tsx";
import type { CourseGradebook } from "../../lib/course-types.ts";
import { WORKSPACE_COPY } from "../../lib/workspace-locale.ts";

const copy = WORKSPACE_COPY.en.courses;

function noop() {}

const modules: CourseGradebook["modules"] = [
  { id: "m1", seq: 1, slug: "bell", title: "The Bell state", notebook_id: "nb-1", graded_cells: 2 },
  { id: "m2", seq: 2, slug: "teleport", title: "Teleportation", notebook_id: "nb-2", graded_cells: 3 },
];

const everyone: CourseGradebook = {
  course_id: "c1",
  visibility: "all_members",
  modules,
  rows: [
    {
      user_id: "u-ana",
      email: "ana@example.test",
      display_name: "Ana",
      entries: [
        {
          module_id: "m1",
          passed: 1,
          failed: 1,
          attempted: 2,
          graded_cells: 2,
          version_seq: 1,
          stale: true,
          run_id: "r1",
          graded_at: "2026-09-20T10:00:00Z",
        },
      ],
      total_passed: 1,
      total_graded_cells: 5,
      last_graded_at: "2026-09-20T10:00:00Z",
    },
    {
      user_id: "u-bo",
      email: "bo@example.test",
      display_name: null,
      entries: [
        {
          module_id: "m2",
          passed: 3,
          failed: 0,
          attempted: 3,
          graded_cells: 3,
          version_seq: 2,
          stale: false,
          run_id: "r2",
          graded_at: "2026-09-21T10:00:00Z",
        },
      ],
      total_passed: 3,
      total_graded_cells: 5,
      last_graded_at: "2026-09-21T10:00:00Z",
    },
    {
      // Has not started: the creator is sent every current member all the same.
      user_id: "u-cy",
      email: "cy@example.test",
      display_name: "Cy",
      entries: [],
      total_passed: 0,
      total_graded_cells: 5,
      last_graded_at: null,
    },
  ],
};

function view(book: CourseGradebook | null, locale: "en" | "ja" = "en") {
  return render(
    <CourseGradebookView
      book={book}
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

test("the course creator sees every member, each module, totals and a CSV download", () => {
  const screen = view(everyone);

  assert.ok(screen.getByRole("heading", { name: copy.gradebookTitle }));
  assert.ok(screen.getByText(copy.gradebookLede));
  assert.ok(screen.getByRole("columnheader", { name: /The Bell state/ }));
  assert.ok(screen.getByRole("columnheader", { name: /Teleportation/ }));

  // Named the way the members page names people: display name with the email
  // under it, or the email alone when there is no name.
  assert.ok(screen.getByText("Ana"));
  assert.ok(screen.getByText("ana@example.test"));
  assert.ok(screen.getByText("bo@example.test"));

  // Ana: 1 of 2 on module 1 (graded on an earlier version), not started on module 2.
  assert.ok(screen.getByText(copy.gradebookScore(1, 2)));
  assert.ok(screen.getByText(copy.gradebookOlderVersion));
  assert.ok(screen.getByText(copy.gradebookScore(3, 5)), "Bo's course total");

  // Cy has not started: listed, with "Not started" in both modules AND the total,
  // never a "0/5" that reads as a failing score.
  const cyRow = screen.getByRole("rowheader", { name: /Cy/ }).closest("tr");
  assert.ok(cyRow);
  const cyCells = [...cyRow.querySelectorAll("td")].map((cell) => cell.textContent);
  assert.deepEqual(cyCells, [
    copy.gradebookNotStarted,
    copy.gradebookNotStarted,
    copy.gradebookNotStarted,
    "",
  ]);
  assert.equal(screen.queryByText(copy.gradebookScore(0, 5)), null);
  // Ana's module 2, Bo's module 1, and Cy's three cells.
  assert.equal(screen.getAllByText(copy.gradebookNotStarted).length, 5);
  // Somebody has started, so the "nobody has started" sentence stays away.
  assert.equal(screen.queryByText(copy.gradebookEmpty), null);

  const download = screen.getByRole("button", { name: copy.gradebookDownloadCsv }) as HTMLButtonElement;
  assert.equal(download.disabled, false);
});

test("a member who did not make the course sees 'Your progress' with one row labelled You", () => {
  const own: CourseGradebook = { ...everyone, visibility: "own_row", rows: [everyone.rows![1]] };
  const screen = view(own);

  assert.ok(screen.getByRole("heading", { name: copy.yourProgressTitle }));
  assert.equal(screen.queryByRole("heading", { name: copy.gradebookTitle }), null);
  assert.ok(screen.getByRole("rowheader", { name: copy.gradebookYou }));
  // Their own email is not repeated back to them, and no one else is on the page.
  assert.equal(screen.queryByText("bo@example.test"), null);
  assert.equal(screen.queryByText("Ana"), null);
  // The export is the creator's tool; a member's own row is already on screen.
  assert.equal(screen.queryByRole("button", { name: copy.gradebookDownloadCsv }), null);
});

test("when nobody has started, the class is still listed and the page says so", () => {
  const cy = everyone.rows![2];
  const creator = view({ ...everyone, rows: [cy] });
  assert.ok(creator.getByText(copy.gradebookEmpty));
  assert.ok(creator.getByText("Cy"), "the member who has not started is still listed");
  const download = creator.getByRole("button", { name: copy.gradebookDownloadCsv }) as HTMLButtonElement;
  assert.equal(download.disabled, false, "the class list is worth exporting");
  creator.unmount();

  // A member who has not started sees their own row, labelled You, not an empty page.
  const member = view({ ...everyone, visibility: "own_row", rows: [cy] });
  assert.ok(member.getByText(copy.yourProgressEmpty));
  assert.ok(member.getByRole("rowheader", { name: copy.gradebookYou }));
  assert.equal(member.getAllByText(copy.gradebookNotStarted).length, 3);
  assert.equal(member.queryByText(copy.gradebookEmpty), null);
  member.unmount();

  // Defensive only (the API always sends a member their own row): no rows at all.
  const none = view({ ...everyone, rows: [] });
  const disabled = none.getByRole("button", { name: copy.gradebookDownloadCsv }) as HTMLButtonElement;
  assert.equal(disabled.disabled, true, "nothing to download");
});

test("the Japanese view renders the Japanese copy", () => {
  const ja = WORKSPACE_COPY.ja.courses;
  const screen = view(everyone, "ja");
  assert.ok(screen.getByRole("heading", { name: ja.gradebookTitle }));
  assert.ok(screen.getByText(ja.gradebookScore(1, 2)));
  assert.ok(screen.getByRole("button", { name: ja.gradebookDownloadCsv }));
});

test("reader-facing gradebook copy has no em dashes in either language", () => {
  for (const locale of ["en", "ja"] as const) {
    const strings = WORKSPACE_COPY[locale].courses;
    const texts = [
      strings.gradebookTitle,
      strings.gradebookLede,
      strings.gradebookEmpty,
      strings.yourProgressTitle,
      strings.yourProgressLede,
      strings.yourProgressEmpty,
      strings.gradebookLoading,
      strings.gradebookLoadFailed,
      strings.gradebookNotStarted,
      strings.gradebookScore(1, 2),
      strings.gradebookOlderVersion,
      strings.gradebookOlderVersionHint(3),
      strings.gradebookDownloadCsvFailed,
      strings.gradebookTotalUnknown,
      strings.gradebookTotalsGenerating,
      strings.gradebookTotalsNoNotebook,
    ];
    for (const text of texts) assert.doesNotMatch(text, /[\u2013\u2014]/, `${locale}: ${text}`);
  }
});

test("while a module is still generating, a started member's total says not known yet", () => {
  const generating: CourseGradebook = {
    ...everyone,
    modules: [
      modules![0],
      { id: "m2", seq: 2, slug: "teleport", title: "Teleportation", notebook_id: "nb-2", graded_cells: null },
    ],
    rows: [{ ...everyone.rows![0], total_graded_cells: null }, { ...everyone.rows![2], total_graded_cells: null }],
  };
  const screen = view(generating);

  assert.ok(screen.getByText(copy.gradebookTotalsGenerating));
  const anaRow = screen.getByRole("rowheader", { name: /Ana/ }).closest("tr");
  assert.ok(anaRow);
  const anaCells = [...anaRow.querySelectorAll("td")].map((cell) => cell.textContent);
  // Module 1 is known (1 of 2); the total is not a smaller "1/2" but "Not known yet".
  assert.equal(anaCells[2], copy.gradebookTotalUnknown);
  assert.doesNotMatch(anaCells[2] ?? "", /\d/);
  // Cy has not started, which still reads as not started rather than not known.
  const cyRow = screen.getByRole("rowheader", { name: /Cy/ }).closest("tr");
  assert.equal(cyRow?.querySelectorAll("td")[2]?.textContent, copy.gradebookNotStarted);
  screen.unmount();

  // The Japanese sentence and cell, from the same state.
  const ja = WORKSPACE_COPY.ja.courses;
  const jaScreen = view(generating, "ja");
  assert.ok(jaScreen.getByText(ja.gradebookTotalsGenerating));
  assert.ok(jaScreen.getByText(ja.gradebookTotalUnknown));
});
