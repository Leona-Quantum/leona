/**
 * Pure logic for check cells (ai-ops 382, `plans/platform-vision-20260924/phase-a/DESIGN.md`
 * §1): building the "Add a check" form's draft into a `CheckProperty`, the client-side
 * validation that mirrors `majorana_contracts.notebooks.CheckProperty` closely enough to
 * catch a mistake before it reaches the server, the author-badge and teeth text the check
 * card renders, and the notebook-level summary line.
 *
 * The server (`leona_notebooks.checks`, not yet landed in this worktree — see
 * `packages/py/contracts/src/majorana_contracts/notebooks.py`) is the only place a
 * `CheckProperty` is actually judged or authorship enforced. Everything here either reads
 * what the server already wrote (`CheckVerdict`, `CheckTeeth`) or builds a property the
 * client HOPES the server accepts — a mismatch here means a wasted round trip and the
 * server's own 400, not a security hole, which is why this file's validation does not need
 * to be byte-for-byte identical to the contract's.
 *
 * No React, no DOM: `components/notebook-check-card.tsx` and
 * `components/notebook-add-check-form.tsx` are what render this.
 */
import type { components } from "@majorana/contracts-gen";
import type { NotebookCellView } from "./notebook-view";

type Cell = components["schemas"]["Cell"];
export type CheckProperty = components["schemas"]["CheckProperty"];
export type CheckKind = CheckProperty["kind"];
export type CheckAuthor = CheckProperty["author"];
export type CheckVerdict = components["schemas"]["CheckVerdict"];
export type CheckTeeth = components["schemas"]["CheckTeeth"];
export type CheckStatus = CheckVerdict["status"];

// ------------------------------------------------------------------------- constants
//
// Mirrors `majorana_contracts.notebooks`. Kept here, rather than generated, because these
// are plain dicts/regexes in the Python source, not part of the OpenAPI schema — only the
// shapes they constrain are generated. If the server's numbers ever move, the client falls
// back to being slightly more permissive than the server for one release, which the
// server's own 400 catches; it can never become MORE permissive than the server actually
// enforces.

/** `CHECK_DEFAULT_TOLERANCE` in `notebooks.py`. */
export const CHECK_DEFAULT_TOLERANCE: Record<CheckKind, number> = {
  state: 1e-6,
  unitary: 1e-6,
  distribution: 1e-6,
  energy: 1e-3,
  value: 1e-6,
};

/** `_CHECK_TOLERANCE_CEILING` in `notebooks.py` — `null` means no ceiling. */
const CHECK_TOLERANCE_CEILING: Partial<Record<CheckKind, number>> = {
  state: 1.0,
  distribution: 1.0,
  unitary: 2.0,
};

const MAX_BASIS_WIDTH = 24;
const MAX_HAMILTONIAN_QUBITS = 10;
const MAX_HAMILTONIAN_TERMS = 256;
const MAX_EXPRESSION_CHARS = 200;
const MAX_STATEMENT_CHARS = 300;
const MAX_SUBJECT_CHARS = 64;

const BITSTRING_RE = /^[01]+$/;
const PAULI_RE = /^[IXYZ]+$/;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Not exhaustive — enough to catch the common accidental subject names ("class", "for"). */
const PYTHON_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
  "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return",
  "try", "while", "with", "yield",
]);

const EXPR_ALLOWED_NAMES = new Set(["i", "j", "pi", "e", "sqrt", "exp", "cos", "sin"]);
const EXPR_CHAR_RE = /^[0-9A-Za-z_+\-*/().\s]*$/;
const EXPR_TOKEN_RE = /[A-Za-z_]+/g;

export function isNumericLiteral(text: string): boolean {
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text.trim());
}

/** `null` when the expression is one the whitelist evaluator
 * (`leona_notebooks.checks.evaluate_expression` / `_validate_check_expression`) would
 * accept; otherwise the reason, in words. */
export function checkExpressionError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "must not be blank";
  if (trimmed.length > MAX_EXPRESSION_CHARS) return `must be at most ${MAX_EXPRESSION_CHARS} characters`;
  if (!EXPR_CHAR_RE.test(trimmed)) return "uses a character a check expression may not";
  for (const token of trimmed.match(EXPR_TOKEN_RE) ?? []) {
    if (!EXPR_ALLOWED_NAMES.has(token)) {
      return `uses "${token}" — only numbers, i, pi, e, sqrt(), exp(), cos(), sin() and + - * / ** are allowed`;
    }
  }
  return null;
}

