/**
 * Jupyter's command mode for the notebook editor, as a pure reducer.
 *
 * Command mode is "a cell is selected and nobody is typing": the cell's card itself has
 * focus (Esc from a cell's code puts it there, and so does a click on the card). Only
 * then do single keys mean commands — Enter edits, A/B insert, D D deletes, M/Y convert,
 * J/K or the arrows move, Shift+Enter runs and advances, Z undoes the last change to the
 * list of cells. Focus in any field, button, select or link inside the card is NOT
 * command mode (`onCell: false`), so an `a` typed into a textarea is a letter, and Enter
 * on a button presses the button.
 *
 * Chords are taken only where the notebook owns the meaning: Cmd/Ctrl+S (save the
 * notebook, which is what the reader means on this page) and Cmd/Ctrl+Enter (run). Every
 * other chord — copy, paste, find, reload, tab switching — and anything with Alt is left
 * to the browser, which is why this returns `null` for them rather than swallowing them.
 */

export type NotebookCommand =
  | { kind: "edit" }
  | { kind: "insert"; where: "above" | "below" }
  | { kind: "delete" }
  | { kind: "convert"; to: "markdown" | "code" }
  | { kind: "select"; delta: -1 | 1 }
  | { kind: "run" }
  | { kind: "run-and-advance" }
  | { kind: "undo" }
  | { kind: "save" };

export interface CommandModeState {
  /** The first D of D D has been pressed, and nothing else since. */
  pendingDelete: boolean;
}

export const COMMAND_MODE_IDLE: CommandModeState = { pendingDelete: false };

export interface CommandKey {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** A key held down: auto-repeat must never turn one D into D D. */
  repeat?: boolean;
  /** An IME composition in progress (Japanese input): its keys are the IME's. */
  isComposing?: boolean;
}

export interface CommandContext {
  /** Focus is on a cell's card itself, not on anything inside it. */
  onCell: boolean;
}

export function commandModeKey(
  state: CommandModeState,
  event: CommandKey,
  context: CommandContext,
): { state: CommandModeState; command: NotebookCommand | null } {
  const none = { state: COMMAND_MODE_IDLE, command: null };
  if (!context.onCell || event.isComposing || event.altKey) return none;
  if (event.metaKey || event.ctrlKey) {
    if (!event.shiftKey && event.key.toLowerCase() === "s") return { state: COMMAND_MODE_IDLE, command: { kind: "save" } };
    if (event.key === "Enter") return { state: COMMAND_MODE_IDLE, command: { kind: "run" } };
    return none;
  }
  if (event.key === "Enter") {
    return { state: COMMAND_MODE_IDLE, command: event.shiftKey ? { kind: "run-and-advance" } : { kind: "edit" } };
  }
  if (event.shiftKey) return none;
  const command = (value: NotebookCommand) => ({ state: COMMAND_MODE_IDLE, command: value });
  switch (event.key === "ArrowDown" || event.key === "ArrowUp" ? event.key : event.key.toLowerCase()) {
    case "ArrowDown":
    case "j":
      return command({ kind: "select", delta: 1 });
    case "ArrowUp":
    case "k":
      return command({ kind: "select", delta: -1 });
    case "a":
      return command({ kind: "insert", where: "above" });
    case "b":
      return command({ kind: "insert", where: "below" });
    case "m":
      return command({ kind: "convert", to: "markdown" });
    case "y":
      return command({ kind: "convert", to: "code" });
    case "z":
      return command({ kind: "undo" });
    case "d":
      if (event.repeat) return { state, command: null };
      return state.pendingDelete ? command({ kind: "delete" }) : { state: { pendingDelete: true }, command: null };
    default:
      return none;
  }
}
