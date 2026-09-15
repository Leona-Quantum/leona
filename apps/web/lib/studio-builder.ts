import type { CircuitFrameworkKey } from "./circuit-frameworks";

export type BuiltinBuilderGate =
  | "H" | "X" | "Y" | "Z" | "S" | "T" | "SDG" | "TDG"
  | "RX" | "RY" | "RZ" | "P"
  | "CX" | "CZ" | "SWAP" | "CP" | "RZZ"
  | "CCX"
  | "M";
export type BuilderGate = BuiltinBuilderGate | "CUSTOM";
export type BuilderCodeVariants = Record<CircuitFrameworkKey, string>;

export type BuilderStep = {
  id: string;
  gate: BuilderGate;
  qubits: number[];
  param?: string;
  customGateId?: string;
};

export type CustomGateDefinition = {
  id: string;
  name: string;
  qubitCount: number;
  steps: BuilderStep[];
  /** Framework-native operation drawn faithfully but not safely regenerable. */
  opaque?: boolean;
};

export const BUILDER_GATES: BuiltinBuilderGate[] = [
  "H", "X", "Y", "Z", "S", "T", "SDG", "TDG",
  "RX", "RY", "RZ", "P",
  "CX", "CZ", "SWAP", "CP", "RZZ",
  "CCX",
  "M",
];
/** Every two-qubit builtin, entanglers and the two-qubit parameterized gates alike. */
export const TWO_QUBIT_GATES: BuiltinBuilderGate[] = ["CX", "CZ", "SWAP", "CP", "RZZ"];
/** The one three-qubit builtin. A qubit-count switch that only knows "one or two"
 * silently truncates CCX's third wire — every arity check in this file and its
 * callers goes through `builderGateArity` instead of a bare ternary. */
export const THREE_QUBIT_GATES: BuiltinBuilderGate[] = ["CCX"];
/** The three original single-qubit rotations. Unchanged in meaning: still
 * exactly "one qubit, needs an angle". P is angle-carrying and single-qubit
 * too, but it is not a rotation about a Bloch axis, so it lives in
 * `ANGLE_GATES` below rather than silently widening what this name means. */
export const ROTATION_GATES: BuiltinBuilderGate[] = ["RX", "RY", "RZ"];
/** Every builtin whose BuilderStep must carry an angle `param` — the three
 * rotations plus the phase gate and the two parameterized two-qubit gates. */
export const ANGLE_GATES: BuiltinBuilderGate[] = ["RX", "RY", "RZ", "P", "CP", "RZZ"];

/** How many qubits a builtin gate's `qubits` array must hold. */
export function builderGateArity(gate: BuiltinBuilderGate): 1 | 2 | 3 {
  if ((THREE_QUBIT_GATES as string[]).includes(gate)) return 3;
  if ((TWO_QUBIT_GATES as string[]).includes(gate)) return 2;
  return 1;
}

/** Whether a builtin gate's BuilderStep must carry an angle `param`. */
export function builderGateNeedsAngle(gate: BuiltinBuilderGate): boolean {
  return (ANGLE_GATES as string[]).includes(gate);
}

