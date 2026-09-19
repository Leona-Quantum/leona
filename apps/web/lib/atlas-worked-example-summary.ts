import { workedExampleDrawing } from "./atlas-worked-example-steps.ts";
import { stepEffect } from "./atlas-step-effect.ts";
import { idealProbabilities, bitstringFor } from "./statevector-kernel.ts";
import { flattenBuilderSteps } from "./studio-builder.ts";
import type { LocalizedText, WorkedExample } from "./worked-examples.ts";
import type { AtlasCircuitSource } from "./repository/atlas-circuit-layout.ts";
import type { WorkedExampleLink } from "./repository/worked-example-links.ts";

/**
 * A `"component"` / `"used-in"` link, resolved into everything the record page
 * needs to draw a real miniature of the referenced example — server-side, and
 * serializable.
 *
 * Why this exists. The note these links rendered was one line:
 *
 *     Worked example of a part this method uses: A Bell pair
 *
 * A label and a link, on 81 records. It named a thing without saying what the
 * thing does, why it is on this page, or what happens if you run it — which is
 * the same "extremely general, no information" failure the stock
 * `encode / transform / measure` diagram had, arriving by a different route.
 *
 * Three facts turn that line into something worth reading, and all three are
 * already on hand:
 *
 * 1. **`link.evidence`** — a verbatim substring of the record's OWN text that
 *    the link was built from, checked against the live corpus by
 *    `scripts/check-worked-example-links.mjs`. Quoting it answers "why is this
 *    here" with the record's own words instead of a category name.
 * 2. **The example's circuit**, which `workedExampleDrawing` already produces
 *    for the full figure and which draws just as well small.
 * 3. **What the example comes out as** — its final outcome distribution, from
 *    the same kernel, plus its authored readout sentence.
 *
 * The full `WorkedExample` must not cross into the client bundle (see
 * `worked-example-resolution.ts`), so this collapses one to a plain object the
 * server passes down. The whole summary is roughly the size of the single
 * string the old note carried.
 */

export interface WorkedExampleOutcome {
  readonly bitstring: string;
  readonly probability: number;
}

export interface WorkedExampleSummary {
  readonly exampleId: string;
  readonly relation: "component" | "used-in";
  readonly title: LocalizedText;
  readonly instance: LocalizedText;
  readonly readout: LocalizedText;
  /** The phrase on THIS record that the link was built from, verbatim. */
  readonly evidence: string;
  /** The circuit, drawn the same way the full figure draws it. */
  readonly drawing: AtlasCircuitSource;
  readonly stepCount: number;
  readonly qubitCount: number;
  /** The example's final outcomes, largest first, at most `SUMMARY_OUTCOMES`. */
  readonly outcomes: readonly WorkedExampleOutcome[];
  readonly otherOutcomes: number;
  readonly otherProbability: number;
  /**
   * True when at least one step of the example is one the probability bars
   * cannot show — a step that moves only phase. Lets the note say so, which is
   * the single most useful thing it can tell a reader deciding whether to open
   * the example.
   */
  readonly hasPhaseStep: boolean;
}

const SUMMARY_OUTCOMES = 4;

export function workedExampleSummary(
  example: WorkedExample,
  link: WorkedExampleLink,
): WorkedExampleSummary {
  const relation = link.relation === "used-in" ? "used-in" : "component";
  return {
    exampleId: example.id,
    relation,
    title: example.title,
    instance: example.instance,
    readout: example.readout,
    evidence: link.evidence,
    drawing: workedExampleDrawing(example.steps, example.customGates, example.qubitCount),
    stepCount: example.steps.length,
    qubitCount: example.qubitCount,
    ...finalOutcomes(example),
    hasPhaseStep: example.steps.some((_, index) => {
      const effect = stepEffect({
        steps: example.steps,
        customGates: example.customGates,
        qubitCount: example.qubitCount,
        index,
      });
      return effect.kind === "ok" && effect.change === "phase";
    }),
  };
}

/**
 * The example's outcomes at its last step.
 *
 * Runs the same kernel the figure's own bars run. A throw is impossible for a
 * committed example — `atlas-step-effect.test.ts` asserts every step of every
 * example reads — but is caught rather than propagated anyway: a record page
 * must not 500 because an example was edited into a shape the kernel declines.
 * The note then simply shows no outcome row.
 */
function finalOutcomes(example: WorkedExample): {
  outcomes: WorkedExampleOutcome[];
  otherOutcomes: number;
  otherProbability: number;
} {
  const empty = { outcomes: [], otherOutcomes: 0, otherProbability: 0 };
  let probabilities: Float64Array;
  try {
    const flat = flattenBuilderSteps([...example.steps], [...example.customGates]);
    probabilities = idealProbabilities({ qubitCount: example.qubitCount, steps: flat });
  } catch {
    return empty;
  }
  const populated: WorkedExampleOutcome[] = [];
  for (let index = 0; index < probabilities.length; index += 1) {
    if (probabilities[index] > 1e-9) {
      populated.push({ bitstring: bitstringFor(index, example.qubitCount), probability: probabilities[index] });
    }
  }
  populated.sort(
    (left, right) => right.probability - left.probability || left.bitstring.localeCompare(right.bitstring),
  );
  const shown = populated.slice(0, SUMMARY_OUTCOMES);
  const rest = populated.slice(SUMMARY_OUTCOMES);
  return {
    outcomes: shown,
    otherOutcomes: rest.length,
    otherProbability: rest.reduce((sum, item) => sum + item.probability, 0),
  };
}