// ------------------------------------------------------------------------- reference library

/** `CHECK_STATE_REFERENCE_RE` families — the fixed Bell variants plus the three that take a
 * qubit count. `CHECK_UNITARY_REFERENCE_RE` families are `qft`/`iqft`. */
export const STATE_REFERENCE_FAMILIES = [
  "bell", "bell:phi-", "bell:psi+", "bell:psi-", "ghz", "w", "uniform",
] as const;
export const UNITARY_REFERENCE_FAMILIES = ["qft", "iqft"] as const;
export type ReferenceFamily =
  | (typeof STATE_REFERENCE_FAMILIES)[number]
  | (typeof UNITARY_REFERENCE_FAMILIES)[number];

/** Families with a fixed size — no qubit-count field shown for these. */
const FIXED_SIZE_FAMILIES = new Set<ReferenceFamily>(["bell", "bell:phi-", "bell:psi+", "bell:psi-"]);

export function referenceTakesQubitCount(family: ReferenceFamily): boolean {
  return !FIXED_SIZE_FAMILIES.has(family);
}

function referenceQubitCeiling(family: ReferenceFamily): number {
  return family === "qft" || family === "iqft" ? 12 : 24;
}

/** The `reference` string the property carries, or an error naming why the qubit count
 * given does not make one — `null` qubits is only valid for a fixed-size family. */
export function buildReferenceString(family: ReferenceFamily, qubits: string): { value: string } | { error: string } {
  if (!referenceTakesQubitCount(family)) return { value: family };
  const trimmed = qubits.trim();
  if (!/^[0-9]+$/.test(trimmed)) return { error: "the qubit count must be a whole number" };
  const n = Number.parseInt(trimmed, 10);
  const ceiling = referenceQubitCeiling(family);
  if (n < 1 || n > ceiling) return { error: `the qubit count must be between 1 and ${ceiling}` };
  return { value: `${family}(${n})` };
}

// ------------------------------------------------------------------------- the draft

export interface CheckBasisRow {
  bitstring: string;
  expr: string;
}

export interface CheckHamiltonianRow {
  pauli: string;
  coefficient: string;
}

/** Which one of a `state` check's two expectation forms is open. `unitary` only ever
 * offers `reference` — its contract has no amplitude-table equivalent. */
export type CheckExpectationMode = "reference" | "amplitudes" | "probabilities" | "hamiltonian" | "value";

/** Everything the "Add a check" form collects, before it is validated and turned into a
 * `CheckProperty`. Every field is a raw string/row the reader typed — parsing and range
 * checks happen in `validateCheckDraft`/`buildCheckProperty`, never here, so a half-typed
 * draft never throws just from being held in state. */
export interface CheckDraft {
  kind: CheckKind;
  subject: string;
  /** `state` only: which of its two expectation forms is open. Ignored for every other
   * kind (`unitary` only ever offers `reference`; the rest have one form each). */
  stateMode: "reference" | "amplitudes";
  referenceFamily: ReferenceFamily;
  referenceQubits: string;
  amplitudes: CheckBasisRow[];
  probabilities: CheckBasisRow[];
  hamiltonian: CheckHamiltonianRow[];
  target: "ground" | "number";
  targetValue: string;
  /** `value`, raw: a single number, or several separated by commas. */
  value: string;
  /** Raw tolerance text; blank means "use the kind's default" (`CHECK_DEFAULT_TOLERANCE`). */
  tolerance: string;
  statement: string;
  /** Whether the reader has hand-edited `statement` — once true, `draftCheckStatement`
   * is no longer called automatically on every field change (the form's job, not this
   * module's — kept here only as the flag the form reads). */
  statementTouched: boolean;
}

/** The expectation form actually in play for `draft.kind` — `state` reads its own
 * `stateMode` toggle, every other kind has exactly one form. */
export function checkExpectationMode(draft: Pick<CheckDraft, "kind" | "stateMode">): CheckExpectationMode {
  switch (draft.kind) {
    case "state":
      return draft.stateMode;
    case "unitary":
      return "reference";
    case "distribution":
      return "probabilities";
    case "energy":
      return "hamiltonian";
    case "value":
      return "value";
  }
}

