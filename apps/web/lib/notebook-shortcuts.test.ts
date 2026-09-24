import assert from "node:assert/strict";
import test from "node:test";

import { COMMAND_MODE_IDLE, commandModeKey, type CommandKey, type CommandModeState } from "./notebook-shortcuts.ts";

const onCell = { onCell: true };

function command(key: CommandKey, state: CommandModeState = COMMAND_MODE_IDLE) {
  return commandModeKey(state, key, onCell).command;
}

test("single keys map to Jupyter's command-mode commands", () => {
  assert.deepEqual(command({ key: "Enter" }), { kind: "edit" });
  assert.deepEqual(command({ key: "Enter", shiftKey: true }), { kind: "run-and-advance" });
  assert.deepEqual(command({ key: "a" }), { kind: "insert", where: "above" });
  assert.deepEqual(command({ key: "b" }), { kind: "insert", where: "below" });
  assert.deepEqual(command({ key: "m" }), { kind: "convert", to: "markdown" });
  assert.deepEqual(command({ key: "y" }), { kind: "convert", to: "code" });
  assert.deepEqual(command({ key: "j" }), { kind: "select", delta: 1 });
  assert.deepEqual(command({ key: "ArrowDown" }), { kind: "select", delta: 1 });
  assert.deepEqual(command({ key: "k" }), { kind: "select", delta: -1 });
  assert.deepEqual(command({ key: "ArrowUp" }), { kind: "select", delta: -1 });
  assert.deepEqual(command({ key: "z" }), { kind: "undo" });
  // Caps lock gives "A" with no Shift; that is still A.
  assert.deepEqual(command({ key: "A" }), { kind: "insert", where: "above" });
});

test("D deletes only on the second press in a row", () => {
  const first = commandModeKey(COMMAND_MODE_IDLE, { key: "d" }, onCell);
  assert.equal(first.command, null);
  assert.equal(first.state.pendingDelete, true);
  assert.deepEqual(commandModeKey(first.state, { key: "d" }, onCell).command, { kind: "delete" });
  // Anything in between cancels it.
  const interrupted = commandModeKey(first.state, { key: "j" }, onCell);
  assert.equal(interrupted.state.pendingDelete, false);
  assert.equal(commandModeKey(interrupted.state, { key: "d" }, onCell).command, null);
  // Holding D down sends repeats, which must not count as the second press.
  const held = commandModeKey(first.state, { key: "d", repeat: true }, onCell);
  assert.equal(held.command, null);
  assert.equal(held.state.pendingDelete, true);
});

test("nothing fires unless the cell card itself has focus", () => {
  for (const key of ["Enter", "a", "b", "d", "m", "y", "j", "k", "z", "ArrowDown"]) {
    const result = commandModeKey({ pendingDelete: true }, { key }, { onCell: false });
    assert.equal(result.command, null, key);
    assert.equal(result.state.pendingDelete, false, key);
  }
  assert.equal(commandModeKey(COMMAND_MODE_IDLE, { key: "s", metaKey: true }, { onCell: false }).command, null);
});

test("the notebook takes Cmd/Ctrl+S and Cmd/Ctrl+Enter, and leaves every other chord to the browser", () => {
  assert.deepEqual(command({ key: "s", metaKey: true }), { kind: "save" });
  assert.deepEqual(command({ key: "s", ctrlKey: true }), { kind: "save" });
  assert.deepEqual(command({ key: "Enter", ctrlKey: true }), { kind: "run" });
  for (const key of ["c", "v", "f", "r", "l", "t", "w", "z", "a"]) {
    assert.equal(command({ key, metaKey: true }), null, `Cmd+${key}`);
    assert.equal(command({ key, ctrlKey: true }), null, `Ctrl+${key}`);
  }
  assert.equal(command({ key: "S", metaKey: true, shiftKey: true }), null);
  assert.equal(command({ key: "a", altKey: true }), null);
  assert.equal(command({ key: "A", shiftKey: true }), null);
  assert.equal(command({ key: "Tab" }), null);
  assert.equal(command({ key: " " }), null);
  assert.equal(command({ key: "Escape" }), null);
});

test("keys belonging to an IME composition are never commands", () => {
  assert.equal(command({ key: "Enter", isComposing: true }), null);
  assert.equal(command({ key: "a", isComposing: true }), null);
});
