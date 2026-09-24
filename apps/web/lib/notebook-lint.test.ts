import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LINT_SEVERITY, lintCell, lintMessage, lintNotebook, type LintFinding } from "./notebook-lint.ts";
import { WORKSPACE_COPY } from "./workspace-locale.ts";

/**
 * The browser linter against the SAME case file the Python linter is tested against
 * (`packages/py/notebooks/tests/test_lint.py`). Read from its repo path, not copied: a
 * copy here would let the two rule sets drift apart with both suites green, which is the
 * failure the shared file exists to prevent.
 */
const CASES_URL = new URL("../../../packages/py/notebooks/tests/data/lint-cases.json", import.meta.url);

interface LintCase {
  name: string;
  source: string;
  preceding?: string[];
  python_only?: boolean;
  expect: { code: string; line: number }[];
}

const FILE = JSON.parse(readFileSync(CASES_URL, "utf8")) as { codes: Record<string, string>; cases: LintCase[] };
const BROWSER_CASES = FILE.cases.filter((item) => !item.python_only);

function codesAndLines(found: readonly LintFinding[]): [string, number][] {
  return found.map((item) => [item.code, item.line] as [string, number]).sort();
}

test("the shared case file is there and big enough to mean something", () => {
  // An empty or mis-pathed file must not pass: the per-case test below would simply
  // loop over nothing and stay green.
  assert.ok(BROWSER_CASES.length >= 20, `only ${BROWSER_CASES.length} browser cases`);
});

test("every code has the severity the case file and lint.py give it", () => {
  assert.deepEqual(LINT_SEVERITY, FILE.codes);
});

for (const item of BROWSER_CASES) {
  test(`shared case: ${item.name}`, () => {
    const found = lintCell(item.source, item.preceding ?? []);
    const want = item.expect.map((entry) => [entry.code, entry.line] as [string, number]).sort();
    assert.deepEqual(codesAndLines(found), want, JSON.stringify(found));
  });
}

test("the production failure names the chained call itself", () => {
  const item = FILE.cases.find((entry) => entry.name === "today's production failure");
  assert.ok(item);
  const [finding] = lintCell(item.source);
  const message = lintMessage(finding, WORKSPACE_COPY.en.notebooks.ide.lint);
  assert.match(message, /QuantumCircuit\(1\)\.h\(0\)/);
  assert.match(message, /InstructionSet/);
  // The underline covers exactly the call, on the line it is on.
  assert.equal(finding.line, 5);
  const line = item.source.split("\n")[4];
  assert.equal(line.slice(finding.col - 1, finding.endCol - 1), "QuantumCircuit(1).h(0)");
});

test("strings, comments and docstrings never trigger a rule", () => {
  const source = [
    '"""QuantumCircuit(1).h(0) and from qiskit import execute"""',
    "note = f'{len(x)} ' 'qc.bind_parameters(x)'",
    "# sv = Statevector(qc) after qc.measure_all()",
    "text = r'from qiskit.opflow import X'  # print(qc.qasm())",
    "",
  ].join("\n");
  assert.deepEqual(lintCell(source), []);
});

test("a line the parser cannot read forgets the names it mentions, so it cannot cause a false alarm", () => {
  // `qc` is measured, then rebound by a statement this parser refuses (two operands in a
  // row). Keeping the old knowledge would flag the Statevector line; forgetting cannot.
  const source = "qc = QuantumCircuit(1)\nqc.measure_all()\nqc = rebuilt() rebuilt()\nsv = Statevector(qc)\n";
  assert.deepEqual(lintCell(source), []);
  // The control: without the unreadable line, the same cell IS flagged.
  const control = "qc = QuantumCircuit(1)\nqc.measure_all()\nsv = Statevector(qc)\n";
  assert.deepEqual(codesAndLines(lintCell(control)), [["measured-circuit-has-no-statevector", 3]]);
});

