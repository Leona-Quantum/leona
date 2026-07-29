/**
 * The per-framework code choices offered for one saved circuit.
 *
 * Extracted from the Vault artifact detail so the Run surface can offer exactly
 * the same set. "Framework conversions show up wherever code does" is only true
 * if it is one function — two implementations drift, and the Run surface would
 * be the one that silently stops converting.
 *
 * Three sources feed a choice, in descending honesty:
 *
 * 1. code the artifact really stores for that framework (`frameworkVariants`,
 *    the artifact's own `framework`, and stored OpenQASM) — offered verbatim
 *    and never annotated, because nothing was rewritten;
 * 2. a deterministic conversion from whichever stored source can be parsed;
 * 3. nothing — a framework with no honest conversion is simply not offered,
 *    rather than shown as an empty or approximate tab.
 *
 * `note` is set only when the conversion went through standard-gate
 * decomposition, i.e. when target-SDK gate conventions could differ. That is
 * the "possibility of loss" disclaimer; an exact subset conversion carries no
 * note because there is nothing to warn about.
 */

import {
  convertCircuitSource,
  looksLikeOpenQasm3,
  parseCircuitSource,
} from "./circuit-conversion.ts";
import { CIRCUIT_FRAMEWORKS, circuitFrameworkOrNull } from "./circuit-frameworks.ts";

export interface FrameworkCodeOption {
  key: string;
  label: string;
  code: string;
  /** Present only when the conversion may not be gate-for-gate faithful. */
  note?: string;
  /** True when this is code the artifact stores, not a conversion of it. */
  native: boolean;
}

export interface FrameworkCodeSource {
  framework: string;
  code: string;
  qasm: string | null;
  frameworkVariants?: Record<string, string> | null;
}

function normalizeFramework(value: string): string | null {
  return circuitFrameworkOrNull(value)?.key ?? null;
}

export function frameworkCodeOptions(source: FrameworkCodeSource): FrameworkCodeOption[] {
  const provided = new Map<string, string>();
  for (const [framework, code] of Object.entries(source.frameworkVariants ?? {})) {
    const normalized = normalizeFramework(framework);
    if (normalized && code) provided.set(normalized, code);
  }
  const primary = normalizeFramework(source.framework);
  if (primary && source.code) provided.set(primary, source.code);
  const qasm = source.qasm && looksLikeOpenQasm3(source.qasm) ? source.qasm : null;
  if (qasm) provided.set("openqasm3", qasm);

  // The conversion source has to be something the converter can actually read.
  // Framework-native Python from a real run is not: it carries `transpile`,
  // `AerSimulator` and locals the bounded parser rejects by design. In practice
  // the stored OpenQASM is what every LLM-run conversion goes through, and
  // without this fallback the whole list collapses to the stored variants.
  const candidates = [...provided.entries()].map(([framework, code]) => ({ framework, code }));
  const conversionSource =
    candidates.find((candidate) => Boolean(parseCircuitSource(candidate.code, candidate.framework)))
    ?? (qasm ? { framework: "openqasm3", code: qasm } : undefined);

  return CIRCUIT_FRAMEWORKS.flatMap(({ key, label }): FrameworkCodeOption[] => {
    const existing = provided.get(key);
    if (existing) return [{ key, label, code: existing, native: true }];
    if (!conversionSource) return [];
    const conversion = convertCircuitSource(
      conversionSource.code,
      conversionSource.framework,
      key,
      qasm,
    );
    if (!conversion) return [];
    return [{
      key,
      label,
      code: conversion.code,
      native: false,
      ...(conversion.fidelity === "standard_gate_decomposition" ? { note: conversion.note } : {}),
    }];
  });
}
