import {
  CIRCUIT_FRAMEWORKS,
  circuitFramework,
  interchangeConversionRecipe,
  type CircuitFrameworkKey,
  type PortableCircuit,
} from "./circuit-frameworks.ts";
import {
  generateBuilderCode,
  type BuilderCodeVariants,
  type BuilderStep,
} from "./studio-builder.ts";
import { parseBuilderCircuit, type ParsedBuilderCircuit } from "./studio-parse.ts";

export type CircuitConversionFidelity = "deterministic_subset" | "interchange_recipe";

export interface CircuitConversion {
  code: string;
  fidelity: CircuitConversionFidelity;
  note: string;
}

export function portableCircuitToBuilder(portable: PortableCircuit): ParsedBuilderCircuit {
  const steps: BuilderStep[] = portable.steps.map((step, index) => ({
    id: `portable-${index}`,
    ...step,
  }));
  if (portable.measure) {
    steps.push(...Array.from({ length: portable.qubitCount }, (_, qubit) => ({
      id: `portable-measure-${qubit}`,
      gate: "M" as const,
      qubits: [qubit],
    })));
  }
  return { qubitCount: portable.qubitCount, steps };
}

export function generatePortableCircuitCode(portable: PortableCircuit): BuilderCodeVariants {
  const circuit = portableCircuitToBuilder(portable);
  return generateBuilderCode(circuit.steps, circuit.qubitCount);
}

export function parseCircuitSource(
  code: string,
  framework: CircuitFrameworkKey | string,
): ParsedBuilderCircuit | null {
  const key = circuitFramework(framework).key;
  if (key !== "qiskit" && key !== "pennylane" && key !== "cirq" && key !== "openqasm3") return null;
  return parseBuilderCircuit(code, key);
}

export function convertCircuitSource(
  code: string,
  sourceFramework: CircuitFrameworkKey | string,
  targetFramework: CircuitFrameworkKey,
  qasm?: string | null,
): CircuitConversion | null {
  const parsed = parseCircuitSource(code, sourceFramework)
    ?? (qasm && looksLikeOpenQasm3(qasm) ? parseCircuitSource(qasm, "openqasm3") : null);
  if (parsed) {
    return {
      code: generateBuilderCode(parsed.steps, parsed.qubitCount)[targetFramework],
      fidelity: "deterministic_subset",
      note: "Generated deterministically from Leona Quantum's bounded gate model. Gate order, parameters, qubit indices, and terminal all-qubit measurement are preserved.",
    };
  }

  if (!qasm || !looksLikeOpenQasm3(qasm)) return null;
  return {
    code: interchangeConversionRecipe(qasm, targetFramework),
    fidelity: "interchange_recipe",
    note: targetFramework === "openqasm3"
      ? "Stored OpenQASM 3 interchange source."
      : "Reviewable target import/transpilation recipe generated from stored OpenQASM 3. Install the listed target extras, then review decomposition, control flow, noise, and measurement semantics before execution.",
  };
}

export function allCircuitConversions(
  code: string,
  sourceFramework: CircuitFrameworkKey | string,
  qasm?: string | null,
): Partial<BuilderCodeVariants> {
  return Object.fromEntries(
    CIRCUIT_FRAMEWORKS.flatMap(({ key }) => {
      const conversion = convertCircuitSource(code, sourceFramework, key, qasm);
      return conversion ? [[key, conversion.code]] : [];
    }),
  ) as Partial<BuilderCodeVariants>;
}

export function looksLikeOpenQasm3(value: string): boolean {
  return /^\s*OPENQASM\s+3(?:\.0)?\s*;/i.test(value);
}
