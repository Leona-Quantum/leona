import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCheckAccept,
  buildCheckCell,
  buildCheckProperty,
  buildReferenceString,
  checkAuthorBadge,
  checkCellPillStatus,
  checkCellSource,
  checkExpectationMode,
  checkExpressionError,
  checkSummaryCounts,
  draftCheckStatement,
  emptyCheckDraft,
  insertCheckCellAfter,
  isNumericLiteral,
  nextCheckCellId,
  referenceTakesQubitCount,
  subjectHintFor,
  validateCheckDraft,
  type CheckDraft,
  type CheckStatementLabels,
} from "./notebook-checks.ts";
import type { NotebookCellView } from "./notebook-view.ts";

// -------------------------------------------------------------- expressions / numbers

test("isNumericLiteral accepts plain numbers, signs and exponents; rejects everything else", () => {
  assert.equal(isNumericLiteral("1"), true);
  assert.equal(isNumericLiteral("-0.5"), true);
  assert.equal(isNumericLiteral("+3.14"), true);
  assert.equal(isNumericLiteral("1e-3"), true);
  assert.equal(isNumericLiteral(".5"), true);
  assert.equal(isNumericLiteral(""), false);
  assert.equal(isNumericLiteral("sqrt(2)"), false);
  assert.equal(isNumericLiteral("1/2"), false);
});

test("checkExpressionError accepts the whitelist grammar and names what it refuses", () => {
  assert.equal(checkExpressionError("sqrt(1/2)"), null);
  assert.equal(checkExpressionError("1/sqrt(2)"), null);
  assert.equal(checkExpressionError("(1+1j)/2"), null);
  assert.equal(checkExpressionError("pi/4"), null);
  assert.match(checkExpressionError("") ?? "", /blank/);
  assert.match(checkExpressionError("import os") ?? "", /"import"/);
  // Not on the whitelist (`leona_notebooks.checks`'s evaluator has no `tan`).
  assert.match(checkExpressionError("tan(1)") ?? "", /"tan"/);
});

// -------------------------------------------------------------- reference library

test("buildReferenceString: a fixed-size family ignores the qubit field", () => {
  const built = buildReferenceString("bell:psi-", "");
  assert.deepEqual(built, { value: "bell:psi-" });
});

test("buildReferenceString: a parametrized family needs a whole number in range", () => {
  assert.deepEqual(buildReferenceString("ghz", "4"), { value: "ghz(4)" });
  assert.deepEqual(buildReferenceString("qft", "12"), { value: "qft(12)" });
  assert.ok("error" in buildReferenceString("qft", "13")); // over the unitary ceiling (12)
  assert.ok("error" in buildReferenceString("ghz", "0"));
  assert.ok("error" in buildReferenceString("ghz", "abc"));
});

test("referenceTakesQubitCount is false only for the four fixed Bell variants", () => {
  assert.equal(referenceTakesQubitCount("bell"), false);
  assert.equal(referenceTakesQubitCount("bell:phi-"), false);
  assert.equal(referenceTakesQubitCount("bell:psi+"), false);
  assert.equal(referenceTakesQubitCount("bell:psi-"), false);
  assert.equal(referenceTakesQubitCount("ghz"), true);
  assert.equal(referenceTakesQubitCount("qft"), true);
});

// -------------------------------------------------------------- draft validation

function stateDraft(overrides: Partial<CheckDraft> = {}): CheckDraft {
  return { ...emptyCheckDraft("state", "qc"), ...overrides };
}

test("a well-formed state/reference draft validates clean", () => {
  const draft = stateDraft({ referenceFamily: "ghz", referenceQubits: "3" });
  assert.deepEqual(validateCheckDraft(draft), []);
});

test("an empty or non-identifier subject is refused, by name", () => {
  assert.match(validateCheckDraft(stateDraft({ subject: "" })).join(" "), /Name the variable/);
  assert.match(validateCheckDraft(stateDraft({ subject: "1bad" })).join(" "), /variable name/);
  assert.match(validateCheckDraft(stateDraft({ subject: "class" })).join(" "), /keyword/);
});

test("amplitudes: inconsistent bitstring widths and a bad expression are both refused", () => {
  const draft = stateDraft({
    stateMode: "amplitudes",
    amplitudes: [
      { bitstring: "00", expr: "1/sqrt(2)" },
      { bitstring: "111", expr: "1/sqrt(2)" },
    ],
  });
  const errors = validateCheckDraft(draft);
  assert.match(errors.join(" "), /same length/);
});

test("amplitudes: a probability-only rule (no negatives) does not apply to amplitudes", () => {
  // Amplitudes may be negative (a real amplitude can be); only `distribution` forbids it.
  const draft = stateDraft({ stateMode: "amplitudes", amplitudes: [{ bitstring: "0", expr: "-1" }] });
  assert.deepEqual(validateCheckDraft(draft), []);
});

