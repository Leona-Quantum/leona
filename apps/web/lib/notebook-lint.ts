/**
 * The browser's copy of the notebook linter: mistakes in a code cell that are certain to
 * break, named at the line where they were made, while the reader is still typing.
 *
 * The rules are `leona_notebooks.lint` (`packages/py/notebooks/src/leona_notebooks/lint.py`),
 * and that module's docstring is the authority on what they are and are not. In one line:
 * each rule keys on a syntactic shape plus a little name tracking (which names hold a
 * `QuantumCircuit`, and which of those have been measured), in source order, across the
 * code cells before this one — and a name the tracking cannot follow is simply not checked.
 * A missed mistake costs one sandbox run; a false alarm on correct code teaches the reader to
 * ignore the flags. This file keeps that trade.
 *
 * Both implementations are tested against `packages/py/notebooks/tests/data/lint-cases.json`
 * (`lib/notebook-lint.test.ts` reads it from its repo path), so neither can grow a rule the
 * other lacks. Two rules are Python-only and deliberately absent here, marked `python_only`
 * in that file:
 *
 * - `forbidden-import` needs the sandbox guard's own import list, which is Python code the
 *   browser does not have. Restating the list here would be a second copy to drift.
 * - `syntax-error` needs a real Python parser. The one below is deliberately partial (see
 *   `parseLogicalLine`), so "my parser gave up" is not evidence that Python would, and
 *   reporting it as a syntax error would be exactly the false alarm this module refuses.
 *
 * Where the browser has to differ from Python it differs in the safe direction. Python
 * lints nothing in a cell that does not parse; the browser cannot know whether Python would
 * parse it, so it skips just the statement it could not read and FORGETS every name that
 * statement mentions (it might have rebound one). Stale knowledge is the only way this
 * design could raise a false alarm, and forgetting cannot.
 */
import { tokenizePython, type PyToken } from "./python-tokens.ts";

export type LintCode =
  | "gate-returns-instructions"
  | "removed-qiskit-api"
  | "measured-circuit-has-no-statevector"
  | "forbidden-import"
  | "syntax-error";

export type LintSeverity = "error" | "warning";

/** Mirrors `_SEVERITY` in lint.py, and the `codes` table of the shared case file (a test
 * asserts all three agree). The last two codes are never produced in the browser. */
export const LINT_SEVERITY: Record<LintCode, LintSeverity> = {
  "gate-returns-instructions": "warning",
  "removed-qiskit-api": "error",
  "measured-circuit-has-no-statevector": "error",
  "forbidden-import": "error",
  "syntax-error": "error",
};

/** Which removed API a `removed-qiskit-api` finding is about, so its message can say what
 * to write instead in the reader's language. */
export type RemovedApiKey =
  | "qiskit.execute"
  | "qiskit.Aer"
  | "qiskit.BasicAer"
  | "qiskit.IBMQ"
  | "qiskit.primitives.Sampler"
  | "qiskit.primitives.Estimator"
  | "qiskit.primitives.BackendSampler"
  | "qiskit.primitives.BackendEstimator"
  | "qiskit.opflow"
  | "qiskit.algorithms"
  | "qiskit.providers.aer"
  | "qiskit.test"
  | "qiskit.tools"
  | "bind_parameters"
  | "qasm";

export type LintDetail =
  | { kind: "gate"; method: string; shown: string }
  | { kind: "removed"; api: RemovedApiKey }
  | { kind: "measured"; name: string };

export interface LintFinding {
  code: LintCode;
  severity: LintSeverity;
  line: number;
  col: number;
  endLine: number;
  /** Exclusive, like Python's `end_col_offset + 1`. */
  endCol: number;
  detail: LintDetail;
}

/** The reader-facing sentences, one per finding shape. Lives in `workspace-locale.ts`
 * (en and ja) like every other string on the page; the type is here so the rules and
 * their messages cannot disagree about which shapes exist. */
export interface NotebookLintCopy {
  gateReturnsInstructions: (shown: string) => string;
  measureAllReturnsNone: (shown: string) => string;
  measuredCircuit: (name: string) => string;
  removedApi: Record<RemovedApiKey, string>;
}

export function lintMessage(finding: LintFinding, copy: NotebookLintCopy): string {
  const { detail } = finding;
  if (detail.kind === "removed") return copy.removedApi[detail.api];
  if (detail.kind === "measured") return copy.measuredCircuit(detail.name);
  return detail.method === "measure_all"
    ? copy.measureAllReturnsNone(detail.shown)
    : copy.gateReturnsInstructions(detail.shown);
}

// ------------------------------------------------------------------ rule tables
//
// Each one a transcription of the table of the same name in lint.py. Maps rather than
// object literals wherever a key comes from the reader's code: `"constructor" in {}` is
// true, and `from qiskit import constructor` must not look like a removed API.

