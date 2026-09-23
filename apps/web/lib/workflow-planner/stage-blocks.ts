// Which Studio blocks (`../circuit-blocks.ts`) let a reader build a small
// instance of an Atlas METHOD chosen in a plan's pipeline.
//
// The pairing is deliberately narrow: a method id is listed here only when a
// Studio block (or small group of blocks, placed in order) really implements
// that construction, at a size the browser can simulate — not merely
// something in the same family. The evidence for each pairing below is the
// worked example that already builds that method's algorithm
// (`../worked-examples.ts`, `WorkedExample.blocks`), cross-checked against
// what the method itself is (`../repository/layer-graph.ts`). Where no
// worked example ties a method this cleanly to a block, or the graph has no
// distinct method node for the construction at all, it is left out rather
// than guessed at — see the note on the quantum Fourier transform below.
import { BLOCK_TEMPLATES } from "../circuit-blocks.ts";

/** Atlas method id -> the Studio block keys that build a small instance of it, in placement order. */
export const STAGE_BLOCKS: Readonly<Record<string, readonly string[]>> = {
  // Grover search (grover-3q-101's own blocks are hadamard_layer + phase_oracle
  // + grover_diffuser; grover_iteration is the two combined into one placeable
  // block, so it is offered alongside rather than instead of the pair).
  "grover-fixed-iteration-search": ["phase_oracle", "grover_diffuser", "grover_iteration"],
  // Coherent-register phase estimation: hadamard layer (state prep, not
  // listed here — it belongs to every stage, not this one specifically) then
  // controlled powers, then the inverse QFT that reads the phase back out.
  // Matches the "Quantum Phase Estimation" worked example's own blocks.
  "register-phase-estimation": ["controlled_phase_powers", "qft_inverse", "qpe_phase"],
  // amplitude-estimation-3's own blocks are hadamard_layer + this + qft_inverse;
  // qft_inverse is already offered under phase estimation, and this method's
  // OWN construction is the controlled-powers block, so only that is listed
  // here to avoid implying two unrelated methods share one Insert list.
  "amplitude-estimation-readout": ["amplitude_estimation_powers"],
  "product-formula-simulation": ["ising_trotter_step"],
  "qaoa-cost-mixer-alternation": ["qaoa_maxcut_layer"],
  // Shor's order-finding: shor-order-finding-15's own blocks, modulus 15's two
  // controlled-multiplication constructions plus the inverse QFT read-out.
  "cyclic-period-finding": ["controlled_mult_7_mod_15", "controlled_mult_4_mod_15", "qft_inverse"],
  //
  // Deliberately NOT listed: a standalone "quantum Fourier transform" method.
  // `qft`/`qft_inverse` appear in several worked examples (the QFT round-trip,
  // the Draper adder, phase estimation, order finding), but the layer graph
  // has no method node realising a capability that IS "compute a QFT" on its
  // own — it appears only embedded in the cost text of the methods above and
  // of the Draper-adder route. Pairing `qft`/`qft_inverse` to one of those
  // method ids would claim the whole method is "the QFT", which it is not.
};

/** Every block key this map cites — asserted against `BLOCK_TEMPLATES` by `workflow-planner-studio-link.test.ts`. */
export function stageBlockKeys(): string[] {
  return [...new Set(Object.values(STAGE_BLOCKS).flat())].sort();
}

/** Every method id this map cites — asserted to be a real method node in `LAYER_GRAPH` by the same test. */
export function stageBlockMethodIds(): string[] {
  return Object.keys(STAGE_BLOCKS).sort();
}

// Self-check keeps the census above honest without adding a runtime cost to
// the pages that import this module: every key is checked once, at import
// time, against the actual template registry.
const TEMPLATE_KEYS = new Set(BLOCK_TEMPLATES.map((template) => template.key));
for (const key of stageBlockKeys()) {
  if (!TEMPLATE_KEYS.has(key)) throw new Error(`STAGE_BLOCKS names an unknown block: ${key}`);
}