test("a half-typed cell does not throw and still checks the lines it can read", () => {
  const source = "qc = QuantumCircuit(1).h(0)\nprint(qc\n";
  assert.deepEqual(codesAndLines(lintCell(source)), [["gate-returns-instructions", 1]]);
  assert.deepEqual(lintCell("s = 'unterminated\n"), []);
  assert.deepEqual(lintCell('"""never closed\nqc.h(0)\n'), []);
});

test("compound statements, inline bodies and parenthesised statements read like Python", () => {
  assert.deepEqual(lintCell("qc = QuantumCircuit(2)\nfor i in range(2): qc.h(i)\n(qc.cx(0, 1))\n"), []);
  assert.deepEqual(
    codesAndLines(lintCell("qc = QuantumCircuit(2)\nif True: out = qc.h(0)\n")),
    [["gate-returns-instructions", 2]],
  );
  assert.deepEqual(
    codesAndLines(lintCell("qc = QuantumCircuit(1)\ndef build(c=qc.x(0)):\n    return qc.h(0)\n")),
    [["gate-returns-instructions", 2], ["gate-returns-instructions", 3]],
  );
  // `.c_if(...)` was removed in Qiskit 2 -- certain to raise, not a false alarm to wave
  // through. (It used to be exempted here as "using the InstructionSet on purpose", back
  // when Qiskit 1 supported chaining it; `removed-qiskit-api` now names it specifically.)
  assert.deepEqual(codesAndLines(lintCell("qc = QuantumCircuit(1, 1)\nqc.x(0).c_if(0, 1)\n")), [
    ["removed-qiskit-api", 2],
  ]);
});

test("an annotated or chained assignment binds every target", () => {
  const source = "a = b = QuantumCircuit(1)\nc: QuantumCircuit = QuantumCircuit(1)\nb.measure_all()\nc.measure_all()\nStatevector(a)\nStatevector(b)\nStatevector(c)\n";
  assert.deepEqual(codesAndLines(lintCell(source)), [
    ["measured-circuit-has-no-statevector", 6],
    ["measured-circuit-has-no-statevector", 7],
  ]);
});

test("a name that looks like an API on the object prototype is not a removed API", () => {
  assert.deepEqual(lintCell("from qiskit import constructor, toString\n"), []);
});

test("lintNotebook reads names across code cells, skips markdown, and does not report cells that never run", () => {
  const findings = lintNotebook([
    { id: "c1", kind: "code", source: "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.measure_all()\n" },
    { id: "c2", kind: "markdown", source: "Statevector(qc) is not code here." },
    { id: "c3", kind: "code", source: "from qiskit.quantum_info import Statevector\nsv = Statevector(qc)\n" },
    { id: "c4", kind: "code", source: "print('fine')\n" },
    { id: "c5", kind: "code", source: "from qiskit import execute\n", execute: false },
  ]);
  assert.deepEqual(Object.keys(findings), ["c3"]);
  assert.equal(findings.c3[0].code, "measured-circuit-has-no-statevector");
});

test("data-meas-without-measure-all fires only when no cell anywhere creates a meas register", () => {
  // The production shape: a helper defined in one cell (c2) reads `.data.meas`, but it is
  // CALLED from a later cell (c3) with a circuit measured by plain `.measure(...)`, not
  // `measure_all()`. Neither cell alone shows the mistake to a per-cell, preceding-only
  // check; only knowing that NO cell in the whole notebook ever creates a "meas" register
  // makes it provable at c2, where the `.data.meas` text actually lives.
  const findings = lintNotebook([
    { id: "c1", kind: "code", source: "from qiskit import QuantumCircuit\nfrom qiskit.primitives import StatevectorSampler\n" },
    {
      id: "c2",
      kind: "code",
      source:
        "def run_and_count(qc, shots=1000):\n"
        + "    sampler = StatevectorSampler(seed=42)\n"
        + "    job = sampler.run([qc], shots=shots)\n"
        + "    return job.result()[0].data.meas.get_counts()\n",
    },
    {
      id: "c3",
      kind: "code",
      source: "qc = QuantumCircuit(1, 1)\nqc.h(0)\nqc.measure(0, 0)\ncounts = run_and_count(qc, shots=1000)\n",
    },
  ]);
  assert.deepEqual(Object.keys(findings), ["c2"]);
  assert.equal(findings.c2[0].code, "data-meas-without-measure-all");
});