/** Circuit methods that append an instruction and return an `InstructionSet` (or, for
 * `measure_all`, `None`). `GATE_METHODS` in lint.py. */
export const GATE_METHODS: ReadonlySet<string> = new Set([
  "h", "x", "y", "z", "s", "sdg", "t", "tdg", "sx", "sxdg",
  "rx", "ry", "rz", "rxx", "ryy", "rzz", "rzx", "p", "u", "r",
  "cx", "cy", "cz", "ch", "cp", "crx", "cry", "crz", "cu", "cs", "csdg", "csx",
  "ccx", "ccz", "cswap", "swap", "iswap", "dcx", "ecr", "mcx", "mcp",
  "rv", "id", "barrier", "measure", "measure_all", "reset", "append", "delay",
  "initialize", "unitary", "prepare_state",
]);

/** Methods that return a NEW circuit when called on one. The value says whether the
 * result is measured; `null` means "the same as the receiver". `_CIRCUIT_RETURNING`. */
const CIRCUIT_RETURNING = new Map<string, boolean | null>([
  ["copy", null],
  ["compose", null],
  ["assign_parameters", null],
  ["inverse", false],
  ["decompose", null],
  ["reverse_bits", null],
  ["remove_final_measurements", false],
  ["measure_all", true],
]);

/** `_REMOVED_FROM`: names Qiskit 2 no longer exports from a module. */
const REMOVED_FROM = new Map<string, Map<string, RemovedApiKey>>([
  [
    "qiskit",
    new Map<string, RemovedApiKey>([
      ["execute", "qiskit.execute"],
      ["Aer", "qiskit.Aer"],
      ["BasicAer", "qiskit.BasicAer"],
      ["IBMQ", "qiskit.IBMQ"],
    ]),
  ],
  [
    "qiskit.primitives",
    new Map<string, RemovedApiKey>([
      ["Sampler", "qiskit.primitives.Sampler"],
      ["Estimator", "qiskit.primitives.Estimator"],
      ["BackendSampler", "qiskit.primitives.BackendSampler"],
      ["BackendEstimator", "qiskit.primitives.BackendEstimator"],
    ]),
  ],
]);

/** `_REMOVED_MODULES`: whole modules that no longer exist. Order matters only in that the
 * first match wins, as in lint.py. */
const REMOVED_MODULES: readonly (readonly [string, RemovedApiKey])[] = [
  ["qiskit.opflow", "qiskit.opflow"],
  ["qiskit.algorithms", "qiskit.algorithms"],
  ["qiskit.providers.aer", "qiskit.providers.aer"],
  ["qiskit.test", "qiskit.test"],
  ["qiskit.tools", "qiskit.tools"],
];

const STATE_BUILDERS: ReadonlySet<string> = new Set(["Statevector", "Operator", "DensityMatrix"]);
const STATE_METHODS: ReadonlySet<string> = new Set(["from_instruction", "evolve"]);

// ------------------------------------------------------------------ syntax tree
//
// Only as much of Python's AST as the rules read. Every rule asks one of three questions
// of a call — what is the receiver, what is the first positional argument, and what is
// the call's PARENT (a bare statement, an attribute access, or anything else) — and
// operator precedence answers none of them. So an expression is parsed into primaries
// (atoms with their `.name`, `(...)` and `[...]` trailers, which is where every rule's
// shape lives) joined by operators whose tree shape is not built at all: `a + b.h(0)` is
// a Group holding `a` and the call, and the call's parent is "not a statement, not an
// attribute", which is the only fact about it any rule uses.

