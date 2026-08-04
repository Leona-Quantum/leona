// Validation boundary for the API's resource-estimate responses (E4).
//
// Same contract as ./from-catalog: everything crossing this line is untrusted
// JSON, every field the UI reads without a guard is checked here, and a payload
// that fails is dropped rather than rendered half-formed. The stakes are a
// little different, though. A malformed catalog record renders a blank card; a
// malformed estimate renders a *number*, and a number on this page is a claim
// about how much hardware an algorithm needs.
//
// So the rule the parser enforces is the one the Python contract enforces on
// the way out: `basis` and the presence of the layers agree, or there is no
// estimate. A payload carrying `basis: "refused"` and a footprint is not a
// partially-good estimate to salvage — it is a disagreement between the two
// halves of the feature, and the safe reading of a disagreement is silence.
import { PUBLIC_ESTIMATE_BASES, type ResourceEstimateBasis } from "./estimate-basis.ts";

export type { ResourceEstimateBasis };
export { PUBLIC_ESTIMATE_BASES };

export interface AssumptionSetSummary {
  /** e.g. `gidney-2025@v1+eps=1e-06`. Two estimates rank against each other only when these match. */
  identity: string;
  name: string;
  version: number;
  citation: string;
  /** Null when no synthesis precision was named; then a rotation has no T-count at all. */
  rotationSynthesisEpsilon: number | null;
  tPerRotation: number | null;
  tPerToffoli: number;
  physicalErrorRate: number;
  cycleTimeS: number;
  reactionTimeS: number;
}

export interface EstimateLogical {
  logicalQubits: number;
  tCount: number;
  toffoliCount: number;
  nonCliffordDepth: number;
  magicStates: number;
  cliffordCount: number;
  synthesisRequired: number;
  /** How much of `tCount` the epsilon produced rather than the circuit. */
  tFromSynthesis: number;
}

export interface EstimateDistance {
  codeDistance: number;
  logicalOperations: number;
  requiredErrorPerOperation: number;
  achievedErrorPerOperation: number;
  physicalPerLogical: number;
}

export interface EstimateFootprint {
  dataPatchQubits: number;
  routingQubits: number;
  factoryQubits: number;
  totalPhysicalQubits: number;
}

export interface EstimateRuntime {
  magicStates: number;
  factoryCount: number;
  throughputSeconds: number | null;
  reactionLimitedSeconds: number;
  /** Null when the model cannot state a wall-clock. Never render null as zero. */
  seconds: number | null;
  bindingTerm: "throughput" | "reaction" | "unstated";
  factoryCrossover: number | null;
}

export interface RepositoryEstimate {
  slug: string;
  basis: ResourceEstimateBasis;
  assumptions: AssumptionSetSummary;
  reason: string | null;
  logical: EstimateLogical | null;
  distance: EstimateDistance | null;
  footprint: EstimateFootprint | null;
  runtime: EstimateRuntime | null;
  targetFailureProbability: number | null;
  notes: string[];
}

/** One row of the browse list's cost column. */
export interface RepositoryEstimateSummary {
  slug: string;
  basis: ResourceEstimateBasis;
  totalPhysicalQubits: number | null;
  magicStates: number | null;
  logicalQubits: number | null;
  codeDistance: number | null;
  seconds: number | null;
}

/**
 * Every entry's cost under ONE assumption set.
 *
 * The identity sits on the container rather than on each row on purpose: it is
 * what lets a caller sort the rows without having to check, pair by pair, that
 * they are comparable. Merging two of these is the thing that must not happen,
 * and it now takes a visible act to do it.
 */
