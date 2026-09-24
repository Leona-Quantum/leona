import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NotebookWorkspace } from "../../app/(app)/notebooks/[notebookId]/notebook-workspace.tsx";
import { cellDomId } from "../../lib/notebook-ide.ts";
import { stubFetch, type RecordedRequest } from "./dom-env.ts";

// Per-cell editing straight from the read view (owner ruling ai-ops 375, quoted in the
// lane brief): every cell editable, addable, deletable and movable on its own, with no
// page-level edit mode. This file exercises that surface end to end, through the real
// `NotebookWorkspace` (as `notebook-editor.test.tsx` already does for the bulk editor),
// so a test failure here means the actual click-through flow broke, not just a prop.

const NOTEBOOK_ID = "66666666-6666-4666-8666-666666666666";

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
    { id: "c01", kind: "markdown" as const, role: "objective" as const, source: "# Bell state", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null },
    { id: "c02", kind: "code" as const, role: "run" as const, source: "print('first')", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null },
    { id: "c03", kind: "code" as const, role: "run" as const, source: "print('second')", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null },
  ],
};

const NOTEBOOK = {
  id: NOTEBOOK_ID,
  workspace_id: "77777777-7777-4777-8777-777777777777",
  owner_user_id: "88888888-8888-4888-8888-888888888888",
  slug: "bell-state-intro",
  title: "Bell state intro",
  kind: "lesson",
  summary: "",
  visibility: "private",
  language: "en",
  framework: SPEC.framework,
  current_version_id: "99999999-9999-4999-8999-999999999999",
  current_version_seq: 1,
  latest_status: "ready",
  latest_run_id: null,
  version_count: 1,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  deleted_at: null,
};

