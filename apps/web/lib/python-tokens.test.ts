import assert from "node:assert/strict";
import test from "node:test";

import { contextAt, tokenizePython } from "./python-tokens.ts";

function kinds(source: string): string[] {
  return tokenizePython(source).map((token) => `${token.kind}:${token.text}`);
}

test("names, numbers, operators and the longest operator first", () => {
  assert.deepEqual(kinds("x **= 2.5e-3j // y"), ["name:x", "op:**=", "number:2.5e-3j", "op://", "name:y"]);
  assert.deepEqual(kinds("f(a, *b, **c) -> None"), [
    "name:f", "op:(", "name:a", "op:,", "op:*", "name:b", "op:,", "op:**", "name:c", "op:)", "op:->", "name:None",
  ]);
});

test("a newline ends a statement only outside brackets, and a backslash joins lines", () => {
  const newlines = (source: string) => tokenizePython(source).filter((token) => token.kind === "newline").length;
  assert.equal(newlines("a = 1\nb = 2\n"), 2);
  assert.equal(newlines("a = (1,\n     2)\n"), 1);
  assert.equal(newlines("a = 1 + \\\n    2\n"), 1);
  // Blank and comment-only lines are not statements.
  assert.equal(newlines("\n\n# only a comment\n\na = 1\n"), 1);
});

test("strings: prefixes, triple quotes, escapes, and the ones never closed", () => {
  assert.deepEqual(kinds(`rb'\\x' F"a" u'b'`), [`string:rb'\\x'`, 'string:F"a"', "string:u'b'"]);
  const triple = tokenizePython('"""a\n# not a comment\n"""\nx');
  assert.equal(triple[0].kind, "string");
  assert.equal(triple[0].endLine, 3);
  assert.equal(triple.some((token) => token.kind === "comment"), false);
  // A backslash always swallows the next character, raw strings included.
  assert.equal(tokenizePython('r"\\"" + x')[0].text, 'r"\\""');
  const open = tokenizePython("s = 'abc\nt = 1");
  assert.equal(open[2].unterminated, true);
  assert.equal(open[2].text, "'abc");
  assert.equal(tokenizePython('"""never')[0].unterminated, true);
  // `print"x"` is a name and a string, not a prefixed string.
  assert.deepEqual(kinds('print"x"'), ["name:print", 'string:"x"']);
});

test("an f-string's replacement field may hold its own quotes (Python 3.12)", () => {
  const tokens = tokenizePython(`f"{d["k"]} and {'x'!r:>{w}}" + y`);
  assert.equal(tokens[0].kind, "string");
  assert.equal(tokens[0].text, `f"{d["k"]} and {'x'!r:>{w}}"`);
  assert.deepEqual(tokens.slice(1).map((token) => token.text), ["+", "y"]);
  // Doubled braces are literal text, not a field.
  assert.equal(tokenizePython(`f"{{not a field}}" x`)[0].text, `f"{{not a field}}"`);
});

test("positions are 1-based lines and columns, with an exclusive end column", () => {
  const [, , call] = tokenizePython("x = 1\n  qc.h(0)").filter((token) => token.kind !== "newline");
  assert.equal(call.text, "1");
  const qc = tokenizePython("x = 1\n  qc.h(0)").find((token) => token.text === "qc");
  assert.ok(qc);
  assert.deepEqual([qc.line, qc.col, qc.endLine, qc.endCol], [2, 3, 2, 5]);
});

test("a character Python refuses becomes an error token instead of throwing", () => {
  assert.deepEqual(kinds("a $ b"), ["name:a", "error:$", "name:b"]);
});

test("contextAt tells code from strings and comments", () => {
  const source = "x = 'ab' # note\ny = \"open";
  assert.equal(contextAt(source, 0).kind, "code");
  assert.equal(contextAt(source, 4).kind, "code"); // before the opening quote
  assert.equal(contextAt(source, 6).kind, "string"); // between a and b
  assert.equal(contextAt(source, 8).kind, "code"); // just after the closing quote
  assert.equal(contextAt(source, 12).kind, "comment");
  assert.equal(contextAt(source, 15).kind, "comment"); // end of the comment line
  // At the end of a string that was never closed, the reader is typing inside it.
  assert.equal(contextAt(source, source.length).kind, "string");
});