export interface RepositoryEstimateList {
  assumptions: AssumptionSetSummary;
  estimates: RepositoryEstimateSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A finite number, or null.
 *
 * `Number.isFinite` and not a bare typeof: JSON has no Infinity, but a
 * hand-rolled producer can emit `null`, a numeric string, or NaN via a division,
 * and every one of those reaches `toLocaleString` and renders as something.
 */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A finite number that must be present; null propagates a failed parse. */
function requiredNum(value: unknown): number | null {
  return num(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseAssumptions(value: unknown): AssumptionSetSummary | null {
  if (!isRecord(value)) return null;
  const identity = nonEmptyString(value.identity);
  const name = nonEmptyString(value.name);
  const citation = nonEmptyString(value.citation);
  const version = requiredNum(value.version);
  const tPerToffoli = requiredNum(value.t_per_toffoli);
  const physicalErrorRate = requiredNum(value.physical_error_rate);
  const cycleTimeS = requiredNum(value.cycle_time_s);
  const reactionTimeS = requiredNum(value.reaction_time_s);
  if (
    identity === null ||
    name === null ||
    citation === null ||
    version === null ||
    tPerToffoli === null ||
    physicalErrorRate === null ||
    cycleTimeS === null ||
    reactionTimeS === null
  ) {
    return null;
  }
  return {
    identity,
    name,
    version,
    citation,
    rotationSynthesisEpsilon: num(value.rotation_synthesis_epsilon),
    tPerRotation: num(value.t_per_rotation),
    tPerToffoli,
    physicalErrorRate,
    cycleTimeS,
    reactionTimeS,
  };
}

function parseBasis(value: unknown): ResourceEstimateBasis | null {
  return typeof value === "string" && (PUBLIC_ESTIMATE_BASES as readonly string[]).includes(value)
    ? (value as ResourceEstimateBasis)
    : null;
}

/** True when this basis is one that carries numbers. */
export function isPriced(basis: ResourceEstimateBasis): boolean {
  return basis === "exact" || basis === "estimated";
}

function parseLogical(value: unknown): EstimateLogical | null {
  if (!isRecord(value)) return null;
  const fields = [
    "logical_qubits",
    "t_count",
    "toffoli_count",
    "non_clifford_depth",
    "magic_states",
    "clifford_count",
    "synthesis_required",
    "t_from_synthesis",
  ] as const;
  const parsed = fields.map((field) => requiredNum(value[field]));
  if (parsed.some((entry) => entry === null)) return null;
  const [
    logicalQubits,
    tCount,
    toffoliCount,
    nonCliffordDepth,
    magicStates,
    cliffordCount,
    synthesisRequired,
    tFromSynthesis,
  ] = parsed as number[];
  return {
    logicalQubits,
    tCount,
    toffoliCount,
    nonCliffordDepth,
    magicStates,
    cliffordCount,
    synthesisRequired,
    tFromSynthesis,
  };
}

function parseDistance(value: unknown): EstimateDistance | null {
  if (!isRecord(value)) return null;
  const codeDistance = requiredNum(value.code_distance);
  const logicalOperations = requiredNum(value.logical_operations);
  const requiredError = requiredNum(value.required_error_per_operation);
  const achievedError = requiredNum(value.achieved_error_per_operation);
  const physicalPerLogical = requiredNum(value.physical_per_logical);
  if (
    codeDistance === null ||
    logicalOperations === null ||
    requiredError === null ||
    achievedError === null ||
    physicalPerLogical === null
  ) {
    return null;
  }
  return {
    codeDistance,
    logicalOperations,
    requiredErrorPerOperation: requiredError,
    achievedErrorPerOperation: achievedError,
    physicalPerLogical,
  };
}

function parseFootprint(value: unknown): EstimateFootprint | null {
  if (!isRecord(value)) return null;
  const data = requiredNum(value.data_patch_qubits);
  const routing = requiredNum(value.routing_qubits);
  const factory = requiredNum(value.factory_qubits);
  const total = requiredNum(value.total_physical_qubits);
  if (data === null || routing === null || factory === null || total === null) return null;
  return {
    dataPatchQubits: data,
    routingQubits: routing,
    factoryQubits: factory,
    totalPhysicalQubits: total,
  };
}

function parseRuntime(value: unknown): EstimateRuntime | null {
  if (!isRecord(value)) return null;
  const magicStates = requiredNum(value.magic_states);
  const factoryCount = requiredNum(value.factory_count);
  const reaction = requiredNum(value.reaction_limited_seconds);
  const binding = value.binding_term;
  if (
    magicStates === null ||
    factoryCount === null ||
    reaction === null ||
    (binding !== "throughput" && binding !== "reaction" && binding !== "unstated")
  ) {
    return null;
  }
  return {
    magicStates,
    factoryCount,
    throughputSeconds: num(value.throughput_seconds),
    reactionLimitedSeconds: reaction,
    seconds: num(value.seconds),
    bindingTerm: binding,
    factoryCrossover: num(value.factory_crossover),
  };
}

/**
 * Narrow one `/estimate` payload, or return null.
 *
 * The final check is the load-bearing one: `basis` and the layers must agree.
 * A priced basis missing a layer would render a heading with a blank number
 * under it; an unpriced basis carrying layers would render a cost under a
 * refusal. Both are worse than showing nothing.
 */
export function parseEstimate(payload: unknown): RepositoryEstimate | null {
  if (!isRecord(payload)) return null;
  const slug = nonEmptyString(payload.slug);
  const basis = parseBasis(payload.basis);
  const assumptions = parseAssumptions(payload.assumptions);
  if (slug === null || basis === null || assumptions === null) return null;

  const logical = parseLogical(payload.logical);
  const distance = parseDistance(payload.distance);
  const footprint = parseFootprint(payload.footprint);
  const runtime = parseRuntime(payload.runtime);
  const reason = nonEmptyString(payload.reason);
  const layers = [logical, distance, footprint, runtime];

  if (isPriced(basis)) {
    if (layers.some((layer) => layer === null)) return null;
  } else if (layers.some((layer) => layer !== null) || reason === null) {
    return null;
  }

  return {
    slug,
    basis,
    assumptions,
    reason,
    logical,
    distance,
    footprint,
    runtime,
    targetFailureProbability: num(payload.target_failure_probability),
    notes: Array.isArray(payload.notes)
      ? payload.notes.filter((note): note is string => typeof note === "string")
      : [],
  };
}

function parseEstimateSummary(value: unknown): RepositoryEstimateSummary | null {
  if (!isRecord(value)) return null;
  const slug = nonEmptyString(value.slug);
  const basis = parseBasis(value.basis);
  if (slug === null || basis === null) return null;
  const totalPhysicalQubits = num(value.total_physical_qubits);
  // A priced row with no total is the one shape that must not survive: the
  // browse list sorts on this field, and a null sorts somewhere.
  if (isPriced(basis) && totalPhysicalQubits === null) return null;
  return {
    slug,
    basis,
    totalPhysicalQubits,
    magicStates: num(value.magic_states),
    logicalQubits: num(value.logical_qubits),
    codeDistance: num(value.code_distance),
    seconds: num(value.seconds),
  };
}

/**
 * Narrow the `/estimates` listing, or return null.
 *
 * Rows that fail are dropped individually — one unreadable row should not cost
 * the visitor the cost column on the other 282 — but a listing with no readable
 * assumption set is discarded whole, because rows whose set is unknown are
 * exactly the rows nothing may sort.
 */
export function parseEstimateList(payload: unknown): RepositoryEstimateList | null {
  if (!isRecord(payload)) return null;
  const assumptions = parseAssumptions(payload.assumptions);
  if (assumptions === null || !Array.isArray(payload.estimates)) return null;
  const estimates = payload.estimates
    .map(parseEstimateSummary)
    .filter((entry): entry is RepositoryEstimateSummary => entry !== null);
  return { assumptions, estimates };
}
