import type { BlockParamSpec, BlockParams } from "./circuit-blocks.ts";

/**
 * The Blocks panel's parameter form: every field is a plain text input (even
 * an "int" or "edges" spec), so this owns turning those strings into the
 * typed `BlockParams` `validateBlockParams`/`build` expect, and reports a
 * parse failure in the same "plain reason, per field" shape
 * `validateBlockParams` already uses for a VALUE that parses but is out of
 * range — so the form shows one consistent kind of message regardless of
 * which check caught the problem.
 */

export type BlockParamFormValues = Record<string, string>;

export function defaultBlockParamFormValues(params: readonly BlockParamSpec[]): BlockParamFormValues {
  const values: BlockParamFormValues = {};
  for (const spec of params) values[spec.key] = spec.kind === "edges" ? edgesToText(spec.default) : String(spec.default);
  return values;
}

/** "0-1,1-2,2-3" — the plain-text form of an edges spec's `[number, number][]`. */
export function edgesToText(edges: readonly (readonly [number, number])[]): string {
  return edges.map(([a, b]) => `${a}-${b}`).join(",");
}

function textToEdges(text: string): [number, number][] | null {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const pairs: [number, number][] = [];
  for (const part of trimmed.split(",")) {
    const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(part);
    if (!match) return null;
    pairs.push([Number(match[1]), Number(match[2])]);
  }
  return pairs;
}

export type BlockParamFieldResult =
  | { ok: true; value: BlockParams[string] }
  | { ok: false; reason: string };

export function parseBlockParamField(spec: BlockParamSpec, raw: string): BlockParamFieldResult {
  if (spec.kind === "int") {
    if (!/^\s*-?\d+\s*$/.test(raw)) return { ok: false, reason: `${spec.label} must be a whole number.` };
    return { ok: true, value: Number(raw.trim()) };
  }
  if (spec.kind === "angle" || spec.kind === "bitstring") {
    return { ok: true, value: raw.trim() };
  }
  const edges = textToEdges(raw);
  if (edges === null) return { ok: false, reason: `${spec.label} must be a comma-separated list of qubit pairs, like "0-1,1-2".` };
  return { ok: true, value: edges };
}

export type BlockParamFormResult =
  | { ok: true; params: BlockParams }
  | { ok: false; reason: string };

/** Parse every field; stops at the first that fails to parse at all (a value
 * that parses but fails a range/length/shape check is `validateBlockParams`'s
 * job, on the `params` this returns). */
export function blockParamsFromForm(params: readonly BlockParamSpec[], values: BlockParamFormValues): BlockParamFormResult {
  const result: BlockParams = {};
  for (const spec of params) {
    const parsed = parseBlockParamField(spec, values[spec.key] ?? "");
    if (!parsed.ok) return parsed;
    result[spec.key] = parsed.value;
  }
  return { ok: true, params: result };
}
