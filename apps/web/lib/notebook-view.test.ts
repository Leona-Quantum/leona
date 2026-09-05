import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCellOutput,
  errorTracebackText,
  notebookCellViews,
  notebookStatusPill,
  answerPromptOf,
  type NotebookCellView,
} from "./notebook-view.ts";

test("a PNG output becomes an <img>-ready data URI, never raw text", () => {
  const view = classifyCellOutput({ mime: "image/png", data: "iVBORw0KG==", truncated: false, original_bytes: null });
  assert.equal(view.kind, "image");
  assert.equal((view as { src: string }).src, "data:image/png;base64,iVBORw0KG==");
});

test("text/html is classified as text, never as a renderable-HTML kind", () => {
  // The whole point of this classification: nothing downstream can reach for
  // dangerouslySetInnerHTML on a "kind: html" value that does not exist here.
  const view = classifyCellOutput({ mime: "text/html", data: "<b>hi</b>", truncated: false, original_bytes: null });
  assert.equal(view.kind, "text");
  assert.equal((view as { text: string }).text, "<b>hi</b>");
});

test("cell views join the spec by id, not by array position", () => {
  const cells = [
    { id: "c02", kind: "code" as const, role: null, source: "print(2)", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null },
    { id: "c01", kind: "code" as const, role: null, source: "print(1)", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null },
  ];
  const report = {
    notebook_slug: "s",
    ok: true,
    runner: "sandbox" as const,
    duration_ms: 0,
    environment: {},
    dropped_bytes: 0,
    note: "",
    cells: [
      { id: "c01", status: "ok" as const, stdout: "1\n", stderr: "", outputs: [], error: null, duration_ms: 5, execution_count: 1, note: "" },
    ],
  };
  const views = notebookCellViews(cells, report);
  const c01 = views.find((view) => view.id === "c01") as NotebookCellView;
  const c02 = views.find((view) => view.id === "c02") as NotebookCellView;
  assert.equal(c01.status, "ok");
  assert.equal(c01.stdout, "1\n");
  // c02 has no matching result: it must not silently borrow c01's.
  assert.equal(c02.status, "not_run");
  assert.equal(c02.stdout, "");
});

test("a cell with execute:false defaults to skipped, not not_run", () => {
  const cells = [{ id: "hw", kind: "code" as const, role: null, source: "submit()", tags: [], execute: false, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null }];
  const [view] = notebookCellViews(cells, null);
  assert.equal(view.status, "skipped");
});

test("a markdown cell with no result also defaults to skipped", () => {
  const cells = [{ id: "m1", kind: "markdown" as const, role: null, source: "# hi", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null }];
  const [view] = notebookCellViews(cells, null);
  assert.equal(view.status, "skipped");
});

test("an error result surfaces ename/evalue verbatim", () => {
  const cells = [{ id: "c1", kind: "code" as const, role: null, source: "1/0", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null }];
  const report = {
    notebook_slug: "s",
    ok: false,
    runner: "sandbox" as const,
    duration_ms: 0,
    environment: {},
    dropped_bytes: 0,
    note: "",
    cells: [
      {
        id: "c1",
        status: "error" as const,
        stdout: "",
        stderr: "",
        outputs: [],
        error: { ename: "ZeroDivisionError", evalue: "division by zero", traceback: ["Traceback...", "ZeroDivisionError: division by zero"] },
        duration_ms: 1,
        execution_count: 1,
        note: "",
      },
    ],
  };
  const [view] = notebookCellViews(cells, report);
  assert.equal(view.status, "error");
  assert.deepEqual(view.error, {
    ename: "ZeroDivisionError",
    evalue: "division by zero",
    traceback: ["Traceback...", "ZeroDivisionError: division by zero"],
  });
});

test("errorTracebackText prefers the real traceback, joined by newline", () => {
  const text = errorTracebackText({ ename: "E", evalue: "v", traceback: ["line1", "line2"] });
  assert.equal(text, "line1\nline2");
});

test("errorTracebackText falls back to ename: evalue when there is no traceback", () => {
  const text = errorTracebackText({ ename: "NotebookGuardError", evalue: "disallowed import", traceback: [] });
  assert.equal(text, "NotebookGuardError: disallowed import");
});

test("errorTracebackText on no error is the empty string", () => {
  assert.equal(errorTracebackText(null), "");
});

