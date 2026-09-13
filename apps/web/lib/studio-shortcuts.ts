import type { BuiltinBuilderGate } from "./studio-builder.ts";
import { STUDIO_PANELS, type StudioPanel } from "./studio-panels.ts";

/**
 * Studio's keyboard map, as a pure function of the key and where focus is.
 *
 * Single keys never fire while the person is typing — a title, the code editor,
 * a Qapp prompt, the shots field — because "h" in a textarea is a letter, not a
 * Hadamard. Modifier chords are the only exception, and only the two that mean
 * nothing inside a text field here.
 *
 * The sheet (`?`) renders from `STUDIO_SHORTCUT_ROWS`, so what it lists and what
 * this function does are one table, not two that can drift.
 */

export type StudioShortcut =
  | { kind: "panel"; panel: StudioPanel }
  | { kind: "sheet" }
  | { kind: "split" }
  | { kind: "gate"; gate: BuiltinBuilderGate }
  | { kind: "undo" }
  | { kind: "delete" }
  | { kind: "step"; delta: -1 | 1 }
  | { kind: "run-cpu" };

export type ShortcutKey = {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

export type ShortcutContext = {
  panel: StudioPanel;
  /** Focus is in a field that takes text. */
  typing: boolean;
  /** The circuit diagram is on screen (Visual tab, or the split view). */
  visualShown: boolean;
};

const GATE_KEYS: Record<string, { plain: BuiltinBuilderGate; shifted?: BuiltinBuilderGate }> = {
  h: { plain: "H" },
  x: { plain: "X", shifted: "RX" },
  y: { plain: "Y", shifted: "RY" },
  z: { plain: "Z", shifted: "RZ" },
  s: { plain: "S" },
  t: { plain: "T" },
  c: { plain: "CX", shifted: "CZ" },
  w: { plain: "SWAP" },
  m: { plain: "M" },
};

export function studioShortcut(event: ShortcutKey, context: ShortcutContext): StudioShortcut | null {
  if (event.altKey) return null;
  if (event.metaKey || event.ctrlKey) {
    if (event.key === "Enter" && context.panel === "simulation") return { kind: "run-cpu" };
    if (event.key.toLowerCase() === "z" && !event.shiftKey && !context.typing && context.visualShown) return { kind: "undo" };
    return null;
  }
  if (context.typing) return null;
  const { key } = event;
  if (key === "?") return { kind: "sheet" };
  if (/^[1-9]$/.test(key)) {
    const panel = STUDIO_PANELS[Number(key) - 1];
    return panel ? { kind: "panel", panel } : null;
  }
  if (key === "\\") return { kind: "split" };
  if (!context.visualShown) return null;
  if (key === "[") return { kind: "step", delta: -1 };
  if (key === "]") return { kind: "step", delta: 1 };
  if (key === "Backspace" || key === "Delete") return { kind: "delete" };
  const gate = GATE_KEYS[key.toLowerCase()];
  if (!gate) return null;
  return { kind: "gate", gate: event.shiftKey && gate.shifted ? gate.shifted : gate.plain };
}

/** True when a key press on this target is text entry rather than a command. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown; type?: unknown };
  if (element.isContentEditable === true) return true;
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = typeof element.type === "string" ? element.type.toLowerCase() : "text";
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
}

export type ShortcutRowId =
  | "tabs" | "split" | "sheet" | "escape"
  | "oneQubit" | "rotations" | "twoQubit" | "measure" | "undo" | "delete" | "step"
  | "runCpu";

export type ShortcutRow = { id: ShortcutRowId; group: "general" | "visual" | "simulation"; keys: string[] };

/** What the sheet lists. Every chord here is one `studioShortcut` returns. */
export const STUDIO_SHORTCUT_ROWS: readonly ShortcutRow[] = [
  { id: "tabs", group: "general", keys: ["1", "2", "3", "4"] },
  { id: "split", group: "general", keys: ["\\"] },
  { id: "sheet", group: "general", keys: ["?"] },
  { id: "escape", group: "general", keys: ["Esc"] },
  { id: "oneQubit", group: "visual", keys: ["H", "X", "Y", "Z", "S", "T"] },
  { id: "rotations", group: "visual", keys: ["⇧X", "⇧Y", "⇧Z"] },
  { id: "twoQubit", group: "visual", keys: ["C", "⇧C", "W"] },
  { id: "measure", group: "visual", keys: ["M"] },
  { id: "undo", group: "visual", keys: ["⌘Z"] },
  { id: "delete", group: "visual", keys: ["⌫"] },
  { id: "step", group: "visual", keys: ["[", "]"] },
  { id: "runCpu", group: "simulation", keys: ["⌘↵"] },
];

/** The key that arms a gate, for a palette tooltip and `aria-keyshortcuts`. */
export function gateShortcutKey(gate: BuiltinBuilderGate): string | null {
  for (const [key, entry] of Object.entries(GATE_KEYS)) {
    if (entry.plain === gate) return key.toUpperCase();
    if (entry.shifted === gate) return `Shift+${key.toUpperCase()}`;
  }
  return null;
}
