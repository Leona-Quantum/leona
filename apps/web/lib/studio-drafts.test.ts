import assert from "node:assert/strict";
import test from "node:test";

import { CIRCUIT_FRAMEWORKS } from "./circuit-frameworks.ts";
import {
  canvasSeedCandidates,
  draftSourceFramework,
  studioDraftBundle,
  type StudioDraftArtifact,
} from "./studio-drafts.ts";
import { parseCircuitSource, reconstructInterchangeCircuit } from "./circuit-conversion.ts";

const COPY = {
  sourceFallbackNote: (target: string, source: string) => `no ${target} conversion; showing ${source}`,
};

/** Shape a real LLM run produces: the pipeline's framework-native Python, with
 * transpile/AerSimulator boilerplate the editable parser deliberately rejects. */
const LLM_QISKIT = `from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

def build_circuit():
    qc = QuantumCircuit(3, 3)
    qc.h(0)
    qc.cx(0, 1)
    qc.cx(1, 2)
    qc.measure([0, 1, 2], [0, 1, 2])
    return qc

FINAL_CIRCUIT = build_circuit()
sim = AerSimulator()
counts = sim.run(transpile(FINAL_CIRCUIT, sim), shots=2048).result().get_counts()
RESULT = {"counts": counts}
`;

/** Shape Qiskit's qasm3 exporter produces: a `meas` register and per-qubit
 * measurement, which is what the worker actually stores as interchange. */
const LLM_QASM = `OPENQASM 3.0;
include "stdgates.inc";
bit[3] meas;
qubit[3] q;
h q[0];
cx q[0], q[1];
cx q[1], q[2];
meas[0] = measure q[0];
meas[1] = measure q[1];
meas[2] = measure q[2];
`;

const BELL = `from qiskit import QuantumCircuit

qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()
`;

function emptyKeys(artifact: StudioDraftArtifact): string[] {
  const bundle = studioDraftBundle(artifact, COPY);
  return CIRCUIT_FRAMEWORKS.filter(({ key }) => !bundle.codes[key]).map(({ key }) => key);
}

test("an LLM run with stored interchange converts to every framework", () => {
  const bundle = studioDraftBundle({ framework: "qiskit", code: LLM_QISKIT, qasm: LLM_QASM }, COPY);

  for (const framework of CIRCUIT_FRAMEWORKS) {
    assert.ok(bundle.codes[framework.key].trim(), framework.label);
  }
  assert.deepEqual(bundle.fallbacks, {}, "nothing should need a source reference here");
  assert.match(bundle.codes.qmod, /allocate\(3, q\)/);
  assert.match(bundle.codes.cirq, /cirq\.LineQubit\.range\(3\)/);
});

test("a run whose best-effort export never happened shows a source reference, never a blank tab", () => {
  // Export is best-effort in the fixed pipeline (ADR-0023), so `qasm` is null
  // for every run whose conversion stage did not produce one. Six of the seven
  // tabs used to open as the empty string.
  const bundle = studioDraftBundle({ framework: "qiskit", code: LLM_QISKIT, qasm: null }, COPY);

  assert.deepEqual(emptyKeys({ framework: "qiskit", code: LLM_QISKIT, qasm: null }), []);
  assert.equal(bundle.codes.qiskit, LLM_QISKIT);
  for (const framework of CIRCUIT_FRAMEWORKS) {
    if (framework.key === "qiskit") continue;
    assert.equal(bundle.codes[framework.key], LLM_QISKIT, framework.label);
    assert.equal(bundle.fallbacks[framework.key], "qiskit", framework.label);
    assert.match(bundle.notes[framework.key] ?? "", /showing Qiskit/);
  }
});

test("a source fallback reports the framework the code is really written in", () => {
  const bundle = studioDraftBundle({ framework: "qiskit", code: LLM_QISKIT, qasm: null }, COPY);

  // The tab says PennyLane; the text is Qiskit. Everything that pairs code with
  // a framework — export header, run request, parser — has to see Qiskit, or it
  // writes a false provenance line and submits source that cannot run.
  assert.equal(draftSourceFramework(bundle, "pennylane"), "qiskit");
  // A real conversion is not a fallback and resolves to itself.
  const converted = studioDraftBundle({ framework: "qiskit", code: BELL, qasm: null }, COPY);
  assert.equal(draftSourceFramework(converted, "pennylane"), "pennylane");
});