interface Span {
  start: number;
  end: number;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

type Parent = Expr | Keyword | Stmt;

type Expr =
  | { type: "Name"; id: string; span: Span; parent?: Parent }
  | { type: "Const"; value: "True" | "False" | "None" | "other"; span: Span; parent?: Parent }
  | { type: "Attribute"; value: Expr; attr: string; span: Span; parent?: Parent }
  | { type: "Call"; func: Expr; args: Expr[]; keywords: Keyword[]; span: Span; parent?: Parent }
  | { type: "Starred"; value: Expr; span: Span; parent?: Parent }
  | { type: "Subscript"; value: Expr; slice: Expr; span: Span; parent?: Parent }
  /** Anything compound: a tuple, list, dict, comprehension, lambda, or an operator
   * expression. Its children are visited; nothing asks what shape it was. */
  | { type: "Group"; items: Expr[]; span: Span; parent?: Parent };

interface Keyword {
  type: "Keyword";
  arg: string | null;
  value: Expr;
  parent?: Parent;
}

type Stmt =
  | { type: "Expr"; value: Expr }
  | { type: "Assign"; targets: Expr[]; value: Expr }
  | { type: "AnnAssign"; target: Expr; value: Expr | null }
  | { type: "Import"; modules: string[]; span: Span }
  | { type: "ImportFrom"; module: string; level: number; names: string[]; span: Span }
  | { type: "Other"; exprs: Expr[] }
  | { type: "Unparsed"; names: string[] };

class LintParseError extends Error {}

/** Words that change how an expression reads but are not operands. The parser treats
 * each as an operator, which is exactly as much as the rules need to know about them. */
const KEYWORD_OPERATORS: ReadonlySet<string> = new Set([
  "and", "or", "not", "in", "is", "if", "else", "for", "async", "await",
  "yield", "from", "as", "lambda",
]);
/** Words that cannot appear inside an expression at all. */
const STATEMENT_KEYWORDS: ReadonlySet<string> = new Set([
  "import", "def", "class", "return", "del", "pass", "global", "nonlocal", "with",
  "while", "try", "except", "finally", "raise", "assert", "break", "continue", "elif",
]);
const COMPOUND: ReadonlySet<string> = new Set([
  "if", "elif", "while", "for", "with", "def", "class", "try", "except", "finally", "else",
]);
const AUGMENTED: ReadonlySet<string> = new Set([
  "+=", "-=", "*=", "/=", "//=", "%=", "@=", "&=", "|=", "^=", ">>=", "<<=", "**=",
]);
const OPENER_FOR: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const CLOSER_FOR: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

function spanOf(first: PyToken, last: PyToken): Span {
  return {
    start: first.start,
    end: last.end,
    line: first.line,
    col: first.col,
    endLine: last.endLine,
    endCol: last.endCol,
  };
}

function isOp(token: PyToken | undefined, text: string): boolean {
  return token !== undefined && token.kind === "op" && token.text === text;
}

function isCloser(token: PyToken | undefined): boolean {
  return token !== undefined && token.kind === "op" && token.text in OPENER_FOR;
}

/** A cursor over one statement's tokens. */
class Cursor {
  tokens: readonly PyToken[];
  index = 0;
  constructor(tokens: readonly PyToken[]) {
    this.tokens = tokens;
  }
  peek(ahead = 0): PyToken | undefined {
    return this.tokens[this.index + ahead];
  }
  next(): PyToken {
    const token = this.tokens[this.index];
    if (!token) throw new LintParseError("unexpected end");
    this.index += 1;
    return token;
  }
  atEnd(): boolean {
    return this.index >= this.tokens.length;
  }
  previous(): PyToken {
    return this.tokens[this.index - 1];
  }
}

function adopt<T extends { parent?: Parent }>(child: T, parent: Parent): T {
  child.parent = parent;
  return child;
}

function isOperatorToken(token: PyToken): boolean {
  if (token.kind === "name") return KEYWORD_OPERATORS.has(token.text);
  if (token.kind !== "op") return false;
  return !(token.text in CLOSER_FOR) && !(token.text in OPENER_FOR) && token.text !== "," && token.text !== "." && token.text !== "...";
}

/**
 * One comma-free run of operands and operators: `a`, `not x`, `a if b else c`, `k: v`.
 * Returns the operand itself when it is alone, which is what makes `bell = qc.h(0)` a
 * call whose parent is the assignment rather than some wrapper. `null` when nothing was
 * there at all (an empty slot between two commas).
 */
function parseRun(cursor: Cursor): Expr | null {
  const parts: Expr[] = [];
  let operators = 0;
  let expectOperand = true;
  const first = cursor.peek();
  while (!cursor.atEnd()) {
    const token = cursor.peek() as PyToken;
    if (isOp(token, ",") || isCloser(token) || isOp(token, ";")) break;
    if (isOperatorToken(token)) {
      cursor.next();
      operators += 1;
      expectOperand = true;
      continue;
    }
    // Two operands with no operator between them is not Python (`print "x"`); refusing it
    // keeps a misread from turning into a finding.
    if (!expectOperand) throw new LintParseError("two operands in a row");
    parts.push(parsePrimary(cursor));
    expectOperand = false;
  }
  if (parts.length === 1 && operators === 0) return parts[0];
  if (parts.length === 0 && operators === 0) return null;
  const group: Expr = {
    type: "Group",
    items: parts,
    span: spanOf(first as PyToken, cursor.previous()),
  };
  for (const part of parts) adopt(part, group);
  return group;
}

/** A comma-separated list at the top of a statement or a bracket. One item with no comma
 * is the item itself; anything else is a tuple. */
function parseList(cursor: Cursor): Expr | null {
  const first = cursor.peek();
  const items: Expr[] = [];
  let sawComma = false;
  while (!cursor.atEnd()) {
    const item = parseRun(cursor);
    if (item) items.push(item);
    const token = cursor.peek();
    if (isOp(token, ",")) {
      if (!item) throw new LintParseError("empty item");
      cursor.next();
      sawComma = true;
      continue;
    }
    break;
  }
  if (items.length === 0) return null;
  if (items.length === 1 && !sawComma) return items[0];
  const tuple: Expr = { type: "Group", items, span: spanOf(first as PyToken, cursor.previous()) };
  for (const item of items) adopt(item, tuple);
  return tuple;
}

/** The contents of a bracket up to and including its closer. */
function parseBracketed(cursor: Cursor, opener: PyToken): { items: Expr[]; sawComma: boolean; close: PyToken } {
  const closer = CLOSER_FOR[opener.text];
  const items: Expr[] = [];
  let sawComma = false;
  for (;;) {
    if (cursor.atEnd()) throw new LintParseError("unclosed bracket");
    if (isOp(cursor.peek(), closer)) return { items, sawComma, close: cursor.next() };
    const item = parseRun(cursor);
    if (!item) throw new LintParseError("empty item");
    items.push(item);
    const token = cursor.peek();
    if (isOp(token, ",")) {
      cursor.next();
      sawComma = true;
      continue;
    }
    if (!isOp(token, closer)) throw new LintParseError("mismatched bracket");
  }
}

function parseCallArguments(cursor: Cursor): { args: Expr[]; keywords: Keyword[]; close: PyToken } {
  const args: Expr[] = [];
  const keywords: Keyword[] = [];
  for (;;) {
    if (cursor.atEnd()) throw new LintParseError("unclosed call");
    if (isOp(cursor.peek(), ")")) return { args, keywords, close: cursor.next() };
    const token = cursor.peek() as PyToken;
    if (isOp(token, "**")) {
      cursor.next();
      const value = parseRun(cursor);
      if (!value) throw new LintParseError("empty **");
      keywords.push({ type: "Keyword", arg: null, value });
    } else if (isOp(token, "*")) {
      const star = cursor.next();
      const value = parseRun(cursor);
      if (!value) throw new LintParseError("empty *");
      const starred: Expr = { type: "Starred", value, span: spanOf(star, cursor.previous()) };
      adopt(value, starred);
      args.push(starred);
    } else if (token.kind === "name" && isOp(cursor.peek(1), "=")) {
      cursor.next();
      cursor.next();
      const value = parseRun(cursor);
      if (!value) throw new LintParseError("empty keyword");
      keywords.push({ type: "Keyword", arg: token.text, value });
    } else {
      const value = parseRun(cursor);
      if (!value) throw new LintParseError("empty argument");
      args.push(value);
    }
    const after = cursor.peek();
    if (isOp(after, ",")) {
      cursor.next();
      continue;
    }
    if (!isOp(after, ")")) throw new LintParseError("mismatched call");
  }
}

function parsePrimary(cursor: Cursor): Expr {
  const token = cursor.next();
  let node: Expr;
  if (token.kind === "name") {
    if (STATEMENT_KEYWORDS.has(token.text)) throw new LintParseError("statement keyword in expression");
    node =
      token.text === "True" || token.text === "False" || token.text === "None"
        ? { type: "Const", value: token.text, span: spanOf(token, token) }
        : { type: "Name", id: token.text, span: spanOf(token, token) };
  } else if (token.kind === "number") {
    node = { type: "Const", value: "other", span: spanOf(token, token) };
  } else if (token.kind === "string") {
    // Adjacent literals are one string (`"a" "b"`), as in Python.
    let last = token;
    if (token.unterminated) throw new LintParseError("unterminated string");
    while (cursor.peek()?.kind === "string") {
      last = cursor.next();
      if (last.unterminated) throw new LintParseError("unterminated string");
    }
    node = { type: "Const", value: "other", span: spanOf(token, last) };
  } else if (isOp(token, "...")) {
    node = { type: "Const", value: "other", span: spanOf(token, token) };
  } else if (isOp(token, "(")) {
    const { items, sawComma, close } = parseBracketed(cursor, token);
    // A parenthesised expression IS the expression — `(qc.h(0))` as a statement is still
    // a bare call statement in Python's tree — so a lone item is returned unwrapped.
    if (items.length === 1 && !sawComma) node = items[0];
    else {
      node = { type: "Group", items, span: spanOf(token, close) };
      for (const item of items) adopt(item, node);
    }
  } else if (isOp(token, "[") || isOp(token, "{")) {
    const { items, close } = parseBracketed(cursor, token);
    node = { type: "Group", items, span: spanOf(token, close) };
    for (const item of items) adopt(item, node);
  } else {
    throw new LintParseError(`unexpected ${token.text}`);
  }

  for (;;) {
    const next = cursor.peek();
    if (isOp(next, ".")) {
      cursor.next();
      const name = cursor.next();
      if (name.kind !== "name") throw new LintParseError("attribute without a name");
      const attribute: Expr = {
        type: "Attribute",
        value: node,
        attr: name.text,
        span: { ...node.span, end: name.end, endLine: name.endLine, endCol: name.endCol },
      };
      adopt(node, attribute);
      node = attribute;
    } else if (isOp(next, "(")) {
      cursor.next();
      const { args, keywords, close } = parseCallArguments(cursor);
      const call: Expr = {
        type: "Call",
        func: node,
        args,
        keywords,
        span: { ...node.span, end: close.end, endLine: close.endLine, endCol: close.endCol },
      };
      adopt(node, call);
      for (const arg of args) adopt(arg, call);
      for (const keyword of keywords) {
        adopt(keyword, call);
        adopt(keyword.value, keyword);
      }
      node = call;
    } else if (isOp(next, "[")) {
      const open = cursor.next();
      const { items, sawComma, close } = parseBracketed(cursor, open);
      const slice: Expr =
        items.length === 1 && !sawComma ? items[0] : { type: "Group", items, span: spanOf(open, close) };
      if (slice.type === "Group" && slice !== items[0]) for (const item of items) adopt(item, slice);
      const subscript: Expr = {
        type: "Subscript",
        value: node,
        slice,
        span: { ...node.span, end: close.end, endLine: close.endLine, endCol: close.endCol },
      };
      adopt(node, subscript);
      adopt(slice, subscript);
      node = subscript;
    } else {
      return node;
    }
  }
}

/** A whole token range as one expression; every token must be used. */
function parseWhole(tokens: readonly PyToken[]): Expr {
  const cursor = new Cursor(tokens);
  const node = parseList(cursor);
  if (!node || !cursor.atEnd()) throw new LintParseError("trailing tokens");
  return node;
}

/** Offsets of tokens at bracket depth zero that satisfy `test`. */
function topLevel(tokens: readonly PyToken[], test: (token: PyToken) => boolean, stopAtLambda = false): number[] {
  const found: number[] = [];
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === "op" && token.text in CLOSER_FOR) depth += 1;
    else if (token.kind === "op" && token.text in OPENER_FOR) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (stopAtLambda && token.kind === "name" && token.text === "lambda") break;
      if (test(token)) found.push(index);
    }
  }
  return found;
}

