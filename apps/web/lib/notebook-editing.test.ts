import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCellEdit,
  cellsAreDirty,
  deleteCell,
  insertCellAfter,
  moveCell,
  nextCellId,
  raisesException,
  specWithCells,
} from "./notebook-editing.ts";

type Cell = Parameters<typeof deleteCell>[0][number];

function cell(id: string, overrides: Partial<Cell> = {}): Cell {
  return {
    id,
    kind: "code",
    role: null,
    source: `print('${id}')`,
    tags: [],
    execute: true,
    stub: null,
    check: null,
    answer: null,
    answer_prompt: null,
    timeout_s: null,
    ...overrides,
  } as Cell;
}

const THREE = [cell("c01"), cell("c02"), cell("c03")];

// ------------------------------------------------------------------------ ids

test("nextCellId takes the lowest free cNN, not the next number after the last", () => {
  assert.equal(nextCellId(THREE), "c04");
  assert.equal(nextCellId([cell("c01"), cell("c03")]), "c02");
  assert.equal(nextCellId([]), "c01");
});

test("nextCellId ignores ids that are not cNN at all", () => {
  // Nala and `from_ipynb` both mint readable ids like `setup`; those must not make
  // the counter skip, and must not collide with what the editor mints.
  assert.equal(nextCellId([cell("setup"), cell("c01")]), "c02");
});

// ---------------------------------------------------------------------- edits

test("applyCellEdit changes only the named cell and only the named fields", () => {
  const edited = applyCellEdit(THREE, "c02", { source: "x = 1" });
  assert.equal(edited[1].source, "x = 1");
  assert.equal(edited[1].role, null);
  assert.equal(edited[0].source, "print('c01')");
  assert.equal(edited[2].source, "print('c03')");
  // The originals are untouched: this is a pure function over a React state array.
  assert.equal(THREE[1].source, "print('c02')");
});

test("applyCellEdit on an unknown id is a no-op, not a throw", () => {
  assert.deepEqual(applyCellEdit(THREE, "nope", { source: "x" }), THREE);
});

test("the raises-exception toggle adds and removes exactly that tag", () => {
  const tagged = applyCellEdit(THREE, "c01", { raisesException: true });
  assert.deepEqual(tagged[0].tags, ["raises-exception"]);
  assert.ok(raisesException(tagged[0]));
  const untagged = applyCellEdit(tagged, "c01", { raisesException: false });
  assert.deepEqual(untagged[0].tags, []);
});

test("the raises-exception toggle preserves other tags", () => {
  const withTag = applyCellEdit([cell("c01", { tags: ["skip-execution"] })], "c01", {
    raisesException: true,
  });
  assert.deepEqual(withTag[0].tags, ["skip-execution", "raises-exception"]);
});

test("flipping a code cell to markdown clears what only a code cell may carry", () => {
  // `Cell._stub_only_on_code` refuses a markdown cell with a stub, so leaving one on
  // would produce a spec the API rejects — the reader would see a 400 for a change
  // they did not knowingly make.
  const start = [cell("c01", { stub: "# your code here", tags: ["raises-exception"] })];
  const flipped = applyCellEdit(start, "c01", { kind: "markdown" });
  assert.equal(flipped[0].kind, "markdown");
  assert.equal(flipped[0].stub, null);
  assert.deepEqual(flipped[0].tags, []);
});

test("a markdown cell cannot be given a raises-exception tag", () => {
  const md = [cell("c01", { kind: "markdown" })];
  assert.deepEqual(applyCellEdit(md, "c01", { raisesException: true })[0].tags, []);
});

test("the execute toggle and the role picker write through", () => {
  const edited = applyCellEdit(THREE, "c03", { execute: false, role: "solution" });
  assert.equal(edited[2].execute, false);
  assert.equal(edited[2].role, "solution");
});

// -------------------------------------------------------------- insert / delete

test("insertCellAfter puts a fresh cell below the named one with the lowest free id", () => {
  const { cells, id } = insertCellAfter(THREE, "c01", "markdown");
  assert.equal(id, "c04");
  assert.deepEqual(
    cells.map((c) => c.id),
    ["c01", "c04", "c02", "c03"],
  );
  assert.equal(cells[1].kind, "markdown");
  assert.equal(cells[1].source, "");
  assert.equal(cells[1].execute, true);
});

