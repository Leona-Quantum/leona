import assert from "node:assert/strict";
import test from "node:test";

import { liveNotebookFromEvents, parseCellsIncrementally, type LiveNotebookEvent } from "./notebook-live.ts";

test("no events yet yields the idle state, not a guess", () => {
  const state = liveNotebookFromEvents([]);
  assert.equal(state.phase, "idle");
  assert.deepEqual(state.cells, []);
  assert.deepEqual(state.repairs, []);
  assert.equal(state.currentRepair, null);
});

test("stage.started(plan) is outlining; stage.started(generate) is drafting", () => {
  const events: LiveNotebookEvent[] = [{ type: "stage.started", stage: "plan" }];
  assert.equal(liveNotebookFromEvents(events).phase, "outlining");
  events.push({ type: "stage.finished", stage: "plan", ok: true, duration_ms: 5 });
  events.push({ type: "stage.started", stage: "generate" });
  assert.equal(liveNotebookFromEvents(events).phase, "drafting");
});

// --- parseCellsIncrementally --------------------------------------------------

test("parseCellsIncrementally ignores the YAML front-matter before the first cell marker", () => {
  const text = "# ---\n# title: X\n# kind: lesson\n# ---\n\n# %% role=run\nprint(1)\n";
  const cells = parseCellsIncrementally(text);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].role, "run");
  assert.equal(cells[0].source, "print(1)\n");
});

test("parseCellsIncrementally strips the leading '# ' from markdown lines, keeps code verbatim", () => {
  const text = "# %% [markdown] role=objective\n# ## Heading\n# body line\n\n# %% role=run\nx = 1\ny = 2\n";
  const cells = parseCellsIncrementally(text);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].kind, "markdown");
  assert.equal(cells[0].source, "## Heading\nbody line\n");
  assert.equal(cells[1].kind, "code");
  assert.equal(cells[1].source, "x = 1\ny = 2\n");
});

test("the trailing, still-open cell is marked writing; earlier ones are not", () => {
  const text = "# %% role=run\nprint(1)\n\n# %% role=run\nprint(2";
  const cells = parseCellsIncrementally(text);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].writing, false);
  assert.equal(cells[1].writing, true);
  assert.equal(cells[1].source, "print(2");
});

test("a cell marker with no id= gets a stable positional id, matching parse_source's own cNN scheme", () => {
  const text = "# %% [markdown] role=objective\n# a\n\n# %% role=run\nb\n";
  const cells = parseCellsIncrementally(text);
  assert.deepEqual(cells.map((c) => c.id), ["c01", "c02"]);
});

test("an explicit id= (quoted or bare) is used instead of a positional one", () => {
  const text = '# %% id="exsol" role=solution\nx = 1\n\n# %% id=c9 role=run\ny = 2\n';
  const cells = parseCellsIncrementally(text);
  assert.deepEqual(cells.map((c) => c.id), ["exsol", "c9"]);
});

test("a header with no text after the marker at all (stream cut mid-header) still parses without throwing", () => {
  const text = "# %% role=run\nprint(1)\n\n# %%";
  const cells = parseCellsIncrementally(text);
  assert.equal(cells.length, 2);
  assert.equal(cells[1].kind, "code");
  assert.equal(cells[1].role, null);
  assert.equal(cells[1].source, "");
  assert.equal(cells[1].writing, true);
});

// --- streaming deltas ----------------------------------------------------------

test("draft deltas accumulate into an incremental cell view, replaced by notebook.draft.parsed", () => {
  const events: LiveNotebookEvent[] = [
    { type: "stage.started", stage: "generate" },
    { type: "notebook.draft.delta", text: "# %% role=objective [markdown]\n# ## Hi\n\n# %% role=run\npri", attempt: 1 },
  ];
  let state = liveNotebookFromEvents(events);
  assert.equal(state.phase, "drafting");
  assert.equal(state.cells.length, 2);
  assert.equal(state.cells[1].writing, true);
  assert.equal(state.cells[1].source, "pri");

  events.push({ type: "notebook.draft.delta", text: "nt(1)\n", attempt: 1 });
  state = liveNotebookFromEvents(events);
  assert.equal(state.cells[1].source, "print(1)\n");

  // The authoritative parse arrives — replaces the incremental view for THIS attempt.
  events.push({
    type: "notebook.draft.parsed",
    cells: [
      { id: "c01", kind: "markdown", role: "objective", source: "## Hi\n" },
      { id: "c02", kind: "code", role: "run", source: "print(1)\n" },
    ],
  });
  state = liveNotebookFromEvents(events);
  assert.equal(state.cells.length, 2);
  assert.equal(state.cells.every((c) => c.writing === false), true);
  assert.equal(state.cells[1].source, "print(1)\n");
});