function dottedName(cursor: Cursor): string {
  const parts = [cursor.next()];
  if (parts[0].kind !== "name") throw new LintParseError("module name expected");
  while (isOp(cursor.peek(), ".")) {
    cursor.next();
    const part = cursor.next();
    if (part.kind !== "name") throw new LintParseError("module name expected");
    parts.push(part);
  }
  return parts.map((part) => part.text).join(".");
}

function skipAlias(cursor: Cursor) {
  const token = cursor.peek();
  if (token?.kind === "name" && token.text === "as") {
    cursor.next();
    if (cursor.next().kind !== "name") throw new LintParseError("alias expected");
  }
}

function parseImport(tokens: readonly PyToken[]): Stmt {
  const cursor = new Cursor(tokens);
  cursor.next(); // `import`
  const modules: string[] = [];
  for (;;) {
    modules.push(dottedName(cursor));
    skipAlias(cursor);
    if (cursor.atEnd()) break;
    if (!isOp(cursor.next(), ",")) throw new LintParseError("bad import");
  }
  return { type: "Import", modules, span: spanOf(tokens[0], tokens[tokens.length - 1]) };
}

function parseFromImport(tokens: readonly PyToken[]): Stmt {
  const cursor = new Cursor(tokens);
  cursor.next(); // `from`
  let level = 0;
  while (isOp(cursor.peek(), ".") || isOp(cursor.peek(), "...")) level += cursor.next().text.length;
  const moduleToken = cursor.peek();
  const module = moduleToken?.kind === "name" && moduleToken.text !== "import" ? dottedName(cursor) : "";
  const keyword = cursor.next();
  if (keyword.kind !== "name" || keyword.text !== "import") throw new LintParseError("import expected");
  const names: string[] = [];
  if (isOp(cursor.peek(), "*")) {
    cursor.next();
  } else {
    const parenthesised = isOp(cursor.peek(), "(");
    if (parenthesised) cursor.next();
    for (;;) {
      if (parenthesised && isOp(cursor.peek(), ")")) {
        cursor.next();
        break;
      }
      const name = cursor.next();
      if (name.kind !== "name") throw new LintParseError("name expected");
      names.push(name.text);
      skipAlias(cursor);
      if (cursor.atEnd()) break;
      const separator = cursor.next();
      if (isOp(separator, ",")) continue;
      if (parenthesised && isOp(separator, ")")) break;
      throw new LintParseError("bad from-import");
    }
  }
  if (!cursor.atEnd()) throw new LintParseError("trailing tokens");
  return { type: "ImportFrom", module, level, names, span: spanOf(tokens[0], tokens[tokens.length - 1]) };
}

