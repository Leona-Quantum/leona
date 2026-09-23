// Reading a sentence: which problem it states, and which numbers it gives.
//
// ## Deterministic on purpose
//
// No model is called. A language model would read more sentences, and it would
// also produce a condition number nobody typed, in the same confident voice as
// one somebody did — and every number downstream of this function is printed
// beside a paper citation. So this reads only what is literally there: a
// keyword it can point to, a number it can point to, and the words each came
// from, which the page shows. What it cannot read, the reader types; what the
// reader does not type is either left empty or shown as an assumption with its
// reason (`ParamSpec.assumed`), never filled quietly.
//
// The cost of that choice is recall. A sentence with no keyword recognises as
// nothing, and the page then asks the reader to pick the problem — which is a
// better failure than a confident wrong one.
import { PROBLEMS, problemById, type ProblemClass } from "./problems.ts";
import type { Bilingual, ParamKey, ParamSpec, ParamValue, ParamValues, ProblemId } from "./types.ts";

/**
 * The most text a plan is read from, wherever the text arrives: typed on the
 * page, or handed in through the URL fragment by the Run composer's cue. One
 * constant for both, so the cue recognises exactly the text the page will get
 * (PR 974 review: the cue read the whole draft and sent a prefix of it).
 */
export const PLAN_TEXT_MAX = 2000;

// ---------------------------------------------------------------------------
// Numbers

const SCALE_WORDS: Record<string, number> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
  "万": 1e4,
  "億": 1e8,
  "兆": 1e12,
};

/**
 * One number as a reader writes it: `1,000,000`, `1e6`, `2^30`, `10^-3`,
 * `1.6 × 10^-3`, `one million`, `100 万`. Kept as source so every rule below
 * can embed it; `parseNumber` is its inverse.
 */
export const NUMBER_SOURCE = String.raw`(?:\d+(?:\.\d+)?\s*(?:[x×*·]\s*10\s*\^\s*[-+−]?\d+|[eE][-+−]?\d+)|(?:2|10)\s*\^\s*\(?[-+−]?\d+\)?|(?:a|one)\s+(?:thousand|million|billion|trillion)|(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*(?:thousand|million|billion|trillion|万|億|兆))?|\.\d+)`;

export function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(/−/g, "-").replace(/,/g, "");
  let m = /^(\d+(?:\.\d+)?)\s*[x×*·]\s*10\s*\^\s*([-+]?\d+)$/.exec(text);
  if (m) return Number(m[1]) * 10 ** Number(m[2]);
  m = /^(\d+(?:\.\d+)?)[eE]([-+]?\d+)$/.exec(text);
  if (m) return Number(m[1]) * 10 ** Number(m[2]);
  m = /^(2|10)\s*\^\s*\(?([-+]?\d+)\)?$/.exec(text);
  if (m) return Number(m[1]) ** Number(m[2]);
  m = /^(?:a|one)\s+(thousand|million|billion|trillion)$/i.exec(text);
  if (m) return SCALE_WORDS[m[1].toLowerCase()];
  m = /^(\d+(?:\.\d+)?|\.\d+)(?:\s*(thousand|million|billion|trillion|万|億|兆))?$/i.exec(text);
  if (m) {
    const base = Number(m[1]);
    const scale = m[2] ? SCALE_WORDS[m[2].toLowerCase()] ?? SCALE_WORDS[m[2]] : 1;
    return Number.isFinite(base) ? base * scale : null;
  }
  return null;
}

const N = NUMBER_SOURCE;

// ---------------------------------------------------------------------------
// Parameter rules

interface Rule {
  pattern: RegExp;
  /** Turn the match into a value; return null to reject this match. */
  read(match: RegExpExecArray): number | null;
}

const num = (group = 1) => (match: RegExpExecArray) => parseNumber(match[group] ?? "");

/** An energy with an optional unit, converted to hartree. Conversions are CODATA's (1 Ha = 627.5095 kcal/mol = 27.211386 eV). */
function hartree(value: number | null, unit: string | undefined): number | null {
  if (value === null) return null;
  const u = (unit ?? "").toLowerCase().replace(/\s+/g, "");
  if (u === "mha" || u === "millihartree" || u === "millihartrees" || u === "ミリハートリー") return value * 1e-3;
  if (u === "kcal/mol") return value / 627.5095;
  if (u === "mev") return value / 27211.386;
  if (u === "ev") return value / 27.211386;
  return value;
}

