import type { PublicLocale } from "./public-locale.ts";
import type { AmplitudePhase, StepEffect, StepEffectReading } from "./atlas-step-effect.ts";

/**
 * The sentence the Atlas worked-example figure prints under a step: what the
 * reading in `atlas-step-effect.ts` says the step did, in the reader's own
 * language.
 *
 * Split from the reading itself so the physics has no locale in it and the
 * prose has no arithmetic in it — the same split `atlas-worked-example-steps.ts`
 * already keeps between `workedExampleReading` and the figure's COPY table.
 *
 * **Every sentence here is about the computed state, never about the gate.**
 * A sentence that named the gate would be a second copy of the label the
 * reader is already looking at, which is the failure this whole lane exists to
 * fix. So "Concentrates probability on 101 — 12.5% to 78.1%" is in, and "a
 * Hadamard puts the qubit in superposition" is out: the first is a measurement
 * of this example at this step and cannot go stale, the second is a textbook
 * line that a reader can get anywhere and that stops being true the moment the
 * example is edited.
 */

/**
 * A probability as a percentage with one decimal — "12.5%", "0.0%", "100.0%".
 *
 * Deliberately not locale-varying: `%` and the Western decimal point are what
 * Japanese technical prose uses for a probability too, and the rest of the
 * figure (`formatSignificant` in atlas-worked-example-steps.ts) already prints
 * its numbers the same way in both locales.
 */
export function formatPercent(probability: number): string {
  return `${(probability * 100).toFixed(1)}%`;
}

/**
 * A relative phase in turns, printed as the multiple of π a reader recognises
 * — 0.5 turns is π, 0.25 is π/2, 0.125 is π/4. Anything that is not a clean
 * eighth prints as a decimal multiple instead of being forced into a fraction
 * it is not.
 */