/** One `;`-free simple statement, or a compound header with its inline body. */
function parseSegment(tokens: readonly PyToken[]): Stmt[] {
  const first = tokens[0];
  if (isOp(first, "@")) return [{ type: "Other", exprs: [parseWhole(tokens.slice(1))] }];
  if (first.kind === "name") {
    const word = first.text;
    if (word === "async" && tokens.length > 1) return parseSegment(tokens.slice(1));
    // `match` and `case` are soft keywords: `match = 3` and `match(x)` are ordinary code.
    // They open a block only when a top-level colon follows and they are not the target
    // of an annotation (`match: int = 3`).
    const soft =
      (word === "match" || word === "case") &&
      tokens.length > 2 &&
      !isOp(tokens[1], ":") &&
      !isOp(tokens[1], "=") &&
      !isOp(tokens[1], ".") &&
      topLevel(tokens, (token) => isOp(token, ":")).length > 0;
    if (COMPOUND.has(word) || soft) {
      const colon = topLevel(tokens, (token) => isOp(token, ":"))[0];
      if (colon === undefined) throw new LintParseError("block without a colon");
      const stmts: Stmt[] = [];
      // A `case` pattern is not an expression (`case Point(x=0):` binds, it does not
      // call), so it is not read at all. Python's checker visits patterns but no rule
      // matches inside one, so nothing is lost.
      if (word !== "case") {
        const header = tokens.slice(word === "def" || word === "class" ? 2 : 1, colon);
        if (header.length > 0) stmts.push({ type: "Other", exprs: [parseWhole(header)] });
      }
      const body = tokens.slice(colon + 1);
      if (body.length > 0) stmts.push(...parseSegment(body));
      return stmts;
    }
    if (word === "import") return [parseImport(tokens)];
    if (word === "from") return [parseFromImport(tokens)];
    if (word === "return" || word === "del" || word === "assert" || word === "raise") {
      return [{ type: "Other", exprs: tokens.length > 1 ? [parseWhole(tokens.slice(1))] : [] }];
    }
    if (word === "pass" || word === "break" || word === "continue" || word === "global" || word === "nonlocal") {
      return [{ type: "Other", exprs: [] }];
    }
  }

  const augmented = topLevel(tokens, (token) => token.kind === "op" && AUGMENTED.has(token.text), true)[0];
  const equals = topLevel(tokens, (token) => isOp(token, "="), true);
  const annotation = topLevel(tokens, (token) => isOp(token, ":"), true)[0];
  if (augmented !== undefined && (equals.length === 0 || augmented < equals[0])) {
    return [{ type: "Other", exprs: [parseWhole(tokens.slice(0, augmented)), parseWhole(tokens.slice(augmented + 1))] }];
  }
  if (annotation !== undefined && (equals.length === 0 || annotation < equals[0])) {
    // `x: T = v`. Python's checker never visits the annotation, so neither does this.
    const target = parseWhole(tokens.slice(0, annotation));
    const value = equals.length > 0 ? parseWhole(tokens.slice(equals[0] + 1)) : null;
    const stmt: Stmt = { type: "AnnAssign", target, value };
    adopt(target, stmt);
    if (value) adopt(value, stmt);
    return [stmt];
  }
  if (equals.length > 0) {
    const bounds = [-1, ...equals, tokens.length];
    const parts = bounds.slice(1).map((end, index) => parseWhole(tokens.slice(bounds[index] + 1, end)));
    const value = parts.pop() as Expr;
    const stmt: Stmt = { type: "Assign", targets: parts, value };
    for (const target of parts) adopt(target, stmt);
    adopt(value, stmt);
    return [stmt];
  }
  const value = parseWhole(tokens);
  const stmt: Stmt = { type: "Expr", value };
  adopt(value, stmt);
  return [stmt];
}

