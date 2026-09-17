import { flattenBuilderSteps, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";
import { expectationValue, type PauliTerm } from "./statevector-kernel.ts";
import { playheadReading, type PlayheadReading } from "./studio-playhead.ts";
import type { AtlasCircuitOperation, AtlasCircuitSource } from "./repository/atlas-circuit-layout.ts";
import { majoranaSignInPath } from "./sign-in.ts";

/**
 * The pure view model behind the Atlas worked-example figure
 * (components/atlas-worked-example.tsx) — turning one `WorkedExample`
 * (apps/web/lib/worked-examples.ts) into a drawing and, per step, either
 * probability bars or ⟨H⟩. Nothing here re-implements the simulator or the
 * circuit-box geometry: `playheadReading`/`idealStatevector` do the physics
 * (via statevector-kernel.ts), `layoutAtlasCircuit` does the geometry, and
 * `flattenBuilderSteps` does block expansion — all imported, none rewritten.
 */

/** One top-level step, drawn as a labelled box — "opened" reveals its flattened gates. */
export function workedExampleDrawing(
  steps: readonly BuilderStep[],
  customGates: readonly CustomGateDefinition[],
  qubitCount: number,
): AtlasCircuitSource {
  const wires = Array.from({ length: qubitCount }, (_, index) => `q${index}`);
  const operations: AtlasCircuitOperation[] = steps.map((step) => ({
    label: stepLabel(step, customGates),
    qubits: step.qubits,
    tone: step.gate === "CUSTOM" ? "accent" : "neutral",
  }));
  return { wires, operations };
}

/**
 * A step's own label — a block's name (from its `CustomGateDefinition`, e.g.
 * "GHZ(4)", "QFT(4)") for a placed block, or the gate mnemonic plus its angle
 * for a raw gate (e.g. "RY(pi/3)"). `customGates` is searched by id; pass the
 * example's own list.
 */
export function stepLabel(step: BuilderStep, customGates: readonly CustomGateDefinition[]): string {
  if (step.gate === "CUSTOM") {
    const definition = customGates.find((gate) => gate.id === step.customGateId);
    return definition?.name ?? "Block";
  }
  return step.param ? `${step.gate}(${formatGateAngle(step.param)})` : step.gate;
}

/**
 * An angle as a reader would write it, when it is a plain number.
 *
 * An authored param is already symbolic — "pi/2", "5*pi/4", "2*J*dt" — and is
 * returned untouched. A GENERATED one is not: the blocks that build a ladder of
 * rotations compute their angles in radians, so opening QPE's controlled-power
 * block listed `CP(2.356194490192345)`, `CP(4.71238898038469)`,
 * `CP(9.42477796076938)`. Those are 3π/4, 3π/2 and 3π — a doubling ladder,
 * which is the entire point of the block, and completely unreadable as printed.
 *
 * Only exact multiples of π/16 are rewritten. Anything else keeps a plain
 * 4-significant-figure decimal rather than being forced into a fraction it is
 * not: a wrong-looking fraction is worse than an honest decimal.
 */
export function formatGateAngle(param: string): string {
  const value = Number(param);
  if (!Number.isFinite(value) || param.trim() === "") return param;
  if (value === 0) return "0";
  const sixteenths = Math.round((value / Math.PI) * 16);
  if (sixteenths !== 0 && Math.abs((value / Math.PI) * 16 - sixteenths) < 1e-9) {
    const divisor = greatestCommonDivisor(Math.abs(sixteenths), 16);
    const top = sixteenths / divisor;
    const bottom = 16 / divisor;
    const numerator = top === 1 ? "π" : top === -1 ? "−π" : `${top}π`;
    return bottom === 1 ? numerator : `${numerator}/${bottom}`;
  }
  return String(Number(value.toPrecision(4)));
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * A block box "opened one level": its own flattened gates, each with the
 * label a reader would recognize and the OUTER circuit's wire numbering
 * (flattenBuilderSteps already remaps qubits through the block's placement,
 * so no second remapping happens here). A raw-gate step has nothing to open
 * and returns an empty list.
 */
export function openedStepGates(
  step: BuilderStep,
  customGates: readonly CustomGateDefinition[],
): Array<{ id: string; label: string; qubits: readonly number[] }> {
  if (step.gate !== "CUSTOM") return [];
  const flat = flattenBuilderSteps([step], [...customGates]);
  return flat.map((gate) => ({ id: gate.id, label: stepLabel(gate, []), qubits: gate.qubits }));
}

// ---------------------------------------------------------------------------
// Observable labelling and number formatting.
//
// Fixed after a review of a live screenshot: quantum-teleportation's
// observable is Z on the target qubit (checking the teleported state), and
// labelling that reading "⟨H⟩" claimed it was an energy, which it is not.
// The label now comes from the observable itself — a single unit-coefficient
// Pauli term prints as that term (e.g. "⟨Z₂⟩"); anything else (several terms,
// or one term with a coefficient other than 1) is a genuine Hamiltonian and
// prints as "⟨H⟩", with the formula rendered once below the figure.

const SUBSCRIPT_DIGITS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
};

function subscript(n: number): string {
  return String(n).split("").map((digit) => SUBSCRIPT_DIGITS[digit] ?? digit).join("");
}

/**
 * The non-identity (qubit, letter) factors of one Pauli string, ascending by
 * qubit index — same highest-qubit-first character convention the kernel's
 * own `pauliExpectation` reads a string with (character 0 = the highest
 * qubit), just resolved to qubit indices and sorted for display rather than
 * applied to a statevector.
 */
function pauliFactors(pauli: string): Array<{ qubit: number; letter: string }> {
  const qubitCount = pauli.length;
  const factors: Array<{ qubit: number; letter: string }> = [];
  for (let charIndex = 0; charIndex < pauli.length; charIndex += 1) {
    const letter = pauli[charIndex].toUpperCase();
    if (letter === "I") continue;
    factors.push({ qubit: qubitCount - 1 - charIndex, letter });
  }
  factors.sort((a, b) => a.qubit - b.qubit);
  return factors;
}

/**
 * A Pauli string's own symbol, identity factors omitted — "Z₀Z₁" for "ZZ",
 * "Z₂" for "ZII" (3 qubits), and "I" for an all-identity string (nothing
 * left to show once identity is omitted, so the identity itself is shown
 * rather than an empty pair of angle brackets).
 */
export function pauliTermSymbol(pauli: string): string {
  const factors = pauliFactors(pauli);
  if (factors.length === 0) return "I";
  return factors.map(({ qubit, letter }) => `${letter}${subscript(qubit)}`).join("");
}

/**
 * "H = Z₀Z₁ + 0.5 X₁ + 0.5 X₀" — one term per entry, in the observable's own
 * array order (not re-sorted: reordering a Hamiltonian an author wrote down
 * in a particular order would be a second claim about it this file has no
 * standing to make). Coefficient magnitudes print as authored (0.5, not
 * 0.500) — the 3-significant-figure rule is for the live computed value
 * (`formatSignificant`), not for a formula's own symbolic coefficients.
 */
export function hamiltonianFormula(observable: readonly PauliTerm[]): string {
  const body = observable
    .map((term, index) => {
      const symbol = pauliTermSymbol(term.pauli);
      const magnitude = Math.abs(term.coefficient);
      const text = magnitude === 1 ? symbol : `${magnitude} ${symbol}`;
      const negative = term.coefficient < 0;
      if (index === 0) return negative ? `−${text}` : text;
      return negative ? ` − ${text}` : ` + ${text}`;
    })
    .join("");
  return `H = ${body}`;
}

export type ObservableLabel =
  /** A single term with coefficient 1 — the observable itself, e.g. "Z₂". */
  | { kind: "term"; symbol: string }
  /** Several terms, or one term whose coefficient isn't 1 — a genuine sum, shown as ⟨H⟩. */
  | { kind: "hamiltonian"; formula: string };

export function observableLabel(observable: readonly PauliTerm[]): ObservableLabel {
  if (observable.length === 1 && observable[0].coefficient === 1) {
    return { kind: "term", symbol: pauliTermSymbol(observable[0].pauli) };
  }
  return { kind: "hamiltonian", formula: hamiltonianFormula(observable) };
}

/**
 * 3 significant figures and the proper minus sign (U+2212, not a hyphen) —
 * `1.00`, `−1.41`, `0.707`, matching how a reader expects a physics
 * quantity printed, not `toString()`'s float noise.
 */
export function formatSignificant(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return (0).toPrecision(digits); // guards -0 -> "-0.00"
  const magnitude = Math.abs(value).toPrecision(digits);
  return value < 0 ? `−${magnitude}` : magnitude;
}

export type WorkedExampleReading =
  | { kind: "probabilities"; reading: PlayheadReading }
  | { kind: "expectation"; value: number };

/**
 * The state after `currentStep` (0-indexed, inclusive) top-level steps —
 * probability bars from `playheadReading`, or, for an example with an
 * `observable`, ⟨H⟩ from `expectationValue` over the same prefix.
 */
export function workedExampleReading(
  steps: readonly BuilderStep[],
  customGates: readonly CustomGateDefinition[],
  qubitCount: number,
  currentStep: number,
  observable?: readonly PauliTerm[],
): WorkedExampleReading {
  if (observable && observable.length > 0) {
    const prefix = steps.slice(0, currentStep + 1);
    const value = expectationValue([...prefix], [...customGates], qubitCount, [...observable] as PauliTerm[]);
    return { kind: "expectation", value };
  }
  const columns = steps.map((_, index) => index);
  const reading = playheadReading({
    qubitCount,
    steps,
    customGates,
    columns,
    moment: currentStep + 1,
  });
  return { kind: "probabilities", reading };
}

/** Where "Open in Studio" takes a signed-in reader: this example, loaded as a new draft. */
export function workedExampleStudioHref(exampleId: string): string {
  return `/studio?example=${encodeURIComponent(exampleId)}`;
}

/**
 * Where "Open in Studio" takes a signed-out reader: sign-in, then back to THIS
 * example in Studio.
 *
 * The record page builds one sign-in link for the whole page with the default
 * returnTo `/run`, and the first version of the worked-example figure reused it,
 * so a signed-out reader who clicked "Open in Studio" and signed in landed on the
 * run page with the example gone. Found on production on 2026-09-15 by an
 * anonymous fetch of a record page; every screenshot of the feature had been
 * taken with local dev auth, which only renders the signed-in branch.
 * `majoranaSignInPath` runs the path through `safeReturnTo`, which keeps a
 * same-origin path's query string.
 */
export function workedExampleSignInHref(exampleId: string): string {
  return majoranaSignInPath(workedExampleStudioHref(exampleId));
}