test("distribution: a negative probability is refused", () => {
  const draft: CheckDraft = {
    ...emptyCheckDraft("distribution", "counts"),
    probabilities: [{ bitstring: "0", expr: "-0.1" }, { bitstring: "1", expr: "1.1" }],
  };
  assert.match(validateCheckDraft(draft).join(" "), /cannot be negative/);
});

test("energy: mismatched Hamiltonian term widths and a non-finite target are both refused", () => {
  const draft: CheckDraft = {
    ...emptyCheckDraft("energy", "qc"),
    hamiltonian: [{ pauli: "Z", coefficient: "1" }, { pauli: "ZZ", coefficient: "0.5" }],
    target: "number",
    targetValue: "not-a-number",
  };
  const errors = validateCheckDraft(draft).join(" ");
  assert.match(errors, /same number of qubits/);
  assert.match(errors, /finite number/);
});

test("value: a non-numeric entry in a comma list is named", () => {
  const draft: CheckDraft = { ...emptyCheckDraft("value", "p"), value: "0.5, oops" };
  assert.match(validateCheckDraft(draft).join(" "), /"oops"/);
});

test("tolerance: negative is refused, and a ceiling kind at or above 1.0 cannot ever fail", () => {
  assert.match(validateCheckDraft(stateDraft({ tolerance: "-0.1" })).join(" "), /negative/);
  const overCeiling = stateDraft({ referenceFamily: "bell", tolerance: "1.0" });
  assert.match(validateCheckDraft(overCeiling).join(" "), /could never fail/);
  // Energy has no ceiling — a large tolerance is unusual but not refused for this reason.
  const energy: CheckDraft = { ...emptyCheckDraft("energy", "qc"), tolerance: "5" };
  assert.equal(validateCheckDraft(energy).some((message) => /could never fail/.test(message)), false);
});

// -------------------------------------------------------------- building the property

test("buildCheckProperty: state/amplitudes carries numeric literals as numbers, expressions as strings", () => {
  const draft = stateDraft({
    stateMode: "amplitudes",
    amplitudes: [{ bitstring: "00", expr: "0.5" }, { bitstring: "11", expr: "sqrt(1/2)" }],
  });
  const property = buildCheckProperty(draft);
  assert.equal(property.kind, "state");
  assert.deepEqual(property.amplitudes, { "00": 0.5, "11": "sqrt(1/2)" });
  assert.equal(property.reference, null);
});

test("buildCheckProperty: a blank tolerance means null — the contract fills in the kind's default", () => {
  const property = buildCheckProperty(stateDraft({ referenceFamily: "bell" }));
  assert.equal(property.tolerance, null);
  const withTolerance = buildCheckProperty(stateDraft({ referenceFamily: "bell", tolerance: "0.001" }));
  assert.equal(withTolerance.tolerance, 0.001);
});

test("buildCheckProperty: energy carries the Hamiltonian as a record and 'ground' or a number as target", () => {
  const ground = buildCheckProperty({
    ...emptyCheckDraft("energy", "qc"),
    hamiltonian: [{ pauli: "Z", coefficient: "1" }, { pauli: "X", coefficient: "0.5" }],
  });
  assert.deepEqual(ground.hamiltonian, { Z: 1, X: 0.5 });
  assert.equal(ground.target, "ground");

  const numeric = buildCheckProperty({
    ...emptyCheckDraft("energy", "qc"),
    hamiltonian: [{ pauli: "Z", coefficient: "1" }],
    target: "number",
    targetValue: "-1.5",
  });
  assert.equal(numeric.target, -1.5);
});

test("buildCheckProperty: value is a bare number for one entry, an array for several", () => {
  const one = buildCheckProperty({ ...emptyCheckDraft("value", "p"), value: "0.5" });
  assert.equal(one.value, 0.5);
  const many = buildCheckProperty({ ...emptyCheckDraft("value", "p"), value: "0.5, 1.2, -3" });
  assert.deepEqual(many.value, [0.5, 1.2, -3]);
});

// -------------------------------------------------------------- the auto-drafted statement

const LABELS: CheckStatementLabels = {
  referenceLabel: {
    bell: "the Bell state",
    "bell:phi-": "Phi-",
    "bell:psi+": "Psi+",
    "bell:psi-": "Psi-",
    ghz: "a GHZ state",
    w: "a W state",
    uniform: "a uniform superposition",
    qft: "the QFT",
    iqft: "the inverse QFT",
  },
  state: (subject, reference) => `Check that ${subject} prepares ${reference}.`,
  stateAmplitudes: (subject) => `Check that ${subject}'s amplitudes match.`,
  unitary: (subject, reference) => `Check that ${subject}'s unitary matches ${reference}.`,
  distribution: (subject) => `Check that ${subject}'s distribution matches.`,
  energyGround: (subject) => `Check ${subject}'s energy against the ground state.`,
  energyTarget: (subject, target) => `Check ${subject}'s energy against ${target}.`,
  value: (subject, value) => `Check that ${subject} equals ${value}.`,
  subjectFallback: "the subject",
};

