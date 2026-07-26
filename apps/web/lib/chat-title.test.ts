import assert from "node:assert/strict";
import test from "node:test";
import { TITLE_MAX_CHARS, displayChatTitle, titleFromPrompt } from "./chat-title.ts";

test("a prompt-derived title is a title, not the prompt", () => {
  assert.equal(
    titleFromPrompt("Build a 2-qubit Bell state circuit in Qiskit and measure both qubits."),
    "Build a 2-qubit Bell state",
  );
});

test("only the first line is considered", () => {
  assert.equal(titleFromPrompt("QAOA on a ring\nand explain it"), "QAOA on a ring");
});

test("runs of whitespace collapse", () => {
  assert.equal(titleFromPrompt("  Bell   state    circuit  "), "Bell state circuit");
});

test("a Japanese prompt is bounded by characters and never rewritten", () => {
  // No spaces means the five-word cap cannot bound it. The character cap does,
  // and the text stays in the language the user wrote in.
  const title = titleFromPrompt("ベル".repeat(60));
  assert.equal(title.length, TITLE_MAX_CHARS);
  assert.ok(title.startsWith("ベル"));
});

test("an empty prompt yields an empty title rather than a stray ellipsis", () => {
  assert.equal(titleFromPrompt("   \n  "), "");
});

test("a user rename outranks the model's name", () => {
  assert.equal(
    displayChatTitle({ titleOverride: "My thesis run", modelTitle: "Bell state circuit" }),
    "My thesis run",
  );
});

test("the model's name outranks a title re-derived from the prompt", () => {
  // The exact regression this ordering exists for: a background refresh of the
  // run list rebuilds `title` from `task_prompt`, and without this it would win.
  assert.equal(
    displayChatTitle({
      modelTitle: "Bell state circuit",
      title: "Build a 2-qubit Bell state",
      prompt: "Build a 2-qubit Bell state circuit in Qiskit and measure both qubits.",
    }),
    "Bell state circuit",
  );
});

test("a blank override does not blank the row", () => {
  assert.equal(displayChatTitle({ titleOverride: "   ", modelTitle: "GHZ state" }), "GHZ state");
});

test("with nothing at all there is still something to click", () => {
  assert.equal(displayChatTitle({}), "Untitled conversation");
});
