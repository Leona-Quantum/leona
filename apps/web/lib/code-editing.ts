/**
 * The code editor's typing rules, as pure functions of text and selection.
 *
 * `components/notebook-code-editor.tsx` is a `<textarea>` over a highlighted copy of its
 * own text, and every keystroke it treats specially — Tab, Shift+Tab, Enter, Backspace,
 * brackets, quotes, Cmd/Ctrl+/ — comes through here as `(value, selection) -> (value,
 * selection)`. Nothing here touches the DOM, so each rule is tested on its own and the
 * component only has to apply the result.
 *
 * Every rule that could guess wrong declines instead: they return `null` (or the state
 * unchanged) and the browser's own behaviour takes the keystroke. A bracket is only closed
 * automatically when the next character leaves room for it, a quote only outside strings
 * and comments and not after a letter (so `don't` in a string, and `x'` anywhere, stay
 * literal), and a closer is only stepped over when there is an opener for it to close.
 * An editor that inserts a character the reader did not type is worse than one that
 * inserts nothing.
 */
import { contextAt, STRING_PREFIX, tokenizePython } from "./python-tokens.ts";

export interface TextState {
  value: string;
  start: number;
  end: number;
}

/** Four spaces: PEP 8, and what every notebook Nala writes uses. */
export const INDENT_UNIT = "    ";
const TAB_WIDTH = INDENT_UNIT.length;

const CLOSER_OF: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const OPENER_OF: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };

function isOpener(char: string | undefined): char is "(" | "[" | "{" {
  return char === "(" || char === "[" || char === "{";
}

function isCloser(char: string | undefined): char is ")" | "]" | "}" {
  return char === ")" || char === "]" || char === "}";
}

function isQuote(char: string | undefined): char is '"' | "'" {
  return char === '"' || char === "'";
}

export function lineStart(value: string, offset: number): number {
  return value.lastIndexOf("\n", offset - 1) + 1;
}

export function lineEnd(value: string, offset: number): number {
  const index = value.indexOf("\n", offset);
  return index === -1 ? value.length : index;
}

/** Start offsets of every line a selection touches. A selection that ends at the very
 * start of a line does not touch it: dragging from line 1 to the start of line 4 selects
 * three lines, and indenting four would surprise everyone. */
function touchedLineStarts({ value, start, end }: TextState): number[] {
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const starts: number[] = [];
  let cursor = lineStart(value, start);
  for (;;) {
    starts.push(cursor);
    const next = value.indexOf("\n", cursor);
    if (next === -1 || next >= last) break;
    cursor = next + 1;
  }
  return starts;
}

interface Change {
  at: number;
  remove: number;
  insert: string;
}

/** Where `position` lands after `changes`. At an insertion point, `before` keeps it in
 * front of the inserted text and `after` moves it past. */
function mapPosition(position: number, changes: readonly Change[], bias: "before" | "after"): number {
  let shift = 0;
  for (const change of changes) {
    const removedEnd = change.at + change.remove;
    const atInsertion = change.remove === 0 && position === change.at;
    if (position < change.at || (atInsertion && bias === "before")) break;
    if (position >= removedEnd) {
      shift += change.insert.length - change.remove;
      continue;
    }
    // Inside a removed range: collapse to where it was.
    return change.at + shift + (bias === "after" ? change.insert.length : 0);
  }
  return position + shift;
}

/** Apply non-overlapping `changes` (in ascending order) and carry the selection through. */
function applyChanges(state: TextState, changes: readonly Change[]): TextState {
  if (changes.length === 0) return state;
  let value = "";
  let cursor = 0;
  for (const change of changes) {
    value += state.value.slice(cursor, change.at) + change.insert;
    cursor = change.at + change.remove;
  }
  value += state.value.slice(cursor);
  const collapsed = state.start === state.end;
  const start = mapPosition(state.start, changes, collapsed ? "after" : "before");
  const end = collapsed ? start : mapPosition(state.end, changes, "after");
  return { value, start, end };
}

function replaceSelection(state: TextState, text: string, caretInText = text.length): TextState {
  const value = state.value.slice(0, state.start) + text + state.value.slice(state.end);
  const caret = state.start + caretInText;
  return { value, start: caret, end: caret };
}

function leadingWhitespace(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? "";
}

/**
 * Tab. With a caret, spaces to the next tab stop, so a column of `=` signs lines up; with
 * a selection, every touched line that has something on it moves one level right (blank
 * lines are left alone rather than filled with trailing spaces).
 */
export function indent(state: TextState): TextState {
  if (state.start === state.end) {
    const column = state.start - lineStart(state.value, state.start);
    return replaceSelection(state, " ".repeat(TAB_WIDTH - (column % TAB_WIDTH)));
  }
  const changes = touchedLineStarts(state)
    .filter((at) => state.value.slice(at, lineEnd(state.value, at)).trim() !== "")
    .map((at) => ({ at, remove: 0, insert: INDENT_UNIT }));
  return applyChanges(state, changes);
}

