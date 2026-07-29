import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeMathDelimiters,
  protectMathPipesInTableRows,
  renderableMarkdown,
} from "./chat-markdown-source.ts";

test("provider TeX delimiters become the ones remark-math reads", () => {
  assert.equal(normalizeMathDelimiters("\\(x+1\\)"), "$x+1$");
  assert.equal(normalizeMathDelimiters("\\[x+1\\]"), "$$x+1$$");
});

test("a ket in a table cell keeps the row's column count", () => {
  // Verbatim from production run 019f9ea6-ef13-7ea5-83a4-bd08b4af9764.
  const row = "| $|\\Phi^+\\rangle$ | $\\frac{1}{\\sqrt{2}}(|00\\rangle + |11\\rangle)$ | ベル状態 |";
  const fixed = protectMathPipesInTableRows(row);

  // Four delimiters => three cells. Before the fix the kets added four more.
  assert.equal(fixed.split("|").length - 1, 4);
  assert.match(fixed, /\$\\vert \\Phi\^\+\\rangle\$/);
  assert.ok(!fixed.includes("(|00"));
});

test("prose outside a table row is untouched", () => {
  const prose = "The state $|00\\rangle$ is not a table row.";
  assert.equal(protectMathPipesInTableRows(prose), prose);
});

test("a table row with no math is untouched", () => {
  const row = "| Qiskit | hardware-facing | verbose |";
  assert.equal(protectMathPipesInTableRows(row), row);
});

test("currency on a table row is not mistaken for math", () => {
  // `$5 | $` is a `$…$` span by shape only. Rewriting it would merge two cells.
  const row = "| plan | costs $5 | $10 |";
  assert.equal(protectMathPipesInTableRows(row), row);
});

test("the separator row is left alone", () => {
  assert.equal(protectMathPipesInTableRows("|---|---|"), "|---|---|");
});

test("a ket written with provider delimiters survives both passes", () => {
  const row = "| \\(|01\\rangle\\) | second |";
  const fixed = renderableMarkdown(row);

  assert.equal(fixed.split("|").length - 1, 3);
  assert.match(fixed, /\$\\vert 01\\rangle\$/);
});
