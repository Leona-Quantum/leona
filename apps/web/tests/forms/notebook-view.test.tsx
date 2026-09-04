import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render, within } from "@testing-library/react";
import { NotebookView } from "../../components/notebook-view.tsx";
import { notebookCellViews } from "../../lib/notebook-view.ts";

// A 1x1 transparent PNG, base64 — small enough to inline as a fixture and real
// enough that classifyCellOutput's data-URI construction is exercised end to end.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const spec = {
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
    { id: "m1", kind: "markdown" as const, role: "objective" as const, source: "# Bell state\nWe build one below.", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null },
    { id: "c1", kind: "code" as const, role: "run" as const, source: "print(counts)", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null },
    { id: "c2", kind: "code" as const, role: "run" as const, source: "1 / 0", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null },
  ],
};

const report = {
  notebook_slug: "bell-state-intro",
  ok: false,
  runner: "sandbox" as const,
  duration_ms: 900,
  environment: {},
  dropped_bytes: 0,
  note: "",
  cells: [
    {
      id: "c1",
      status: "ok" as const,
      stdout: "{'00': 512, '11': 512}\n",
      stderr: "",
      outputs: [{ mime: "image/png" as const, data: TINY_PNG_BASE64, truncated: false, original_bytes: null }],
      error: null,
      duration_ms: 120,
      execution_count: 1,
      note: "",
    },
    {
      id: "c2",
      status: "error" as const,
      stdout: "",
      stderr: "",
      outputs: [],
      error: { ename: "ZeroDivisionError", evalue: "division by zero", traceback: [] },
      duration_ms: 4,
      execution_count: 2,
      note: "",
    },
  ],
};

test("NotebookView renders markdown, a stdout+figure code cell, and an error cell", () => {
  const cells = notebookCellViews(spec.cells, report);
  const view = render(<NotebookView cells={cells} locale="en" framework="qiskit" />);

  // The markdown cell renders through ChatMarkdown, not as raw text.
  assert.ok(view.getByRole("heading", { name: "Bell state" }));

  // The code cell's stdout is on screen.
  assert.match(view.getByText(/'00': 512, '11': 512/).textContent ?? "", /512/);

  // The PNG output became an <img> whose src is the data-URI this component
  // promises to build — never anything the sandbox output happened to be.
  const figure = view.getByAltText("figure") as HTMLImageElement;
  assert.ok(figure.src.startsWith("data:image/png;base64,"));
  assert.ok(figure.src.includes(TINY_PNG_BASE64));

  // The error cell's ename/evalue are readable text, not swallowed or rendered as HTML.
  const alert = view.getByRole("alert");
  assert.match(alert.textContent ?? "", /ZeroDivisionError/);
  assert.match(alert.textContent ?? "", /division by zero/);
});

test("text/html output is shown as literal text, never as rendered markup", () => {
  const htmlSpec = [
    { id: "c3", kind: "code" as const, role: null, source: "render_html()", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null },
  ];
  const htmlReport = {
    ...report,
    cells: [
      {
        id: "c3",
        status: "ok" as const,
        stdout: "",
        stderr: "",
        outputs: [{ mime: "text/html" as const, data: "<strong>bold</strong>", truncated: false, original_bytes: null }],
        error: null,
        duration_ms: 1,
        execution_count: 1,
        note: "",
      },
    ],
  };
  const cells = notebookCellViews(htmlSpec, htmlReport);
  const view = render(<NotebookView cells={cells} locale="en" framework="qiskit" />);
  // The literal tag text is visible on the page...
  assert.ok(view.getByText("<strong>bold</strong>"));
  // ...and there is no actual <strong> element produced by that output — if there
  // were, this component would have interpreted the HTML instead of showing it.
  assert.equal(view.container.querySelector(".mj-notebook-cell-output-text strong"), null);
});

test("the \"Explain this error\" action appears only on the cell whose output actually errored", () => {
  const cells = notebookCellViews(spec.cells, report);
  const view = render(<NotebookView cells={cells} locale="en" framework="qiskit" onCellAction={() => {}} />);
  const articles = view.container.querySelectorAll(".mj-notebook-cell");
  assert.equal(articles.length, 3);

  const [markdownCell, okCell, errorCell] = Array.from(articles) as HTMLElement[];
  assert.equal(markdownCell.dataset.kind, "markdown");
  assert.equal(okCell.dataset.status, "ok");
  assert.equal(errorCell.dataset.status, "error");

  assert.equal(within(markdownCell).queryByText("Explain this error"), null);
  assert.equal(within(okCell).queryByText("Explain this error"), null);
  assert.ok(within(errorCell).getByText("Explain this error"));
});
