import assert from "node:assert/strict";
import test from "node:test";

import {
  dedent,
  deleteBackward,
  indent,
  lineAt,
  markedLines,
  newline,
  offsetOf,
  toggleComment,
  typeCharacter,
  type TextState,
} from "./code-editing.ts";

/** A state from text with `|` as the caret, or `[` `]` around a selection. */
function at(marked: string): TextState {
  if (marked.includes("|")) {
    const start = marked.indexOf("|");
    return { value: marked.replace("|", ""), start, end: start };
  }
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { value: marked.replace("[", "").replace("]", ""), start, end };
}

/** The inverse of `at`, so expectations read as text. */
function show(state: TextState | null): string | null {
  if (!state) return null;
  const { value, start, end } = state;
  if (start === end) return `${value.slice(0, start)}|${value.slice(start)}`;
  return `${value.slice(0, start)}[${value.slice(start, end)}]${value.slice(end)}`;
}

test("Tab with a caret inserts spaces to the next tab stop", () => {
  assert.equal(show(indent(at("|x"))), "    |x");
  assert.equal(show(indent(at("ab|"))), "ab  |");
  assert.equal(show(indent(at("    |"))), "        |");
});

test("Tab with a selection indents every touched line that has something on it", () => {
  assert.equal(show(indent(at("[a\nb\n\nc]"))), "[    a\n    b\n\n    c]");
  // A selection ending at the start of a line does not touch that line.
  assert.equal(show(indent(at("[a\n]b"))), "[    a\n]b");
  // A selection starting mid-line indents the whole line and keeps its place in the text.
  assert.equal(show(indent(at("x = [1]"))), "    x = [1]");
});

test("Shift+Tab steps each touched line back to the previous tab stop", () => {
  assert.equal(show(dedent(at("        |x"))), "    |x");
  assert.equal(show(dedent(at("      x|"))), "    x|");
  assert.equal(show(dedent(at("  x|"))), "x|");
  assert.equal(show(dedent(at("\tx|"))), "x|");
  assert.equal(show(dedent(at("x|"))), "x|");
  assert.equal(show(dedent(at("[    a\n        b\nc]"))), "[a\n    b\nc]");
});

test("Enter keeps the indentation and opens a level after a colon or an open bracket", () => {
  assert.equal(show(newline(at("    x = 1|"))), "    x = 1\n    |");
  assert.equal(show(newline(at("for i in range(3):|"))), "for i in range(3):\n    |");
  assert.equal(show(newline(at("    if ok:  # start|"))), "    if ok:  # start\n        |");
  assert.equal(show(newline(at("values = [|"))), "values = [\n    |");
  // Between a pair, the closer gets its own line back at the original indentation.
  assert.equal(show(newline(at("    f(|)"))), "    f(\n        |\n    )");
});

test("a colon inside a string or a comment opens nothing", () => {
  assert.equal(show(newline(at('label = "ratio:"|'))), 'label = "ratio:"\n|');
  assert.equal(show(newline(at("x = 1  # note:|"))), "x = 1  # note:\n|");
  assert.equal(show(newline(at('    """Example:|'))), '    """Example:\n    |');
});

test("Cmd/Ctrl+/ comments at the shallowest indentation, and uncomments when all are comments", () => {
  assert.equal(show(toggleComment(at("x = 1|"))), "# x = 1|");
  assert.equal(show(toggleComment(at("[    a\n        b\n\n    c]"))), "[    # a\n    #     b\n\n    # c]");
  assert.equal(show(toggleComment(at("[    # a\n    #     b]"))), "[    a\n        b]");
  assert.equal(show(toggleComment(at("#x = 1|"))), "x = 1|");
  // Mixed: comment everything, as every editor does.
  assert.equal(show(toggleComment(at("[# a\nb]"))), "[# # a\n# b]");
  assert.equal(show(toggleComment(at("   |"))), "   |");
});

test("an opening bracket closes itself only when the next character leaves room", () => {
  assert.equal(show(typeCharacter(at("print|"), "(")), "print(|)");
  assert.equal(show(typeCharacter(at("f(|)"), "[")), "f([|])");
  assert.equal(show(typeCharacter(at("x = |"), "{")), "x = {|}");
  // Before existing code, a bracket is the start of wrapping it: type it plainly.
  assert.equal(typeCharacter(at("|qc"), "("), null);
  // Never inside a string or a comment, and never over a selection.
  assert.equal(typeCharacter(at("s = 'a|'"), "("), null);
  assert.equal(typeCharacter(at("# note |"), "("), null);
  assert.equal(typeCharacter(at("[qc]"), "("), null);
});