export function emptyCheckDraft(kind: CheckKind, subject: string): CheckDraft {
  return {
    kind,
    subject,
    stateMode: "reference",
    referenceFamily: kind === "unitary" ? "qft" : "bell",
    referenceQubits: "2",
    amplitudes: [{ bitstring: "00", expr: "" }, { bitstring: "11", expr: "" }],
    probabilities: [{ bitstring: "00", expr: "" }, { bitstring: "11", expr: "" }],
    hamiltonian: [{ pauli: "Z", coefficient: "1" }],
    target: "ground",
    targetValue: "",
    value: "",
    tolerance: "",
    statement: "",
    statementTouched: false,
  };
}

// ------------------------------------------------------------------------- validation

/** Human-readable problems with `draft` — empty means the contract would accept it (this
 * module's best guess; the server has the last word). Every message stands on its own, so
 * the form can list them as-is. */
export function validateCheckDraft(draft: CheckDraft): string[] {
  const errors: string[] = [];
  const subject = draft.subject.trim();
  if (!subject) errors.push("Name the variable this check is about.");
  else if (subject.length > MAX_SUBJECT_CHARS) errors.push(`The subject must be at most ${MAX_SUBJECT_CHARS} characters.`);
  else if (!IDENTIFIER_RE.test(subject)) errors.push("The subject must be a Python variable name.");
  else if (PYTHON_KEYWORDS.has(subject)) errors.push(`"${subject}" is a Python keyword, not a variable name.`);

  if (draft.statement.trim().length > MAX_STATEMENT_CHARS) {
    errors.push(`The statement must be at most ${MAX_STATEMENT_CHARS} characters.`);
  }

  switch (draft.kind) {
    case "state":
      if (draft.stateMode === "reference") {
        validateReference(draft, errors);
      } else {
        validateBasisRows(draft.amplitudes, "amplitude", errors);
      }
      break;
    case "unitary":
      validateReference(draft, errors);
      break;
    case "distribution":
      validateBasisRows(draft.probabilities, "probability", errors, { forbidNegative: true });
      break;
    case "energy":
      validateHamiltonian(draft, errors);
      break;
    case "value":
      validateValue(draft, errors);
      break;
  }

  validateTolerance(draft, errors);
  return errors;
}

function validateReference(draft: CheckDraft, errors: string[]): void {
  const built = buildReferenceString(draft.referenceFamily, draft.referenceQubits);
  if ("error" in built) errors.push(`Reference: ${built.error}.`);
}

function validateBasisRows(
  rows: readonly CheckBasisRow[],
  noun: string,
  errors: string[],
  options: { forbidNegative?: boolean } = {},
): void {
  const entries = rows.filter((row) => row.bitstring.trim() || row.expr.trim());
  if (entries.length === 0) {
    errors.push(`Add at least one ${noun}.`);
    return;
  }
  const widths = new Set<number>();
  const seen = new Set<string>();
  for (const row of entries) {
    const key = row.bitstring.trim();
    if (!BITSTRING_RE.test(key)) {
      errors.push(`"${row.bitstring}" is not a string of 0s and 1s.`);
      continue;
    }
    if (seen.has(key)) errors.push(`"${key}" is listed twice.`);
    seen.add(key);
    widths.add(key.length);
    const value = row.expr.trim();
    if (!value) {
      errors.push(`${key} needs a value.`);
    } else if (!isNumericLiteral(value)) {
      const problem = checkExpressionError(value);
      if (problem) errors.push(`${key}: ${problem}.`);
    } else if (options.forbidNegative && Number.parseFloat(value) < 0) {
      errors.push(`${key} cannot be negative.`);
    }
  }
  if (widths.size > 1) errors.push(`Every bitstring must be the same length (got ${[...widths].sort().join(", ")}).`);
  const width = [...widths][0] ?? 0;
  if (width > MAX_BASIS_WIDTH) errors.push(`A check simulates at most ${MAX_BASIS_WIDTH} qubits.`);
}