/**
 * The statements on one logical line, in order. A segment this parser cannot read becomes
 * `Unparsed` with the names it mentions, rather than failing the line: the rest of the
 * cell is still worth checking, and the names are what `forget` needs.
 *
 * The parser is deliberately partial: it reads every shape the rules look at and refuses
 * the rest (a `print "x"`, a stray keyword, an unclosed bracket), so a refusal means
 * "not read", never "not Python".
 */
function parseLogicalLine(tokens: readonly PyToken[]): Stmt[] {
  const segments: PyToken[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === "op" && token.text in CLOSER_FOR) depth += 1;
    else if (token.kind === "op" && token.text in OPENER_FOR) depth = Math.max(0, depth - 1);
    if (depth === 0 && isOp(token, ";")) segments.push([]);
    else segments[segments.length - 1].push(token);
  }
  const stmts: Stmt[] = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    try {
      stmts.push(...parseSegment(segment));
    } catch (error) {
      if (!(error instanceof LintParseError)) throw error;
      const names = segment.filter((token) => token.kind === "name").map((token) => token.text);
      stmts.push({ type: "Unparsed", names });
    }
  }
  return stmts;
}

/** A cell's statements, logical line by logical line. Comments never reach the parser,
 * and strings arrive as single tokens, which is why neither can trigger a rule. */
function parseCell(source: string): Stmt[] {
  const stmts: Stmt[] = [];
  let line: PyToken[] = [];
  for (const token of tokenizePython(source)) {
    if (token.kind === "comment") continue;
    if (token.kind === "newline") {
      if (line.length > 0) stmts.push(...parseLogicalLine(line));
      line = [];
      continue;
    }
    line.push(token);
  }
  if (line.length > 0) stmts.push(...parseLogicalLine(line));
  return stmts;
}