test("data-meas-without-measure-all stands down when measure_all appears anywhere in the notebook", () => {
  // The control: an unrelated circuit elsewhere in the SAME notebook calls `measure_all()`,
  // so a "meas" register genuinely can exist somewhere in this notebook's universe of
  // behaviour, and the whole-notebook rule must stand down -- a false alarm here would
  // send a correct cell to the repair model in the real pipeline.
  const findings = lintNotebook([
    { id: "c1", kind: "code", source: "from qiskit import QuantumCircuit\n" },
    { id: "c2", kind: "code", source: "qc2 = QuantumCircuit(2)\nqc2.measure_all()\n" },
    {
      id: "c3",
      kind: "code",
      source:
        "def run_and_count(qc, shots=1000):\n"
        + "    job = sampler.run([qc], shots=shots)\n"
        + "    return job.result()[0].data.meas.get_counts()\n",
    },
  ]);
  assert.deepEqual(findings, {});
});

test("every finding shape has a message in English and in Japanese", () => {
  const shapes: LintFinding[] = [
    ...lintCell("qc = QuantumCircuit(1).h(0)\n"),
    ...lintCell("qc = QuantumCircuit(1)\nx = [qc.measure_all()]\n"),
    ...lintCell("qc = QuantumCircuit(1)\nqc.measure_all()\nStatevector(qc)\n"),
    ...lintCell("from qiskit import execute\n"),
    ...lintCell("from qiskit.circuit.library import QFTGate\nqft = QFTGate(3, inverse=True)\n"),
    ...lintCell("QuantumCircuit(1).h(0).num_qubits\n"),
    ...lintCell("counts = job.result()[0].data.meas.get_counts()\n", [], true),
  ];
  assert.equal(shapes.length, 7);
  for (const locale of ["en", "ja"] as const) {
    const copy = WORKSPACE_COPY[locale].notebooks.ide.lint;
    for (const finding of shapes) assert.ok(lintMessage(finding, copy).length > 10);
    for (const [api, message] of Object.entries(copy.removedApi)) assert.ok(message.length > 10, api);
  }
  // The Japanese copy is Japanese, not the English copy again.
  const ja = WORKSPACE_COPY.ja.notebooks.ide.lint;
  const en = WORKSPACE_COPY.en.notebooks.ide.lint;
  assert.notEqual(ja.gateReturnsInstructions("qc.h(0)"), en.gateReturnsInstructions("qc.h(0)"));
  assert.match(ja.measuredCircuit("qc"), /[぀-ヿ一-鿿]/);
});

test("data-meas-without-measure-all stands down when the circuit is read from OpenQASM text", () => {
  // The text may declare a register named "meas" that never appears in the notebook's code
  // (`_QASM_LOADERS` in lint.py). A literal register name that is not "meas" leaves the
  // rule armed, the control.
  const reader = { id: "c2", kind: "code" as const, source: "counts = job.result()[0].data.meas.get_counts()\n" };
  for (const setup of [
    "qc = qasm3.loads(program_text)\n",
    "from qiskit.qasm2 import loads\nqc = loads(program_text)\n",
    "qc = QuantumCircuit.from_qasm_str(program_text)\n",
  ]) {
    assert.deepEqual(lintNotebook([{ id: "c1", kind: "code", source: setup }, reader]), {}, setup);
  }
  const armed = lintNotebook([{ id: "c1", kind: "code", source: "qc = QuantumCircuit(2, 2)\n" }, reader]);
  assert.deepEqual(Object.keys(armed), ["c2"]);
});
