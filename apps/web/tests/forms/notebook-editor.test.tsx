import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotebookWorkspace } from "../../app/(app)/notebooks/[notebookId]/notebook-workspace.tsx";
import { stubFetch, type RecordedRequest } from "./dom-env.ts";

const NOTEBOOK_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Assert an element is gone WITHOUT handing the element itself to `assert`.
 *
 * `assert.equal(screen.queryByLabelText(...), null)` reads better and is a trap: on
 * failure Node builds the message by inspecting both values, and inspecting a jsdom
 * element walks its whole object graph. Inside `waitFor`, which retries the callback
 * ~50 times before giving up, that turned a one-line assertion failure into a process
 * killed by the OS at 27 seconds with no output at all — a failing test that looks
 * exactly like a hung one. Compare booleans; the label is the message.
 */
function assertAbsent(element: unknown, what: string) {
  assert.equal(element === null, true, `expected ${what} to be gone`);
}

const SPEC = {
  schema_version: 1 as const,
  slug: "bell-state-intro",
  title: "Bell state intro",
  kind: "lesson" as const,
  summary: "",
  audience: { level: "engineer" as const, assumes: [], not_assumed: [] },
  style: {
    analogies: true,
    analogy_domains: [],
    tone: "plain" as const,
    math_level: "minimal" as const,
    visualizations: true,
    code_comments: "light" as const,
    language: "en" as const,
  },
  framework: { name: "qiskit" as const, version: ">=2.5,<2.6", execution: "local-statevector" as const },
  objectives: [],
  prerequisites: [],
  duration_minutes: null,
  references: [],
  seeds: [],
  brief: "",
  extra: {},
  cells: [
    { id: "c01", kind: "markdown" as const, role: "objective" as const, source: "# Bell state", tags: [], execute: true, stub: null, timeout_s: null },
    { id: "c02", kind: "code" as const, role: "run" as const, source: "print('first')", tags: [], execute: true, stub: null, timeout_s: null },
    { id: "c03", kind: "code" as const, role: "run" as const, source: "print('second')", tags: [], execute: true, stub: null, timeout_s: null },
  ],
};

const NOTEBOOK = {
  id: NOTEBOOK_ID,
  workspace_id: "22222222-2222-4222-8222-222222222222",
  owner_user_id: "33333333-3333-4333-8333-333333333333",
  slug: "bell-state-intro",
  title: "Bell state intro",
  kind: "lesson",
  summary: "",
  visibility: "private",
  language: "en",
  framework: SPEC.framework,
  current_version_id: "44444444-4444-4444-8444-444444444444",
  current_version_seq: 1,
  latest_status: "ready",
  latest_run_id: null,
  version_count: 1,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  deleted_at: null,
};

const VERSION = {
  id: "44444444-4444-4444-8444-444444444444",
  notebook_id: NOTEBOOK_ID,
  seq: 1,
  status: "ready",
  created_by: "nala",
  message: "",
  ok: true,
  cell_count: 3,
  run_id: null,
  created_at: "2026-09-01T00:00:00Z",
  spec: SPEC,
  source: "",
  ipynb: { nbformat: 4 },
  report: null,
  review: null,
  warnings: [],
  error: "",
};

/** Answers the four GETs the workspace fires on mount, and records everything so a
 * test can assert on the exact POST body the editor sent. */
function stubWorkspace(
  overrides: {
    version?: Record<string, unknown>;
    onPost?: (request: RecordedRequest) => { status: number; body?: unknown };
  } = {},
) {
  return stubFetch((request) => {
    if (request.method === "POST") {
      return (
        overrides.onPost?.(request) ?? {
          status: 201,
          body: { version: { ...VERSION, seq: 2, created_by: "user" }, run_id: null },
        }
      );
    }
    if (request.url.endsWith("/versions")) {
      return { status: 200, body: { items: [{ ...VERSION, spec: undefined }] } };
    }
    if (request.url.endsWith("/turns")) return { status: 200, body: { items: [] } };
    if (/\/versions\/\d+$/.test(request.url)) {
      return { status: 200, body: { ...VERSION, ...(overrides.version ?? {}) } };
    }
    return { status: 200, body: NOTEBOOK };
  });
}

async function openEditor() {
  render(<NotebookWorkspace notebookId={NOTEBOOK_ID} locale="en" />);
  const edit = await screen.findByRole("button", { name: "Edit" });
  fireEvent.click(edit);
  await screen.findByLabelText("Source of cell c01");
}

test("edit mode renders one textarea per cell, carrying each cell's source", async () => {
  const fetchStub = stubWorkspace();
  try {
    await openEditor();

    const first = screen.getByLabelText("Source of cell c01") as HTMLTextAreaElement;
    const second = screen.getByLabelText("Source of cell c02") as HTMLTextAreaElement;
    const third = screen.getByLabelText("Source of cell c03") as HTMLTextAreaElement;
    assert.equal(first.value, "# Bell state");
    assert.equal(second.value, "print('first')");
    assert.equal(third.value, "print('second')");
    // The reader's own text, in a real textarea — not a contenteditable div.
    assert.equal(first.tagName, "TEXTAREA");
  } finally {
    fetchStub.restore();
  }
});