function validateHamiltonian(draft: CheckDraft, errors: string[]): void {
  const entries = draft.hamiltonian.filter((row) => row.pauli.trim() || row.coefficient.trim());
  if (entries.length === 0) {
    errors.push("Add at least one Hamiltonian term.");
  } else if (entries.length > MAX_HAMILTONIAN_TERMS) {
    errors.push(`At most ${MAX_HAMILTONIAN_TERMS} terms.`);
  } else {
    const widths = new Set<number>();
    for (const row of entries) {
      const term = row.pauli.trim().toUpperCase();
      if (!PAULI_RE.test(term)) {
        errors.push(`"${row.pauli}" is not a string of I, X, Y, Z.`);
        continue;
      }
      widths.add(term.length);
      const coefficient = row.coefficient.trim();
      if (!coefficient || !isNumericLiteral(coefficient) || !Number.isFinite(Number.parseFloat(coefficient))) {
        errors.push(`${term} needs a finite coefficient.`);
      }
    }
    if (widths.size > 1) errors.push("Every Hamiltonian term must act on the same number of qubits.");
    const width = [...widths][0] ?? 0;
    if (width > MAX_HAMILTONIAN_QUBITS) errors.push(`An energy check diagonalises at most ${MAX_HAMILTONIAN_QUBITS} qubits.`);
  }
  if (draft.target === "number") {
    if (!draft.targetValue.trim() || !isNumericLiteral(draft.targetValue) || !Number.isFinite(Number.parseFloat(draft.targetValue))) {
      errors.push("The target energy must be a finite number.");
    }
  }
}

function validateValue(draft: CheckDraft, errors: string[]): void {
  const parts = draft.value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) {
    errors.push("Enter the value your code should produce.");
    return;
  }
  for (const part of parts) {
    if (!isNumericLiteral(part) || !Number.isFinite(Number.parseFloat(part))) {
      errors.push(`"${part}" is not a finite number.`);
    }
  }
}

function validateTolerance(draft: CheckDraft, errors: string[]): void {
  const raw = draft.tolerance.trim();
  if (!raw) return;
  const value = Number.parseFloat(raw);
  if (!isNumericLiteral(raw) || !Number.isFinite(value)) {
    errors.push("The tolerance must be a finite number.");
    return;
  }
  if (value < 0) errors.push("The tolerance cannot be negative.");
  const ceiling = CHECK_TOLERANCE_CEILING[draft.kind];
  if (ceiling !== undefined && value >= ceiling) {
    errors.push(`A ${draft.kind} check with tolerance ${value} could never fail — it must be below ${ceiling}.`);
  }
}

// ------------------------------------------------------------------------- building the property

function basisRecord(rows: readonly CheckBasisRow[]): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const row of rows) {
    const key = row.bitstring.trim();
    const value = row.expr.trim();
    if (!key || !value) continue;
    out[key] = isNumericLiteral(value) ? Number.parseFloat(value) : value;
  }
  return out;
}

/** `draft` turned into the property the server would receive — call only once
 * `validateCheckDraft(draft)` is empty; a draft that fails validation may build something
 * the server refuses, which is fine (the server's 400 is the backstop), but never
 * something that throws here. */
export function buildCheckProperty(draft: CheckDraft, author: CheckAuthor = "user"): CheckProperty {
  const base = {
    kind: draft.kind,
    subject: draft.subject.trim(),
    amplitudes: null,
    probabilities: null,
    reference: null,
    reference_qasm: null,
    hamiltonian: null,
    target: null,
    value: null,
    tolerance: draft.tolerance.trim() ? Number.parseFloat(draft.tolerance) : null,
    statement: draft.statement.trim(),
    author,
    citation: "",
    accepted: false,
    block: null,
  } as CheckProperty;

  switch (draft.kind) {
    case "state": {
      if (draft.stateMode === "amplitudes") {
        base.amplitudes = basisRecord(draft.amplitudes);
      } else {
        const built = buildReferenceString(draft.referenceFamily, draft.referenceQubits);
        base.reference = "value" in built ? built.value : draft.referenceFamily;
      }
      break;
    }
    case "unitary": {
      const built = buildReferenceString(draft.referenceFamily, draft.referenceQubits);
      base.reference = "value" in built ? built.value : draft.referenceFamily;
      break;
    }
    case "distribution":
      base.probabilities = basisRecord(draft.probabilities);
      break;
    case "energy": {
      const terms: Record<string, number> = {};
      for (const row of draft.hamiltonian) {
        const pauli = row.pauli.trim().toUpperCase();
        const coefficient = Number.parseFloat(row.coefficient.trim());
        if (pauli && Number.isFinite(coefficient)) terms[pauli] = coefficient;
      }
      base.hamiltonian = terms;
      base.target = draft.target === "ground" ? "ground" : Number.parseFloat(draft.targetValue.trim());
      break;
    }
    case "value": {
      const numbers = draft.value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => Number.parseFloat(part));
      base.value = numbers.length === 1 ? numbers[0] : numbers;
      break;
    }
  }
  return base;
}

