import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react";
import { NotebookLiveView } from "../../components/notebook-live-view.tsx";
import type { LiveCellView, LiveNotebookState } from "../../lib/notebook-live.ts";

function cell(overrides: Partial<LiveCellView> = {}): LiveCellView {
  return {
    id: "c01",
    kind: "code",
    role: null,
    source: "print(1)",
    writing: false,
    status: "queued",
    ename: null,
    evalue: null,
    check: null,
    ...overrides,
  };
}

function state(overrides: Partial<LiveNotebookState> = {}): LiveNotebookState {
  return {
    phase: "drafting",
    draftText: "",
    cells: [],
    repairs: [],
    currentRepair: null,
    ...overrides,
  };
}

test("renders nothing while idle", () => {
  const view = render(<NotebookLiveView state={state({ phase: "idle" })} locale="en" />);
  assert.equal(view.container.textContent, "");
});

test("shows the phase label for a non-idle phase", () => {
  const view = render(<NotebookLiveView state={state({ phase: "outlining" })} locale="en" />);
  assert.ok(view.getByText("Planning the notebook"));
});

test("renders a markdown cell through ChatMarkdown", () => {
  const view = render(
    <NotebookLiveView
      state={state({ cells: [cell({ id: "c01", kind: "markdown", role: "objective", source: "## What you will build" })] })}
      locale="en"
    />,
  );
  assert.ok(view.getByRole("heading", { name: "What you will build" }));
  assert.ok(view.getByText("objective"));
});

test("a code cell shows its source and a status chip matching its status", () => {
  const view = render(
    <NotebookLiveView
      state={state({ cells: [cell({ id: "c02", role: "run", source: "qc.h(0)", status: "ran" })] })}
      locale="en"
    />,
  );
  // SyntaxHighlightedCode splits the source across per-token <span>s, so the
  // string is not one text node — assert on the rendered text as a whole instead
  // of `getByText`, which only matches a single element's own text.
  assert.match(view.container.querySelector(".mj-notebook-cell-code")?.textContent ?? "", /qc\.h\(0\)/);
  assert.ok(view.getByText("Ran"));
  // A cell that did not raise shows no error block at all.
  assert.equal(view.queryByRole("alert"), null);
});

test("a raised cell shows the error name and value under it", () => {
  const view = render(
    <NotebookLiveView
      state={state({
        cells: [cell({ id: "c05", status: "raised", ename: "NameError", evalue: "name 'x' is not defined" })],
      })}
      locale="en"
    />,
  );
  assert.ok(view.getByText("Raised an error"));
  const alert = view.getByRole("alert");
  assert.match(alert.textContent ?? "", /NameError: name 'x' is not defined/);
});

test("the cell being written shows the caret and its sr-only label; a finished cell does not", () => {
  const view = render(
    <NotebookLiveView
      state={state({
        cells: [cell({ id: "c01", writing: false }), cell({ id: "c02", writing: true })],
      })}
      locale="en"
    />,
  );
  assert.equal(view.getAllByText("▍", { exact: false }).length, 1);
  assert.ok(view.getByText("Nala is writing this cell"));
});

test("a repair in flight shows the repair banner with the cell id, attempt and total", () => {
  const view = render(
    <NotebookLiveView
      state={state({
        phase: "repairing",
        currentRepair: { cellId: "c28", status: "started", error: "NameError: x", attempt: 2, of: 3, beforeRunning: false, source: null },
      })}
      locale="en"
    />,
  );
  assert.ok(view.getByText("Nala is fixing cell c28: attempt 2 of 3."));
});

test("a pre-execution repair (before_running) shows the checking banner instead", () => {
  const view = render(
    <NotebookLiveView
      state={state({
        phase: "checking",
        currentRepair: { cellId: "c07", status: "started", error: "gate-returns-instructions", attempt: 1, of: 3, beforeRunning: true, source: null },
      })}
      locale="en"
    />,
  );
  assert.ok(view.getByText("Nala is checking cell c07 before running it."));
});

test("no repair banner is shown once the repair has finished", () => {
  const view = render(<NotebookLiveView state={state({ phase: "running", currentRepair: null })} locale="en" />);
  assert.equal(view.queryByText(/fixing cell/), null);
});

test("ja locale renders real Japanese copy, not English", () => {
  const view = render(<NotebookLiveView state={state({ phase: "running" })} locale="ja" />);
  assert.ok(view.getByText("ノートブックを実行しています"));
});

test("a quiz/challenge cell's redacted content, if the worker ever sent one through, is rendered as inert text — never as HTML", () => {
  // The component trusts the state it is given; this proves it does not add a
  // SECOND leak by interpreting a cell's source as markup. ChatMarkdown already
  // renders model text as markdown, never raw HTML — this pins that a script tag in
  // a cell source is shown as visible text, never executed or injected as an element.
  const view = render(
    <NotebookLiveView
      state={state({ cells: [cell({ id: "c01", kind: "markdown", source: "<script>window.__pwned = true</script>" })] })}
      locale="en"
    />,
  );
  assert.equal((globalThis as { __pwned?: boolean }).__pwned, undefined);
  assert.equal(view.container.querySelector("script"), null);
});