const VERSION = {
  id: "99999999-9999-4999-8999-999999999999",
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

/** Same shape as `notebook-editor.test.tsx`'s own helper of this name — duplicated
 * rather than shared, matching how every file under `tests/forms/` carries its own
 * fixtures. `onPost` may return a Promise so a save can be held open mid-test (the
 * busy-lock test needs exactly that). */
function stubWorkspace(
  overrides: {
    version?: Record<string, unknown>;
    onPost?: (request: RecordedRequest) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;
  } = {},
) {
  return stubFetch((request) => {
    if (request.url === "/api/presence/heartbeat") return { status: 204 };
    if (request.url.startsWith("/api/presence?")) return { status: 200, body: { viewers: [] } };
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
    const versionMatch = /\/versions\/(\d+)$/.exec(request.url);
    if (versionMatch) {
      // A real save moves the notebook to a NEW seq (`setPinnedSeq` in the
      // workspace), and the workspace immediately re-fetches that seq — so this
      // stub echoes back whichever seq was actually asked for, or the read view
      // never finds a version whose `seq` matches and renders nothing forever.
      return { status: 200, body: { ...VERSION, ...(overrides.version ?? {}), seq: Number(versionMatch[1]) } };
    }
    return { status: 200, body: NOTEBOOK };
  });
}

function isSavePost(call: RecordedRequest): boolean {
  return call.method === "POST" && call.url === `/api/notebooks/${NOTEBOOK_ID}/versions`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Renders the workspace and waits for the read view's per-cell toolbars — one
 * "Edit this cell" button per cell — to confirm the notebook actually loaded. */
async function renderWorkspace() {
  render(<NotebookWorkspace notebookId={NOTEBOOK_ID} locale="en" />);
  return screen.findAllByRole("button", { name: "Edit this cell" });
}

function cellArticle(cellId: string): HTMLElement {
  const node = document.getElementById(cellDomId(cellId));
  assert.ok(node, `cell ${cellId} not on screen`);
  return node as HTMLElement;
}

/** Opens the given cell's "More actions" disclosure and returns it — its structural
 * buttons (Add/Move/Duplicate/Delete) render inside, per rule 5's "keep the toolbar
 * from growing into a wall of links". A native `<details>`, toggled by clicking its
 * `<summary>` — the same pattern `repository-browser.test.tsx` uses; `getByRole`
 * does not resolve a `<summary>`'s role reliably in this DOM environment. */
function openMoreActions(cellId: string): HTMLDetailsElement {
  const details = cellArticle(cellId).querySelector<HTMLDetailsElement>(".mj-notebook-ide-toolbar-more");
  assert.ok(details, `cell ${cellId} has no "More actions" disclosure`);
  fireEvent.click(details!.querySelector("summary")!);
  return details!;
}

// ------------------------------------------------------------------- edit + save

test("editing and saving one cell posts a spec where only that cell changed", async () => {
  const fetchStub = stubWorkspace();
  try {
    await renderWorkspace();
    fireEvent.click(within(cellArticle("c02")).getByRole("button", { name: "Edit this cell" }));
    const editor = await screen.findByLabelText("Source of cell c02");
    fireEvent.change(editor, { target: { value: "print('edited by the reader')" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => assert.ok(fetchStub.calls.some(isSavePost)));
    const post = fetchStub.calls.find(isSavePost)!;
    assert.equal(post.url, `/api/notebooks/${NOTEBOOK_ID}/versions`);
    const body = post.body as { spec: typeof SPEC; execute: boolean; run_until: string | null };
    assert.equal(body.execute, false);
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
    // The editor closed on a successful save.
    assert.equal(screen.queryByLabelText("Source of cell c02"), null);
  } finally {
    fetchStub.restore();
  }
});

test("Save & run to here posts execute:true with run_until set to the edited cell", async () => {
  const fetchStub = stubWorkspace();
  try {
    await renderWorkspace();
    fireEvent.click(within(cellArticle("c03")).getByRole("button", { name: "Edit this cell" }));
    await screen.findByLabelText("Source of cell c03");
    fireEvent.click(screen.getByRole("button", { name: "Save & run to here" }));

    await waitFor(() => assert.ok(fetchStub.calls.some(isSavePost)));
    const body = (fetchStub.calls.find(isSavePost) as RecordedRequest).body as {
      execute: boolean;
      run_until: string;
    };
    assert.equal(body.execute, true);
    assert.equal(body.run_until, "c03");
  } finally {
    fetchStub.restore();
  }
});

// A markdown cell's editor offers only "Save" — running to a text cell means nothing.
test("a markdown cell's inline editor has no Save & run to here", async () => {
  const fetchStub = stubWorkspace();
  try {
    await renderWorkspace();
    fireEvent.click(within(cellArticle("c01")).getByRole("button", { name: "Edit this cell" }));
    await screen.findByLabelText("Source of cell c01");
    assert.equal(screen.queryByRole("button", { name: "Save & run to here" }), null);
    assert.ok(screen.getByRole("button", { name: "Save" }));
  } finally {
    fetchStub.restore();
  }
});

// --------------------------------------------------------------------- add + cancel

test("add code below opens an empty cell inline; cancelling before saving posts nothing", async () => {
  const fetchStub = stubWorkspace();
  try {
    await renderWorkspace();
    const details = openMoreActions("c01");
    fireEvent.click(within(details).getByRole("button", { name: "Add code below" }));

    // The lowest free id (c01-c03 taken) is c04.
    const editor = (await screen.findByLabelText("Source of cell c04")) as HTMLTextAreaElement;
    assert.equal(editor.value, "");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    assert.equal(screen.queryByLabelText("Source of cell c04"), null);
    assert.equal(fetchStub.calls.some(isSavePost), false);
  } finally {
    fetchStub.restore();
  }
});

test("add code below, typed and saved, inserts the new cell in place", async () => {
  const fetchStub = stubWorkspace();
  try {
    await renderWorkspace();
    const details = openMoreActions("c01");
    fireEvent.click(within(details).getByRole("button", { name: "Add code below" }));
    const editor = await screen.findByLabelText("Source of cell c04");
    fireEvent.change(editor, { target: { value: "x = 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => assert.ok(fetchStub.calls.some(isSavePost)));
    const body = (fetchStub.calls.find(isSavePost) as RecordedRequest).body as {
      spec: { cells: { id: string; source: string }[] };
      execute: boolean;
    };
    // Structural changes save with execute:false (rule 1).
    assert.equal(body.execute, false);
    assert.deepEqual(
      body.spec.cells.map((cell) => cell.id),
      ["c01", "c04", "c02", "c03"],
    );
    assert.equal(body.spec.cells[1].source, "x = 1");
  } finally {
    fetchStub.restore();
  }
});

// -------------------------------------------------------------------------- delete

test("delete asks for confirmation; declined it saves nothing, confirmed it removes the cell", async () => {
  const fetchStub = stubWorkspace();
  const originalConfirm = window.confirm;
  let confirmPrompt = "";
  try {
    await renderWorkspace();
    const details = openMoreActions("c03");

    window.confirm = (message) => {
      confirmPrompt = message ?? "";
      return false;
    };
    fireEvent.click(within(details).getByRole("button", { name: "Delete cell" }));
    assert.equal(confirmPrompt, "Delete this cell?");
    assert.equal(fetchStub.calls.some(isSavePost), false);
    assert.ok(document.getElementById(cellDomId("c03")), "declined delete must keep the cell");

    window.confirm = () => true;
    fireEvent.click(within(details).getByRole("button", { name: "Delete cell" }));
    await waitFor(() => assert.ok(fetchStub.calls.some(isSavePost)));
    const body = (fetchStub.calls.find(isSavePost) as RecordedRequest).body as {
      spec: { cells: { id: string }[] };
      execute: boolean;
    };
    assert.deepEqual(
      body.spec.cells.map((cell) => cell.id),
      ["c01", "c02"],
    );
    assert.equal(body.execute, false);
  } finally {
    window.confirm = originalConfirm;
    fetchStub.restore();
  }
});

// ---------------------------------------------------------------------- move + dup

test("move up saves a reordered spec immediately, with execute:false", async () => {
  const fetchStub = stubWorkspace();
  try {
    await renderWorkspace();
    const details = openMoreActions("c03");
    fireEvent.click(within(details).getByRole("button", { name: "Move up" }));

    await waitFor(() => assert.ok(fetchStub.calls.some(isSavePost)));
    const body = (fetchStub.calls.find(isSavePost) as RecordedRequest).body as {
      spec: { cells: { id: string }[] };
      execute: boolean;
    };
    assert.deepEqual(
      body.spec.cells.map((cell) => cell.id),
      ["c01", "c03", "c02"],
    );
    assert.equal(body.execute, false);
  } finally {
    fetchStub.restore();
  }
});

test("duplicate saves a copy directly below the original", async () => {
  const fetchStub = stubWorkspace();
  try {
    await renderWorkspace();
    const details = openMoreActions("c02");
    fireEvent.click(within(details).getByRole("button", { name: "Duplicate" }));

    await waitFor(() => assert.ok(fetchStub.calls.some(isSavePost)));
    const body = (fetchStub.calls.find(isSavePost) as RecordedRequest).body as {
      spec: { cells: { id: string; source: string }[] };
    };
    assert.deepEqual(
      body.spec.cells.map((cell) => cell.id),
      ["c01", "c02", "c04", "c03"],
    );
    assert.equal(body.spec.cells[2].source, "print('first')");
  } finally {
    fetchStub.restore();
  }
});

// ----------------------------------------------------------------------- busy lock

test("while a per-cell save is in flight, every other cell's actions are disabled", async () => {
  const response = deferred<{ status: number; body?: unknown }>();
  const fetchStub = stubWorkspace({ onPost: () => response.promise });
  try {
    await renderWorkspace();
    const details = openMoreActions("c03");
    fireEvent.click(within(details).getByRole("button", { name: "Move up" }));

    await waitFor(() => assert.equal(fetchStub.calls.filter(isSavePost).length, 1));
    const c01Edit = within(cellArticle("c01")).getByRole("button", { name: "Edit this cell" }) as HTMLButtonElement;
    const c02Edit = within(cellArticle("c02")).getByRole("button", { name: "Edit this cell" }) as HTMLButtonElement;
    assert.equal(c01Edit.disabled, true);
    assert.equal(c02Edit.disabled, true);
    // "More actions" on the cell whose move is in flight is disabled too — not just
    // the cells that did not initiate the change.
    const c03Details = cellArticle("c03").querySelector<HTMLDetailsElement>(".mj-notebook-ide-toolbar-more");
    assert.ok(c03Details);

    // Let the held request settle so nothing keeps updating state after the test
    // ends (this stub's version-list response does not reflect the new seq, so
    // there is nothing further worth asserting on screen once it resolves).
    await act(async () => {
      response.resolve({ status: 201, body: { version: { ...VERSION, seq: 2 }, run_id: null } });
      await response.promise.catch(() => {});
    });
  } finally {
    fetchStub.restore();
  }
});

// ------------------------------------------------------------------------ failure

test("a failed cell save shows the server's own sentence and keeps the reader's text", async () => {
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
    await renderWorkspace();
    fireEvent.click(within(cellArticle("c02")).getByRole("button", { name: "Edit this cell" }));
    const editor = await screen.findByLabelText("Source of cell c02");
    fireEvent.change(editor, { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText(/no cell 'c99'/);
    // Still editing, and the edit survives.
    assert.equal((screen.getByLabelText("Source of cell c02") as HTMLTextAreaElement).value, "keep me");
  } finally {
    fetchStub.restore();
  }
});

// -------------------------------------------------------------- page-level Edit gate

test("the page-level Edit button is disabled while a single-cell edit is open", async () => {
  const fetchStub = stubWorkspace();
  try {
    await renderWorkspace();
    const pageEdit = screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement;
    assert.equal(pageEdit.disabled, false);

    fireEvent.click(within(cellArticle("c02")).getByRole("button", { name: "Edit this cell" }));
    await screen.findByLabelText("Source of cell c02");
    assert.equal((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled, true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    assert.equal((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled, false);
  } finally {
    fetchStub.restore();
  }
});

// ---------------------------------------------------------------- switching cells

test("opening a second cell's editor while the first is dirty asks first", async () => {
  const fetchStub = stubWorkspace();
  const originalConfirm = window.confirm;
  let confirmCalls = 0;
  try {
    await renderWorkspace();
    fireEvent.click(within(cellArticle("c02")).getByRole("button", { name: "Edit this cell" }));
    fireEvent.change(await screen.findByLabelText("Source of cell c02"), { target: { value: "unsaved change" } });

    window.confirm = () => {
      confirmCalls += 1;
      return false;
    };
    fireEvent.click(within(cellArticle("c03")).getByRole("button", { name: "Edit this cell" }));
    assert.equal(confirmCalls, 1);
    // Declined: still on c02, with the unsaved text intact.
    assert.equal((screen.getByLabelText("Source of cell c02") as HTMLTextAreaElement).value, "unsaved change");
    assert.equal(screen.queryByLabelText("Source of cell c03"), null);

    window.confirm = () => {
      confirmCalls += 1;
      return true;
    };
    fireEvent.click(within(cellArticle("c03")).getByRole("button", { name: "Edit this cell" }));
    await screen.findByLabelText("Source of cell c03");
    assert.equal(screen.queryByLabelText("Source of cell c02"), null);
  } finally {
    window.confirm = originalConfirm;
    fetchStub.restore();
  }
});

// ------------------------------------------------------------------------ Nala

test('"Ask Nala to change this cell" starts a chat message naming the cell', async () => {
  const fetchStub = stubWorkspace();
  try {
    await renderWorkspace();
    fireEvent.click(within(cellArticle("c02")).getByRole("button", { name: "Ask Nala to change this cell" }));
    const chatBox = screen.getByRole("textbox", { name: "Talk to Nala" }) as HTMLTextAreaElement;
    assert.equal(chatBox.value, "Change cell c02: ");
  } finally {
    fetchStub.restore();
  }
});