// ------------------------------------------------------------------------- the auto-drafted statement

export interface CheckStatementLabels {
  referenceLabel: Record<ReferenceFamily, string>;
  state: (subject: string, reference: string) => string;
  stateAmplitudes: (subject: string) => string;
  unitary: (subject: string, reference: string) => string;
  distribution: (subject: string) => string;
  energyGround: (subject: string) => string;
  energyTarget: (subject: string, target: string) => string;
  value: (subject: string, value: string) => string;
  subjectFallback: string;
}

/** The editable statement the form pre-fills, in words — "Check that {subject} prepares
 * the Bell state." Never called once the reader has typed their own (`statementTouched`);
 * the form owns that gate, this just builds the text. */
export function draftCheckStatement(draft: CheckDraft, labels: CheckStatementLabels): string {
  const subject = draft.subject.trim() || labels.subjectFallback;
  switch (draft.kind) {
    case "state":
      if (draft.stateMode === "amplitudes") return labels.stateAmplitudes(subject);
      return labels.state(subject, labels.referenceLabel[draft.referenceFamily]);
    case "unitary":
      return labels.unitary(subject, labels.referenceLabel[draft.referenceFamily]);
    case "distribution":
      return labels.distribution(subject);
    case "energy":
      return draft.target === "ground" ? labels.energyGround(subject) : labels.energyTarget(subject, draft.targetValue.trim());
    case "value":
      return labels.value(subject, draft.value.trim());
  }
}

// ------------------------------------------------------------------------- cell construction

/** A brand-new check cell's `source`: a readable comment rendered from the property
 * (DESIGN.md §1.1 — "the static guard passes it trivially"). Mirrors the server's own
 * rendering closely enough for the reader to recognise it; the server is authoritative. */
export function checkCellSource(statement: string): string {
  return `# check: ${statement || "(no statement)"}`;
}

/** A new check cell, `role=check`, `author="user"`, `accepted=true` — a reader who just
 * wrote the check has, by writing it, accepted it (DESIGN.md §1.4: "a new check … becomes
 * author='user', accepted=True"). The server's `enforce_check_authorship` re-derives both
 * fields anyway for a brand-new cell, so sending them here is belt-and-suspenders, never
 * trusted on its own — never a way to hand a check someone else wrote a false Accept. */
export function buildCheckCell(id: string, property: CheckProperty): Cell {
  return {
    id,
    kind: "code",
    role: "check",
    source: checkCellSource(property.statement),
    tags: [],
    execute: true,
    stub: null,
    check: null,
    answer: null,
    answer_prompt: null,
    timeout_s: null,
    property: { ...property, author: "user", accepted: true },
    block: null,
  };
}

/** A new check cell inserted directly after `afterId` (`null` puts it at the top) — the
 * same placement rule `insertCellAfter` (`lib/notebook-editing.ts`) uses for a plain cell,
 * reused here rather than imported so this module has no dependency on that one's id
 * scheme beyond agreeing on it (`nextCellId`, duplicated by necessity: importing it back
 * would make this the only lib file that reaches across into notebook-editing.ts for one
 * function, for no benefit over the two staying independent). */
export function nextCheckCellId(cells: readonly Cell[]): string {
  const used = new Set(cells.map((cell) => cell.id));
  let index = 1;
  while (used.has(`c${String(index).padStart(2, "0")}`)) index += 1;
  return `c${String(index).padStart(2, "0")}`;
}

export function insertCheckCellAfter(
  cells: readonly Cell[],
  afterId: string | null,
  property: CheckProperty,
): { cells: Cell[]; id: string } {
  const id = nextCheckCellId(cells);
  const created = buildCheckCell(id, property);
  const index = afterId === null ? -1 : cells.findIndex((cell) => cell.id === afterId);
  const at = index === -1 && afterId !== null ? cells.length : index + 1;
  return { cells: [...cells.slice(0, at), created, ...cells.slice(at)], id };
}

