import type {
  PublicRepositoryCodeVariant,
  PublicRepositoryEntry,
  PublicRepositoryFramework,
} from "./types";
import {
  circuitFramework,
  type PortableCircuit,
  type PortableCircuitGate,
} from "../circuit-frameworks";
import {
  convertCircuitSource,
  generatePortableCircuitCode,
  looksLikeOpenQasm3,
  parseCircuitSource,
} from "../circuit-conversion";

/**
 * Turning one entry into the code shown for a chosen framework — split out of
 * `lib/public-repository.ts` for the reason given in `./entry-verification`.
 *
 * Same story, same cause: every function here is pure over the `entry` handed
 * to it and none of them reads the corpus, but they lived in the barrel that
 * value-imports all nine `entries-*.ts` files. `repository-entry-view.tsx` is a
 * `"use client"` component, so importing `getPublicRepositoryVariant` from
 * there shipped the entire Atlas catalog to anyone opening a single record —
 * a page that already receives the one entry it renders as a prop.
 *
 * The guard is `lib/client-catalog-leak.test.ts`. It found this file's reason
 * for existing: the first two components were fixed by hand, and the test
 * immediately named a third nobody had looked at.
 */
// FULL entries only, and the signature says so now.
//
// It used to read `PublicRepositoryEntry | PublicRepositoryListEntry`, with a
// comment explaining that the union existed "so the browse list's framework
// filter can call it with a projected list entry". **There is no framework
// filter** — it was removed as a control that still kept two thirds of the
// catalogue at its most aggressive setting — and the union had quietly become
// false besides: this function reads a variant's `code` and a circuit's
// `steps`, and the list projection sends neither. A list entry passed here
// would have produced an empty conversion rather than an error.
//
// Every real caller already passes a full record: the detail view, the export
// route, and getPublicRepositoryLibraryVariant below. Narrowing the type is how
// that stays true.
export function getPublicRepositoryVariant(
  entry: PublicRepositoryEntry,
  framework: PublicRepositoryFramework,
): PublicRepositoryCodeVariant {
  const nativeVariant = entry.codeVariants.find((variant) => variant.framework === framework);
  if (nativeVariant?.code) return nativeVariant;

  const target = circuitFramework(framework);
  const portable = entry.portableCircuit ?? inferPortableCircuit(entry);
  if (portable) {
    const code = generatePortableCircuitCode(portable)[target.key];
    return {
      framework,
      status: "conversion",
      language: target.language,
      filename: `${entry.slug}.${target.extension}`,
      code,
      note: "Deterministic Leona Quantum conversion from the bounded portable gate model. Gate order, parameters, qubit indices, and terminal all-qubit measurement are preserved; review target-SDK and hardware decomposition before execution.",
    };
  }

  const qasmVariant = entry.codeVariants.find((variant) => (
    variant.framework === "OpenQASM 3.0" && looksLikeOpenQasm3(variant.code)
  ));
  const sourceVariant = entry.codeVariants.find((variant) => variant.status === "native" && Boolean(variant.code));
  if (sourceVariant && qasmVariant) {
    const conversion = convertCircuitSource(
      sourceVariant.code,
      circuitFramework(sourceVariant.framework).key,
      target.key,
      qasmVariant.code,
    );
    if (conversion) {
      return {
        framework,
        status: "conversion",
        language: target.language,
        filename: `${entry.slug}.${target.extension}`,
        code: conversion.code,
        note: conversion.note,
      };
    }
  }

  if (sourceVariant?.code) {
    return {
      framework,
      status: "source",
      language: sourceVariant.language,
      filename: sourceVariant.filename,
      code: sourceVariant.code,
      note: `No safe direct ${framework} conversion is available for this reference. Showing the stored ${sourceVariant.framework} source instead of an executable-looking conversion recipe.`,
    };
  }

  return {
    framework,
    status: "unsupported",
    language: framework === "OpenQASM 3.0" ? "openqasm" : "python",
    filename: `${entry.slug}-not-a-concrete-circuit.txt`,
    code: "",
    note: `This record does not expose source code, so a ${framework} circuit would be speculative.`,
  };
}

function inferPortableCircuit(entry: PublicRepositoryEntry): PortableCircuit | null {
  for (const variant of entry.codeVariants) {
    if (variant.status !== "native" || !variant.code) continue;
    const parsed = parseCircuitSource(variant.code, circuitFramework(variant.framework).key);
    if (!parsed) continue;
    return {
      qubitCount: parsed.qubitCount,
      steps: parsed.steps
        .filter((step) => step.gate !== "M" && step.gate !== "CUSTOM")
        .map((step) => ({ gate: step.gate as PortableCircuitGate, qubits: step.qubits, ...(step.param ? { param: step.param } : {}) })),
      measure: parsed.steps.some((step) => step.gate === "M"),
    };
  }

  return null;
}