// ------------------------------------------------------------------ the checker

interface CheckerState {
  report: boolean;
  /** name -> measured? for every name known to hold a QuantumCircuit. */
  circuits: Map<string, boolean>;
  found: LintFinding[];
  source: string;
}

function emit(state: CheckerState, code: LintCode, span: Span, detail: LintDetail) {
  if (!state.report) return;
  state.found.push({
    code,
    severity: LINT_SEVERITY[code],
    line: span.line,
    col: span.col,
    endLine: span.endLine,
    endCol: span.endCol,
    detail,
  });
}

function isQuantumCircuitCall(node: Expr): boolean {
  if (node.type !== "Call") return false;
  const { func } = node;
  return (func.type === "Name" && func.id === "QuantumCircuit") || (func.type === "Attribute" && func.attr === "QuantumCircuit");
}

function keywordIsFalse(call: Extract<Expr, { type: "Call" }>, name: string): boolean {
  return call.keywords.some((keyword) => keyword.arg === name && keyword.value.type === "Const" && keyword.value.value === "False");
}

function receiverIsCircuit(node: Expr, state: CheckerState): boolean {
  return isQuantumCircuitCall(node) || (node.type === "Name" && state.circuits.has(node.id));
}

/** If `value` evaluates to a circuit, whether that circuit is measured; else null.
 * `_circuit_value` in lint.py, branch for branch. */
function circuitValue(value: Expr, state: CheckerState): boolean | null {
  if (isQuantumCircuitCall(value)) return false;
  if (value.type === "Name" && state.circuits.has(value.id)) return state.circuits.get(value.id) as boolean;
  if (value.type === "Call" && value.func.type === "Attribute") {
    const method = value.func.attr;
    const receiver = value.func.value;
    if (CIRCUIT_RETURNING.has(method) && receiverIsCircuit(receiver, state)) {
      if (method === "measure_all" || method === "remove_final_measurements") {
        // In place (the default) the call returns None; the gate rule says so.
        if (!keywordIsFalse(value, "inplace")) return null;
        return CIRCUIT_RETURNING.get(method) as boolean;
      }
      const marker = CIRCUIT_RETURNING.get(method);
      if (marker !== null && marker !== undefined) return marker;
      if (receiver.type === "Name") return state.circuits.get(receiver.id) ?? false;
      return false;
    }
  }
  return null;
}

function bind(target: Expr, measured: boolean | null, state: CheckerState) {
  if (target.type === "Name") {
    if (measured === null) state.circuits.delete(target.id);
    else state.circuits.set(target.id, measured);
  } else {
    visitExpr(target, state);
  }
}

/** How a call reads in the reader's own words, for the message: its source text with
 * whitespace collapsed, cut at 60 characters as lint.py cuts `ast.unparse`. */
function shownSource(span: Span, state: CheckerState): string {
  const shown = state.source.slice(span.start, span.end).replace(/\s+/g, " ");
  return shown.length > 60 ? `${shown.slice(0, 57)}...` : shown;
}

function checkGateValue(call: Extract<Expr, { type: "Call" }>, state: CheckerState) {
  const { func } = call;
  if (func.type !== "Attribute" || !GATE_METHODS.has(func.attr) || !receiverIsCircuit(func.value, state)) return;
  // A measured copy: using the value is the point.
  if (func.attr === "measure_all" && keywordIsFalse(call, "inplace")) return;
  const parent = call.parent;
  // A statement throws the result away, which is correct; `.c_if(...)` and friends use
  // the InstructionSet on purpose.
  if (parent && "type" in parent && (parent.type === "Expr" || parent.type === "Attribute")) return;
  emit(state, "gate-returns-instructions", call.span, {
    kind: "gate",
    method: func.attr,
    shown: shownSource(call.span, state),
  });
}

function checkStateOfMeasured(call: Extract<Expr, { type: "Call" }>, state: CheckerState) {
  const { func } = call;
  const named =
    (func.type === "Name" && STATE_BUILDERS.has(func.id)) ||
    (func.type === "Attribute" && (STATE_METHODS.has(func.attr) || STATE_BUILDERS.has(func.attr)));
  if (!named || call.args.length === 0) return;
  const argument = call.args[0];
  if (argument.type === "Name" && state.circuits.get(argument.id) === true) {
    emit(state, "measured-circuit-has-no-statevector", call.span, { kind: "measured", name: argument.id });
  }
}

