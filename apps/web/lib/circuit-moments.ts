import type { BuilderStep } from "./studio-builder.ts";

/**
 * Where each operation is drawn: moment packing for the circuit diagram.
 *
 * The diagram used to give every operation its own column, so three final
 * measurements on three different wires drew as a staircase and a depth-5
 * circuit took eight columns. A moment is a column of operations that touch
 * disjoint wires; an operation lands in the first column after everything
 * already on the wires it covers.
 *
 * "Covers" is the full span between a multi-qubit operation's lowest and
 * highest wire, not just its endpoints, because the connector is drawn across
 * the wires in between — a q1 gate in the same column as CX(q0, q2) would sit on
 * top of that line. So this can use more columns than the logical depth in
 * `circuitCompressionMetrics`, which only counts the wires an operation acts on.
 *
 * Order along each wire is exactly the array order, so the drawing never
 * reorders two operations that share a qubit.
 */
export type CircuitMoments = {
  /** Column of each step, index-aligned with the input. */
  columns: number[];
  /** Columns used; 0 for an empty circuit. */
  count: number;
  /** First free column on each wire — where a one-qubit gate placed there lands. */
  frontier: number[];
};

export function circuitMoments(qubitCount: number, steps: ReadonlyArray<Pick<BuilderStep, "qubits">>): CircuitMoments {
  const width = Math.max(0, qubitCount);
  const frontier: number[] = new Array<number>(width).fill(0);
  const columns: number[] = [];
  let count = 0;
  for (const step of steps) {
    if (!step.qubits.length) {
      columns.push(0);
      continue;
    }
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const qubit of step.qubits) {
      if (qubit < low) low = qubit;
      if (qubit > high) high = qubit;
    }
    let column = 0;
    for (let qubit = low; qubit <= high; qubit += 1) column = Math.max(column, frontier[qubit] ?? 0);
    columns.push(column);
    for (let qubit = low; qubit <= high; qubit += 1) frontier[qubit] = column + 1;
    count = Math.max(count, column + 1);
  }
  return { columns, count, frontier: frontier.slice(0, width) };
}
