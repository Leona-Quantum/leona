/**
 * A tolerant tokenizer for Python source, for the two things in the browser that need to
 * know where code stops and strings and comments start: the notebook linter
 * (`notebook-lint.ts`) and the code editor's typing rules (`code-editing.ts`).
 *
 * Tolerant is the point. A cell is tokenized on every debounced keystroke, which means it
 * is usually half-written: a string not yet closed, a bracket still open. Nothing here
 * throws. An unclosed string runs to the end of its line (or, for a triple-quoted one, to
 * the end of the cell) and is flagged `unterminated`; an open bracket simply keeps the
 * logical line going, exactly as Python's own tokenizer does, and a character Python would
 * refuse becomes an `error` token for the caller to decide about.
 *
 * What it tracks and Python's tokenizer also tracks: string prefixes (`r`, `b`, `f`, `t` and
 * their pairs), triple quotes, backslash escapes (a backslash always swallows the next
 * character, in raw strings too — that is why `r"\"` does not end), f-string replacement
 * fields with their own nested strings (Python 3.12 allows `f"{d["k"]}"`), line
 * continuations, and the rule that a newline inside brackets does not end a statement.
 * What it does not do: INDENT/DEDENT tokens. Neither caller needs block structure — the
 * linter reads name bindings in source order, which is block-independent — and computing
 * them would mean refusing inconsistent indentation, which is the one thing a tokenizer
 * run on every keystroke must not do.
 *
 * Columns are 1-based and counted in UTF-16 code units, which is what a textarea's
 * selection offsets count in. Python's own `col_offset` counts UTF-8 bytes; the two agree
 * on ASCII, and the shared lint cases compare lines, not columns.
 */

export type PyTokenKind = "name" | "number" | "string" | "op" | "comment" | "newline" | "error";

export interface PyToken {
  kind: PyTokenKind;
  text: string;
  /** Offset of the first character. */
  start: number;
  /** Offset just past the last character. */
  end: number;
  line: number;
  col: number;
  endLine: number;
  /** Column just past the last character (exclusive), the same convention as Python's
   * `end_col_offset + 1`. */
  endCol: number;
  /** A string the source never closed. */
  unterminated?: boolean;
}

/** Longest first, so `**=` is never read as `**` then `=`. */
const MULTI_CHAR_OPERATORS = [
  "**=", "//=", ">>=", "<<=", "...",
  "->", ":=", "**", "//", "<<", ">>", "<=", ">=", "==", "!=",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "@=",
];
const SINGLE_CHAR_OPERATORS = new Set("+-*/%@&|^~<>()[]{},:;.=!".split(""));
const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);

/** Every prefix Python accepts before a quote, case-insensitively: `rb`, `Fr` and so on.
 * `t` is Python 3.14's template string. A word that is not one of these (`print"x"`) is
 * a name followed by a string, which is what Python reads it as too. */
export const STRING_PREFIX = /^(?:[rubft]|br|rb|fr|rf|tr|rt)$/i;
const NUMBER = /(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?[jJ]?)/y;
const IDENT_START = /[\p{L}\p{Nl}_]/u;
const IDENT_PART = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]/u;