test("draftCheckStatement names the reference for a state/reference draft", () => {
  const draft = stateDraft({ subject: "qc", referenceFamily: "ghz", referenceQubits: "3" });
  assert.equal(draftCheckStatement(draft, LABELS), "Check that qc prepares a GHZ state.");
});

test("draftCheckStatement falls back to a placeholder subject when none is typed yet", () => {
  const draft = stateDraft({ subject: "", referenceFamily: "bell" });
  assert.equal(draftCheckStatement(draft, LABELS), "Check that the subject prepares the Bell state.");
});

test("checkExpectationMode: state reads its own toggle, every other kind is fixed", () => {
  assert.equal(checkExpectationMode({ kind: "state", stateMode: "amplitudes" }), "amplitudes");
  assert.equal(checkExpectationMode({ kind: "unitary", stateMode: "amplitudes" }), "reference");
  assert.equal(checkExpectationMode({ kind: "distribution", stateMode: "reference" }), "probabilities");
  assert.equal(checkExpectationMode({ kind: "energy", stateMode: "reference" }), "hamiltonian");
  assert.equal(checkExpectationMode({ kind: "value", stateMode: "reference" }), "value");
});

// -------------------------------------------------------------- cell construction

test("checkCellSource renders the statement as a comment", () => {
  assert.equal(checkCellSource("bell prepares (|00> + |11>)/sqrt(2)"), "# check: bell prepares (|00> + |11>)/sqrt(2)");
});

test("buildCheckCell always sets author=user, accepted=true — a reader who writes a check has, by writing it, accepted it", () => {
  const property = buildCheckProperty(stateDraft({ referenceFamily: "bell" }), "nala"); // even if someone tried to sneak "nala" in
  const cell = buildCheckCell("c05", property);
  assert.equal(cell.role, "check");
  assert.equal(cell.kind, "code");
  assert.equal(cell.property?.author, "user");
  assert.equal(cell.property?.accepted, true);
  assert.equal(cell.stub, null);
  assert.equal(cell.check, null);
});

test("insertCheckCellAfter places the new cell right after the named one, with the next free id", () => {
  const cells = [
    { id: "c01", kind: "code" as const, role: null, source: "", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: null },
    { id: "c02", kind: "code" as const, role: null, source: "", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: null },
  ];
  const property = buildCheckProperty(stateDraft({ referenceFamily: "bell" }));
  const { cells: next, id } = insertCheckCellAfter(cells, "c01", property);
  assert.equal(id, "c03");
  assert.deepEqual(next.map((cell) => cell.id), ["c01", "c03", "c02"]);
});

test("nextCheckCellId agrees with the plain cell insertion's id scheme (cNN, lowest free)", () => {
  const cells = [{ id: "c01", kind: "code" as const, role: null, source: "", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: null }];
  assert.equal(nextCheckCellId(cells), "c02");
});

test("subjectHintFor finds the last top-level assignment in the preceding code cell", () => {
  const cells = [
    { id: "c01", kind: "code" as const, role: null, source: "a = 1\nqc = build()\n", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: null },
    { id: "c02", kind: "markdown" as const, role: null, source: "text", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: null },
  ];
  assert.equal(subjectHintFor(cells, "c01"), "qc");
  // A markdown cell (or an unknown id) has no source to guess from.
  assert.equal(subjectHintFor(cells, "c02"), "");
  assert.equal(subjectHintFor(cells, "nope"), "");
});

test("applyCheckAccept sets accepted=true on the named cell and leaves everything else untouched", () => {
  const property = buildCheckProperty(stateDraft({ referenceFamily: "ghz", referenceQubits: "3" }), "nala");
  const cells = [
    { id: "c01", kind: "code" as const, role: "check" as const, source: "# check: x", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: { ...property, accepted: false } },
  ];
  const next = applyCheckAccept(cells, "c01");
  assert.equal(next[0].property?.accepted, true);
  // Author is left exactly as it was — Accept never claims an author change.
  assert.equal(next[0].property?.author, "nala");
  assert.equal(next[0].property?.kind, "state");
  assert.equal(next[0].property?.reference, "ghz(3)");
});