/** The last variable a code cell assigned at the top level — the "prefilled when obvious"
 * subject hint for a check added right after it. `null`/empty when nothing obvious was
 * assigned; the form still opens, just with an empty subject field. Deliberately naive
 * (a single regex over the source, no `ast`): this only ever saves a reader one line of
 * typing, so a wrong guess costs nothing — they can always type over it. */
export function subjectHintFor(cells: readonly Cell[], afterId: string): string {
  const cell = cells.find((item) => item.id === afterId);
  if (!cell || cell.kind !== "code") return "";
  const assignRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/gm;
  let match: RegExpExecArray | null;
  let last = "";
  while ((match = assignRe.exec(cell.source)) !== null) last = match[1];
  return last;
}

/** Accept = a user-authored edit of one cell, setting `property.accepted = true` and
 * nothing else (DESIGN.md §1.4). Author is left untouched — the server enforces
 * authorship anyway (`enforce_check_authorship`), so this never sends an author change;
 * sending one here would do nothing but invite drift between what the button claims and
 * what the server actually does. Unknown id or a non-check cell: unchanged, like every
 * other cell op in `notebook-editing.ts`. */
export function applyCheckAccept(cells: readonly Cell[], cellId: string): Cell[] {
  return cells.map((cell) => {
    if (cell.id !== cellId || !cell.property) return cell;
    return { ...cell, property: { ...cell.property, accepted: true } };
  });
}

// ------------------------------------------------------------------------- author badge

export type CheckAuthorBadge =
  | { kind: "nala"; citation: string; accepted: boolean }
  | { kind: "user" }
  | { kind: "source"; citation: string };

export function checkAuthorBadge(property: Pick<CheckProperty, "author" | "citation" | "accepted">): CheckAuthorBadge {
  if (property.author === "nala") return { kind: "nala", citation: property.citation, accepted: property.accepted };
  if (property.author === "source") return { kind: "source", citation: property.citation };
  return { kind: "user" };
}

// ------------------------------------------------------------------------- the cell-head pill

export type CheckCellPillStatus = "pass" | "fail" | "inconclusive" | "not_run" | "error";

/** What a `role=check` cell's head pill should show: the VERDICT, not the generic
 * capture status a plain code cell's pill shows. `cell.status === "ok"` only means the
 * worker's capture function ran — a check that captured cleanly and then judged the
 * subject as a fail is still "ok" by that measure, and a pill reading "Passed" on a
 * failing check (DESIGN.md §1.5's own words never say "verified", and this bug says
 * "Passed" regardless) is actively misleading. `"error"` is the one case the capture
 * status still wins outright: the sandbox crashed before it ever captured a subject, a
 * different failure from a judged check that failed, and there is no verdict to prefer
 * over it (`cell.checkVerdict` is `null` in that case too, same as not-run — this check
 * runs first so a genuine crash is never silently read as "not run yet"). */
export function checkCellPillStatus(cell: Pick<NotebookCellView, "status" | "checkVerdict">): CheckCellPillStatus {
  if (cell.status === "error") return "error";
  if (!cell.checkVerdict) return "not_run";
  return cell.checkVerdict.status;
}

// ------------------------------------------------------------------------- notebook-level summary

export interface CheckSummaryCounts {
  total: number;
  pass: number;
  fail: number;
  inconclusive: number;
  notRun: number;
  /** Nala-authored checks still awaiting a person's Accept — regardless of whether
   * they have been run yet. */
  proposedUnaccepted: number;
}

/** The notebook-level summary's numbers, from the joined cell views — "computed from the
 * report, not guessed" (the brief). `null` when the notebook has no check cells, so the
 * caller renders nothing rather than a summary of zero checks. */
export function checkSummaryCounts(cells: readonly NotebookCellView[]): CheckSummaryCounts | null {
  const checks = cells.filter((cell) => cell.role === "check" && cell.checkProperty !== null);
  if (checks.length === 0) return null;
  const counts: CheckSummaryCounts = { total: checks.length, pass: 0, fail: 0, inconclusive: 0, notRun: 0, proposedUnaccepted: 0 };
  for (const cell of checks) {
    const status = cell.checkVerdict?.status ?? null;
    if (status === "pass") counts.pass += 1;
    else if (status === "fail") counts.fail += 1;
    else if (status === "inconclusive") counts.inconclusive += 1;
    else counts.notRun += 1;
    const property = cell.checkProperty;
    if (property && property.author === "nala" && !property.accepted) counts.proposedUnaccepted += 1;
  }
  return counts;
}