function visitExpr(node: Expr, state: CheckerState) {
  switch (node.type) {
    case "Call": {
      const { func } = node;
      checkGateValue(node, state);
      if (func.type === "Attribute") {
        if (func.attr === "bind_parameters") {
          emit(state, "removed-qiskit-api", node.span, { kind: "removed", api: "bind_parameters" });
        } else if (func.attr === "qasm" && node.args.length === 0 && node.keywords.length === 0) {
          emit(state, "removed-qiskit-api", node.span, { kind: "removed", api: "qasm" });
        } else if (func.attr === "execute" && func.value.type === "Name" && func.value.id === "qiskit") {
          emit(state, "removed-qiskit-api", node.span, { kind: "removed", api: "qiskit.execute" });
        }
      }
      checkStateOfMeasured(node, state);
      visitExpr(func, state);
      for (const arg of node.args) visitExpr(arg, state);
      for (const keyword of node.keywords) visitExpr(keyword.value, state);
      return;
    }
    case "Attribute":
    case "Starred":
      visitExpr(node.value, state);
      return;
    case "Subscript":
      visitExpr(node.value, state);
      visitExpr(node.slice, state);
      return;
    case "Group":
      for (const item of node.items) visitExpr(item, state);
      return;
    default:
      return;
  }
}

function checkModule(module: string, span: Span, state: CheckerState) {
  for (const [prefix, api] of REMOVED_MODULES) {
    if (module === prefix || module.startsWith(`${prefix}.`)) {
      emit(state, "removed-qiskit-api", span, { kind: "removed", api });
      return;
    }
  }
  // `forbidden-import` would be checked here; see the module comment for why it is not.
}

function visitStmt(stmt: Stmt, state: CheckerState) {
  switch (stmt.type) {
    case "Expr": {
      visitExpr(stmt.value, state);
      const call = stmt.value;
      if (call.type === "Call" && call.func.type === "Attribute") {
        const receiver = call.func.value;
        if (receiver.type === "Name" && state.circuits.has(receiver.id)) {
          const method = call.func.attr;
          if ((method === "measure" || method === "measure_all") && !keywordIsFalse(call, "inplace")) {
            state.circuits.set(receiver.id, true);
          } else if (method === "remove_final_measurements" && !keywordIsFalse(call, "inplace")) {
            state.circuits.set(receiver.id, false);
          }
        }
      }
      return;
    }
    case "Assign": {
      visitExpr(stmt.value, state);
      const measured = circuitValue(stmt.value, state);
      for (const target of stmt.targets) bind(target, measured, state);
      return;
    }
    case "AnnAssign":
      if (stmt.value) {
        visitExpr(stmt.value, state);
        bind(stmt.target, circuitValue(stmt.value, state), state);
      }
      return;
    case "Import":
      for (const module of stmt.modules) checkModule(module, stmt.span, state);
      return;
    case "ImportFrom": {
      if (stmt.level > 0) return; // relative: nothing here can say what it names
      checkModule(stmt.module, stmt.span, state);
      const removed = REMOVED_FROM.get(stmt.module);
      if (removed) {
        for (const name of stmt.names) {
          const api = removed.get(name);
          if (api) emit(state, "removed-qiskit-api", stmt.span, { kind: "removed", api });
        }
      }
      return;
    }
    case "Other":
      for (const expr of stmt.exprs) visitExpr(expr, state);
      return;
    case "Unparsed":
      // Forget, never guess: see the module comment.
      for (const name of stmt.names) state.circuits.delete(name);
      return;
  }
}

function run(source: string, state: CheckerState) {
  state.source = source;
  for (const stmt of parseCell(source)) visitStmt(stmt, state);
}

/**
 * Findings for one code cell, given the code cells that run before it, in order.
 * `lint_cell` in lint.py: earlier cells are read only for the names they bind, and their
 * own mistakes are not reported here.
 */
export function lintCell(source: string, preceding: readonly string[] = []): LintFinding[] {
  const history: CheckerState = { report: false, circuits: new Map(), found: [], source: "" };
  for (const earlier of preceding) run(earlier, history);
  const state: CheckerState = { report: true, circuits: new Map(history.circuits), found: [], source: "" };
  run(source, state);
  return state.found.sort((a, b) => a.line - b.line || a.col - b.col || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export interface LintableCell {
  id: string;
  kind: "code" | "markdown";
  source: string;
  execute?: boolean;
}

/**
 * Findings for every code cell of a notebook, keyed by cell id; cells with none are left
 * out. `lint_spec` in lint.py: markdown is skipped, and a code cell marked not to run is
 * read for its names (it is still in the notebook a reader downloads) but not reported,
 * because the sandbox never runs it.
 */
export function lintNotebook(cells: readonly LintableCell[]): Record<string, LintFinding[]> {
  const findings: Record<string, LintFinding[]> = {};
  const preceding: string[] = [];
  for (const cell of cells) {
    if (cell.kind !== "code") continue;
    if (cell.execute === false) {
      preceding.push(cell.source);
      continue;
    }
    const found = lintCell(cell.source, preceding);
    if (found.length > 0) findings[cell.id] = found;
    preceding.push(cell.source);
  }
  return findings;
}