// ミリハートリー before ハートリー: the alternation takes the first that matches.
const ENERGY_UNIT = String.raw`(?:\s*(mHa|millihartrees?|hartrees?|Ha|kcal\s*/\s*mol|meV|eV|ミリハートリー|ハートリー))?`;

// A Japanese sentence joins a name to its number with a particle (λ は 500,
// 条件数が 1000) or a full-width colon as often as with "=", so every
// "name then number" rule below accepts those too.
const JOIN_JA = String.raw`|：|は|が`;

const RULES: Partial<Record<ParamKey, Rule[]>> = {
  bits: [
    { pattern: /\bRSA[- ]?(\d{3,5})\b/i, read: num() },
    { pattern: /\bsecp(\d{3})[rk]1\b/i, read: num() },
    { pattern: /\bP-(192|224|256|384|521)\b/, read: num() },
    { pattern: /\b(ed25519|curve25519)\b/i, read: () => 255 },
    { pattern: new RegExp(String.raw`(${N})\s*-?\s*bits?\b(?!\s+of\s+(?:precision|accuracy))`, "i"), read: num() },
    { pattern: new RegExp(String.raw`(${N})\s*ビット`), read: num() },
  ],
  domainSize: [
    {
      pattern: new RegExp(
        String.raw`(${N})\s+(?:[a-z-]+\s+){0,2}(?:items?|entries|records?|elements?|candidates?|keys?|possibilit(?:y|ies)|rows?|strings?|options?|passwords?|states?)\b`,
        "i",
      ),
      read: num(),
    },
    { pattern: new RegExp(String.raw`\b(?:N|domain size|search space(?: of)?|database of|list of|table of)\s*(?:=|:|of|is)?\s*(${N})`, "i"), read: num() },
    { pattern: new RegExp(String.raw`(${N})\s*(?:件|個|通り)`), read: num() },
    // "search over 40-bit keys" names a domain of 2^40, stated as bits.
    { pattern: new RegExp(String.raw`(${N})\s*-?\s*bit\s+(?:keys?|strings?|inputs?|space)`, "i"), read: (m) => { const b = parseNumber(m[1]); return b === null ? null : 2 ** b; } },
  ],
  markedCount: [
    { pattern: /\b(?:a single|one|the single|the only|unique|exactly one|only one)\s+(?:[a-z-]+\s+)?(?:record|item|entry|solution|match|marked|element|key|string|password|candidate|answer)s?\b/i, read: () => 1 },
    { pattern: new RegExp(String.raw`(${N})\s+(?:marked|solutions?|matches|matching|targets?|accepted|valid|good)\b`, "i"), read: num() },
    { pattern: new RegExp(String.raw`\bM\s*=\s*(${N})`), read: num() },
    { pattern: /(?<![\d０-９])(?:1|一)\s*件/, read: () => 1 },
  ],
  lambda: [
    { pattern: new RegExp(String.raw`(?:λ|\blambda\b|\bone[- ]norm\b|\b1[- ]norm\b|\bL1[- ]norm\b)\s*(?:=|:|of|is|≈|~${JOIN_JA})?\s*(${N})${ENERGY_UNIT}`, "i"), read: (m) => hartree(parseNumber(m[1]), m[2]) },
  ],
  deltaE: [
    { pattern: /\bchemical accuracy\b|化学精度/i, read: () => 0.0016 },
    { pattern: new RegExp(String.raw`(?:ΔE|\bdelta ?E\b|\bprecision\b|\baccuracy\b|\berror\b|\bto within\b|\bwithin\b|精度|誤差)\s*(?:=|:|of|is|≈|~|to${JOIN_JA})?\s*(${N})${ENERGY_UNIT}`, "i"), read: (m) => hartree(parseNumber(m[1]), m[2]) },
  ],
  orbitals: [
    { pattern: new RegExp(String.raw`(${N})\s*(?:spin[- ])?orbitals?\b`, "i"), read: num() },
    { pattern: new RegExp(String.raw`(?:スピン)?軌道\s*(?:の数)?\s*(?:は|が|：)?\s*(${N})|(${N})\s*(?:個の)?\s*(?:スピン)?軌道`), read: (m) => parseNumber(m[1] ?? m[2] ?? "") },
  ],
  kappa: [
    { pattern: new RegExp(String.raw`(?:κ|\bkappa\b|\bcondition number\b|条件数)\s*(?:=|:|of|is|≈|~${JOIN_JA})?\s*(${N})`, "i"), read: num() },
  ],
  epsilon: [
    { pattern: new RegExp(String.raw`(?:ε|\bepsilon\b|\berror\b|\bprecision\b|\baccuracy\b|\btolerance\b|\bto within\b|\bwithin\b|誤差|精度)\s*(?:=|:|of|is|≈|~|to|で${JOIN_JA})?\s*(${N})(\s*%)?`, "i"), read: (m) => { const v = parseNumber(m[1]); return v === null ? null : m[2] ? v / 100 : v; } },
  ],
  dimension: [
    { pattern: new RegExp(String.raw`(${N})\s+(?:unknowns|variables|equations|rows)\b`, "i"), read: num() },
    { pattern: new RegExp(String.raw`(${N})\s*[x×]\s*(?:${N})\s+(?:sparse\s+)?(?:matrix|system)`, "i"), read: num() },
    { pattern: new RegExp(String.raw`\b(?:N|dimension|size)\s*(?:=|:|of|is)\s*(${N})`, "i"), read: num() },
    { pattern: new RegExp(String.raw`未知数\s*(?:の数)?\s*(${N})|(${N})\s*個?の?未知数`), read: (m) => parseNumber(m[1] ?? m[2] ?? "") },
  ],
  nodes: [
    { pattern: new RegExp(String.raw`(${N})\s*(?:nodes|vertices|cities|assets|sites)\b`, "i"), read: num() },
    { pattern: new RegExp(String.raw`(?:頂点|ノード)\s*(${N})|(${N})\s*(?:個の)?\s*(?:頂点|ノード)`), read: (m) => parseNumber(m[1] ?? m[2] ?? "") },
  ],
  edges: [
    { pattern: new RegExp(String.raw`(${N})\s*edges\b|辺\s*(${N})`, "i"), read: (m) => parseNumber(m[1] ?? m[2] ?? "") },
  ],
  layers: [
    { pattern: /\bp\s*=\s*(\d+)\b/, read: num() },
    { pattern: new RegExp(String.raw`(${N})\s*(?:layers|rounds|層)`, "i"), read: num() },
  ],
  time: [
    { pattern: new RegExp(String.raw`(?:\btime\s*(?:t\s*)?(?:=|:|of)?|\bt\s*=|\bfor\s+(?:a\s+)?time\s+(?:of\s+)?|時間\s*t?\s*=?)\s*(${N})`, "i"), read: num() },
  ],
  precisionBits: [
    { pattern: new RegExp(String.raw`(${N})\s*(?:-?\s*bits?)\s+of\s+(?:precision|accuracy)|(${N})\s*-?\s*bit\s+(?:precision|accuracy)`, "i"), read: (m) => parseNumber(m[1] ?? m[2] ?? "") },
    { pattern: new RegExp(String.raw`(${N})\s*ビットの精度|精度\s*(${N})\s*ビット`), read: (m) => parseNumber(m[1] ?? m[2] ?? "") },
  ],
  failureProbability: [
    { pattern: new RegExp(String.raw`(${N})\s*%\s*(?:confidence|success|probability|信頼度|の確率)`, "i"), read: (m) => { const v = parseNumber(m[1]); return v === null ? null : 1 - v / 100; } },
    { pattern: new RegExp(String.raw`(?:信頼度|成功確率)\s*(${N})\s*%`), read: (m) => { const v = parseNumber(m[1]); return v === null ? null : 1 - v / 100; } },
    { pattern: new RegExp(String.raw`\bfailure probability\s*(?:=|:|of|is)?\s*(${N})`, "i"), read: num() },
  ],
  oracleToffolis: [
    { pattern: new RegExp(String.raw`(${N})\s*Toffolis?\s+(?:gates?\s+)?(?:per|in each|for each|in one|in the)\s+(?:check|query|oracle|call)`, "i"), read: num() },
  ],
  stepToffolis: [
    { pattern: new RegExp(String.raw`(${N})\s*Toffolis?\s+(?:gates?\s+)?(?:per|in each|for each)\s+(?:step|walk step|query|block[- ]encoding)`, "i"), read: num() },
  ],
};

