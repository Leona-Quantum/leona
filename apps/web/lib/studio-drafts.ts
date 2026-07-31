// Explicit .ts on value imports: they are not erased and must resolve under
// `node --experimental-strip-types`.
import {
  CIRCUIT_FRAMEWORKS,
  circuitFramework,
  circuitFrameworkOrNull,
  type CircuitFrameworkKey,
} from "./circuit-frameworks.ts";
import {
  allCircuitConversionResults,
  looksLikeOpenQasm3,
  parseCircuitSource,
} from "./circuit-conversion.ts";
import { MAX_VIEWABLE_QUBITS } from "./studio-parse.ts";
import type { BuilderCodeVariants } from "./studio-builder.ts";

/**
 * What Studio's framework picker holds for one artifact.
 *
 * This used to live inside studio-workspace.tsx and had two defects that only a
 * test over real records makes visible. Measured on 2026-07-26 against the 282
 * Atlas entries the workspace can import: 129 of them opened in Studio with empty
 * framework tabs.
 *
 * 1. It chose its conversion source with the *editable builder's* parser, whose
 *    width ceiling is the six-wire canvas. A circuit written in exactly the
 *    portable gate subset the converter supports produced no conversions at all
 *    once it was seven qubits wide. Conversion parses at the viewing ceiling
 *    now; see convertCircuitSource.
 * 2. Anything it could not convert became the empty string, so the editor opened
 *    blank with a one-line toast. Atlas's own public page has never done that —
 *    it falls back to the stored source under a "Source reference" label with a
 *    note saying it is not a conversion. Studio now matches, and reports which
 *    framework the shown code is really written in so nothing downstream
 *    (export header, run submission, parsing) mislabels it.
 */
export interface StudioDraftArtifact {
  framework?: string;
  code?: string;
  qasm?: string | null;
  frameworkVariants?: Record<string, string>;
}

export interface StudioDraftBundle {
  codes: BuilderCodeVariants;
  /** Disclosure to show when the selected framework's draft is not a plain conversion. */
  notes: Partial<Record<CircuitFrameworkKey, string>>;
  /**
   * Target framework → the framework the code shown under it is ACTUALLY
   * written in. Present only for source fallbacks. A caller that pairs code with
   * a framework (export header, run request, parser) must resolve through
   * `draftSourceFramework` rather than trusting the selected tab.
   */
  fallbacks: Partial<Record<CircuitFrameworkKey, CircuitFrameworkKey>>;
}

export interface StudioDraftCopy {
  /** e.g. ("PennyLane", "Qiskit") → "No PennyLane conversion … showing Qiskit source." */
  sourceFallbackNote: (target: string, source: string) => string;
}

const EMPTY_CODES = Object.fromEntries(
  CIRCUIT_FRAMEWORKS.map(({ key }) => [key, ""]),
) as BuilderCodeVariants;

export function frameworkKeyOrNull(value: string | undefined | null): CircuitFrameworkKey | null {
  return circuitFrameworkOrNull(value)?.key ?? null;
}

/** The framework the draft under `framework` is really written in. */
export function draftSourceFramework(
  bundle: Pick<StudioDraftBundle, "fallbacks">,
  framework: CircuitFrameworkKey,
): CircuitFrameworkKey {
  return bundle.fallbacks[framework] ?? framework;
}

export function studioDraftBundle(
  artifact: StudioDraftArtifact,
  copy: StudioDraftCopy,
): StudioDraftBundle {
  const active = frameworkKeyOrNull(artifact.framework);
  const provided: Partial<BuilderCodeVariants> = {};
  for (const [name, code] of Object.entries(artifact.frameworkVariants ?? {})) {
    const key = frameworkKeyOrNull(name);
    if (key && code) provided[key] = code;
  }
  if (artifact.code && active) provided[active] = artifact.code;
  const qasm = artifact.qasm && looksLikeOpenQasm3(artifact.qasm) ? artifact.qasm : null;
  if (qasm) provided.openqasm3 = qasm;

  const candidates = (Object.entries(provided) as Array<[CircuitFrameworkKey, string]>)
    .map(([framework, code]) => ({ framework, code }));
  // MAX_VIEWABLE_QUBITS, not the builder's width: picking the source for a
  // source-to-source conversion has nothing to do with what the canvas can draw.
  const source = candidates.find(({ framework, code }) => (
    Boolean(parseCircuitSource(code, framework, MAX_VIEWABLE_QUBITS))
  )) ?? (qasm ? { framework: "openqasm3" as const, code: qasm } : undefined);
  const converted = source
    ? allCircuitConversionResults(source.code, source.framework, qasm)
    : {};

  // Prefer the artifact's own declared framework as the thing to fall back to:
  // it is the source the pipeline actually executed, and the one a reader is
  // least surprised to see. Any provided variant beats showing nothing.
  const fallbackSource = active && provided[active]
    ? { framework: active, code: provided[active] as string }
    : candidates[0];

  const codes = { ...EMPTY_CODES };
  const notes: StudioDraftBundle["notes"] = {};
  const fallbacks: StudioDraftBundle["fallbacks"] = {};
  for (const { key, label } of CIRCUIT_FRAMEWORKS) {
    const own = provided[key];
    if (own) {
      codes[key] = own;
      continue;
    }
    const conversion = converted[key];
    if (conversion) {
      codes[key] = conversion.code;
      if (conversion.fidelity === "standard_gate_decomposition") notes[key] = conversion.note;
      continue;
    }
    if (!fallbackSource) continue;
    codes[key] = fallbackSource.code;
    fallbacks[key] = fallbackSource.framework;
    notes[key] = copy.sourceFallbackNote(label, circuitFramework(fallbackSource.framework).label);
  }
  return { codes, notes, fallbacks };
}

/**
 * Every candidate source the canvas may try to parse, in usefulness order.
 *
 * The load-bearing part is not the ordering, it is the `fallbacks` resolution:
 * a tab holding another framework's source under a source-reference label must
 * be offered to the parser as the language it is actually written in. Handing
 * Qiskit source to the PennyLane parser cannot succeed, and if it ever did it
 * would draw a diagram of something nobody wrote.
 */
export function canvasSeedCandidates(
  artifact: StudioDraftArtifact,
  drafts: BuilderCodeVariants,
  activeFramework: CircuitFrameworkKey,
  fallbacks: StudioDraftBundle["fallbacks"] = {},
): Array<{ framework: CircuitFrameworkKey; code: string }> {
  const seen = new Set<string>();
  const ordered: Array<{ framework: CircuitFrameworkKey; code: string }> = [];
  const push = (framework: CircuitFrameworkKey, code: string | undefined | null) => {
    if (!code) return;
    // A fallback draft is the *other* framework's source shown under this tab;
    // parsing it as this framework would be reading the wrong language.
    const resolved = fallbacks[framework] ?? framework;
    const fingerprint = `${resolved}:${code}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    ordered.push({ framework: resolved, code });
  };
  push(activeFramework, drafts[activeFramework]);
  for (const [name, code] of Object.entries(artifact.frameworkVariants ?? {})) {
    const key = frameworkKeyOrNull(name);
    if (key) push(key, code);
  }
  if (artifact.qasm && looksLikeOpenQasm3(artifact.qasm)) push("openqasm3", artifact.qasm);
  // openqasm3 first among the remaining drafts: it is the one the permissive
  // interchange reader understands, and the one conversion most often produces.
  push("openqasm3", drafts.openqasm3);
  for (const { key } of CIRCUIT_FRAMEWORKS) push(key, drafts[key]);
  return ordered;
}