export function tokenizePython(source: string): PyToken[] {
  const n = source.length;
  const lineStarts = [0];
  for (let index = 0; index < n; index += 1) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }

  function lineOf(offset: number): number {
    // The last line start at or before `offset`, by binary search: a cell is small, but
    // this runs for every token of every cell on every debounced keystroke.
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  const tokens: PyToken[] = [];
  let depth = 0;

  function push(kind: PyTokenKind, start: number, end: number, unterminated = false) {
    const startLine = lineOf(start);
    // The END position is the character just past the token, which for a token that
    // finishes a line is the newline's own offset — still on the token's last line.
    const endLine = end > start ? lineOf(end - 1) : startLine;
    const token: PyToken = {
      kind,
      text: source.slice(start, end),
      start,
      end,
      line: startLine + 1,
      col: start - lineStarts[startLine] + 1,
      endLine: endLine + 1,
      endCol: end - lineStarts[endLine] + 1,
    };
    if (unterminated) token.unterminated = true;
    tokens.push(token);
  }

  function lastSignificant(): PyToken | undefined {
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      if (tokens[index].kind !== "comment") return tokens[index];
    }
    return undefined;
  }

  /** From the opening quote at `quoteAt`; returns where the string ends. */
  function scanString(quoteAt: number, prefix: string): { end: number; unterminated: boolean } {
    const quote = source[quoteAt];
    const triple = source.startsWith(quote.repeat(3), quoteAt);
    const formatted = /[ft]/i.test(prefix);
    let cursor = quoteAt + (triple ? 3 : 1);
    // Depth inside an f-string replacement field. Inside one the text is CODE again —
    // brackets, and strings of their own — until the matching `}`.
    let field = 0;
    while (cursor < n) {
      const char = source[cursor];
      if (field > 0) {
        if (char === "'" || char === '"') {
          const inner = scanString(cursor, "");
          if (inner.unterminated) return inner;
          cursor = inner.end;
          continue;
        }
        if (char === "{") field += 1;
        else if (char === "}") field -= 1;
        cursor += 1;
        continue;
      }
      if (char === "\\") {
        cursor += 2;
        continue;
      }
      if (formatted && char === "{") {
        if (source[cursor + 1] === "{") {
          cursor += 2;
          continue;
        }
        field = 1;
        cursor += 1;
        continue;
      }
      if (triple) {
        if (source.startsWith(quote.repeat(3), cursor)) return { end: cursor + 3, unterminated: false };
        cursor += 1;
        continue;
      }
      if (char === quote) return { end: cursor + 1, unterminated: false };
      if (char === "\n") return { end: cursor, unterminated: true };
      cursor += 1;
    }
    return { end: n, unterminated: true };
  }

  let index = 0;
  while (index < n) {
    const char = source[index];
    if (char === " " || char === "\t" || char === "\f" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\\" && (source[index + 1] === "\n" || (source[index + 1] === "\r" && source[index + 2] === "\n"))) {
      index += source[index + 1] === "\r" ? 3 : 2;
      continue;
    }
    if (char === "\n") {
      // A statement ends at a newline only outside brackets, and only once it has
      // started: blank and comment-only lines produce no NEWLINE, as in Python.
      const previous = lastSignificant();
      if (depth === 0 && previous && previous.kind !== "newline") push("newline", index, index + 1);
      index += 1;
      continue;
    }
    if (char === "#") {
      let end = index;
      while (end < n && source[end] !== "\n") end += 1;
      push("comment", index, end);
      index = end;
      continue;
    }
    if (IDENT_START.test(char)) {
      let end = index + 1;
      while (end < n && IDENT_PART.test(source[end])) end += 1;
      const word = source.slice(index, end);
      if ((source[end] === '"' || source[end] === "'") && STRING_PREFIX.test(word)) {
        const scanned = scanString(end, word);
        push("string", index, scanned.end, scanned.unterminated);
        index = scanned.end;
        continue;
      }
      push("name", index, end);
      index = end;
      continue;
    }
    if (char === '"' || char === "'") {
      const scanned = scanString(index, "");
      push("string", index, scanned.end, scanned.unterminated);
      index = scanned.end;
      continue;
    }
    if (/\d/.test(char) || (char === "." && /\d/.test(source[index + 1] ?? ""))) {
      NUMBER.lastIndex = index;
      const match = NUMBER.exec(source);
      const end = match && match[0].length > 0 ? index + match[0].length : index + 1;
      push("number", index, end);
      index = end;
      continue;
    }
    const operator = MULTI_CHAR_OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      push("op", index, index + operator.length);
      index += operator.length;
      continue;
    }
    if (SINGLE_CHAR_OPERATORS.has(char)) {
      if (OPENERS.has(char)) depth += 1;
      else if (CLOSERS.has(char)) depth = Math.max(0, depth - 1);
      push("op", index, index + 1);
      index += 1;
      continue;
    }
    push("error", index, index + 1);
    index += 1;
  }
  return tokens;
}

/** What the caret is inside of: code, a string, or a comment. */
export type SourceContext =
  | { kind: "code" }
  | { kind: "comment" }
  | { kind: "string"; token: PyToken };

/**
 * Where `offset` sits, for the editor's typing rules: a quote typed inside a string or a
 * comment is text, not the start of a pair.
 *
 * The caret is INSIDE a string strictly between its first and last character, and also at
 * its very end when the string was never closed (that is where the reader is typing). It
 * is inside a comment anywhere after the `#`, including the end of the line.
 */
export function contextAt(source: string, offset: number): SourceContext {
  for (const token of tokenizePython(source)) {
    if (token.start >= offset) break;
    if (token.kind === "string" && (offset < token.end || (offset === token.end && token.unterminated))) {
      return { kind: "string", token };
    }
    if (token.kind === "comment" && offset <= token.end) return { kind: "comment" };
  }
  return { kind: "code" };
}