export function formatPhase(turns: number): string {
  if (turns === 0) return "0";
  const halves = turns * 2; // multiples of π
  const eighths = Math.round(halves * 8);
  if (Math.abs(halves * 8 - eighths) < 1e-6) {
    const numerator = eighths;
    const denominator = 8;
    const divisor = greatestCommonDivisor(Math.abs(numerator), denominator);
    const top = numerator / divisor;
    const bottom = denominator / divisor;
    if (bottom === 1) return top === 1 ? "π" : `${top}π`;
    return top === 1 ? `π/${bottom}` : `${top}π/${bottom}`;
  }
  return `${halves.toFixed(3)}π`;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * The one-sentence account of a step, or null where the reading declined.
 *
 * Null renders as nothing at all — a figure that cannot read the state must
 * not print a sentence that a reader would take for "the state did not
 * change". That is the same distinction `PlayheadReading`'s `unavailable`
 * already makes for the probability bars, kept for the same reason.
 */
export function describeStepEffect(effect: StepEffect, locale: PublicLocale): string | null {
  if (effect.kind !== "ok") return null;
  const parts = [movementSentence(effect, locale)];
  const entanglement = entanglementSentence(effect, locale);
  if (entanglement) parts.push(entanglement);
  return parts.join(" ");
}

function movementSentence(effect: StepEffectReading, locale: PublicLocale): string {
  const ja = locale === "ja";
  switch (effect.change) {
    case "none":
      return ja
        ? "この状態は変化しません。確率も位相も、直前とまったく同じです。"
        : "Nothing about the state changes here — the same outcomes with the same probabilities and the same phases as the step before.";
    case "phase": {
      const count = effect.distinctPhases;
      const lead = ja
        ? `測定結果の確率は変わりません。このステップが動かすのは位相だけで、確率としては見えません（現在 ${count} 種類の相対位相があります）。`
        : `The outcome probabilities do not move at all. What this step changes is phase — ${count} distinct relative ${count === 1 ? "phase" : "phases"} across the state now — which no measurement can see until a later step turns it back into probability.`;
      return lead;
    }
    case "move": {
      if (effect.moved) {
        return ja
          ? `状態がまるごと ${effect.moved.from} から ${effect.moved.to} へ移ります。前後どちらも重ね合わせではなく、確率1の1つの測定結果です。`
          : `The whole state moves from ${effect.moved.from} to ${effect.moved.to} — one certain outcome before, one certain outcome after, no superposition either side.`;
      }
      return ja
        ? `確率はもとの ${effect.support.before} 個の測定結果からすべて離れ、まったく別の ${effect.support.after} 個へ移ります。前後で重なる測定結果はひとつもありません。`
        : `Probability leaves ${effect.support.before === 1 ? "the outcome" : `all ${effect.support.before} outcomes`} it was on and appears on ${effect.support.after} entirely different ${effect.support.after === 1 ? "one" : "ones"} — not one outcome is populated both before and after.`;
    }
    case "spread": {
      const { before, after } = effect.support;
      const equally = effect.uniform
        ? ja
          ? `${after} 個すべてが等確率です。`
          : ` All ${after} are equally likely.`
        : "";
      return (
        (ja
          ? `確率が ${before} 個の測定結果から ${after} 個へ広がります。`
          : `Probability spreads from ${before} ${before === 1 ? "outcome" : "outcomes"} to ${after}.`) + equally
      );
    }
    case "concentrate": {
      const { before, after } = effect.support;
      const top = effect.moves.find((move) => move.after > move.before);
      const tail = top
        ? ja
          ? ` ${top.bitstring} は ${formatPercent(top.before)} から ${formatPercent(top.after)} になります。`
          : ` ${top.bitstring} goes from ${formatPercent(top.before)} to ${formatPercent(top.after)}.`
        : "";
      return (
        (ja
          ? `確率が ${before} 個の測定結果から ${after} 個へ集まります。`
          : `Probability gathers from ${before} ${before === 1 ? "outcome" : "outcomes"} onto ${after}.`) + tail
      );
    }
    case "redistribute": {
      const gained = effect.moves.filter((move) => move.after > move.before).slice(0, 2);
      const lost = effect.moves.filter((move) => move.after < move.before).slice(0, 2);
      const gainedText = gained
        .map((move) => `${move.bitstring} ${formatPercent(move.before)} → ${formatPercent(move.after)}`)
        .join(", ");
      const lostText = lost
        .map((move) => `${move.bitstring} ${formatPercent(move.before)} → ${formatPercent(move.after)}`)
        .join(", ");
      const { after, newlyPopulated, emptied } = effect.support;
      // "the same N outcomes" is only true when the SET did not change. A step
      // that populates three states and empties three others leaves the size
      // alone, and claiming sameness there would describe six movements as none.
      const setUnchanged = newlyPopulated === 0 && emptied === 0;
      if (ja) {
        const lead = setUnchanged
          ? `同じ ${after} 個の測定結果のあいだで確率が移動します。`
          : `確率が移動し、${newlyPopulated} 個の測定結果が新たに現れ、${emptied} 個が消えます（現在 ${after} 個）。`;
        const pieces = [lead, gainedText ? `増加：${gainedText}。` : "", lostText ? `減少：${lostText}。` : ""];
        return pieces.filter(Boolean).join("");
      }
      const lead = setUnchanged
        ? `Probability moves between the same ${after} outcomes.`
        : `Probability moves: ${newlyPopulated} ${newlyPopulated === 1 ? "outcome appears" : "outcomes appear"} that had none, ${emptied} ${emptied === 1 ? "drops" : "drop"} to zero, ${after} carry probability now.`;
      const pieces = [lead];
      if (gainedText) pieces.push(`Up: ${gainedText}.`);
      if (lostText) pieces.push(`Down: ${lostText}.`);
      return pieces.join(" ");
    }
  }
}

function entanglementSentence(effect: StepEffectReading, locale: PublicLocale): string | null {
  const ja = locale === "ja";
  if (effect.entangles) {
    return ja
      ? "ここで量子ビットがもつれます。どの量子ビットも、単独では状態を持たなくなります。"
      : "This is the step that entangles the qubits: from here on no single qubit has a state of its own, only the register as a whole does.";
  }
  if (effect.disentangles) {
    return ja
      ? "もつれがここで解けます。各量子ビットは再びそれぞれの状態を持ちます。"
      : "The entanglement comes apart here: each qubit has a state of its own again.";
  }
  return null;
}

/**
 * The heading over the amplitude-and-phase table, and whether the figure
 * should show that table at all for this step.
 *
 * Shown when the step moved phase, or when the state carries more than one
 * relative phase — the two cases where the probability bars alone leave a
 * reader with a false impression of a state. A state whose amplitudes are all
 * in phase is fully described by the bars, and a second panel repeating them
 * with a "phase 0" column beside each would be noise.
 */
export function shouldShowPhases(effect: StepEffect): effect is StepEffectReading {
  if (effect.kind !== "ok") return false;
  return effect.change === "phase" || effect.distinctPhases > 1;
}

export function phasePanelCopy(locale: PublicLocale): {
  heading: string;
  stateColumn: string;
  probabilityColumn: string;
  phaseColumn: string;
  other: (count: number, probability: string) => string;
  note: string;
} {
  if (locale === "ja") {
    return {
      heading: "このステップ後の振幅と位相",
      stateColumn: "測定結果",
      probabilityColumn: "確率",
      phaseColumn: "相対位相",
      other: (count, probability) => `他 ${count} 件（合計 ${probability}）`,
      note: "位相は最大振幅を基準とした相対値です。全体位相は観測できないため、意味を持つのは差だけです。",
    };
  }
  return {
    heading: "Amplitude and phase after this step",
    stateColumn: "Outcome",
    probabilityColumn: "Probability",
    phaseColumn: "Relative phase",
    other: (count, probability) => `${count} more ${count === 1 ? "outcome" : "outcomes"} (${probability} between them)`,
    note: "Phases are measured against the largest amplitude. A global phase is not observable, so only the differences carry meaning.",
  };
}

/** One row of the amplitude-and-phase table, already formatted. */
export function phaseRow(
  amplitude: AmplitudePhase,
  locale: PublicLocale,
): { bitstring: string; probability: string; phase: string; phaseTurns: number } {
  return {
    bitstring: amplitude.bitstring,
    probability: formatPercent(amplitude.probability),
    phase: formatPhase(amplitude.phaseTurns),
    phaseTurns: amplitude.phaseTurns,
  };
}