test("applyCheckAccept on an unknown id or a non-check cell is a no-op", () => {
  const cells = [
    { id: "c01", kind: "code" as const, role: null, source: "x = 1", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: null },
  ];
  assert.deepEqual(applyCheckAccept(cells, "c01"), cells);
  assert.deepEqual(applyCheckAccept(cells, "nope"), cells);
});

// -------------------------------------------------------------- author badge

test("checkAuthorBadge classifies the three authors, citation carried through for nala and source", () => {
  assert.deepEqual(checkAuthorBadge({ author: "nala", citation: "", accepted: false }), { kind: "nala", citation: "", accepted: false });
  assert.deepEqual(checkAuthorBadge({ author: "nala", citation: "Nielsen & Chuang, Box 1.1", accepted: true }), {
    kind: "nala",
    citation: "Nielsen & Chuang, Box 1.1",
    accepted: true,
  });
  assert.deepEqual(checkAuthorBadge({ author: "user", citation: "", accepted: true }), { kind: "user" });
  assert.deepEqual(checkAuthorBadge({ author: "source", citation: "arXiv:1234.5678", accepted: false }), {
    kind: "source",
    citation: "arXiv:1234.5678",
  });
});

// -------------------------------------------------------------- the cell-head pill

test("checkCellPillStatus prefers the verdict over the generic capture status", () => {
  assert.equal(checkCellPillStatus({ status: "ok", checkVerdict: { status: "fail" } as never }), "fail");
  assert.equal(checkCellPillStatus({ status: "ok", checkVerdict: { status: "inconclusive" } as never }), "inconclusive");
  assert.equal(checkCellPillStatus({ status: "ok", checkVerdict: { status: "pass" } as never }), "pass");
});

test("checkCellPillStatus is not_run when the capture ran but no verdict exists yet", () => {
  assert.equal(checkCellPillStatus({ status: "ok", checkVerdict: null }), "not_run");
});

test("checkCellPillStatus is error when the capture itself crashed, even with a stale verdict", () => {
  // A crashed capture never carries a verdict in practice (the join sets checkVerdict
  // from THIS run's result), but error wins even if one were somehow present — the
  // sandbox crashing is a different failure from a judged check that failed.
  assert.equal(checkCellPillStatus({ status: "error", checkVerdict: null }), "error");
  assert.equal(checkCellPillStatus({ status: "error", checkVerdict: { status: "pass" } as never }), "error");
});

// -------------------------------------------------------------- notebook-level summary

function checkCellView(overrides: Partial<NotebookCellView> = {}): NotebookCellView {
  return {
    id: "c1",
    kind: "code",
    role: "check",
    source: "# check",
    execute: true,
    status: "ok",
    stdout: "",
    stderr: "",
    outputs: [],
    error: null,
    truncated: false,
    durationMs: 10,
    cachedFromSeq: null,
    graded: false,
    answerPrompt: null,
    hardwareRequests: [],
    checkProperty: {
      kind: "state",
      subject: "qc",
      amplitudes: null,
      probabilities: null,
      reference: "bell",
      reference_qasm: null,
      hamiltonian: null,
      target: null,
      value: null,
      tolerance: 1e-6,
      statement: "bell prepares the Bell state",
      author: "nala",
      citation: "",
      accepted: false,
    },
    checkVerdict: null,
    ...overrides,
  };
}

test("checkSummaryCounts is null when the notebook has no check cells", () => {
  assert.equal(checkSummaryCounts([checkCellView({ role: "run", checkProperty: null })]), null);
});

test("checkSummaryCounts tallies pass/fail/inconclusive/not-run and unaccepted Nala proposals", () => {
  const cells: NotebookCellView[] = [
    checkCellView({ id: "c1", checkVerdict: { status: "pass", basis: "circuit" } as NotebookCellView["checkVerdict"] }),
    checkCellView({ id: "c2", checkVerdict: { status: "pass", basis: "circuit" } as NotebookCellView["checkVerdict"] }),
    checkCellView({ id: "c3", checkVerdict: { status: "pass", basis: "circuit" } as NotebookCellView["checkVerdict"] }),
    checkCellView({
      id: "c4",
      checkVerdict: { status: "inconclusive", basis: "circuit" } as NotebookCellView["checkVerdict"],
      checkProperty: { ...checkCellView().checkProperty!, author: "nala", accepted: false },
    }),
  ];
  const counts = checkSummaryCounts(cells);
  assert.deepEqual(counts, { total: 4, pass: 3, fail: 0, inconclusive: 1, notRun: 0, proposedUnaccepted: 4 });
});

test("checkSummaryCounts counts a not-yet-run check separately from a fail", () => {
  const cells = [checkCellView({ checkVerdict: null })];
  const counts = checkSummaryCounts(cells);
  assert.equal(counts?.notRun, 1);
  assert.equal(counts?.fail, 0);
});