/** Shift+Tab: every touched line back to the previous tab stop (six spaces become four,
 * four become none), or one tab removed. Lines already at the margin are untouched. */
export function dedent(state: TextState): TextState {
  const changes: Change[] = [];
  for (const at of touchedLineStarts(state)) {
    const line = state.value.slice(at, lineEnd(state.value, at));
    if (line.startsWith("\t")) {
      changes.push({ at, remove: 1, insert: "" });
      continue;
    }
    const spaces = /^ */.exec(line)?.[0].length ?? 0;
    if (spaces === 0) continue;
    changes.push({ at, remove: Math.min(spaces, spaces % TAB_WIDTH || TAB_WIDTH), insert: "" });
  }
  return applyChanges(state, changes);
}

/**
 * Enter. The new line keeps the current line's indentation, and gains one level after a
 * line whose code ends in `:` (a block opens) or in an open bracket (a call or literal
 * continues). Between a bracket pair the closer drops to its own line at the original
 * indentation, so `f(|)` becomes a three-line call with the caret on the middle line.
 *
 * Inside a string only the indentation is kept: a `:` in a docstring opens nothing.
 */
export function newline(state: TextState): TextState {
  const { value, start, end } = state;
  const before = value.slice(lineStart(value, start), start);
  const base = leadingWhitespace(before);
  let indentation = base;
  let tail = "";
  // A caret at the end of a comment still follows the code before the comment
  // (`if ok:  # start` opens a block); only a string turns the rule off.
  if (contextAt(value, start).kind !== "string") {
    const significant = tokenizePython(before).filter((token) => token.kind !== "comment" && token.kind !== "newline");
    const last = significant[significant.length - 1];
    if (last && last.kind === "op" && (last.text === ":" || isOpener(last.text))) indentation += INDENT_UNIT;
    const previous = value[start - 1];
    if (start === end && isOpener(previous) && value[end] === CLOSER_OF[previous]) tail = `\n${base}`;
  }
  const inserted = `\n${indentation}`;
  return replaceSelection(state, inserted + tail, inserted.length);
}

/**
 * Cmd/Ctrl+/. If every non-blank touched line is already a comment, uncomment them all;
 * otherwise comment them all, with `# ` at the shallowest indentation so the block keeps
 * its shape. Mixed selections comment, as every editor does: the reader asked to comment
 * something, and toggling lines one by one would leave the block half and half.
 */
export function toggleComment(state: TextState): TextState {
  const lines = touchedLineStarts(state)
    .map((at) => ({ at, text: state.value.slice(at, lineEnd(state.value, at)) }))
    .filter((line) => line.text.trim() !== "");
  if (lines.length === 0) return state;
  const commented = lines.every((line) => line.text.trimStart().startsWith("#"));
  if (commented) {
    return applyChanges(
      state,
      lines.map((line) => {
        const lead = leadingWhitespace(line.text).length;
        return { at: line.at + lead, remove: line.text.startsWith("# ", lead) ? 2 : 1, insert: "" };
      }),
    );
  }
  const column = Math.min(...lines.map((line) => leadingWhitespace(line.text).length));
  return applyChanges(
    state,
    lines.map((line) => ({ at: line.at + column, remove: 0, insert: "# " })),
  );
}

/** Whether the character after the caret leaves room for a pair to open: nothing,
 * whitespace, or something that ends an expression. Before a letter or a digit, `(`
 * is almost always the start of `(x` being typed in front of existing text. */
function roomAfter(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char) || ")]},:;".includes(char);
}

/**
 * A typed bracket or quote, when there is exactly one sensible thing to do with it; `null`
 * means "let the browser type it". Only ever acts on a caret, never on a selection: a
 * reader who selects a word and types `(` means to replace it, as in a plain field.
 */
export function typeCharacter(state: TextState, char: string): TextState | null {
  const { value, start, end } = state;
  if (start !== end) return null;
  const next = value[start];
  const context = contextAt(value, start);

  if (isOpener(char)) {
    if (context.kind !== "code" || !roomAfter(next)) return null;
    return replaceSelection(state, char + CLOSER_OF[char], 1);
  }

  if (isCloser(char)) {
    if (context.kind !== "code" || next !== char) return null;
    // Step over the closer only when some opener is waiting for it. With the brackets
    // already balanced-or-worse, the reader is typing a closer that does not exist yet.
    let open = 0;
    for (const token of tokenizePython(value)) {
      if (token.kind !== "op") continue;
      if (token.text === OPENER_OF[char]) open += 1;
      else if (token.text === char) open -= 1;
    }
    if (open < 0) return null;
    return { value, start: start + 1, end: start + 1 };
  }

  if (isQuote(char)) {
    if (context.kind === "comment") return null;
    if (context.kind === "string") {
      // The closing quote of the string the caret is in: step over it.
      const { token } = context;
      if (next === char && !token.unterminated && token.end === start + 1) return { value, start: start + 1, end: start + 1 };
      return null;
    }
    const before = value.slice(lineStart(value, start), start);
    // `""` then a third quote is a docstring opening: close it as one.
    if (before.endsWith(char + char) && next !== char) return replaceSelection(state, char.repeat(4), 1);
    if (!roomAfter(next)) return null;
    const previous = value[start - 1];
    if (isQuote(previous)) return null;
    if (previous !== undefined && /[\p{L}\p{N}_]/u.test(previous)) {
      // After a word, a quote opens a string only when the word is a string prefix
      // (`f"`, `rb'`) standing on its own; anything else (`don't`, `x'`) is left literal.
      const word = /[\p{L}\p{N}_]+$/u.exec(before)?.[0] ?? "";
      const beforeWord = before.slice(0, before.length - word.length);
      if (!STRING_PREFIX.test(word) || /[\p{L}\p{N}_.]$/u.test(beforeWord)) return null;
    }
    return replaceSelection(state, char + char, 1);
  }

  return null;
}

