import assert from "node:assert/strict";
import test from "node:test";

import { diffNotebookVersions, type NotebookDiffCell } from "./notebook-diff.ts";

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
    title: "Title",
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

function statusOf(cells: NotebookDiffCell[], id: string) {
  return cells.find((c) => c.id === id)?.status;
}

test("an added cell (present only in newer) is reported added", () => {
  const older = spec([cell("c1", "a")]);
  const newer = spec([cell("c1", "a"), cell("c2", "b")]);
  const diff = diffNotebookVersions(older, newer);
  assert.equal(statusOf(diff.cells, "c1"), "unchanged");
  assert.equal(statusOf(diff.cells, "c2"), "added");
});

test("a removed cell (present only in older) is reported removed", () => {
  const older = spec([cell("c1", "a"), cell("c2", "b")]);
  const newer = spec([cell("c1", "a")]);
  const diff = diffNotebookVersions(older, newer);
  assert.equal(statusOf(diff.cells, "c1"), "unchanged");
  assert.equal(statusOf(diff.cells, "c2"), "removed");
  assert.equal(diff.cells.length, 2);
});

test("a changed cell carries a line diff with + and - lines", () => {
  const older = spec([cell("c1", "line1\nline2\nline3")]);
  const newer = spec([cell("c1", "line1\nCHANGED\nline3")]);
  const diff = diffNotebookVersions(older, newer);
  const entry = diff.cells.find((c) => c.id === "c1");
  assert.equal(entry?.status, "changed");
  assert.ok(entry?.lines);
  assert.ok(entry?.lines?.some((l) => l.kind === "-" && l.text === "line2"));
  assert.ok(entry?.lines?.some((l) => l.kind === "+" && l.text === "CHANGED"));
  assert.ok(entry?.lines?.some((l) => l.kind === " " && l.text === "line1"));
});

test("an unchanged cell (identical content, same position) has no lines", () => {
  const older = spec([cell("c1", "same")]);
  const newer = spec([cell("c1", "same")]);
  const diff = diffNotebookVersions(older, newer);
  const entry = diff.cells.find((c) => c.id === "c1");
  assert.equal(entry?.status, "unchanged");
  assert.equal(entry?.lines, undefined);
});

test("a cell whose relative position changed, with identical content, is reported moved", () => {
  const older = spec([cell("c1", "a"), cell("c2", "b")]);
  const newer = spec([cell("c2", "b"), cell("c1", "a")]);
  const diff = diffNotebookVersions(older, newer);
  assert.equal(statusOf(diff.cells, "c1"), "moved");
  assert.equal(statusOf(diff.cells, "c2"), "moved");
});

test("a removed cell is placed right after the surviving cell it used to follow", () => {
  const older = spec([cell("c1", "a"), cell("c2", "removed-me"), cell("c3", "c")]);
  const newer = spec([cell("c1", "a"), cell("c3", "c")]);
  const diff = diffNotebookVersions(older, newer);
  const ids = diff.cells.map((c) => c.id);
  assert.deepEqual(ids, ["c1", "c2", "c3"]);
});

test("a removed cell with nothing surviving before it is placed at the front", () => {
  const older = spec([cell("c1", "removed-me"), cell("c2", "a")]);
  const newer = spec([cell("c2", "a")]);
  const diff = diffNotebookVersions(older, newer);
  assert.deepEqual(diff.cells.map((c) => c.id), ["c1", "c2"]);
});

test("header reports only fields that differ, with before/after text", () => {
  const older = spec([], { title: "Old title", summary: "same summary", objectives: ["a"], duration_minutes: 10 });
  const newer = spec([], { title: "New title", summary: "same summary", objectives: ["a", "b"], duration_minutes: 10 });
  const diff = diffNotebookVersions(older, newer);
  const fields = diff.header.map((f) => f.field);
  assert.ok(fields.includes("title"));
  assert.ok(fields.includes("objectives"));
  assert.ok(!fields.includes("summary"));
  assert.ok(!fields.includes("duration_minutes"));
  const title = diff.header.find((f) => f.field === "title");
  assert.equal(title?.before, "Old title");
  assert.equal(title?.after, "New title");
});

test("identical versions produce no header diff and every cell unchanged", () => {
  const older = spec([cell("c1", "a"), cell("c2", "b")]);
  const newer = spec([cell("c1", "a"), cell("c2", "b")]);
  const diff = diffNotebookVersions(older, newer);
  assert.deepEqual(diff.header, []);
  assert.ok(diff.cells.every((c) => c.status === "unchanged"));
});

test("a 200-line cell diff finishes quickly", () => {
  const before = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  // Every other line changed — a realistic "half the cell was rewritten" case.
  const after = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? `line ${i}` : `changed ${i}`)).join("\n");
  const older = spec([cell("c1", before)]);
  const newer = spec([cell("c1", after)]);
  const start = Date.now();
  const diff = diffNotebookVersions(older, newer);
  const elapsedMs = Date.now() - start;
  assert.equal(diff.cells[0].status, "changed");
  assert.ok(elapsedMs < 2000, `expected the 200-line diff to finish quickly, took ${elapsedMs}ms`);
});