export function createBuilderStepId(prefix = "step"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function customGateFunctionName(gate: CustomGateDefinition): string {
  const slug = gate.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "gate";
  const idSuffix = gate.id.replaceAll(/[^a-z0-9]/gi, "").slice(-6) || "group";
  return `custom_${slug}_${idSuffix}`;
}

export function builderStepLabel(step: BuilderStep, customGates: CustomGateDefinition[]): string {
  if (step.gate !== "CUSTOM") return step.gate;
  return customGates.find((gate) => gate.id === step.customGateId)?.name ?? "Custom gate";
}

function usedCustomGates(steps: BuilderStep[], customGates: CustomGateDefinition[]): CustomGateDefinition[] {
  const byId = new Map(customGates.map((gate) => [gate.id, gate]));
  const usedIds = new Set<string>();
  const visit = (id: string, ancestors: ReadonlySet<string>) => {
    if (ancestors.has(id) || usedIds.has(id)) return;
    const gate = byId.get(id);
    if (!gate) return;
    usedIds.add(id);
    const nextAncestors = new Set(ancestors).add(id);
    for (const step of gate.steps) {
      if (step.gate === "CUSTOM" && step.customGateId) visit(step.customGateId, nextAncestors);
    }
  };
  for (const step of steps) {
    if (step.gate === "CUSTOM" && step.customGateId) visit(step.customGateId, new Set());
  }
  return customGates.filter((gate) => usedIds.has(gate.id));
}

type QubitReference = (qubit: number) => string;

function qiskitOperation(step: BuilderStep, resolve: QubitReference, customGates: CustomGateDefinition[]): string {
  const [a, b, c] = step.qubits;
  switch (step.gate) {
    case "H": return `qc.h(${resolve(a)})`;
    case "X": return `qc.x(${resolve(a)})`;
    case "Y": return `qc.y(${resolve(a)})`;
    case "Z": return `qc.z(${resolve(a)})`;
    case "S": return `qc.s(${resolve(a)})`;
    case "T": return `qc.t(${resolve(a)})`;
    case "SDG": return `qc.sdg(${resolve(a)})`;
    case "TDG": return `qc.tdg(${resolve(a)})`;
    case "RX": return `qc.rx(${step.param}, ${resolve(a)})`;
    case "RY": return `qc.ry(${step.param}, ${resolve(a)})`;
    case "RZ": return `qc.rz(${step.param}, ${resolve(a)})`;
    case "P": return `qc.p(${step.param}, ${resolve(a)})`;
    case "CX": return `qc.cx(${resolve(a)}, ${resolve(b)})`;
    case "CZ": return `qc.cz(${resolve(a)}, ${resolve(b)})`;
    case "SWAP": return `qc.swap(${resolve(a)}, ${resolve(b)})`;
    case "CP": return `qc.cp(${step.param}, ${resolve(a)}, ${resolve(b)})`;
    case "RZZ": return `qc.rzz(${step.param}, ${resolve(a)}, ${resolve(b)})`;
    case "CCX": return `qc.ccx(${resolve(a)}, ${resolve(b)}, ${resolve(c)})`;
    case "CUSTOM": {
      const custom = customGates.find((gate) => gate.id === step.customGateId);
      return custom
        ? `${customGateFunctionName(custom)}(qc, [${step.qubits.map(resolve).join(", ")}])`
        : "# missing custom gate";
    }
    case "M": return "";
  }
}

function pennylaneOperation(step: BuilderStep, resolve: QubitReference, customGates: CustomGateDefinition[]): string {
  const [a, b, c] = step.qubits;
  switch (step.gate) {
    case "H": return `qml.Hadamard(wires=${resolve(a)})`;
    case "X": return `qml.PauliX(wires=${resolve(a)})`;
    case "Y": return `qml.PauliY(wires=${resolve(a)})`;
    case "Z": return `qml.PauliZ(wires=${resolve(a)})`;
    case "S": return `qml.S(wires=${resolve(a)})`;
    case "T": return `qml.T(wires=${resolve(a)})`;
    // PennyLane has no dedicated dagger gates; `qml.adjoint` is the documented
    // way to invert any operator, S and T included.
    case "SDG": return `qml.adjoint(qml.S)(wires=${resolve(a)})`;
    case "TDG": return `qml.adjoint(qml.T)(wires=${resolve(a)})`;
    case "RX": return `qml.RX(${step.param}, wires=${resolve(a)})`;
    case "RY": return `qml.RY(${step.param}, wires=${resolve(a)})`;
    case "RZ": return `qml.RZ(${step.param}, wires=${resolve(a)})`;
    case "P": return `qml.PhaseShift(${step.param}, wires=${resolve(a)})`;
    case "CX": return `qml.CNOT(wires=[${resolve(a)}, ${resolve(b)}])`;
    case "CZ": return `qml.CZ(wires=[${resolve(a)}, ${resolve(b)}])`;
    case "SWAP": return `qml.SWAP(wires=[${resolve(a)}, ${resolve(b)}])`;
    case "CP": return `qml.ControlledPhaseShift(${step.param}, wires=[${resolve(a)}, ${resolve(b)}])`;
    // IsingZZ(phi) = exp(-i phi/2 Z⊗Z), the same convention this file's RZZ uses.
    case "RZZ": return `qml.IsingZZ(${step.param}, wires=[${resolve(a)}, ${resolve(b)}])`;
    case "CCX": return `qml.Toffoli(wires=[${resolve(a)}, ${resolve(b)}, ${resolve(c)}])`;
    case "CUSTOM": {
      const custom = customGates.find((gate) => gate.id === step.customGateId);
      return custom
        ? `${customGateFunctionName(custom)}([${step.qubits.map(resolve).join(", ")}])`
        : "# missing custom gate";
    }
    case "M": return "";
  }
}

function cirqOperation(step: BuilderStep, resolve: QubitReference, customGates: CustomGateDefinition[]): string {
  const [a, b, c] = step.qubits;
  switch (step.gate) {
    case "H": return `cirq.H(${resolve(a)})`;
    case "X": return `cirq.X(${resolve(a)})`;
    case "Y": return `cirq.Y(${resolve(a)})`;
    case "Z": return `cirq.Z(${resolve(a)})`;
    case "S": return `cirq.S(${resolve(a)})`;
    case "T": return `cirq.T(${resolve(a)})`;
    // Cirq has no dedicated dagger constants; `**-1` on the (EigenGate) S/T
    // gates is the documented way to invert them.
    case "SDG": return `(cirq.S**-1)(${resolve(a)})`;
    case "TDG": return `(cirq.T**-1)(${resolve(a)})`;
    case "RX": return `cirq.rx(${step.param}).on(${resolve(a)})`;
    case "RY": return `cirq.ry(${step.param}).on(${resolve(a)})`;
    case "RZ": return `cirq.rz(${step.param}).on(${resolve(a)})`;
    // ZPowGate(exponent=t) applies diag(1, e^{i*pi*t}); dividing by pi converts
    // this file's radians into that "turns" exponent.
    case "P": return `cirq.ZPowGate(exponent=(${step.param})/pi).on(${resolve(a)})`;
    case "CX": return `cirq.CNOT(${resolve(a)}, ${resolve(b)})`;
    case "CZ": return `cirq.CZ(${resolve(a)}, ${resolve(b)})`;
    case "SWAP": return `cirq.SWAP(${resolve(a)}, ${resolve(b)})`;
    case "CP": return `cirq.CZPowGate(exponent=(${step.param})/pi).on(${resolve(a)}, ${resolve(b)})`;
    case "RZZ": return `cirq.rzz(${step.param}).on(${resolve(a)}, ${resolve(b)})`;
    case "CCX": return `cirq.CCX(${resolve(a)}, ${resolve(b)}, ${resolve(c)})`;
    case "CUSTOM": {
      const custom = customGates.find((gate) => gate.id === step.customGateId);
      return custom
        ? `*${customGateFunctionName(custom)}([${step.qubits.map(resolve).join(", ")}])`
        : "# missing custom gate";
    }
    case "M": return "";
  }
}

function qiskitDefinition(gate: CustomGateDefinition, customGates: CustomGateDefinition[]): string[] {
  const operations = gate.steps.map((step) => qiskitOperation(step, (qubit) => `qubits[${qubit}]`, customGates)).filter(Boolean);
  return [`def ${customGateFunctionName(gate)}(qc, qubits):`, ...(operations.length ? operations.map((line) => `    ${line}`) : ["    pass"])];
}

function pennylaneDefinition(gate: CustomGateDefinition, customGates: CustomGateDefinition[]): string[] {
  const operations = gate.steps.map((step) => pennylaneOperation(step, (qubit) => `wires[${qubit}]`, customGates)).filter(Boolean);
  return [`def ${customGateFunctionName(gate)}(wires):`, ...(operations.length ? operations.map((line) => `    ${line}`) : ["    pass"])];
}

function cirqDefinition(gate: CustomGateDefinition, customGates: CustomGateDefinition[]): string[] {
  const operations = gate.steps.map((step) => cirqOperation(step, (qubit) => `qubits[${qubit}]`, customGates)).filter(Boolean);
  return [
    `def ${customGateFunctionName(gate)}(qubits):`,
    "    return [",
    ...(operations.length ? operations.map((line) => `        ${line},`) : ["        # empty custom gate"]),
    "    ]",
  ];
}

export function flattenBuilderSteps(
  steps: BuilderStep[],
  customGates: CustomGateDefinition[],
): BuilderStep[] {
  const byId = new Map(customGates.map((gate) => [gate.id, gate]));
  const flatten = (step: BuilderStep, ancestors: ReadonlySet<string>): BuilderStep[] => {
    if (step.gate !== "CUSTOM") return [step];
    if (!step.customGateId || ancestors.has(step.customGateId)) return [];
    const custom = byId.get(step.customGateId);
    if (!custom) return [];
    const nextAncestors = new Set(ancestors).add(custom.id);
    return custom.steps.flatMap((definitionStep) => {
      const qubits = definitionStep.qubits.map((qubit) => step.qubits[qubit]).filter((qubit) => qubit !== undefined);
      if (qubits.length !== definitionStep.qubits.length) return [];
      return flatten({ ...definitionStep, id: `${step.id}-${definitionStep.id}`, qubits }, nextAncestors);
    });
  };
  return steps.flatMap((step) => flatten(step, new Set()));
}

function cudaqOperation(step: BuilderStep): string {
  const [a, b, c] = step.qubits;
  switch (step.gate) {
    case "H": return `h(q[${a}])`;
    case "X": return `x(q[${a}])`;
    case "Y": return `y(q[${a}])`;
    case "Z": return `z(q[${a}])`;
    case "S": return `s(q[${a}])`;
    case "T": return `t(q[${a}])`;
    // `.adj` is CUDA-Q's documented adjoint modifier, available on any gate.
    case "SDG": return `s.adj(q[${a}])`;
    case "TDG": return `t.adj(q[${a}])`;
    case "RX": return `rx(${step.param}, q[${a}])`;
    case "RY": return `ry(${step.param}, q[${a}])`;
    case "RZ": return `rz(${step.param}, q[${a}])`;
    // r1(theta, qubit) is CUDA-Q's native "rotation about |1>", i.e. diag(1, e^{i*theta}).
    case "P": return `r1(${step.param}, q[${a}])`;
    case "CX": return `x.ctrl(q[${a}], q[${b}])`;
    case "CZ": return `z.ctrl(q[${a}], q[${b}])`;
    case "SWAP": return `swap(q[${a}], q[${b}])`;
    // No documented native controlled-phase or RZZ modifier combination, so
    // both are decomposed here from confirmed-native primitives (r1/rz plus
    // `.ctrl`) rather than guessed at a single call. CP(θ) = P(θ/2) on the
    // control · CX · P(-θ/2) on the target · CX · P(θ/2) on the target;
    // RZZ(θ) = CX · RZ(θ) on the target · CX.
    // Joined with a newline plus the kernel body's own 4-space indent, so every
    // line lands at the same depth once the caller prefixes this whole string
    // with its usual leading "    " (a plain "\n" would leave lines 2+ flush left).
    case "CP": return [
      `r1(${halfExpr(step.param)}, q[${a}])`,
      `x.ctrl(q[${a}], q[${b}])`,
      `r1(${negateExpr(halfExpr(step.param))}, q[${b}])`,
      `x.ctrl(q[${a}], q[${b}])`,
      `r1(${halfExpr(step.param)}, q[${b}])`,
    ].join("\n    ");
    case "RZZ": return [
      `x.ctrl(q[${a}], q[${b}])`,
      `rz(${step.param}, q[${b}])`,
      `x.ctrl(q[${a}], q[${b}])`,
    ].join("\n    ");
    // `.ctrl` takes its controls as one list before the target.
    case "CCX": return `x.ctrl([q[${a}], q[${b}]], q[${c}])`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

function halfExpr(param: string | undefined): string {
  return `(${param})/2`;
}

function negateExpr(expr: string): string {
  return `-(${expr})`;
}

function braketOperation(step: BuilderStep): string {
  const [a, b, c] = step.qubits;
  switch (step.gate) {
    case "H": return `circuit.h(${a})`;
    case "X": return `circuit.x(${a})`;
    case "Y": return `circuit.y(${a})`;
    case "Z": return `circuit.z(${a})`;
    case "S": return `circuit.s(${a})`;
    case "T": return `circuit.t(${a})`;
    // `si`/`ti` are Braket's own names for the conjugate transposes of S/T.
    case "SDG": return `circuit.si(${a})`;
    case "TDG": return `circuit.ti(${a})`;
    case "RX": return `circuit.rx(${a}, ${step.param})`;
    case "RY": return `circuit.ry(${a}, ${step.param})`;
    case "RZ": return `circuit.rz(${a}, ${step.param})`;
    case "P": return `circuit.phaseshift(${a}, ${step.param})`;
    case "CX": return `circuit.cnot(${a}, ${b})`;
    case "CZ": return `circuit.cz(${a}, ${b})`;
    case "SWAP": return `circuit.swap(${a}, ${b})`;
    case "CP": return `circuit.cphaseshift(${a}, ${b}, ${step.param})`;
    // circuit.zz(q0, q1, angle) = exp(-i*angle*Z⊗Z/2), the same convention this file's RZZ uses.
    case "RZZ": return `circuit.zz(${a}, ${b}, ${step.param})`;
    case "CCX": return `circuit.ccnot(${a}, ${b}, ${c})`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

/** `stdgates.inc` defines `p`, `cp`, `ccx`, `sdg` and `tdg` natively, but not
 * `rzz` — its call site below relies on the `gate rzz(theta) a, b { ... }`
 * preamble `generateBuilderCode` emits once, ahead of `qubit[...] q;`, when
 * any step uses it (see `RZZ_QASM_GATE_DEFINITION` and its use below). */
function openqasmOperation(step: BuilderStep): string {
  const [a, b, c] = step.qubits;
  switch (step.gate) {
    case "H": return `h q[${a}];`;
    case "X": return `x q[${a}];`;
    case "Y": return `y q[${a}];`;
    case "Z": return `z q[${a}];`;
    case "S": return `s q[${a}];`;
    case "T": return `t q[${a}];`;
    case "SDG": return `sdg q[${a}];`;
    case "TDG": return `tdg q[${a}];`;
    case "RX": return `rx(${step.param}) q[${a}];`;
    case "RY": return `ry(${step.param}) q[${a}];`;
    case "RZ": return `rz(${step.param}) q[${a}];`;
    case "P": return `p(${step.param}) q[${a}];`;
    case "CX": return `cx q[${a}], q[${b}];`;
    case "CZ": return `cz q[${a}], q[${b}];`;
    case "SWAP": return `swap q[${a}], q[${b}];`;
    case "CP": return `cp(${step.param}) q[${a}], q[${b}];`;
    case "RZZ": return `rzz(${step.param}) q[${a}], q[${b}];`;
    case "CCX": return `ccx q[${a}], q[${b}], q[${c}];`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

/** OpenQASM 3's `stdgates.inc` has no `rzz`. This is the exact shape Qiskit's
 * own qasm3 exporter uses for a bound RZZ instruction (see
 * `circuit-conversion.ts`'s `parseOpenQasm3StandardGates`, which already
 * reconstructs this precise definition), so emitting it here keeps the two
 * directions round-trippable through the same shape rather than inventing a
 * second one. */
const RZZ_QASM_GATE_DEFINITION = ["gate rzz(theta) a, b {", "    cx a, b;", "    rz(theta) b;", "    cx a, b;", "}"];

function pyquilOperation(step: BuilderStep): string {
  const [a, b, c] = step.qubits;
  switch (step.gate) {
    case "H": return `program += H(${a})`;
    case "X": return `program += X(${a})`;
    case "Y": return `program += Y(${a})`;
    case "Z": return `program += Z(${a})`;
    case "S": return `program += S(${a})`;
    case "T": return `program += T(${a})`;
    // pyquil.gates has no SDG/TDG; PHASE(-pi/2) and PHASE(-pi/4) are exact —
    // S = PHASE(pi/2) and T = PHASE(pi/4), so this is the inverse, not an
    // approximation.
    case "SDG": return `program += PHASE(-pi/2, ${a})`;
    case "TDG": return `program += PHASE(-pi/4, ${a})`;
    case "RX": return `program += RX(${step.param}, ${a})`;
    case "RY": return `program += RY(${step.param}, ${a})`;
    case "RZ": return `program += RZ(${step.param}, ${a})`;
    case "P": return `program += PHASE(${step.param}, ${a})`;
    case "CX": return `program += CNOT(${a}, ${b})`;
    case "CZ": return `program += CZ(${a}, ${b})`;
    case "SWAP": return `program += SWAP(${a}, ${b})`;
    case "CP": return `program += CPHASE(${step.param}, ${a}, ${b})`;
    // pyquil's standard gate set has no RZZ; decompose exactly (RZZ(θ) = CX · RZ(θ)@target · CX).
    case "RZZ": return `program += CNOT(${a}, ${b})\nprogram += RZ(${step.param}, ${b})\nprogram += CNOT(${a}, ${b})`;
    case "CCX": return `program += CCNOT(${a}, ${b}, ${c})`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

function qiboOperation(step: BuilderStep): string {
  const [a, b, c] = step.qubits;
  switch (step.gate) {
    case "H": return `circuit.add(gates.H(${a}))`;
    case "X": return `circuit.add(gates.X(${a}))`;
    case "Y": return `circuit.add(gates.Y(${a}))`;
    case "Z": return `circuit.add(gates.Z(${a}))`;
    case "S": return `circuit.add(gates.S(${a}))`;
    case "T": return `circuit.add(gates.T(${a}))`;
    case "SDG": return `circuit.add(gates.SDG(${a}))`;
    case "TDG": return `circuit.add(gates.TDG(${a}))`;
    case "RX": return `circuit.add(gates.RX(${a}, ${step.param}))`;
    case "RY": return `circuit.add(gates.RY(${a}, ${step.param}))`;
    case "RZ": return `circuit.add(gates.RZ(${a}, ${step.param}))`;
    // Qibo's phase gate is the OpenQASM-derived U1(qubit, theta) = diag(1, e^{i*theta}).
    case "P": return `circuit.add(gates.U1(${a}, ${step.param}))`;
    case "CX": return `circuit.add(gates.CNOT(${a}, ${b}))`;
    case "CZ": return `circuit.add(gates.CZ(${a}, ${b}))`;
    case "SWAP": return `circuit.add(gates.SWAP(${a}, ${b}))`;
    // Qibo's controlled phase is named CU1 (controlled-U1), not CPHASE.
    case "CP": return `circuit.add(gates.CU1(${a}, ${b}, ${step.param}))`;
    case "RZZ": return `circuit.add(gates.RZZ(${a}, ${b}, ${step.param}))`;
    case "CCX": return `circuit.add(gates.TOFFOLI(${a}, ${b}, ${c}))`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

function qulacsOperation(step: BuilderStep): string {
  const [a, b, c] = step.qubits;
  switch (step.gate) {
    case "H": return `circuit.add_gate(H(${a}))`;
    case "X": return `circuit.add_gate(X(${a}))`;
    case "Y": return `circuit.add_gate(Y(${a}))`;
    case "Z": return `circuit.add_gate(Z(${a}))`;
    case "S": return `circuit.add_gate(S(${a}))`;
    case "T": return `circuit.add_gate(T(${a}))`;
    case "SDG": return `circuit.add_gate(Sdag(${a}))`;
    case "TDG": return `circuit.add_gate(Tdag(${a}))`;
    // Qulacs uses exp(+i theta Pauli/2); portable angles use exp(-i theta Pauli/2).
    case "RX": return `circuit.add_gate(RX(${a}, -(${step.param})))`;
    case "RY": return `circuit.add_gate(RY(${a}, -(${step.param})))`;
    case "RZ": return `circuit.add_gate(RZ(${a}, -(${step.param})))`;
    // U1(index, lambda) is Qulacs' QASM-derived phase gate, diag(1, e^{i*lambda}) —
    // a fixed diagonal unitary, not an exp(±i·Pauli/2) rotation, so unlike
    // RX/RY/RZ above it carries no sign-convention flip.
    case "P": return `circuit.add_gate(U1(${a}, ${step.param}))`;
    case "CX": return `circuit.add_gate(CNOT(${a}, ${b}))`;
    case "CZ": return `circuit.add_gate(CZ(${a}, ${b}))`;
    case "SWAP": return `circuit.add_gate(SWAP(${a}, ${b}))`;
    // Qulacs has no controlled-phase gate (`qulacs.gate.CP` is an unrelated
    // completely-positive Kraus-map helper, not a quantum gate) and no RZZ, so
    // both are decomposed from confirmed-native U1/CNOT/RZ. Joined with a
    // trailing newline; qulacsLines are spread as top-level statements, so no
    // extra indent is needed (contrast the CUDA-Q kernel body above).
    case "CP": return [
      `circuit.add_gate(U1(${a}, ${halfExpr(step.param)}))`,
      `circuit.add_gate(CNOT(${a}, ${b}))`,
      `circuit.add_gate(U1(${b}, ${negateExpr(halfExpr(step.param))}))`,
      `circuit.add_gate(CNOT(${a}, ${b}))`,
      `circuit.add_gate(U1(${b}, ${halfExpr(step.param)}))`,
    ].join("\n");
    case "RZZ": return [
      `circuit.add_gate(CNOT(${a}, ${b}))`,
      `circuit.add_gate(RZ(${b}, -(${step.param})))`,
      `circuit.add_gate(CNOT(${a}, ${b}))`,
    ].join("\n");
    case "CCX": return `circuit.add_gate(TOFFOLI(${a}, ${b}, ${c}))`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

/**
 * Classiq's Qmod, in its Python-embedded form. Gate names and argument order are
 * taken from Classiq's own standard-gate reference: single-qubit gates take a
 * target, `RX`/`RY`/`RZ` take `(theta, target)`, `CX`/`CZ` take
 * `(control, target)`, and `SWAP` takes `(qbit0, qbit1)`.
 *
 * There is deliberately no measurement operation. A Qmod model does not place
 * measure gates; the qubits it exposes as `Output` are what an execution
 * samples, so measurement is expressed by executing the synthesized program.
 * `generateBuilderCode` appends that call instead.
 *
 * ## What this export is NOT, and why the emitted file says so
 *
 * A gate-for-gate transliteration. Qmod's reason to exist is the layer above
 * gates — `qnum` variables with arithmetic (`res = a <= 2` synthesises a
 * comparator), `within { } apply { }` for U†VU with automatic uncompute and
 * ancilla reclamation, and a synthesis engine that chooses implementations
 * rather than transpiling a fixed one. A drawn circuit is a gate list, so this
 * emitter renders a gate list, and calling that "Qmod" without qualification
 * overstates it in the same way `status: "native"` on a prose record did.
 * Studied in `plans/classiq-library-study.md`; the header comment in the emitted
 * file is where a reader actually sees it.
 */
function qmodOperation(step: BuilderStep): string {
  const [a, b, c] = step.qubits;
  switch (step.gate) {
    case "H": return `H(q[${a}])`;
    case "X": return `X(q[${a}])`;
    case "Y": return `Y(q[${a}])`;
    case "Z": return `Z(q[${a}])`;
    case "S": return `S(q[${a}])`;
    case "T": return `T(q[${a}])`;
    // Classiq's standard_gates reference does not document SDG/TDG; PHASE is
    // documented, and PHASE(-pi/2)/PHASE(-pi/4) are exact inverses of S and T.
    case "SDG": return `PHASE(-pi/2, q[${a}])`;
    case "TDG": return `PHASE(-pi/4, q[${a}])`;
    case "RX": return `RX(${step.param}, q[${a}])`;
    case "RY": return `RY(${step.param}, q[${a}])`;
    case "RZ": return `RZ(${step.param}, q[${a}])`;
    case "P": return `PHASE(${step.param}, q[${a}])`;
    case "CX": return `CX(q[${a}], q[${b}])`;
    case "CZ": return `CZ(q[${a}], q[${b}])`;
    case "SWAP": return `SWAP(q[${a}], q[${b}])`;
    // Classiq's controlled phase is `CPhase`, not `CPHASE`.
    case "CP": return `CPhase(${step.param}, q[${a}], q[${b}])`;
    // Classiq's RZZ/CCX take their multi-qubit operand as one QArray, unlike
    // the single-target gates above.
    case "RZZ": return `RZZ(${step.param}, [q[${a}], q[${b}]])`;
    case "CCX": return `CCX([q[${a}], q[${b}]], q[${c}])`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

/** Executable source for a drawn circuit, in every framework the canvas offers.
 *
 * ## Why every variant ends by binding FINAL_CIRCUIT
 *
 * `roles.classify_source` reads what source BINDS to decide what it is. Until
 * this bound it, the canvas emitted code binding only `qc` (or `circuit`),
 * which classifies as UNKNOWN — "something this product cannot execute". Every
 * circuit anyone drew therefore failed `contract_diagnostics` with
 * "must bind FINAL_CIRCUIT", took the repair path, and went to a language model
 * to be rewritten: the user's own circuit replaced by a model's guess at it,
 * which is the exact failure `packages/py/frameworks/.../roles.py` was written
 * to stop.
 *
 * It is not decoration. It is the name the sandbox observes to lift interchange
 * QASM, and the name `DERIVE_RESULT_FROM_CIRCUIT` needs to let a drawn circuit
 * report what it found instead of being asked for a RESULT a drawing was never
 * going to bind.
 *
 * `studio-parse` skips this line on the way back in — it is a binding, not a
 * gate, so the canvas round-trip is unchanged.
 */
export function generateBuilderCode(
  steps: BuilderStep[],
  qubitCount: number,
  customGates: CustomGateDefinition[] = [],
): BuilderCodeVariants {
  const ordered = steps.filter((step) => step.gate !== "M");
  const measured = steps.some((step) => step.gate === "M");
  const activeCustomGates = usedCustomGates(steps, customGates);
  const opaqueGate = activeCustomGates.find((gate) => gate.opaque);
  if (opaqueGate) {
    throw new Error(`cannot generate source for opaque circuit operation: ${opaqueGate.name}`);
  }
  const usesAngle = steps.some((step) => Boolean(step.param)) || activeCustomGates.some((gate) => gate.steps.some((step) => Boolean(step.param)));

  const qiskitLines = ordered.map((step) => qiskitOperation(step, (qubit) => String(qubit), customGates)).filter(Boolean);
  const qiskit = [
    "from qiskit import QuantumCircuit",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    ...activeCustomGates.flatMap((gate) => [...qiskitDefinition(gate, customGates), ""]),
    `qc = QuantumCircuit(${qubitCount})`,
    ...qiskitLines,
    ...(measured ? ["qc.measure_all()"] : []),
    // See FINAL_CIRCUIT note above the function.
    "",
    "FINAL_CIRCUIT = qc",
  ].join("\n");

  const pennylaneLines = ordered.map((step) => pennylaneOperation(step, (qubit) => String(qubit), customGates)).filter(Boolean);
  const pennylane = [
    "import pennylane as qml",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    ...activeCustomGates.flatMap((gate) => [...pennylaneDefinition(gate, customGates), ""]),
    `dev = qml.device("default.qubit", wires=${qubitCount})`,
    "",
    measured ? "@qml.qnode(dev, shots=1000)" : "@qml.qnode(dev)",
    "def circuit():",
    ...(pennylaneLines.length ? pennylaneLines.map((line) => `    ${line}`) : ["    pass"]),
    measured ? "    return qml.sample()" : "    return qml.state()",
    // See FINAL_CIRCUIT note above the function. PennyLane's circuit IS the
    // QNode, which is what its adapter observes.
    "",
    "FINAL_CIRCUIT = circuit",
  ].join("\n");

  const cirqLines = ordered.map((step) => cirqOperation(step, (qubit) => `qubits[${qubit}]`, customGates)).filter(Boolean);
  const cirq = [
    "import cirq",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    ...activeCustomGates.flatMap((gate) => [...cirqDefinition(gate, customGates), ""]),
    `qubits = cirq.LineQubit.range(${qubitCount})`,
    "circuit = cirq.Circuit(",
    ...cirqLines.map((line) => `    ${line},`),
    ...(measured ? ["    cirq.measure(*qubits, key=\"result\"),"] : []),
    ")",
    // See FINAL_CIRCUIT note above the function.
    "",
    "FINAL_CIRCUIT = circuit",
  ].join("\n");

  const flattened = flattenBuilderSteps(steps, customGates);
  const flattenedOperations = flattened.filter((step) => step.gate !== "M");

  const cudaqLines = flattenedOperations.map(cudaqOperation).filter(Boolean);
  const cudaq = [
    "import cudaq",
    ...(usesAngle ? ["from math import pi"] : []),
    "",
    "@cudaq.kernel",
    "def circuit():",
    `    q = cudaq.qvector(${qubitCount})`,
    ...(cudaqLines.length ? cudaqLines.map((line) => `    ${line}`) : ["    pass"]),
    ...(measured ? ["    mz(q)"] : []),
  ].join("\n");

  const braketLines = flattenedOperations.map(braketOperation).filter(Boolean);
  const braket = [
    "from braket.circuits import Circuit",
    ...(usesAngle ? ["from math import pi"] : []),
    "",
    "circuit = Circuit()",
    ...braketLines,
    ...(measured ? [`circuit.measure(range(${qubitCount}))`] : []),
    "",
    "FINAL_CIRCUIT = circuit",
  ].join("\n");

  const openqasmLines = flattenedOperations.map(openqasmOperation).filter(Boolean);
  const usesRzz = flattenedOperations.some((step) => step.gate === "RZZ");
  const openqasm3 = [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    // stdgates.inc has no rzz; define it once, the same shape Qiskit's own
    // qasm3 exporter uses for a bound RZZ instruction.
    ...(usesRzz ? RZZ_QASM_GATE_DEFINITION : []),
    `qubit[${qubitCount}] q;`,
    ...(measured ? [`bit[${qubitCount}] c;`] : []),
    "",
    ...openqasmLines,
    ...(measured ? ["c = measure q;"] : []),
  ].join("\n");

  const pyquilLines = flattenedOperations.map(pyquilOperation).filter(Boolean);
  const pyquil = [
    "from pyquil import Program",
    `from pyquil.gates import ${["H", "X", "Y", "Z", "S", "T", "PHASE", "RX", "RY", "RZ", "CNOT", "CZ", "SWAP", "CPHASE", "CCNOT", ...(measured ? ["MEASURE"] : [])].join(", ")}`,
    ...(usesAngle ? ["from math import pi"] : []),
    "",
    "program = Program()",
    ...(measured ? [`ro = program.declare("ro", "BIT", ${qubitCount})`] : []),
    ...pyquilLines,
    ...(measured ? Array.from({ length: qubitCount }, (_, qubit) => `program += MEASURE(${qubit}, ro[${qubit}])`) : []),
    "",
    "FINAL_CIRCUIT = program",
  ].join("\n");

  const qiboLines = flattenedOperations.map(qiboOperation).filter(Boolean);
  const qibo = [
    "from qibo import Circuit, gates",
    ...(usesAngle ? ["from math import pi"] : []),
    "",
    `circuit = Circuit(${qubitCount})`,
    ...qiboLines,
    ...(measured ? [`circuit.add(gates.M(*range(${qubitCount}), register_name="ro"))`] : []),
    "",
    "FINAL_CIRCUIT = circuit",
  ].join("\n");

  const qulacsLines = flattenedOperations.map(qulacsOperation).filter(Boolean);
  const qulacs = [
    "from qulacs import QuantumCircuit",
    `from qulacs.gate import ${["H", "X", "Y", "Z", "S", "T", "Sdag", "Tdag", "RX", "RY", "RZ", "U1", "CNOT", "CZ", "SWAP", "TOFFOLI", ...(measured ? ["Measurement"] : [])].join(", ")}`,
    ...(usesAngle ? ["from math import pi"] : []),
    "",
    `circuit = QuantumCircuit(${qubitCount})`,
    ...qulacsLines,
    ...(measured ? Array.from({ length: qubitCount }, (_, qubit) => `circuit.add_gate(Measurement(${qubit}, ${qubit}))`) : []),
    "",
    "FINAL_CIRCUIT = circuit",
  ].join("\n");

  const qmodLines = flattenedOperations.map(qmodOperation).filter(Boolean);
  const qmod = [
    "# A gate-level rendering of this circuit as a Qmod model. It synthesizes, and",
    "# executes when the circuit is measured, but it uses none of what Qmod is for:",
    "# quantum numeric variables with arithmetic, within/apply for automatic",
    "# uncompute, and reusable qfuncs. Rewrite it in those terms before treating it",
    "# as idiomatic Qmod.",
    "from classiq import *",
    ...(usesAngle ? ["from classiq.qmod.symbolic import pi"] : []),
    "",
    "@qfunc",
    "def main(q: Output[QArray[QBit]]) -> None:",
    `    allocate(${qubitCount}, q)`,
    ...qmodLines.map((line) => `    ${line}`),
    "",
    "qprog = synthesize(create_model(main))",
    ...(measured
      ? [
        "",
        "# Qmod has no measure gate: executing the model samples its Output qubits.",
        "print(execute(qprog).result_value().counts)",
      ]
      : []),
  ].join("\n");

  return { qiskit, pennylane, cirq, cudaq, braket, openqasm3, pyquil, qibo, qulacs, qmod };
}
