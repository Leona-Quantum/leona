// The planner's physical estimate: what `POST /v1/estimates/logical` answers
// for the logical points `scaling.ts` builds, read strictly.
//
// The shapes mirror the route-local models in `services/api/.../routes/
// estimates.py`, whose layer summaries are the contracts' own
// (`FootprintSummary`, `RuntimeSummary`); its frontier points name their
// assumption set and `citations` states each set's source once. A payload that
// does not match is `null` — the panel then says the estimate could not be
// read — rather than a partly-parsed object whose missing field renders as 0.
import type { LogicalPointBody } from "./scaling.ts";

export const ASSUMPTION_SETS = ["gidney-2025@v2", "composed-trapped-ion@v2"] as const;
export type AssumptionSetKey = (typeof ASSUMPTION_SETS)[number];

export interface PhysicalMachine {
  totalPhysicalQubits: number;
  factoryQubits: number;
  factoryCount: number;
  factoryCrossover: number | null;
  /** Null when the model cannot state a wall-clock. */
  seconds: number | null;
  bindingTerm: "throughput" | "reaction" | "unstated";
}

export interface PhysicalFrontierPoint {
  assumptionSet: string;
  factoryCount: number;
  totalPhysicalQubits: number;
  runtimeSeconds: number;
}

export interface PhysicalPoint {
  label: string;
  parameterValue: number | null;
  refused: string | null;
  codeDistance: number | null;
  fastest: PhysicalMachine | null;
  smallest: PhysicalMachine | null;
  frontier: PhysicalFrontierPoint[];
}

export interface PhysicalEstimate {
  assumptionSet: string;
  citation: string;
  /** Identity -> citation for every set a frontier point names. */
  citations: Readonly<Record<string, string>>;
  physicalErrorRate: number;
  cycleTimeSeconds: number;
  reactionTimeSeconds: number;
  points: PhysicalPoint[];
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function machine(value: unknown): PhysicalMachine | null {
  if (!isObject(value) || !isObject(value.footprint) || !isObject(value.runtime)) return null;
  const { footprint, runtime } = value;
  const total = num(footprint.total_physical_qubits);
  const factoryQubits = num(footprint.factory_qubits);
  const factoryCount = num(runtime.factory_count);
  const binding = runtime.binding_term;
  if (total === null || factoryQubits === null || factoryCount === null) return null;
  if (binding !== "throughput" && binding !== "reaction" && binding !== "unstated") return null;
  return {
    totalPhysicalQubits: total,
    factoryQubits,
    factoryCount,
    factoryCrossover: num(runtime.factory_crossover),
    seconds: num(runtime.seconds),
    bindingTerm: binding,
  };
}

function frontier(value: unknown): PhysicalFrontierPoint[] | null {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: PhysicalFrontierPoint[] = [];
  for (const point of value) {
    if (!isObject(point)) return null;
    const assumptionSet = str(point.assumption_set);
    const factoryCount = num(point.factory_count);
    const total = num(point.total_physical_qubits);
    const runtime = num(point.runtime_seconds);
    if (assumptionSet === null || factoryCount === null || total === null || runtime === null) return null;
    out.push({ assumptionSet, factoryCount, totalPhysicalQubits: total, runtimeSeconds: runtime });
  }
  return out;
}

export function parsePhysicalEstimate(payload: unknown): PhysicalEstimate | null {
  if (!isObject(payload) || !isObject(payload.assumptions) || !Array.isArray(payload.points)) return null;
  const a = payload.assumptions;
  const identity = str(a.identity);
  const citation = str(a.citation);
  const errorRate = num(a.physical_error_rate);
  const cycle = num(a.cycle_time_s);
  const reaction = num(a.reaction_time_s);
  if (identity === null || citation === null || errorRate === null || cycle === null || reaction === null) return null;
  if (!isObject(payload.citations)) return null;
  const citations = Object.fromEntries(
    Object.entries(payload.citations).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  const points: PhysicalPoint[] = [];
  for (const raw of payload.points) {
    if (!isObject(raw)) return null;
    const label = str(raw.label);
    if (label === null) return null;
    const refused = raw.refused === null || raw.refused === undefined ? null : str(raw.refused);
    const fastest = raw.fastest === null || raw.fastest === undefined ? null : machine(raw.fastest);
    const smallest = raw.smallest === null || raw.smallest === undefined ? null : machine(raw.smallest);
    const points_ = frontier(raw.frontier);
    // A point is either refused with a reason or costed with a machine; a
    // payload claiming neither (or a machine that failed to parse) is refused
    // whole, because rendering it would print a blank as a cost.
    if (points_ === null) return null;
    if (refused === null && fastest === null) return null;
    if (raw.fastest !== null && raw.fastest !== undefined && fastest === null) return null;
    if (raw.smallest !== null && raw.smallest !== undefined && smallest === null) return null;
    // A frontier point naming a set the response does not cite would render a
    // hardware name with no source behind it.
    if (points_.some((p) => !Object.hasOwn(citations, p.assumptionSet))) return null;
    const distance = isObject(raw.distance) ? num(raw.distance.code_distance) : null;
    points.push({
      label,
      parameterValue: num(raw.parameter_value),
      refused,
      codeDistance: distance,
      fastest,
      smallest,
      frontier: points_,
    });
  }
  return {
    assumptionSet: identity,
    citation,
    citations,
    physicalErrorRate: errorRate,
    cycleTimeSeconds: cycle,
    reactionTimeSeconds: reaction,
    points,
  };
}

export type PhysicalOutcome =
  | { status: "ok"; estimate: PhysicalEstimate }
  | { status: "signed-out" }
  | { status: "error"; httpStatus: number | null };

/** Same-origin BFF (`app/api/estimates/logical/route.ts`), which attaches the session's bearer token. */
export async function fetchPhysicalEstimate(
  points: LogicalPointBody[],
  assumptions: AssumptionSetKey,
  fetcher: typeof fetch = fetch,
): Promise<PhysicalOutcome> {
  try {
    const response = await fetcher("/api/estimates/logical", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points, assumptions }),
      cache: "no-store",
      credentials: "include",
      // A lapsed session is answered with a redirect to the identity provider.
      // Followed, it becomes a cross-origin fetch that fails as a network
      // error; held, it is an `opaqueredirect` this can name.
      redirect: "manual",
    });
    if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403) {
      return { status: "signed-out" };
    }
    if (!response.ok) return { status: "error", httpStatus: response.status };
    const estimate = parsePhysicalEstimate(await response.json());
    return estimate ? { status: "ok", estimate } : { status: "error", httpStatus: null };
  } catch {
    return { status: "error", httpStatus: null };
  }
}