test("Save & run posts the EDITED spec, with the notebook's other fields intact", async () => {
  const fetchStub = stubWorkspace();
  try {
    await openEditor();

    const second = screen.getByLabelText("Source of cell c02");
    fireEvent.change(second, { target: { value: "print('edited by the reader')" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & run" }));

    await waitFor(() => {
      assert.ok(fetchStub.calls.some((call) => call.method === "POST"));
    });
    const post = fetchStub.calls.find((call) => call.method === "POST");
    assert.ok(post);
    assert.equal(post.url, `/api/notebooks/${NOTEBOOK_ID}/versions`);
    const body = post.body as { spec: typeof SPEC; execute: boolean; run_until: string | null };
    assert.equal(body.execute, true);
    assert.equal(body.run_until, null);
    // The edit is in the payload...
    assert.equal(body.spec.cells[1].source, "print('edited by the reader')");
    // ...the untouched cells are unchanged...
    assert.equal(body.spec.cells[0].source, "# Bell state");
    assert.equal(body.spec.cells[2].source, "print('second')");
    // ...and the rest of the spec rode along rather than being rebuilt from nothing.
    assert.equal(body.spec.slug, "bell-state-intro");
    assert.equal(body.spec.kind, "lesson");
    assert.equal(body.spec.framework.name, "qiskit");
  } finally {
    fetchStub.restore();
  }
});

test("adding, moving and deleting a cell all reach the posted spec", async () => {
  const fetchStub = stubWorkspace();
  try {
    await openEditor();

    // Add a code cell below c01 — it should take the lowest free id, c04.
    fireEvent.click(screen.getAllByRole("button", { name: "Add code below" })[0]);
    await screen.findByLabelText("Source of cell c04");
    fireEvent.change(screen.getByLabelText("Source of cell c04"), {
      target: { value: "x = 1" },
    });
    // Delete c03, and move c02 up.
    fireEvent.click(screen.getAllByRole("button", { name: "Delete cell" })[3]);
    fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save & run" }));

    await waitFor(() => {
      assert.ok(fetchStub.calls.some((call) => call.method === "POST"));
    });
    const body = (fetchStub.calls.find((c) => c.method === "POST") as RecordedRequest).body as {
      spec: { cells: { id: string; source: string }[] };
    };
    assert.deepEqual(
      body.spec.cells.map((cell) => cell.id),
      ["c04", "c01", "c02"],
    );
    assert.equal(body.spec.cells[0].source, "x = 1");
  } finally {
    fetchStub.restore();
  }
});

test("Run to here appears on the focused cell and posts that cell's id as run_until", async () => {
  const fetchStub = stubWorkspace();
  try {
    await openEditor();

    assertAbsent(screen.queryByRole("button", { name: "Run to here" }), "Run to here");
    fireEvent.focus(screen.getByLabelText("Source of cell c02"));
    fireEvent.click(await screen.findByRole("button", { name: "Run to here" }));

    await waitFor(() => {
      assert.ok(fetchStub.calls.some((call) => call.method === "POST"));
    });
    const body = (fetchStub.calls.find((c) => c.method === "POST") as RecordedRequest).body as {
      run_until: string;
      execute: boolean;
    };
    assert.equal(body.run_until, "c02");
    assert.equal(body.execute, true);
  } finally {
    fetchStub.restore();
  }
});

test("Save without running posts execute:false", async () => {
  const fetchStub = stubWorkspace();
  try {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Save without running" }));

    await waitFor(() => {
      assert.ok(fetchStub.calls.some((call) => call.method === "POST"));
    });
    const body = (fetchStub.calls.find((c) => c.method === "POST") as RecordedRequest).body as {
      execute: boolean;
    };
    assert.equal(body.execute, false);
  } finally {
    fetchStub.restore();
  }
});

test("a successful save leaves edit mode", async () => {
  const fetchStub = stubWorkspace();
  try {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Save & run" }));
    await waitFor(() => {
      assertAbsent(screen.queryByLabelText("Source of cell c01"), "the editor");
    });
  } finally {
    fetchStub.restore();
  }
});

test("a refused save shows the API's own sentence and keeps the reader's work", async () => {
  const fetchStub = stubWorkspace({
    onPost: () => ({
      status: 400,
      body: {
        type: "about:blank",
        title: "run_until: this notebook has no cell 'c99'",
        status: 400,
        code: "http_error",
        reason: "notebook_unknown_cell",
      },
    }),
  });
  try {
    await openEditor();
    fireEvent.change(screen.getByLabelText("Source of cell c02"), {
      target: { value: "keep me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & run" }));

    await screen.findByText(/no cell 'c99'/);
    // Still editing, and the edit survives — losing a reader's work on a refusal
    // would be worse than the refusal.
    assert.equal(
      (screen.getByLabelText("Source of cell c02") as HTMLTextAreaElement).value,
      "keep me",
    );
  } finally {
    fetchStub.restore();
  }
});

test("structure warnings render as advisory notes, not as a blocker", async () => {
  const fetchStub = stubWorkspace({
    version: { warnings: ["There is at least one markdown cell of role=concept."] },
  });
  try {
    render(<NotebookWorkspace notebookId={NOTEBOOK_ID} locale="en" />);
    await screen.findByText("Nala's structure notes");
    await screen.findByText(/role=concept/);
    // The notebook itself is still on screen beside them — a warning is not a refusal.
    assert.ok(screen.getByRole("button", { name: "Edit" }));
  } finally {
    fetchStub.restore();
  }
});