/**
 * Backspace, when it should remove more than one character; `null` otherwise. Two cases:
 * an empty pair around the caret (`(|)`, `"|"`) goes as a pair, and a caret in the
 * leading indentation steps back to the previous tab stop, so one press undoes one Tab.
 */
export function deleteBackward(state: TextState): TextState | null {
  const { value, start, end } = state;
  if (start !== end || start === 0) return null;
  const previous = value[start - 1];
  const next = value[start];
  const context = contextAt(value, start);
  if (isOpener(previous) && next === CLOSER_OF[previous] && context.kind === "code") {
    return { value: value.slice(0, start - 1) + value.slice(start + 1), start: start - 1, end: start - 1 };
  }
  if (isQuote(previous) && next === previous && context.kind === "string") {
    // Only an EMPTY string: the pair must be the whole token, not the end of one string
    // and the start of the next.
    if (context.token.start === start - 1 && context.token.end === start + 1) {
      return { value: value.slice(0, start - 1) + value.slice(start + 1), start: start - 1, end: start - 1 };
    }
    return null;
  }
  const before = value.slice(lineStart(value, start), start);
  if (before.length > 0 && /^ +$/.test(before)) {
    const remove = before.length % TAB_WIDTH || TAB_WIDTH;
    if (remove > 1) {
      return { value: value.slice(0, start - remove) + value.slice(start), start: start - remove, end: start - remove };
    }
  }
  return null;
}

// ------------------------------------------------------------------ diagnostics layer

export interface MarkRange {
  line: number;
  col: number;
  endLine?: number | null;
  /** Exclusive. */
  endCol?: number | null;
  severity: "error" | "warning";
}

export interface MarkedSegment {
  text: string;
  severity: "error" | "warning" | null;
}

/**
 * The source split into lines, each line into runs of unmarked and marked text, for the
 * underline layer under the textarea. The concatenated `text` of every line is exactly
 * that line: the layer must lay out character-for-character like the textarea above it,
 * or the underline sits under the wrong code.
 *
 * A range with no end (or an empty one) runs to the end of its line, so a finding is never
 * invisible; where an error and a warning overlap, the error wins.
 */
export function markedLines(source: string, marks: readonly MarkRange[]): MarkedSegment[][] {
  const lines = source.split("\n");
  const levels = lines.map((line) => new Uint8Array(line.length));
  for (const mark of marks) {
    const level = mark.severity === "error" ? 2 : 1;
    const lastLine = Math.max(mark.line, mark.endLine ?? mark.line);
    for (let number = mark.line; number <= lastLine; number += 1) {
      const text = lines[number - 1];
      if (text === undefined) break;
      let from = number === mark.line ? mark.col - 1 : text.length - text.trimStart().length;
      let to = number === lastLine && mark.endCol != null ? mark.endCol - 1 : text.length;
      from = Math.max(0, Math.min(from, text.length));
      to = Math.max(0, Math.min(to, text.length));
      if (to <= from) to = text.length;
      for (let index = from; index < to; index += 1) {
        if (levels[number - 1][index] < level) levels[number - 1][index] = level;
      }
    }
  }
  return lines.map((text, lineIndex) => {
    const segments: MarkedSegment[] = [];
    const level = levels[lineIndex];
    let runStart = 0;
    for (let index = 1; index <= text.length; index += 1) {
      if (index === text.length || level[index] !== level[runStart]) {
        const code = level[runStart];
        segments.push({ text: text.slice(runStart, index), severity: code === 2 ? "error" : code === 1 ? "warning" : null });
        runStart = index;
      }
    }
    return segments;
  });
}

/** The offset of a 1-based line and column, clamped into the text. */
export function offsetOf(value: string, line: number, col: number): number {
  let at = 0;
  for (let current = 1; current < line; current += 1) {
    const next = value.indexOf("\n", at);
    if (next === -1) return value.length;
    at = next + 1;
  }
  return Math.min(at + Math.max(0, col - 1), lineEnd(value, at));
}

/** The 1-based line an offset is on. */
export function lineAt(value: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < value.length; index += 1) {
    if (value[index] === "\n") line += 1;
  }
  return line;
}