/** A d-regular graph states its edge count through n and d; read both and multiply. */
function regularEdges(text: string, nodes: number | null): { value: number; evidence: string } | null {
  if (nodes === null) return null;
  const m = /\b(\d+)-regular\b|(\d+)\s*-?正則/i.exec(text);
  if (!m) return null;
  const degree = Number(m[1] ?? m[2]);
  if (!Number.isFinite(degree) || (nodes * degree) % 2 !== 0) return null;
  return { value: (nodes * degree) / 2, evidence: m[0] };
}

export function withinSpec(spec: ParamSpec, value: number): boolean {
  if (!Number.isFinite(value) || value < spec.min || value > spec.max) return false;
  return !spec.integer || Number.isInteger(value);
}

/**
 * The first rule for this parameter that produces an in-range value. An
 * out-of-range reading is discarded rather than clamped: a "2048-bit" in a
 * search problem is not a domain size of 2048, and a clamped number would be
 * one nobody wrote.
 */
function readParam(spec: ParamSpec, text: string): ParamValue | null {
  for (const rule of RULES[spec.key] ?? []) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", ""));
    const match = pattern.exec(text);
    if (!match) continue;
    const value = rule.read(match);
    if (value === null || !withinSpec(spec, value)) continue;
    return { key: spec.key, value, origin: "text", evidence: match[0].trim() };
  }
  return null;
}

