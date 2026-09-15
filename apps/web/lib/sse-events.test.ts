import assert from "node:assert/strict";
import test from "node:test";

import { parseSseBlock, splitSseBuffer } from "./sse-events.ts";

test("parseSseBlock reads a single data line and a numeric id", () => {
  assert.deepEqual(parseSseBlock('id: 7\ndata: {"type":"chat.delta"}'), { id: 7, data: '{"type":"chat.delta"}' });
});

test("parseSseBlock joins multiple data: lines with a newline", () => {
  assert.deepEqual(parseSseBlock("data: line one\ndata: line two"), { id: null, data: "line one\nline two" });
});

test("parseSseBlock returns null for a comment-only block", () => {
  assert.equal(parseSseBlock(": keep-alive"), null);
});

test("parseSseBlock returns null when there is no data: line", () => {
  assert.equal(parseSseBlock("id: 3"), null);
  assert.equal(parseSseBlock(""), null);
});

test("parseSseBlock treats a non-numeric id as absent, not a parse failure", () => {
  assert.deepEqual(parseSseBlock("id: not-a-number\ndata: x"), { id: null, data: "x" });
});

test("splitSseBuffer returns complete blocks and holds back an incomplete tail", () => {
  const { blocks, remainder } = splitSseBuffer("data: a\n\ndata: b\n\ndata: c (incompl");
  assert.deepEqual(blocks, ["data: a", "data: b"]);
  assert.equal(remainder, "data: c (incompl");
});

test("splitSseBuffer normalizes CRLF before splitting on the blank line", () => {
  const { blocks, remainder } = splitSseBuffer("data: a\r\n\r\ndata: b");
  assert.deepEqual(blocks, ["data: a"]);
  assert.equal(remainder, "data: b");
});

test("splitSseBuffer on an empty buffer returns no blocks and an empty remainder", () => {
  assert.deepEqual(splitSseBuffer(""), { blocks: [], remainder: "" });
});