test("a NEW draft attempt (structure-check retry) resets the incremental view, not appends to the old one", () => {
  const events: LiveNotebookEvent[] = [
    { type: "notebook.draft.delta", text: "# %% role=run\nfirst attempt\n", attempt: 1 },
    { type: "notebook.draft.parsed", cells: [{ id: "c01", kind: "code", role: "run", source: "first attempt\n" }] },
    // The pipeline rejected attempt 1 on structure and asked for a redo.
    { type: "notebook.draft.delta", text: "# %% role=objective [markdown]\n# second attempt\n", attempt: 2 },
  ];
  const state = liveNotebookFromEvents(events);
  // Back to incremental parsing for attempt 2 — the stale parsed cells from
  // attempt 1 must not linger.
  assert.equal(state.cells.length, 1);
  assert.equal(state.cells[0].role, "objective");
  assert.equal(state.cells[0].source, "second attempt\n");
});

// --- notebook.cells (execution) -------------------------------------------------

test("notebook.cells overlays ran/raised/not_run status onto matching cells by id", () => {
  const events: LiveNotebookEvent[] = [
    {
      type: "notebook.draft.parsed",
      cells: [
        { id: "c01", kind: "code", role: "run", source: "a" },
        { id: "c02", kind: "code", role: "run", source: "b" },
        { id: "c03", kind: "code", role: "run", source: "c" },
      ],
    },
    { type: "stage.started", stage: "final_execute" },
    {
      type: "notebook.cells",
      attempt: 1,
      ok: false,
      cells: [
        { id: "c01", status: "ok", ename: null, evalue: null, duration_ms: 5 },
        { id: "c02", status: "error", ename: "NameError", evalue: "boom", duration_ms: 3 },
        { id: "c03", status: "not_run", ename: null, evalue: null, duration_ms: 0 },
      ],
    },
  ];
  const state = liveNotebookFromEvents(events);
  assert.equal(state.phase, "running");
  const byId = Object.fromEntries(state.cells.map((c) => [c.id, c]));
  assert.equal(byId.c01.status, "ran");
  assert.equal(byId.c02.status, "raised");
  assert.equal(byId.c02.ename, "NameError");
  assert.equal(byId.c02.evalue, "boom");
  assert.equal(byId.c03.status, "not_run");
});

test("a cell with no notebook.cells report yet reads as queued", () => {
  const events: LiveNotebookEvent[] = [
    { type: "notebook.draft.parsed", cells: [{ id: "c01", kind: "code", role: "run", source: "a" }] },
  ];
  assert.equal(liveNotebookFromEvents(events).cells[0].status, "queued");
});

// --- notebook.repair -------------------------------------------------------------

test("a repair before execution (a lint finding) is 'checking'; after execution is 'repairing'", () => {
  const before: LiveNotebookEvent[] = [
    { type: "notebook.repair", cell_id: "c05", status: "started", error: "gate-returns-instructions", attempt: 1, of: 3, before_running: true },
  ];
  assert.equal(liveNotebookFromEvents(before).phase, "checking");

  const after: LiveNotebookEvent[] = [
    { type: "notebook.repair", cell_id: "c05", status: "started", error: "NameError: boom", attempt: 1, of: 3, before_running: false },
  ];
  assert.equal(liveNotebookFromEvents(after).phase, "repairing");
});

test("currentRepair is set while a repair is in flight and cleared once it finishes", () => {
  const events: LiveNotebookEvent[] = [
    { type: "notebook.repair", cell_id: "c05", status: "started", error: "NameError: boom", attempt: 2, of: 3, before_running: false },
  ];
  let state = liveNotebookFromEvents(events);
  assert.ok(state.currentRepair);
  assert.equal(state.currentRepair?.cellId, "c05");
  assert.equal(state.currentRepair?.attempt, 2);
  assert.equal(state.currentRepair?.of, 3);

  events.push({
    type: "notebook.repair",
    cell_id: "c05",
    status: "finished",
    error: "NameError: boom",
    attempt: 2,
    of: 3,
    before_running: false,
    source: "print('fixed')\n",
  });
  state = liveNotebookFromEvents(events);
  assert.equal(state.currentRepair, null);
  assert.equal(state.repairs.length, 2);
});

