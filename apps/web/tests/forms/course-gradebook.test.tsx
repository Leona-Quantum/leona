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
  assert.equal(screen.getAllByText(copy.gradebookNotStarted).length, 2);
  assert.ok(screen.getByText(copy.gradebookScore(3, 5)), "Bo's course total");

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

test("an empty gradebook says so in words that fit who is looking", () => {
  const creatorEmpty = view({ ...everyone, rows: [] });
  assert.ok(creatorEmpty.getByText(copy.gradebookEmpty));
  const download = creatorEmpty.getByRole("button", { name: copy.gradebookDownloadCsv }) as HTMLButtonElement;
  assert.equal(download.disabled, true, "nothing to download yet");
  creatorEmpty.unmount();

  const memberEmpty = view({ ...everyone, visibility: "own_row", rows: [] });
  assert.ok(memberEmpty.getByText(copy.yourProgressEmpty));
  assert.equal(memberEmpty.queryByText(copy.gradebookEmpty), null);
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
    ];
    for (const text of texts) assert.doesNotMatch(text, /[\u2013\u2014]/, `${locale}: ${text}`);
  }
});
