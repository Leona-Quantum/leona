// Shared shapes for the workflow planner. See `./index.ts` for what the planner
// is and the rules it holds to.
import type { SourceKey } from "./sources.ts";

/** Plain text in both reader languages. The corpus convention: never one without the other. */
export interface Bilingual {
  en: string;
  ja: string;
}

export type ProblemId =
  | "search"
  | "factoring"
  | "ecdlp"
  | "ground-state"
  | "hamiltonian-simulation"
  | "linear-system"
  | "maxcut"
  | "amplitude-estimation"
  | "phase-estimation"
  | "linear-ode"
  | "nonlinear-ode";

export type ParamKey =
  | "domainSize"
  | "markedCount"
  | "bits"
  | "lambda"
  | "deltaE"
  | "orbitals"
  | "kappa"
  | "epsilon"
  | "dimension"
  | "sparsity"
  | "nodes"
  | "edges"
  | "layers"
  | "time"
  | "precisionBits"
  | "failureProbability"
  | "oracleToffolis"
  | "stepToffolis";

export interface ParamSpec {
  key: ParamKey;
  label: Bilingual;
  /** Shown under the input; says what the number means in this problem. */
  hint: Bilingual;
  unit?: Bilingual;
  min: number;
  max: number;
  integer: boolean;
  /**
   * Used only when the reader's text states nothing, and always shown as an
   * assumption with its reason — never silently. Absent means the planner
   * leaves the value empty and the lines that need it say so.
   */
  assumed?: { value: number; reason: Bilingual; source?: SourceKey };
}

/** Where a parameter's value came from — the page prints this beside the number. */
/**
 * `invalid` is a value the reader typed that the parameter cannot take (out of
 * range, not a whole number where one is needed, not a number at all). It
 * carries no value, so no formula ever sees it, and the page says why.
 */
export type ParamOrigin = "text" | "assumed" | "reader" | "unset" | "invalid";

export interface ParamValue {
  key: ParamKey;
  value: number | null;
  origin: ParamOrigin;
  /** The words in the reader's text the value was read from, when origin is "text". */
  evidence?: string;
  /** Why this value was assumed, when origin is "assumed". */
  assumedReason?: Bilingual;
}

export type ParamValues = Partial<Record<ParamKey, ParamValue>>;

/**
 * What kind of number a cost line is. The page prints the kind beside the
 * value, because "exact", "an upper bound", "a paper's numerical estimate" and
 * "a scaling with no constant" are four different claims and a table that
 * showed them in one column without the label would be making the strongest of
 * the four about all of them.
 */
export type CostKind =
  | "exact"
  | "upper-bound"
  | "leading-order"
  | "numerical-estimate"
  | "published"
  | "derived"
  | "supplied"
  | "scaling";

export interface CostLine {
  id: string;
  label: Bilingual;
  /** Null when a needed parameter is missing. On a "scaling" line it is a magnitude, never a count. */
  value: number | null;
  unit: Bilingual;
  /** The formula as plain text, e.g. "3n + 0.002·n·lg n". */
  formula: string;
  kind: CostKind;
  source: SourceKey | null;
  /** Printed before the value when the source states a bound rather than a number ("less than a million"). */
  qualifier?: "<" | "≤";
  /** How the number follows from the source, when it is arithmetic on the source rather than the source's own number. */
  note?: Bilingual;
  /** The parameters this line needs and does not have. */
  missing?: ParamKey[];
  /**
   * What this line counts, in the vocabulary of the Studio gate set
   * (`BuilderGate` in `../studio-builder.ts`: `"H"`, `"CP"`, `"RZZ"`, ...), or
   * `"all"` for every two-qubit gate. Set ONLY when the source this line cites
   * states, in its own words, what it is counting — never inferred from the
   * formula's shape. Its absence is not an oversight: it is how
   * `block-audit.ts` tells "this line's gate names are unstated" apart from
   * "the audit checked and they disagree," and it never fills the gap with a
   * guess (see that file's module comment).
   */
  counts?: { ops: string[] | "all"; note?: string };
}

/** The logical-level cost the estimator takes as input. Every field is a line, so it carries its kind and source. */
export interface LogicalSummary {
  logicalQubits: CostLine | null;
  toffolis: CostLine | null;
  tGates: CostLine | null;
  queries: CostLine | null;
  /**
   * The serial chain of dependent non-Clifford steps, where the source states
   * one. It is the estimator's `non_clifford_depth`: the runtime floor no
   * number of magic-state factories can lower. Absent for every problem whose
   * source gives no such figure, and then the physical estimate says its
   * runtime is one factory's throughput rather than the fastest possible.
   */
  serialDepth?: CostLine | null;
}

export interface Suggestion {
  id: string;
  title: Bilingual;
  body: Bilingual;
  source: SourceKey | null;
  /** A method id in the layer graph the suggestion points at, when it is "swap this block for that one". */
  swapTo?: { capability: string; method: string };
}