test("a finished repair's redacted (null) source leaves the cell's shown text untouched", () => {
  const events: LiveNotebookEvent[] = [
    { type: "notebook.draft.parsed", cells: [{ id: "exsol", kind: "code", role: "solution", source: "STUB\n" }] },
    { type: "notebook.repair", cell_id: "exsol", status: "started", error: "NameError: x", attempt: 1, of: 3, before_running: false },
    // The worker redacts `source` to null for a graded/solution-only cell.
    { type: "notebook.repair", cell_id: "exsol", status: "finished", error: "NameError: x", attempt: 1, of: 3, before_running: false, source: null },
  ];
  const state = liveNotebookFromEvents(events);
  assert.equal(state.cells[0].source, "STUB\n");
});

test("a finished repair's non-null source overlays the cell's shown text", () => {
  const events: LiveNotebookEvent[] = [
    { type: "notebook.draft.parsed", cells: [{ id: "c05", kind: "code", role: "run", source: "old\n" }] },
    { type: "notebook.repair", cell_id: "c05", status: "started", error: "NameError: x", attempt: 1, of: 3, before_running: false },
    { type: "notebook.repair", cell_id: "c05", status: "finished", error: "NameError: x", attempt: 1, of: 3, before_running: false, source: "fixed\n" },
  ];
  const state = liveNotebookFromEvents(events);
  assert.equal(state.cells[0].source, "fixed\n");
});

test("deltas that arrive WHILE a repair is in flight are not shown as the main draft (no cell wipeout)", () => {
  const events: LiveNotebookEvent[] = [
    { type: "notebook.draft.parsed", cells: [{ id: "c01", kind: "code", role: "run", source: "a\n" }, { id: "c02", kind: "code", role: "run", source: "b\n" }] },
    { type: "notebook.repair", cell_id: "c02", status: "started", error: "NameError: x", attempt: 1, of: 3, before_running: false },
    // The repair's own (small) fragment streams on the SAME event type.
    { type: "notebook.draft.delta", text: "# %% role=run\nfixed", attempt: 5 },
  ];
  const state = liveNotebookFromEvents(events);
  // Both original cells are still present — the repair fragment did not replace
  // the whole draft view.
  assert.deepEqual(state.cells.map((c) => c.id), ["c01", "c02"]);
});

// --- terminal / disorder ---------------------------------------------------------

test("run.finished(succeeded) is done; any other status, or run.error, is failed", () => {
  assert.equal(liveNotebookFromEvents([{ type: "run.finished", status: "succeeded" }]).phase, "done");
  assert.equal(liveNotebookFromEvents([{ type: "run.finished", status: "failed" }]).phase, "failed");
  assert.equal(liveNotebookFromEvents([{ type: "run.error", code: "x", message: "m" }]).phase, "failed");
});

test("a duplicate notebook.cells event (the SSE reconnect replaying a seq) is harmless — last write wins", () => {
  const one: LiveNotebookEvent = { type: "notebook.cells", attempt: 1, ok: true, cells: [{ id: "c01", status: "ok", ename: null, evalue: null, duration_ms: 5 }] };
  const events = [one, one];
  const state = liveNotebookFromEvents(events);
  assert.equal(state.cells.length, 0); // no notebook.draft.parsed in this fixture — nothing to overlay onto
  // The reducer itself must not throw or duplicate internal state on a repeat.
  assert.doesNotThrow(() => liveNotebookFromEvents([...events, one]));
});

test("a stream that just stops (no run.finished, no run.error — a lost connection) leaves the last known phase, not idle", () => {
  const events: LiveNotebookEvent[] = [
    { type: "stage.started", stage: "final_execute" },
    { type: "notebook.cells", attempt: 1, ok: false, cells: [{ id: "c01", status: "ok", ename: null, evalue: null, duration_ms: 5 }] },
  ];
  const state = liveNotebookFromEvents(events);
  assert.equal(state.phase, "running");
});