function resolveParam(spec: ParamSpec, text: string, nodes: number | null): ParamValue {
  let found = readParam(spec, text);
  if (!found && spec.key === "edges") {
    const regular = regularEdges(text, nodes);
    if (regular && withinSpec(spec, regular.value)) {
      found = { key: "edges", value: regular.value, origin: "text", evidence: regular.evidence };
    }
  }
  if (found) return found;
  if (spec.assumed) return { key: spec.key, value: spec.assumed.value, origin: "assumed", assumedReason: spec.assumed.reason };
  return { key: spec.key, value: null, origin: "unset" };
}

/**
 * Every parameter the problem declares: read from the text, else assumed with
 * its reason, else unset. Built with `Object.fromEntries` rather than by
 * assigning through a computed key, which semgrep's remote-property-injection
 * rule blocks even when, as here, the key comes from a closed union.
 */
export function readParams(problem: ProblemClass, text: string): ParamValues {
  const nodesSpec = problem.params.find((spec) => spec.key === "nodes");
  const nodes = nodesSpec ? readParam(nodesSpec, text)?.value ?? null : null;
  return Object.fromEntries(problem.params.map((spec) => [spec.key, resolveParam(spec, text, nodes)])) as ParamValues;
}

// ---------------------------------------------------------------------------
// Problems

export interface Recognition {
  problem: ProblemId;
  score: number;
  /** The words that decided it, in the order they appear. */
  evidence: string[];
}

/** Every problem the text scores for, best first. Empty when no keyword matched anything. */
export function recogniseProblems(text: string): Recognition[] {
  const results: Recognition[] = [];
  for (const problem of PROBLEMS) {
    let score = 0;
    const evidence: { at: number; words: string }[] = [];
    for (const rule of problem.keywords) {
      const match = new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")).exec(text);
      if (!match) continue;
      score += rule.weight;
      evidence.push({ at: match.index, words: match[0].trim() });
    }
    if (score > 0) {
      results.push({ problem: problem.id, score, evidence: evidence.sort((a, b) => a.at - b.at).map((e) => e.words) });
    }
  }
  // Stable on ties: `PROBLEMS` order decides, so the same sentence always reads the same way.
  return results.sort((a, b) => b.score - a.score);
}

export function recogniseProblem(text: string): Recognition | null {
  return recogniseProblems(text)[0] ?? null;
}

export function paramLabel(problemId: ProblemId, key: ParamKey): Bilingual | null {
  return problemById(problemId)?.params.find((spec) => spec.key === key)?.label ?? null;
}
