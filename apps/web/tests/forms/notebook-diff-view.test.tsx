import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react";
import { NotebookDiffView } from "../../components/notebook-diff-view.tsx";
import { diffNotebookVersions } from "../../lib/notebook-diff.ts";

function cell(id: string, source: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "code" as const,
    role: null,
    source,
    tags: [] as string[],
    execute: true,
    stub: null,
    timeout_s: null,
    ...overrides,
  };
}

function spec(cells: ReturnType<typeof cell>[], overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1 as const,
    slug: "s",
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
    objectives: [] as string[],
    prerequisites: [] as string[],
    duration_minutes: null as number | null,
    references: [] as never[],
    seeds: [] as never[],
    brief: "",
    extra: {},
    cells,
    ...overrides,
  };
}

test("NotebookDiffView renders a + line for a changed cell", () => {
  const older = spec([cell("c1", "qc.h(0)\nqc.measure_all()")]);
  const newer = spec([cell("c1", "qc.h(0)\nqc.x(1)\nqc.measure_all()")]);
  const diff = diffNotebookVersions(older, newer);

  const view = render(<NotebookDiffView diff={diff} older={older} newer={newer} locale="en" />);

  // The added line is on screen, with its own gutter marked "+".
  const addedLine = view.getByText("qc.x(1)").closest(".mj-notebook-diff-line");
  assert.ok(addedLine);
  assert.ok(addedLine?.classList.contains("mj-notebook-diff-line--add"));
  assert.equal(addedLine?.querySelector(".mj-notebook-diff-gutter")?.textContent, "+");

  // The unchanged surrounding lines are still shown as context, not as +/-.
  const contextLine = view.getByText("qc.h(0)").closest(".mj-notebook-diff-line");
  assert.ok(contextLine?.classList.contains("mj-notebook-diff-line--context"));
});

test("NotebookDiffView collapses an unchanged cell to one line, with no source shown", () => {
  const older = spec([cell("c1", "same code")]);
  const newer = spec([cell("c1", "same code")]);
  const diff = diffNotebookVersions(older, newer);

  const view = render(<NotebookDiffView diff={diff} older={older} newer={newer} locale="en" />);
  assert.equal(view.queryByText("same code"), null);
  assert.ok(view.getByText("Unchanged"));
});