test("insertCellAfter(null) puts the cell first, and an unknown id appends", () => {
  assert.equal(insertCellAfter(THREE, null, "code").cells[0].id, "c04");
  const appended = insertCellAfter(THREE, "gone", "code").cells;
  assert.equal(appended[appended.length - 1].id, "c04");
});

test("deleteCell removes one cell and frees its id for reuse", () => {
  const left = deleteCell(THREE, "c02");
  assert.deepEqual(
    left.map((c) => c.id),
    ["c01", "c03"],
  );
  assert.equal(nextCellId(left), "c02");
});

test("deleting the last cell leaves an empty notebook rather than refusing", () => {
  assert.deepEqual(deleteCell([cell("c01")], "c01"), []);
});

// ------------------------------------------------------------------------ move

test("moveCell swaps with its neighbour in each direction", () => {
  assert.deepEqual(
    moveCell(THREE, "c02", "up").map((c) => c.id),
    ["c02", "c01", "c03"],
  );
  assert.deepEqual(
    moveCell(THREE, "c02", "down").map((c) => c.id),
    ["c01", "c03", "c02"],
  );
});

test("a move off either end is a no-op, and so is a move of an unknown cell", () => {
  assert.deepEqual(
    moveCell(THREE, "c01", "up").map((c) => c.id),
    ["c01", "c02", "c03"],
  );
  assert.deepEqual(
    moveCell(THREE, "c03", "down").map((c) => c.id),
    ["c01", "c02", "c03"],
  );
  assert.deepEqual(
    moveCell(THREE, "gone", "up").map((c) => c.id),
    ["c01", "c02", "c03"],
  );
});

// ------------------------------------------------------------------ spec + dirty

test("specWithCells keeps every field of the version's spec except the cells", () => {
  const spec = {
    schema_version: 1 as const,
    slug: "keep-me",
    title: "Keep me",
    kind: "lab" as const,
    summary: "s",
    objectives: ["o"],
    references: [{ title: "R", authors: "", year: null, url: "", note: "" }],
    cells: THREE,
  } as unknown as Parameters<typeof specWithCells>[0];
  const next = specWithCells(spec, deleteCell(THREE, "c01"));
  assert.equal(next.slug, "keep-me");
  assert.equal(next.kind, "lab");
  assert.deepEqual(next.objectives, ["o"]);
  assert.equal(next.references?.length, 1);
  assert.deepEqual(
    (next.cells ?? []).map((c) => c.id),
    ["c02", "c03"],
  );
});

test("cellsAreDirty sees every change the editor can make", () => {
  assert.equal(cellsAreDirty(THREE, THREE), false);
  assert.equal(cellsAreDirty(THREE, applyCellEdit(THREE, "c01", { source: "x" })), true);
  assert.equal(cellsAreDirty(THREE, applyCellEdit(THREE, "c01", { kind: "markdown" })), true);
  assert.equal(cellsAreDirty(THREE, applyCellEdit(THREE, "c01", { role: "run" })), true);
  assert.equal(cellsAreDirty(THREE, applyCellEdit(THREE, "c01", { execute: false })), true);
  assert.equal(
    cellsAreDirty(THREE, applyCellEdit(THREE, "c01", { raisesException: true })),
    true,
  );
  assert.equal(cellsAreDirty(THREE, moveCell(THREE, "c01", "down")), true);
  assert.equal(cellsAreDirty(THREE, deleteCell(THREE, "c01")), true);
  assert.equal(cellsAreDirty(THREE, insertCellAfter(THREE, "c01", "code").cells), true);
});

test("cellsAreDirty ignores a field the editor never touches", () => {
  // A version whose cells carry a `timeout_s` Nala set must not read as dirty the
  // moment the editor opens, or every open would prompt on navigate-away.
  const withTimeout = THREE.map((c) => ({ ...c, timeout_s: 30 }) as Cell);
  assert.equal(cellsAreDirty(THREE, withTimeout), false);
});