test("a truncated output marks the cell view truncated", () => {
  const cells = [{ id: "c1", kind: "code" as const, role: null, source: "big()", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null }];
  const report = {
    notebook_slug: "s",
    ok: true,
    runner: "sandbox" as const,
    duration_ms: 0,
    environment: {},
    dropped_bytes: 100,
    note: "",
    cells: [
      {
        id: "c1",
        status: "ok" as const,
        stdout: "",
        stderr: "",
        outputs: [{ mime: "text/plain" as const, data: "...", truncated: true, original_bytes: 99999 }],
        error: null,
        duration_ms: 1,
        execution_count: 1,
        note: "",
      },
    ],
  };
  const [view] = notebookCellViews(cells, report);
  assert.equal(view.truncated, true);
});

test("notebookStatusPill maps running to generating and passes the rest through", () => {
  assert.equal(notebookStatusPill("running"), "generating");
  assert.equal(notebookStatusPill("queued"), "queued");
  assert.equal(notebookStatusPill("ready"), "ready");
  assert.equal(notebookStatusPill("failed"), "failed");
});

test("a cell with a hidden check is marked graded; a plain cell is not", () => {
  // `graded` is what decides whether "check my attempt" runs the exercise's own
  // test or asks Nala's opinion, so it has to be read off the cell rather than
  // guessed from the role — a `role=checkpoint` cell has no grader of its own.
  const base = {
    kind: "code" as const,
    role: null,
    source: "x = 1",
    tags: [],
    execute: true,
    stub: null,
    check: null,
    answer: null,
    answer_prompt: null,
    timeout_s: null,
  };
  const views = notebookCellViews(
    [
      { ...base, id: "plain" },
      { ...base, id: "exercise", stub: "def f(): ...", check: "assert f() == 1" },
      {
        ...base,
        id: "question",
        kind: "markdown" as const,
        role: "question" as const,
        answer: { kind: "choice" as const, options: ["a", "b"], correct: "a" },
      },
    ] as never,
    null,
  );
  assert.deepEqual(
    views.map((view) => [view.id, view.graded]),
    [
      ["plain", false],
      ["exercise", true],
      ["question", true],
    ],
  );
});


// --------------------------------------------------- the answer-key redaction
//
// These test `answerPromptOf` DIRECTLY, and they have to. The rendering tests in
// `tests/forms/notebook-view.test.tsx` assert that no answer appears in the DOM, and
// they keep passing when this function is replaced by `{...cell.answer}` — because the
// renderer only ever reads three fields, so the secret ones simply never get drawn.
// Verified by mutation: spreading the whole key left all 57 form tests green. What that
// mutation breaks is the CONTRACT other code is entitled to rely on — that a value of
// this type carries nothing a reader must not see — and only an assertion about the
// object's own shape can see it break.

const questionCell = (answer: unknown) => ({
  id: "q1",
  kind: "markdown" as const,
  role: "question" as const,
  source: "Which gate?",
  tags: [],
  execute: true,
  stub: null,
  check: null,
  answer,
  answer_prompt: null,
  timeout_s: null,
});

test("the derived answer prompt carries exactly kind, options and unit — nothing else", () => {
  const prompt = answerPromptOf(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a spec cell fixture
    questionCell({ kind: "choice", options: ["H", "X"], correct: 1, explanation: "because H" }) as any,
  );
  assert.deepEqual(Object.keys(prompt ?? {}).sort(), ["kind", "options", "unit"]);
  assert.deepEqual(prompt, { kind: "choice", options: ["H", "X"], unit: "" });
});

test("a text key's accepted spellings never reach the derived prompt", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a spec cell fixture
  const prompt = answerPromptOf(questionCell({ kind: "text", accept: ["Hadamard"], explanation: "" }) as any);
  assert.deepEqual(prompt, { kind: "text", options: [], unit: "" });
  assert.equal(JSON.stringify(prompt).includes("Hadamard"), false);
});

test("a numeric key's value never reaches the derived prompt, but its unit does", () => {
  const prompt = answerPromptOf(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a spec cell fixture
    questionCell({ kind: "numeric", value: 0.5, tolerance: 0.01, unit: "probability", explanation: "" }) as any,
  );
  assert.deepEqual(prompt, { kind: "numeric", options: [], unit: "probability" });
  assert.equal(JSON.stringify(prompt).includes("0.5"), false);
});

test("a rubric key's rubric never reaches the derived prompt", () => {
  const prompt = answerPromptOf(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a spec cell fixture
    questionCell({ kind: "rubric", rubric: "Mentions interference.", explanation: "" }) as any,
  );
  assert.deepEqual(prompt, { kind: "rubric", options: [], unit: "" });
  assert.equal(JSON.stringify(prompt).includes("interference"), false);
});

test("a cell with no answer key derives no prompt", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a spec cell fixture
  assert.equal(answerPromptOf(questionCell(null) as any), null);
});
