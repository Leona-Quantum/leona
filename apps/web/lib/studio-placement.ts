import type { BuilderStep } from "./studio-builder.ts";

/**
 * Where a newly placed operation goes in the builder's step list.
 *
 * Generated code measures last (`measure_all()` and its equivalents), so a gate
 * appended after a wire's measurement was drawn where no generated program can
 * run it: the diagram disagreed with the code it had just produced, and the
 * "no longer matches" banner fired on the first click of a fresh Bell-pair
 * draft. A new operation goes in front of the trailing measurements on the
 * wires it acts on instead, which is exactly where the code runs it.
 *
 * A measurement is always appended. A measurement with a non-measurement
 * operation after it on the same wire is not trailing and stays where it is,
 * and so does everything after it. Operations passed over act on other wires
 * only, so moving the new one in front of them cannot change the circuit.
 */
export function insertBeforeTrailingMeasurements(steps: readonly BuilderStep[], step: BuilderStep): BuilderStep[] {
  if (step.gate === "M") return [...steps, step];
  const wires = new Set(step.qubits);
  let insertAt = steps.length;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const existing = steps[index];
    if (!existing.qubits.some((qubit) => wires.has(qubit))) continue;
    if (existing.gate !== "M") break;
    insertAt = index;
  }
  return [...steps.slice(0, insertAt), step, ...steps.slice(insertAt)];
}