test("a closer steps over its twin only when an opener is waiting for it", () => {
  assert.equal(show(typeCharacter(at("print(x|)"), ")")), "print(x)|");
  assert.equal(show(typeCharacter(at("f(\n    a|)"), ")")), "f(\n    a)|");
  // Already one closer too many: the reader means another one.
  assert.equal(typeCharacter(at("x|)"), ")"), null);
  assert.equal(typeCharacter(at("x|"), ")"), null);
});

test("quotes pair only in code, never after a letter unless it is a string prefix", () => {
  assert.equal(show(typeCharacter(at("s = |"), '"')), 's = "|"');
  assert.equal(show(typeCharacter(at("s = f|"), "'")), "s = f'|'");
  assert.equal(show(typeCharacter(at("s = rb|"), '"')), 's = rb"|"');
  assert.equal(typeCharacter(at("don|"), "'"), null);
  assert.equal(typeCharacter(at("elif|"), '"'), null);
  assert.equal(typeCharacter(at("x.f|"), '"'), null);
  assert.equal(typeCharacter(at("# it|"), "'"), null);
  assert.equal(typeCharacter(at("s = 'don|"), "'"), null);
  // Stepping over the closing quote of the string the caret is in.
  assert.equal(show(typeCharacter(at("s = 'ab|'"), "'")), "s = 'ab'|");
  // A third quote after an empty pair is a docstring opening.
  assert.equal(show(typeCharacter(at('""|'), '"')), '"""|"""');
});

test("Backspace removes an empty pair together, and steps back through indentation by a level", () => {
  assert.equal(show(deleteBackward(at("print(|)"))), "print|");
  assert.equal(show(deleteBackward(at('s = "|"'))), "s = |");
  // Two different strings meeting at the caret are not a pair.
  assert.equal(deleteBackward(at("'a'|'b'")), null);
  assert.equal(show(deleteBackward(at("        |x"))), "    |x");
  assert.equal(show(deleteBackward(at("      |"))), "    |");
  assert.equal(deleteBackward(at("x|")), null);
  assert.equal(deleteBackward(at(" |")), null);
});

test("marked lines reproduce every line exactly, with the marked runs flagged", () => {
  const source = "qc = QuantumCircuit(1).h(0)\n\nprint(qc)";
  const lines = markedLines(source, [{ line: 1, col: 6, endLine: 1, endCol: 28, severity: "warning" }]);
  assert.deepEqual(
    lines.map((segments) => segments.map((segment) => segment.text).join("")),
    source.split("\n"),
  );
  assert.deepEqual(lines[0], [
    { text: "qc = ", severity: null },
    { text: "QuantumCircuit(1).h(0)", severity: "warning" },
  ]);
  assert.deepEqual(lines[1], []);
  assert.deepEqual(lines[2], [{ text: "print(qc)", severity: null }]);
});

test("marks: an error outranks a warning, a missing end runs to the line's end, bad lines are ignored", () => {
  const lines = markedLines("abcdef\n  ghi", [
    { line: 1, col: 1, endLine: 1, endCol: 5, severity: "warning" },
    { line: 1, col: 3, endLine: 1, endCol: 4, severity: "error" },
    { line: 2, col: 3, severity: "error" },
    { line: 9, col: 1, severity: "error" },
  ]);
  assert.deepEqual(lines[0], [
    { text: "ab", severity: "warning" },
    { text: "c", severity: "error" },
    { text: "d", severity: "warning" },
    { text: "ef", severity: null },
  ]);
  assert.deepEqual(lines[1], [
    { text: "  ", severity: null },
    { text: "ghi", severity: "error" },
  ]);
});

test("line and column convert to offsets and back, clamped", () => {
  const value = "ab\ncde\nf";
  assert.equal(offsetOf(value, 1, 1), 0);
  assert.equal(offsetOf(value, 2, 2), 4);
  assert.equal(offsetOf(value, 2, 99), 6);
  assert.equal(offsetOf(value, 9, 1), value.length);
  assert.equal(lineAt(value, 0), 1);
  assert.equal(lineAt(value, 4), 2);
  assert.equal(lineAt(value, value.length), 3);
});