test("a circuit wider than the canvas still converts — drawing and translating are different limits", () => {
  const wide = [
    "from qiskit import QuantumCircuit",
    "",
    "qc = QuantumCircuit(8)",
    "qc.h(0)",
    ...Array.from({ length: 7 }, (_, index) => `qc.cx(${index}, ${index + 1})`),
    "qc.measure_all()",
  ].join("\n");

  const bundle = studioDraftBundle({ framework: "qiskit", code: wide, qasm: null }, COPY);

  assert.deepEqual(emptyKeys({ framework: "qiskit", code: wide, qasm: null }), []);
  assert.deepEqual(bundle.fallbacks, {}, "an 8-qubit portable circuit needs no fallback");
  assert.match(bundle.codes.openqasm3, /qubit\[8\] q;/);
});

test("a stored variant is never overwritten by a conversion of itself", () => {
  const handWritten = "import pennylane as qml\n# a researcher's own annotated source\n";
  const bundle = studioDraftBundle(
    { framework: "qiskit", code: BELL, qasm: null, frameworkVariants: { PennyLane: handWritten } },
    COPY,
  );

  assert.equal(bundle.codes.pennylane, handWritten);
  assert.equal(bundle.fallbacks.pennylane, undefined);
  assert.match(bundle.codes.cirq, /cirq\.Circuit/);
});

test("an artifact with no code at all yields empty drafts rather than inventing one", () => {
  const bundle = studioDraftBundle({ framework: "qiskit" }, COPY);

  for (const framework of CIRCUIT_FRAMEWORKS) {
    assert.equal(bundle.codes[framework.key], "", framework.label);
  }
  assert.deepEqual(bundle.fallbacks, {});
});

test("interchange held only as a framework variant still reaches the canvas", () => {
  // Exporter-style OpenQASM — `meas` register, per-qubit measurement — which the
  // strict editable parser rejects by design and only the permissive interchange
  // reader can draw. When it arrives as a framework variant rather than in the
  // artifact's own `qasm` column, the canvas seed used to consult `qasm` alone
  // and opened empty. The draft bundle surfaces it as the openqasm3 draft, which
  // is what seedForArtifact now feeds to the interchange reader.
  const artifact: StudioDraftArtifact = {
    framework: "qiskit",
    code: LLM_QISKIT,
    qasm: null,
    frameworkVariants: { "OpenQASM 3.0": LLM_QASM },
  };
  const bundle = studioDraftBundle(artifact, COPY);

  assert.equal(parseCircuitSource(LLM_QASM, "openqasm3"), null, "precondition: the editable parser rejects it");
  assert.equal(bundle.codes.openqasm3, LLM_QASM, "the variant must land on the openqasm3 draft");
  const reconstructed = reconstructInterchangeCircuit(bundle.codes.openqasm3);
  assert.equal(reconstructed.kind, "ok");
  assert.equal(reconstructed.kind === "ok" ? reconstructed.circuit.qubitCount : 0, 3);
});

test("the canvas seed never hands a fallback draft to the wrong language's parser", () => {
  const artifact: StudioDraftArtifact = { framework: "qiskit", code: LLM_QISKIT, qasm: null };
  const bundle = studioDraftBundle(artifact, COPY);
  const candidates = canvasSeedCandidates(artifact, bundle.codes, "pennylane", bundle.fallbacks);

  // The PennyLane tab holds Qiskit source; it must be offered as Qiskit.
  const first = candidates[0];
  assert.equal(first.framework, "qiskit");
  assert.equal(first.code, LLM_QISKIT);
  assert.ok(
    candidates.every((candidate) => candidate.framework !== "pennylane" || parseCircuitSource(candidate.code, "pennylane")),
    "no candidate may claim to be PennyLane source the PennyLane parser rejects",
  );
});

test("Classiq is accepted as a spelling of Qmod", () => {
  const bundle = studioDraftBundle(
    { framework: "classiq", code: "from classiq import *\n# native\n" },
    COPY,
  );

  assert.match(bundle.codes.qmod, /# native/);
});
