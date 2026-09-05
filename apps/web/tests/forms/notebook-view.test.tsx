import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { components } from "@majorana/contracts-gen";
import { fireEvent, render, within } from "@testing-library/react";
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

// --------------------------------------------------------------- question cells
//
// Everything below is the browser half of graded QUESTIONS. The server could grade
// one before any of this existed — `deterministic_grade`, `AnswerPrompt` redaction and
// the `answers` half of the attempt route were all built and tested — and no reader
// could ever reach it, because nothing drew an input. These tests are the assertion
// that the input exists, submits the right thing, and never draws the answer.

type SpecCell = components["schemas"]["Cell"];

function questionCell(id: string, answer: SpecCell["answer"], source = "Which gate?"): SpecCell {
  return {
    id,
    kind: "markdown" as const,
    role: "question" as const,
    source,
    tags: [],
    execute: true,
    stub: null,
    check: null,
    answer,
    answer_prompt: null,
    timeout_s: null,
  };
}

test("a choice question draws one radio per option and submits the option's INDEX", () => {
  // The index, not the text: `deterministic_grade` does `int(response)` and compares
  // against the key's `correct`, so submitting "Pauli-X" would be read as an
  // unparseable option number and the reader marked wrong for a right answer.
  const cells = notebookCellViews(
    [questionCell("q1", { kind: "choice", options: ["Hadamard", "Pauli-X"], correct: 1, explanation: "" })],
    null,
  );
  const sent: Array<[string, string, string | undefined]> = [];
  const view = render(
    <NotebookView
      cells={cells}
      locale="en"
      framework="qiskit"
      onCellAction={(cellId, action, detail) => sent.push([cellId, action, detail])}
    />,
  );
  const radios = view.container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  assert.equal(radios.length, 2);
  assert.ok(view.getByText("Hadamard"));
  fireEvent.click(radios[1]);
  fireEvent.click(view.getByRole("button", { name: "Check my answer" }));
  assert.deepEqual(sent, [["q1", "answerQuestion", "1"]]);
});

test("a choice question never renders which option is correct", () => {
  // The workspace is served the AUTHORED spec today, so the key really is in the
  // payload (ai-ops issue 260). That makes this the boundary that matters: the renderer must
  // not draw what it was handed. A `data-*` attribute or a stray title would leak it
  // just as effectively as visible text, so the whole subtree's HTML is searched.
  const cells = notebookCellViews(
    [questionCell("q1", { kind: "choice", options: ["Hadamard", "Pauli-X"], correct: 1, explanation: "because H" })],
    null,
  );
  const view = render(<NotebookView cells={cells} locale="en" framework="qiskit" onCellAction={() => {}} />);
  const answerBlock = view.container.querySelector(".mj-notebook-cell-answer");
  assert.ok(answerBlock);
  assert.equal(/correct/i.test(answerBlock.outerHTML), false);
  assert.equal(answerBlock.outerHTML.includes("because H"), false);
});

test("a text question never renders its accepted spellings", () => {
  const cells = notebookCellViews(
    [questionCell("q1", { kind: "text", accept: ["Hadamard", "the Hadamard gate"], explanation: "" })],
    null,
  );
  const view = render(<NotebookView cells={cells} locale="en" framework="qiskit" onCellAction={() => {}} />);
  const answerBlock = view.container.querySelector(".mj-notebook-cell-answer");
  assert.ok(answerBlock);
  assert.equal(answerBlock.outerHTML.includes("Hadamard"), false);
  assert.equal(answerBlock.querySelectorAll('input[type="text"]').length, 1);
});

test("a numeric question shows its unit and never its value", () => {
  const cells = notebookCellViews(
    [questionCell("q1", { kind: "numeric", value: 0.5, tolerance: 0.01, unit: "probability", explanation: "" })],
    null,
  );
  const view = render(<NotebookView cells={cells} locale="en" framework="qiskit" onCellAction={() => {}} />);
  const answerBlock = view.container.querySelector(".mj-notebook-cell-answer");
  assert.ok(answerBlock);
  assert.ok(within(answerBlock as HTMLElement).getByText("probability"));
  assert.equal(answerBlock.outerHTML.includes("0.5"), false);
  assert.equal(answerBlock.querySelectorAll('input[type="number"]').length, 1);
});

test("a rubric question says the model grades it, before the reader answers", () => {
  const cells = notebookCellViews(
    [questionCell("q1", { kind: "rubric", rubric: "Mentions interference.", explanation: "" })],
    null,
  );
  const view = render(<NotebookView cells={cells} locale="en" framework="qiskit" onCellAction={() => {}} />);
  const answerBlock = view.container.querySelector(".mj-notebook-cell-answer") as HTMLElement;
  assert.ok(answerBlock);
  assert.ok(within(answerBlock).getByText(/Nala grades this one/));
  // And the rubric itself — which tells the reader exactly what to write — stays out.
  assert.equal(answerBlock.outerHTML.includes("Mentions interference"), false);
});

test("a cell with no answer key draws no answer input at all", () => {
  const cells = notebookCellViews(spec.cells, report);
  const view = render(<NotebookView cells={cells} locale="en" framework="qiskit" onCellAction={() => {}} />);
  assert.equal(view.container.querySelector(".mj-notebook-cell-answer"), null);
});

test("submitting is refused until the reader has actually answered", () => {
  const cells = notebookCellViews(
    [questionCell("q1", { kind: "text", accept: ["Hadamard"], explanation: "" })],
    null,
  );
  const sent: string[] = [];
  const view = render(
    <NotebookView cells={cells} locale="en" framework="qiskit" onCellAction={(id) => sent.push(id)} />,
  );
  const submit = view.getByRole("button", { name: "Check my answer" }) as HTMLButtonElement;
  assert.equal(submit.disabled, true);
  fireEvent.click(submit);
  assert.deepEqual(sent, []);
});
