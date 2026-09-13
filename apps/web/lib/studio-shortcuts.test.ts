import assert from "node:assert/strict";
import { test } from "node:test";

import { BUILDER_GATES } from "./studio-builder.ts";
import { gateShortcutKey, isTypingTarget, studioShortcut, type ShortcutContext } from "./studio-shortcuts.ts";

const visual: ShortcutContext = { panel: "visual", typing: false, visualShown: true };
const code: ShortcutContext = { panel: "code", typing: false, visualShown: false };

test("number keys switch tabs in the order the strip shows them", () => {
  assert.deepEqual(studioShortcut({ key: "1" }, code), { kind: "panel", panel: "code" });
  assert.deepEqual(studioShortcut({ key: "2" }, code), { kind: "panel", panel: "simulation" });
  assert.deepEqual(studioShortcut({ key: "3" }, code), { kind: "panel", panel: "visual" });
  assert.deepEqual(studioShortcut({ key: "4" }, code), { kind: "panel", panel: "summary" });
  assert.equal(studioShortcut({ key: "5" }, code), null);
});

test("nothing single-key fires while typing", () => {
  const typing = { ...visual, typing: true };
  for (const key of ["1", "h", "?", "\\", "[", "Backspace"]) assert.equal(studioShortcut({ key }, typing), null, key);
});

test("gate keys act only while the diagram is on screen", () => {
  assert.equal(studioShortcut({ key: "h" }, code), null);
  assert.deepEqual(studioShortcut({ key: "h" }, visual), { kind: "gate", gate: "H" });
  assert.deepEqual(studioShortcut({ key: "X", shiftKey: true }, visual), { kind: "gate", gate: "RX" });
  assert.deepEqual(studioShortcut({ key: "x" }, visual), { kind: "gate", gate: "X" });
  assert.deepEqual(studioShortcut({ key: "c" }, visual), { kind: "gate", gate: "CX" });
  assert.deepEqual(studioShortcut({ key: "C", shiftKey: true }, visual), { kind: "gate", gate: "CZ" });
  assert.deepEqual(studioShortcut({ key: "w" }, visual), { kind: "gate", gate: "SWAP" });
  assert.deepEqual(studioShortcut({ key: "m" }, visual), { kind: "gate", gate: "M" });
  assert.deepEqual(studioShortcut({ key: "]" }, visual), { kind: "step", delta: 1 });
  assert.deepEqual(studioShortcut({ key: "Delete" }, visual), { kind: "delete" });
});

test("modifier chords: run on Simulation, undo outside text fields", () => {
  assert.deepEqual(studioShortcut({ key: "Enter", metaKey: true }, { ...code, panel: "simulation" }), { kind: "run-cpu" });
  assert.equal(studioShortcut({ key: "Enter", metaKey: true }, code), null);
  assert.deepEqual(studioShortcut({ key: "z", ctrlKey: true }, visual), { kind: "undo" });
  assert.equal(studioShortcut({ key: "z", ctrlKey: true }, { ...visual, typing: true }), null);
  assert.equal(studioShortcut({ key: "z", metaKey: true, shiftKey: true }, visual), null);
  assert.equal(studioShortcut({ key: "h", altKey: true }, visual), null);
});

test("every palette gate has a key, and each key arms one gate", () => {
  const keys = BUILDER_GATES.map((gate) => gateShortcutKey(gate));
  assert.ok(keys.every(Boolean));
  assert.equal(new Set(keys).size, BUILDER_GATES.length);
});

test("isTypingTarget", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isTypingTarget({ tagName: "input", type: "number" }), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "range" }), false);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "radio" }), false);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
  assert.equal(isTypingTarget(null), false);
});
