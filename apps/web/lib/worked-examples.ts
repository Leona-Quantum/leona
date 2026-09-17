import {
  blockTemplate,
  instantiateBlock,
  type BlockParams,
} from "./circuit-blocks.ts";
import { createBuilderStepId, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";
// From the pure kernel directly, not from studio-simulation.ts: this module
// is reachable from the public, unauthenticated Atlas record page (via
// atlas-worked-example.tsx), and studio-simulation.ts also imports
// account-tier.ts / user-storage.ts, which must not reach that bundle. Same
// functions, same behavior — studio-simulation.ts re-exports both unchanged.
// `expectationValue` and `PauliTerm` now live there too (moved out of this
// file, same reason) and are re-exported below unchanged. See
// statevector-kernel.ts's doc comment.
import { expectationValue, idealProbabilities, idealStatevector, type PauliTerm } from "./statevector-kernel.ts";

export { expectationValue, type PauliTerm };

/**
 * Concrete, checked worked examples built from circuit-blocks.ts — one
 * instance per algorithm, not a template.
 *
 * Qubit-order convention: identical to circuit-blocks.ts and
 * studio-simulation.ts — qubit `i` is bit `i` of a basis index. A bitstring
 * in a check or a note is read the way `bitstringFor` prints one: character 0
 * is the highest-numbered qubit, the last character is qubit 0.
 */

export type LocalizedText = { en: string; ja: string };

export type WorkedExampleCheck =
  | { kind: "peak"; bitstring: string; minProbability: number }
  | { kind: "support"; bitstrings: string[] }
  | { kind: "distribution"; probabilities: Record<string, number>; tolerance: number }
  | { kind: "expectation"; value: number; tolerance: number };

export type WorkedExample = {
  id: string;
  algorithm: string;
  title: LocalizedText;
  instance: LocalizedText;
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
  notes: { stepId: string; text: LocalizedText }[];
  check: WorkedExampleCheck;
  readout: LocalizedText;
  keywords: string[];
  blocks: string[];
  observable?: PauliTerm[];
};

// ---------------------------------------------------------------------------
// Small builders shared across examples

function place(key: string, params: BlockParams, qubits: number[], idPrefix: string): { step: BuilderStep; customGates: CustomGateDefinition[] } {
  const template = blockTemplate(key);
  if (!template) throw new Error(`unknown block: ${key}`);
  return instantiateBlock(template.build(params), qubits, idPrefix);
}

function rawStep(gate: BuilderStep["gate"], qubits: number[], param?: string): BuilderStep {
  return { id: createBuilderStepId(), gate, qubits, ...(param ? { param } : {}) };
}

function note(stepId: string, en: string, ja: string): { stepId: string; text: LocalizedText } {
  return { stepId, text: { en, ja } };
}

// ---------------------------------------------------------------------------
// 1. bell-pair

function bellPair(): WorkedExample {
  const h = rawStep("H", [0]);
  const cx = rawStep("CX", [0, 1]);
  return {
    id: "bell-pair",
    algorithm: "Bell pair",
    title: { en: "A Bell pair", ja: "ベル対" },
    instance: { en: "2 qubits, preparing (|00⟩ + |11⟩) / √2.", ja: "2量子ビットで (|00⟩ + |11⟩) / √2 を準備します。" },
    qubitCount: 2,
    steps: [h, cx],
    customGates: [],
    notes: [
      note(h.id, "Puts qubit 0 into an equal superposition of |0⟩ and |1⟩.", "量子ビット0を|0⟩と|1⟩の等しい重ね合わせにします。"),
      note(cx.id, "Entangles qubit 1 with qubit 0, so the two only ever agree.", "量子ビット1を量子ビット0ともつれさせ、2つの量子ビットは常に一致します。"),
    ],
    check: { kind: "support", bitstrings: ["00", "11"] },
    readout: { en: "Measuring both qubits always gives 00 or 11, each about half the time, and never 01 or 10.", ja: "両方の量子ビットを測定すると常に00か11が得られ、それぞれ約半分の確率で、01や10になることはありません。" },
    keywords: ["bell state", "entanglement"],
    blocks: [],
  };
}

// ---------------------------------------------------------------------------
// 2. ghz-4

function ghz4(): WorkedExample {
  // The `ghz` block, unrolled into its own four gates as four top-level steps.
  // Placed as one block this example was a single opaque box labelled GHZ(4):
  // one step, one note, and a walkthrough with nothing to walk through. The
  // gate sequence and the final state are identical — `leafBlock` for `ghz`
  // is exactly h(0) then the CX chain — but each link of the chain is now its
  // own step, and each one's derived effect shows the entanglement reaching
  // one more qubit.
  const h0 = rawStep("H", [0]);
  const chain = [rawStep("CX", [0, 1]), rawStep("CX", [1, 2]), rawStep("CX", [2, 3])];
  return {
    id: "ghz-4",
    algorithm: "GHZ state",
    title: { en: "A 4-qubit GHZ state", ja: "4量子ビットGHZ状態" },
    instance: { en: "4 qubits, preparing (|0000⟩ + |1111⟩) / √2.", ja: "4量子ビットで (|0000⟩ + |1111⟩) / √2 を準備します。" },
    qubitCount: 4,
    steps: [h0, ...chain],
    customGates: [],
    notes: [
      note(h0.id, "Puts qubit 0 into an equal superposition of |0⟩ and |1⟩. The other three are still plain |0⟩.", "量子ビット0を|0⟩と|1⟩の等しい重ね合わせにします。他の3つはまだ単なる|0⟩です。"),
      note(chain[0].id, "Copies qubit 0's value onto qubit 1 — not by reading it, which would destroy the superposition, but by making the pair agree in both branches at once.", "量子ビット0の値を量子ビット1へ写します。読み取るのではなく（読み取れば重ね合わせが壊れます）、2つの分岐の両方で同時に一致させることで行います。"),
      note(chain[1].id, "The same again onto qubit 2: the agreement extends down the chain one qubit at a time.", "量子ビット2へも同様に。一致が鎖に沿って1量子ビットずつ広がります。"),
      note(chain[2].id, "And onto qubit 3, closing the chain. All four now agree in both branches, which is what makes this a GHZ state rather than four separate superpositions.", "そして量子ビット3へ。鎖が閉じます。4つすべてが両方の分岐で一致し、これが4つの独立した重ね合わせではなくGHZ状態である理由です。"),
    ],
    check: { kind: "support", bitstrings: ["0000", "1111"] },
    readout: { en: "Measuring all four qubits always gives 0000 or 1111, each about half the time.", ja: "4つの量子ビットすべてを測定すると常に0000か1111が得られ、それぞれ約半分の確率です。" },
    keywords: ["ghz state", "entanglement"],
    blocks: [],
  };
}

// ---------------------------------------------------------------------------
// 3. deutsch-jozsa-3 (n=3 input + 1 ancilla, uncomputed at the end)

function deutschJozsa3(): WorkedExample {
  const n = 3;
  const ancilla = n;
  const prepAncilla = rawStep("X", [ancilla]);
  const hAll = place("hadamard_layer", { n: 4 }, [0, 1, 2, 3], "h-all");
  const oracle = place("dj_balanced_oracle", { n }, [0, 1, 2, ancilla], "dj-oracle");
  const hInputs = place("hadamard_layer", { n: 3 }, [0, 1, 2], "h-inputs");
  const uncomputeH = rawStep("H", [ancilla]);
  const uncomputeX = rawStep("X", [ancilla]);
  const steps = [prepAncilla, hAll.step, oracle.step, hInputs.step, uncomputeH, uncomputeX];
  return {
    id: "deutsch-jozsa-3",
    algorithm: "Deutsch-Jozsa",
    title: { en: "Deutsch-Jozsa on a balanced function", ja: "均等関数に対するドイチュ・ジョサ" },
    instance: { en: "3 input qubits, testing f(x) = x0 XOR x1 XOR x2, which is balanced.", ja: "3つの入力量子ビットで、均等関数 f(x) = x0 XOR x1 XOR x2 を判定します。" },
    qubitCount: 4,
    steps,
    customGates: [...hAll.customGates, ...oracle.customGates, ...hInputs.customGates],
    notes: [
      note(prepAncilla.id, "Sets the ancilla to |1⟩, so the next step can put it into |−⟩.", "補助量子ビットを|1⟩にし、次のステップで|−⟩にできるようにします。"),
      note(hAll.step.id, "Hadamards everything: the ancilla becomes |−⟩, and the three input qubits spread into an equal superposition of all 8 inputs.", "すべての量子ビットにアダマールを適用します。補助量子ビットは|−⟩になり、3つの入力量子ビットは8通りの入力すべての等しい重ね合わせになります。"),
      note(oracle.step.id, "Applies f by CX-ing each input qubit onto the ancilla; against |−⟩, this kicks a phase (−1)^f(x) onto each input branch.", "各入力量子ビットを補助量子ビットへCXすることでfを適用します。補助量子ビットが|−⟩であるため、各入力分岐に位相(−1)^f(x)が乗ります。"),
      note(hInputs.step.id, "A second Hadamard layer on the inputs only turns those phases into a deterministic readout.", "入力量子ビットのみへの2回目のアダマール層が、それらの位相を確定的な読み出し結果に変えます。"),
      note(uncomputeH.id, "Undoes the ancilla's Hadamard.", "補助量子ビットのアダマールを打ち消します。"),
      note(uncomputeX.id, "Returns the ancilla to |0⟩, purely for a tidy final state. It plays no further role in the algorithm.", "補助量子ビットを|0⟩に戻します。これは最終状態を整えるためだけのもので、アルゴリズム自体にはこれ以上関与しません。"),
    ],
    check: { kind: "peak", bitstring: "0111", minProbability: 0.999 },
    readout: { en: "The three input qubits read 111 (any nonzero result proves f is balanced, not constant); the ancilla reads 0.", ja: "3つの入力量子ビットは111と読み取られます（0以外の結果はfが定数ではなく均等であることを証明します）。補助量子ビットは0です。" },
    keywords: ["deutsch-jozsa", "oracle"],
    blocks: ["hadamard_layer", "dj_balanced_oracle"],
  };
}

// ---------------------------------------------------------------------------
// 4. bernstein-vazirani-1011 (n=4 + 1 ancilla, uncomputed)

function bernsteinVazirani1011(): WorkedExample {
  const secret = "1011";
  const n = secret.length;
  const ancilla = n;
  const prepAncilla = rawStep("X", [ancilla]);
  const hAll = place("hadamard_layer", { n: 5 }, [0, 1, 2, 3, 4], "h-all");
  const oracle = place("bv_oracle", { secret }, [0, 1, 2, 3, ancilla], "bv-oracle");
  const hInputs = place("hadamard_layer", { n: 4 }, [0, 1, 2, 3], "h-inputs");
  const uncomputeH = rawStep("H", [ancilla]);
  const uncomputeX = rawStep("X", [ancilla]);
  const steps = [prepAncilla, hAll.step, oracle.step, hInputs.step, uncomputeH, uncomputeX];
  return {
    id: "bernstein-vazirani-1011",
    algorithm: "Bernstein-Vazirani",
    title: { en: "Bernstein-Vazirani recovers a secret string", ja: "ベルンシュタイン・ヴァジラニで秘密の文字列を復元" },
    instance: { en: "4 input qubits, secret string 1011, recovered in a single query.", ja: "4つの入力量子ビットで、秘密の文字列1011を1回の問い合わせで復元します。" },
    qubitCount: 5,
    steps,
    customGates: [...hAll.customGates, ...oracle.customGates, ...hInputs.customGates],
    notes: [
      note(prepAncilla.id, "Sets the ancilla to |1⟩, so the next step can put it into |−⟩.", "補助量子ビットを|1⟩にし、次のステップで|−⟩にできるようにします。"),
      note(hAll.step.id, "Hadamards everything: the ancilla becomes |−⟩, and the four input qubits spread into an equal superposition.", "すべての量子ビットにアダマールを適用します。補助量子ビットは|−⟩になり、4つの入力量子ビットは等しい重ね合わせになります。"),
      note(oracle.step.id, "CXs the input qubits where the secret has a 1 (positions 0, 1 and 3) onto the ancilla, kicking back a phase that encodes the secret.", "秘密の文字列が1である位置（0, 1, 3番目）の入力量子ビットを補助量子ビットへCXし、秘密を符号化する位相を跳ね返します。"),
      note(hInputs.step.id, "A second Hadamard layer on the inputs turns that phase pattern directly into the secret string.", "入力量子ビットへの2回目のアダマール層が、その位相パターンを秘密の文字列そのものに変換します。"),
      note(uncomputeH.id, "Undoes the ancilla's Hadamard.", "補助量子ビットのアダマールを打ち消します。"),
      note(uncomputeX.id, "Returns the ancilla to |0⟩, purely for a tidy final state.", "補助量子ビットを|0⟩に戻します。これは最終状態を整えるためだけのものです。"),
    ],
    check: { kind: "peak", bitstring: "01011", minProbability: 0.999 },
    readout: { en: "The four input qubits read 1011, the secret, recovered exactly, in one shot. The ancilla reads 0.", ja: "4つの入力量子ビットは1011と読み取られます。秘密がそのまま、1回で復元されます。補助量子ビットは0です。" },
    keywords: ["bernstein-vazirani", "oracle"],
    blocks: ["hadamard_layer", "bv_oracle"],
  };
}

// ---------------------------------------------------------------------------
// 5. grover-3q-101

function grover3q101(): WorkedExample {
  const n = 3;
  const hAll = place("hadamard_layer", { n }, [0, 1, 2], "h-all");
  // Each Grover iteration split into its two halves rather than placed as one
  // `grover_iteration` block. The two do completely different things and the
  // difference is the algorithm: the oracle moves no probability at all — it
  // only flips a sign — and the diffuser turns that sign into amplitude. As a
  // single box per iteration the figure showed one number going up and gave a
  // reader no way to see which half did it, or that half of Grover is a step
  // the probability bars cannot show.
  const oracle1 = place("phase_oracle", { bitstring: "101" }, [0, 1, 2], "oracle1");
  const diffuser1 = place("grover_diffuser", { n }, [0, 1, 2], "diffuser1");
  const oracle2 = place("phase_oracle", { bitstring: "101" }, [0, 1, 2], "oracle2");
  const diffuser2 = place("grover_diffuser", { n }, [0, 1, 2], "diffuser2");
  const steps = [hAll.step, oracle1.step, diffuser1.step, oracle2.step, diffuser2.step];
  return {
    id: "grover-3q-101",
    algorithm: "Grover search",
    title: { en: "Grover's algorithm finds |101⟩", ja: "グローバーのアルゴリズムが|101⟩を発見" },
    instance: { en: "3 qubits, searching for |101⟩ among 8 states, with 2 Grover iterations.", ja: "3量子ビット、8状態の中から|101⟩を2回のグローバー反復で探索します。" },
    qubitCount: n,
    steps,
    customGates: [
      ...hAll.customGates,
      ...oracle1.customGates,
      ...diffuser1.customGates,
      ...oracle2.customGates,
      ...diffuser2.customGates,
    ],
    notes: [
      note(hAll.step.id, "Spreads the state into an equal superposition of all 8 three-qubit strings. Every answer is equally likely, including the right one.", "状態を8通りの3量子ビット文字列すべての等しい重ね合わせに広げます。正解を含め、どの答えも等しく起こりえます。"),
      note(oracle1.step.id, "The oracle marks |101⟩ by flipping its sign, and leaves the other seven states exactly as they were. Measuring now would be no better than guessing — the mark is a phase, and a phase is not an outcome.", "オラクルは|101⟩の符号を反転させて印をつけ、他の7状態はそのままにします。ここで測定しても当てずっぽうと変わりません。印は位相であり、位相は測定結果ではないからです。"),
      note(diffuser1.step.id, "The diffuser reflects every amplitude about their average. The marked state sits below the average because its sign was flipped, so reflecting pushes it up and pulls the other seven down. This is where the phase becomes probability.", "拡散変換はすべての振幅を平均に関して反射させます。印のついた状態は符号が反転しているため平均より下にあり、反射によって押し上げられ、他の7つは引き下げられます。位相が確率に変わるのがここです。"),
      note(oracle2.step.id, "The same oracle again, flipping the sign of |101⟩ — now the largest amplitude rather than one of eight equal ones.", "同じオラクルをもう一度適用し、|101⟩の符号を反転させます。今度は8つの等しい振幅のひとつではなく、最大の振幅です。"),
      note(diffuser2.step.id, "And the same reflection again. Two iterations is close to the optimal number for 8 states: a third would overshoot and start pushing the answer back down.", "そして同じ反射をもう一度。8状態に対して2回の反復はほぼ最適な回数です。3回目は行き過ぎて、答えを再び押し下げ始めます。"),
    ],
    check: { kind: "peak", bitstring: "101", minProbability: 0.9 },
    readout: { en: "Measuring gives 101, the marked state, with high probability.", ja: "測定すると高い確率でマークされた状態である101が得られます。" },
    keywords: ["grover", "amplitude amplification"],
    blocks: ["hadamard_layer", "phase_oracle", "grover_diffuser"],
  };
}

// ---------------------------------------------------------------------------
// 6. qft-4q-roundtrip

function qft4qRoundtrip(): WorkedExample {
  const n = 4;
  // |0101>: qubit3=0, qubit2=1, qubit1=0, qubit0=1.
  const prep = [rawStep("X", [2]), rawStep("X", [0])];
  const qft = place("qft", { n }, [0, 1, 2, 3], "qft");
  const qftInverse = place("qft_inverse", { n }, [0, 1, 2, 3], "qft-inverse");
  const steps = [...prep, qft.step, qftInverse.step];
  return {
    id: "qft-4q-roundtrip",
    algorithm: "Quantum Fourier Transform",
    title: { en: "QFT then its inverse, on |0101⟩", ja: "|0101⟩へのQFTとその逆変換" },
    instance: { en: "4 qubits, starting at |0101⟩, applying the QFT then immediately undoing it.", ja: "4量子ビット、|0101⟩から開始し、QFTを適用した直後に元に戻します。" },
    qubitCount: n,
    steps,
    customGates: [...qft.customGates, ...qftInverse.customGates],
    notes: [
      note(prep[0].id, "Prepares qubit 2 as |1⟩.", "量子ビット2を|1⟩に準備します。"),
      note(prep[1].id, "Prepares qubit 0 as |1⟩, so the register reads |0101⟩.", "量子ビット0を|1⟩に準備し、レジスタが|0101⟩になるようにします。"),
      note(qft.step.id, "Applies the Quantum Fourier Transform, spreading the single input state into an equal-magnitude superposition over all 16 outputs, each carrying a different phase.", "量子フーリエ変換を適用し、単一の入力状態を16通りの出力すべてにわたる等しい大きさの重ね合わせに広げます。それぞれが異なる位相を持ちます。"),
      note(qftInverse.step.id, "Applies the exact inverse QFT, which collapses the superposition straight back to the original input.", "厳密な逆QFTを適用し、重ね合わせを元の入力へそのまま戻します。"),
    ],
    check: { kind: "peak", bitstring: "0101", minProbability: 0.999 },
    readout: { en: "The register reads 0101 again, exactly: the QFT and its inverse cancel, the way any unitary and its adjoint do.", ja: "レジスタは再び正確に0101と読み取られます。QFTとその逆変換は、ユニタリ演算とその随伴演算がそうであるように打ち消し合います。" },
    keywords: ["quantum fourier transform", "qft"],
    blocks: ["qft", "fourier_add_constant", "qft_inverse"],
  };
}

// ---------------------------------------------------------------------------
// 7 & 8. QPE — exact and inexact.
//
// Bit order, established by running the circuit rather than assumed: for
// t=3, angle=3*pi/4 (= 2*pi*3/8), the full 4-qubit register (qubits 0-2
// counting, qubit 3 the target) lands EXACTLY on bitstring "1011" —
// target=1 (its eigenvalue population never moves, only its phase), and the
// counting register's own three characters read "011" = 3, matching
// angle/(2*pi) = 3/8 exactly. So the counting register's displayed
// bitstring (this file's usual convention: character 0 = the highest
// qubit) reads off the integer k such that angle/(2*pi) ~= k / 2^t directly
// — no reversal needed.

function qpePhaseExample(
  id: string,
  angle: string,
  check: WorkedExampleCheck,
  instanceEn: string,
  instanceJa: string,
  readoutEn: string,
  readoutJa: string,
): WorkedExample {
  const t = 3;
  const target = t;
  const counting = [0, 1, 2];
  // The `qpe_phase` block's own four stages, placed as four top-level steps
  // instead of the single box the block draws as. Same gates, same final
  // state — `QPE_PHASE.build` is exactly this sequence — but phase estimation
  // stops being one rectangle labelled "QPE phase(3)" with one sentence under
  // it, which is what it was: the most-referenced example in the corpus and
  // the least legible.
  //
  // It is worth four steps specifically because the third one is invisible to
  // the probability bars. The controlled powers write the phase into the
  // counting register without moving a single outcome probability, and the
  // inverse QFT then turns that phase into the answer. Split like this, the
  // figure's derived per-step reading says exactly that; as one box it could
  // not say anything at all.
  const prepare = rawStep("X", [target]);
  const hadamards = place("hadamard_layer", { n: t }, counting, `${id}-h`);
  const powers = place("controlled_phase_powers", { t, angle }, [...counting, target], `${id}-cpp`);
  const inverseQft = place("qft_inverse", { n: t }, counting, `${id}-iqft`);
  const steps = [prepare, hadamards.step, powers.step, inverseQft.step];
  return {
    id,
    algorithm: "Quantum Phase Estimation",
    title: { en: `Phase estimation of P(${angle})`, ja: `P(${angle})の位相推定` },
    instance: { en: instanceEn, ja: instanceJa },
    qubitCount: t + 1,
    steps,
    customGates: [...hadamards.customGates, ...powers.customGates, ...inverseQft.customGates],
    notes: [
      note(
        prepare.id,
        `Puts the target qubit into |1⟩, which is an eigenstate of P(${angle}): applying the gate to it multiplies it by a phase and changes nothing else. That is the whole requirement QPE places on its input.`,
        `対象量子ビットを|1⟩にします。これはP(${angle})の固有状態です。このゲートを適用しても位相が掛かるだけで、他には何も変わりません。QPEが入力に要求するのはこれだけです。`,
      ),
      note(
        hadamards.step.id,
        "Spreads the 3 counting qubits over all 8 values they can hold at once. Each one will later ask about a different power of the phase.",
        "3個のカウント量子ビットを、取りうる8通りの値すべてに同時に広げます。それぞれが後で位相の異なるべき乗について問い合わせます。",
      ),
      note(
        powers.step.id,
        `Counting qubit k applies P(${angle}) to the target 2^k times, controlled on itself. The target never changes — it is an eigenstate — so the phase it would have picked up is kicked back onto the control instead. This is the step that writes the answer into the register.`,
        `カウント量子ビットkは、自身を制御として対象にP(${angle})を2^k回適用します。対象は固有状態なので変化せず、対象が受けるはずだった位相が制御側へ跳ね返ります。答えをレジスタに書き込むのがこのステップです。`,
      ),
      note(
        inverseQft.step.id,
        "The inverse Fourier transform reads that phase pattern back out as a binary number. Phase in, bits out.",
        "逆フーリエ変換が、その位相のパターンを2進数として読み出します。位相を入れて、ビットを取り出します。",
      ),
    ],
    check,
    readout: { en: readoutEn, ja: readoutJa },
    keywords: ["phase estimation"],
    blocks: ["hadamard_layer", "controlled_phase_powers", "qft_inverse"],
  };
}

// ---------------------------------------------------------------------------
// 9. draper-adder-5-plus-3

function draperAdder5Plus3(): WorkedExample {
  const n = 4;
  const a = 3;
  // |5> = 0101: qubit2=1, qubit0=1.
  const prep = [rawStep("X", [0]), rawStep("X", [2])];
  // The adder's three stages as three steps rather than one `draper_add_constant`
  // box. The point of the Draper adder is WHERE the arithmetic happens — the
  // register is transformed into the Fourier basis, the addition is a set of
  // single-qubit phase rotations there, and the register is transformed back —
  // and a single box labelled "Draper add 3 (mod 16)" showed none of that. Split
  // like this the middle step reads as pure phase, which is the claim the record
  // makes: no ancilla, no carry chain, the carries are already in the phases.
  const toFourier = place("qft", { n }, [0, 1, 2, 3], "draper-qft");
  const rotations = place("fourier_add_constant", { n, a }, [0, 1, 2, 3], "draper-add");
  const fromFourier = place("qft_inverse", { n }, [0, 1, 2, 3], "draper-iqft");
  const steps = [...prep, toFourier.step, rotations.step, fromFourier.step];
  return {
    id: "draper-adder-5-plus-3",
    algorithm: "Draper adder",
    title: { en: "Draper adder: 5 + 3", ja: "ドレイパー加算器：5 + 3" },
    instance: { en: "4 qubits, adding the constant 3 to the input 5, giving 8 mod 16.", ja: "4量子ビットで、入力5に定数3を加算し、16を法として8を得ます。" },
    qubitCount: n,
    steps,
    customGates: [...toFourier.customGates, ...rotations.customGates, ...fromFourier.customGates],
    notes: [
      note(prep[0].id, "Prepares qubit 0 as |1⟩.", "量子ビット0を|1⟩に準備します。"),
      note(prep[1].id, "Prepares qubit 2 as |1⟩, so the register reads |0101⟩ = 5.", "量子ビット2を|1⟩に準備し、レジスタが|0101⟩ = 5になるようにします。"),
      note(toFourier.step.id, "Transforms the register into the Fourier basis. The number 5 is no longer one outcome — it is a pattern of phases spread evenly over all 16.", "レジスタをフーリエ基底へ変換します。数5はもはや1つの測定結果ではなく、16通り全体に均等に広がった位相のパターンです。"),
      note(rotations.step.id, "Four single-qubit phase rotations, each twice the angle of the one below it because each qubit is worth twice as much in the binary number. Together they add 3 to whatever number the phases encode — with no ancilla and no carry chain, because in this basis the carries are already in the phases. Open the block to see the four angles.", "4つの単一量子ビット位相回転です。2進数において各量子ビットの重みが2倍ずつ大きくなるため、角度もひとつ下の2倍になっています。これらが合わさって、位相が符号化している数に3を加えます。補助量子ビットも桁上げの連鎖もありません。この基底では桁上げがすでに位相の中にあるからです。ブロックを開くと4つの角度が見られます。"),
      note(fromFourier.step.id, "Transforms back out of the Fourier basis, turning the shifted phase pattern into the answer as an ordinary binary number.", "フーリエ基底から戻す変換を行い、ずれた位相のパターンを通常の2進数としての答えに変えます。"),
    ],
    check: { kind: "peak", bitstring: "1000", minProbability: 0.999 },
    readout: { en: "The register reads 1000 = 8: 5 + 3, exactly.", ja: "レジスタは1000 = 8と読み取られます：5 + 3が正確に得られます。" },
    keywords: ["draper adder", "quantum arithmetic", "quantum fourier transform"],
    blocks: ["qft", "fourier_add_constant", "qft_inverse"],
  };
}

// ---------------------------------------------------------------------------
// 10. ising-trotter-4 — check values are regression values taken by running
// this file's own simulator once, NOT a physics claim about a real material.

function isingTrotter4(): WorkedExample {
  const n = 4;
  const J = "1";
  const h = "0.5";
  const dt = "0.3";
  const step1 = place("ising_trotter_step", { n, J, h, dt }, [0, 1, 2, 3], "trotter1");
  const step2 = place("ising_trotter_step", { n, J, h, dt }, [0, 1, 2, 3], "trotter2");
  const steps = [step1.step, step2.step];
  return {
    id: "ising-trotter-4",
    algorithm: "Trotterized time evolution",
    title: { en: "2 Trotter steps of a transverse-field Ising chain", ja: "横磁場イジング鎖の2回のトロッター・ステップ" },
    instance: { en: "4 qubits starting at |0000⟩, J=1, h=0.5, dt=0.3, 2 first-order Trotter steps.", ja: "4量子ビットが|0000⟩から開始し、J=1、h=0.5、dt=0.3で、1次のトロッター・ステップを2回行います。" },
    qubitCount: n,
    steps,
    customGates: [...step1.customGates, ...step2.customGates],
    notes: [
      note(step1.step.id, "First Trotter step: RZZ(2*J*dt) couples each neighbouring pair on the line, then RX(2*h*dt) applies the transverse field to every qubit.", "1回目のトロッター・ステップ：RZZ(2*J*dt)が直線上の隣接するペアを結合し、続いてRX(2*h*dt)が横磁場をすべての量子ビットに適用します。"),
      note(step2.step.id, "Second Trotter step, identical to the first. Together the two steps approximate exp(−i·H·2·dt) for this chain's Hamiltonian.", "2回目のトロッター・ステップは1回目と同一です。合わせて、この鎖のハミルトニアンに対するexp(−i・H・2・dt)を近似します。"),
    ],
    // Regression values from running this file's own simulator once — not a
    // physics claim about a real material (only the 5 largest entries are
    // pinned; the rest of the probability mass, ~0.031, is spread thinly
    // across the remaining basis states and left unchecked).
    check: {
      kind: "distribution",
      probabilities: { "0000": 0.7517, "0001": 0.0636, "1000": 0.0636, "0010": 0.0452, "0100": 0.0452 },
      tolerance: 0.001,
    },
    readout: { en: "The state spreads from |0000⟩ across several nearby basis states. The exact split is a regression value from this file's own simulator, not a claim about a real material.", ja: "状態は|0000⟩からいくつかの近い基底状態に広がります。正確な内訳はこのファイル自身のシミュレータによる回帰値であり、実在する物質についての主張ではありません。" },
    keywords: ["trotter", "product formula", "hamiltonian simulation"],
    blocks: ["ising_trotter_step"],
  };
}

// ---------------------------------------------------------------------------
// 11. qaoa-maxcut-4-cycle

function qaoaMaxcut4Cycle(): WorkedExample {
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]];
  // gamma=pi/4, beta=pi/8 (the block's own defaults) turn out to tie 0101/1010
  // with FOUR other cuts at the same probability — not a useful worked
  // example. gamma=pi/8, beta=3*pi/8 was found by a coarse grid search over
  // this file's own simulator and gives 0101/1010 a clean, well-separated
  // peak (~0.266 each, next tier ~0.078).
  const gamma = "pi/8";
  const beta = "3*pi/8";
  const hAll = place("hadamard_layer", { n: 4 }, [0, 1, 2, 3], "h-all");
  const layer = place("qaoa_maxcut_layer", { edges, gamma, beta }, [0, 1, 2, 3], "qaoa-layer");
  const steps = [hAll.step, layer.step];
  return {
    id: "qaoa-maxcut-4-cycle",
    algorithm: "QAOA",
    title: { en: "QAOA, p=1, MaxCut on a 4-cycle", ja: "QAOA、p=1、4サイクルのMaxCut" },
    instance: { en: "4 qubits on a 4-cycle (edges 0-1, 1-2, 2-3, 3-0), one QAOA layer with gamma=pi/8, beta=3*pi/8.", ja: "4サイクル上の4量子ビット（辺0-1、1-2、2-3、3-0）、gamma=pi/8、beta=3*pi/8で1層のQAOA。" },
    qubitCount: 4,
    steps,
    customGates: [...hAll.customGates, ...layer.customGates],
    notes: [
      note(hAll.step.id, "Starts from the uniform superposition over all 16 possible cuts.", "16通りのすべてのカット分割にわたる一様な重ね合わせから開始します。"),
      note(layer.step.id, "The cost layer (RZZ(2*gamma) on each of the 4 edges) rewards cuts that separate connected qubits, then the mixer (RX(2*beta) on every qubit) lets amplitude move between cuts.", "コスト層（4本の辺それぞれにRZZ(2*gamma)）が接続された量子ビットを分離するカットに報いを与え、続いてミキサー（すべての量子ビットにRX(2*beta)）がカット間で振幅を移動させます。"),
    ],
    // Probability taken from running this file's own simulator once; 1010 is
    // equal by the cycle's own symmetry (checked directly in the test too).
    check: { kind: "peak", bitstring: "0101", minProbability: 0.26 },
    readout: { en: "0101 and 1010 are the two optimal cuts of a 4-cycle (alternating around the ring); at these angles measuring the register returns one of them clearly more often than any other cut.", ja: "0101と1010は4サイクルの2つの最適カットです（リング上で交互）。この角度では、レジスタを測定するとこれらのどちらかが他のどのカットよりも明確に高い頻度で得られます。" },
    keywords: ["qaoa", "maxcut", "variational"],
    blocks: ["hadamard_layer", "qaoa_maxcut_layer"],
  };
}

// ---------------------------------------------------------------------------
// 12. swap-test (|+> vs |0>)

function swapTestPlusZero(): WorkedExample {
  const built = place("swap_test", { n: 1 }, [0, 1, 2], "swap-test");
  const prep = rawStep("H", [1]);
  const steps = [prep, built.step];
  return {
    id: "swap-test",
    algorithm: "Swap test",
    title: { en: "Swap test: |+⟩ versus |0⟩", ja: "スワップテスト：|+⟩ と |0⟩" },
    instance: { en: "One ancilla plus two single-qubit registers, comparing |+⟩ against |0⟩.", ja: "1個の補助量子ビットと2つの単一量子ビットレジスタで、|+⟩と|0⟩を比較します。" },
    qubitCount: 3,
    steps,
    customGates: built.customGates,
    notes: [
      note(prep.id, "Prepares the first register (qubit 1) as |+⟩; the second register (qubit 2) is left at |0⟩.", "最初のレジスタ（量子ビット1）を|+⟩に準備します。2番目のレジスタ（量子ビット2）は|0⟩のままにします。"),
      note(built.step.id, "Hadamards the ancilla, applies a controlled swap between the two registers, then Hadamards the ancilla again.", "補助量子ビットにアダマールを適用し、2つのレジスタ間で制御スワップを適用した後、補助量子ビットに再びアダマールを適用します。"),
    ],
    // Full distribution (qubit 2 = register B, qubit 1 = register A, qubit 0
    // = ancilla — see the module-level convention note), verified against the
    // simulator: 000 (both registers read 0) carries the whole "identical
    // outcome" mass at 0.5, and each state with register A=1 or B=1 alone
    // carries 0.125, all with the ancilla split 0/1 evenly within each.
    check: { kind: "distribution", probabilities: { "000": 0.5, "010": 0.125, "011": 0.125, "100": 0.125, "101": 0.125 }, tolerance: 1e-6 },
    readout: { en: "The ancilla (qubit 0) reads 0 more often than 1: the swap test formula (1 + |⟨+|0⟩|²) / 2 predicts this, using the exact overlap |⟨+|0⟩|² = 1/2.", ja: "補助量子ビット（量子ビット0）は1より0と読み取られることの方が多くなります。スワップテストの式 (1 + |⟨+|0⟩|²) / 2 がこれを予測し、厳密な重なり |⟨+|0⟩|² = 1/2 を用います。" },
    keywords: ["swap test", "state overlap"],
    blocks: ["swap_test"],
  };
}

// ---------------------------------------------------------------------------
// 13. teleportation-deferred

function teleportationDeferred(): WorkedExample {
  const prepState = rawStep("RY", [0], "pi/3");
  const bellH = rawStep("H", [1]);
  const bellCx = rawStep("CX", [1, 2]);
  const measureCx = rawStep("CX", [0, 1]);
  const measureH = rawStep("H", [0]);
  const correctX = rawStep("CX", [1, 2]);
  const correctZ = rawStep("CZ", [0, 2]);
  const steps = [prepState, bellH, bellCx, measureCx, measureH, correctX, correctZ];
  return {
    id: "teleportation-deferred",
    algorithm: "Quantum teleportation",
    title: { en: "Teleportation, deferred-measurement form", ja: "遅延測定形式によるテレポーテーション" },
    instance: { en: "3 qubits, teleporting RY(π/3)|0⟩ from qubit 0 to qubit 2, with the corrections applied as controlled gates instead of classically controlled ones after a measurement.", ja: "3量子ビットで、RY(π/3)|0⟩を量子ビット0から量子ビット2へテレポートします。補正は測定後の古典制御ゲートではなく、制御ゲートとして適用されます。" },
    qubitCount: 3,
    steps,
    customGates: [],
    notes: [
      note(prepState.id, "Prepares the state to teleport on qubit 0: RY(π/3)|0⟩.", "テレポートする状態を量子ビット0に準備します：RY(π/3)|0⟩。"),
      note(bellH.id, "Starts a Bell pair between qubit 1 (Alice's half) and qubit 2 (Bob's half).", "量子ビット1（アリスの半分）と量子ビット2（ボブの半分）の間でベル対を開始します。"),
      note(bellCx.id, "Completes the Bell pair.", "ベル対を完成させます。"),
      note(measureCx.id, "The first half of Alice's Bell measurement on her two qubits (0 and 1), ordinarily followed by an actual measurement.", "アリスが自分の2つの量子ビット（0と1）に対して行うベル測定の前半です。通常はここで実際の測定が行われます。"),
      note(measureH.id, "The second half of Alice's Bell measurement.", "アリスのベル測定の後半です。"),
      note(correctX.id, "The correction that would classically depend on Alice's qubit-1 outcome, applied instead as a genuine controlled gate (the 'deferred measurement' trick).", "本来はアリスの量子ビット1の測定結果に古典的に依存する補正を、実際の制御ゲートとして適用します（「遅延測定」のトリック）。"),
      note(correctZ.id, "The correction that would classically depend on Alice's qubit-0 outcome, applied the same way.", "本来はアリスの量子ビット0の測定結果に依存する補正を、同様に適用します。"),
    ],
    check: { kind: "expectation", value: 0.5, tolerance: 1e-9 },
    readout: { en: "Qubit 2's marginal state matches RY(π/3)|0⟩ exactly: ⟨Z⟩ = cos(π/3) = 0.5. The state teleported across without qubit 0 and qubit 2 ever directly interacting.", ja: "量子ビット2の周辺状態はRY(π/3)|0⟩と正確に一致します：⟨Z⟩ = cos(π/3) = 0.5。量子ビット0と量子ビット2が直接相互作用することなく、状態がテレポートされました。" },
    keywords: ["teleportation"],
    blocks: [],
    observable: [{ coefficient: 1, pauli: "ZII" }],
  };
}

// ---------------------------------------------------------------------------
// 14. vqe-2q-transverse-ising

// Found by a deterministic coarse grid search over this file's own simulator
// (multiples of pi/4 in each of the 4 angles — see worked-examples.test.ts,
// which re-runs the same bounded search and checks it lands here). This
// exact point reaches the Hamiltonian's true ground energy exactly (to
// floating-point precision): the second RY layer turns out not to be needed
// for this particular 2-qubit problem, so both its angles are 0.
const VQE_ANGLES = ["pi/2", "5*pi/4", "0", "0"];
// The exact ground energy of H = Z@Z + 0.5*(X@I + I@X), by diagonalising the
// 4x4 matrix (also done independently in the test).
const VQE_GROUND_ENERGY = -Math.sqrt(2);

function vqeAnsatzSteps(angles: readonly string[], idPrefix: string): BuilderStep[] {
  return [
    rawStep("RY", [0], angles[0]),
    rawStep("RY", [1], angles[1]),
    rawStep("CX", [0, 1]),
    rawStep("RY", [0], angles[2]),
    rawStep("RY", [1], angles[3]),
  ].map((step, index) => ({ ...step, id: `${idPrefix}-${index}` }));
}

const VQE_OBSERVABLE: PauliTerm[] = [
  { coefficient: 1, pauli: "ZZ" },
  { coefficient: 0.5, pauli: "XI" },
  { coefficient: 0.5, pauli: "IX" },
];

function vqeTransverseIsing(): WorkedExample {
  const steps = vqeAnsatzSteps(VQE_ANGLES, "vqe");
  return {
    id: "vqe-2q-transverse-ising",
    algorithm: "Variational Quantum Eigensolver",
    title: { en: "VQE on a 2-qubit transverse-field Ising Hamiltonian", ja: "2量子ビット横磁場イジング・ハミルトニアンに対するVQE" },
    instance: { en: "2 qubits, H = Z⊗Z + 0.5*(X⊗I + I⊗X), a stated toy Hamiltonian (not a molecule), minimised with a hardware-efficient ansatz.", ja: "2量子ビット、H = Z⊗Z + 0.5*(X⊗I + I⊗X)、明示された説明用の簡単なハミルトニアン（分子ではありません）を、ハードウェア効率の良いアンザッツで最小化します。" },
    qubitCount: 2,
    steps,
    customGates: [],
    notes: [
      note(steps[0].id, "One of the four angles the optimiser is free to turn. Nothing chose π/2 in advance — it is where a classical optimiser ended up after repeatedly measuring the energy and adjusting.", "最適化器が自由に回せる4つの角度のひとつです。事前に π/2 を選んだものは何もなく、エネルギーの測定と調整を繰り返した古典最適化器が行き着いた値です。"),
      note(steps[1].id, "The same freedom on qubit 1, and a different answer: 5π/4 rather than π/2. The two qubits are not symmetric in this Hamiltonian, so the ansatz must be able to treat them differently.", "量子ビット1にも同じ自由度があり、答えは異なります。π/2 ではなく 5π/4 です。このハミルトニアンにおいて2つの量子ビットは対称ではなく、アンザッツは両者を異なって扱える必要があります。"),
      note(steps[2].id, "A CX entangles the two qubits, letting the ansatz reach states a product of single-qubit rotations alone cannot.", "CXが2つの量子ビットをもつれさせ、単一量子ビット回転の積だけでは到達できない状態にアンザッツが到達できるようにします。"),
      note(steps[3].id, "The second layer's rotation on qubit 0. The optimiser set this one to zero, so it does nothing at all — which is the honest outcome, not a mistake: the layer has to be in the circuit for the optimiser to have had the choice.", "2番目の層の、量子ビット0への回転です。最適化器はこれをゼロにしたため、何も起こりません。これは誤りではなく正直な結果です。最適化器がその選択肢を持つためには、この層が回路に存在していなければなりません。"),
      note(steps[4].id, "And the last of the four, also zero. A two-layer ansatz turned out to need only its first layer for this Hamiltonian — something you learn by running the optimisation, not by inspecting the circuit.", "4つのうちの最後のひとつで、これもゼロです。2層のアンザッツは、このハミルトニアンに対しては結局最初の層しか必要としませんでした。これは回路を眺めてではなく、最適化を実行してはじめて分かることです。"),
    ],
    check: { kind: "expectation", value: VQE_GROUND_ENERGY, tolerance: 1e-6 },
    readout: {
      en: "At these angles the ansatz's energy ⟨H⟩ reaches E0 = −√2, the Hamiltonian's exact ground energy; a real VQE run reaches these angles by repeating measure-the-energy then update-the-angles, not by a closed-form solution.",
      ja: "これらの角度において、アンザッツのエネルギー⟨H⟩はこのハミルトニアンの厳密な基底エネルギー E0 = −√2 に到達します。実際のVQE実行では、閉形式の解ではなく、エネルギーを測定してから角度を更新することを繰り返してこれらの角度に到達します。",
    },
    keywords: ["variational quantum eigensolver", "vqe", "variational"],
    blocks: [],
    observable: VQE_OBSERVABLE,
  };
}

// ---------------------------------------------------------------------------
// 15. quantum-walk-cycle-4

function quantumWalkCycle4(): WorkedExample {
  const step1 = place("quantum_walk_step_cycle4", {}, [0, 1, 2], "walk1");
  const step2 = place("quantum_walk_step_cycle4", {}, [0, 1, 2], "walk2");
  const step3 = place("quantum_walk_step_cycle4", {}, [0, 1, 2], "walk3");
  const steps = [step1.step, step2.step, step3.step];
  return {
    id: "quantum-walk-cycle-4",
    algorithm: "Discrete-time quantum walk",
    title: { en: "A discrete-time quantum walk on a 4-cycle", ja: "4サイクル上の離散時間量子ウォーク" },
    instance: { en: "One coin qubit, two position qubits (4 positions on a cycle), 3 steps starting at position 0.", ja: "コイン用の量子ビット1個、位置用の量子ビット2個（サイクル上の4つの位置）で、位置0から3ステップ進めます。" },
    qubitCount: 3,
    steps,
    customGates: [...step1.customGates, ...step2.customGates, ...step3.customGates],
    notes: [
      note(step1.step.id, "Flips the coin with a Hadamard, then shifts the position by +1 if the coin is |1⟩ or -1 mod 4 if the coin is |0⟩; with the coin in superposition, both shifts happen at once, entangling coin and position.", "コインをアダマールゲートで重ね合わせにし、コインが|1⟩なら位置を+1、|0⟩なら4を法として-1だけ移動します。コインが重ね合わせのときは両方の移動が同時に起こり、コインと位置がもつれます。"),
      note(step2.step.id, "The same coin flip and shift, applied again.", "同じコインの反転と移動を再度適用します。"),
      note(step3.step.id, "The same coin flip and shift, a third time.", "同じコインの反転と移動を3回目に適用します。"),
    ],
    check: { kind: "distribution", probabilities: { "110": 0.5, "111": 0.5 }, tolerance: 1e-6 },
    readout: { en: "The position always reads 3, for either value of the coin: constructive interference on this small cycle concentrates the walk onto a single position after exactly 3 steps.", ja: "コインの値にかかわらず、位置は常に3と読み取られます。この小さなサイクル上では、ちょうど3ステップ後に建設的干渉によってウォークが単一の位置に集中します。" },
    keywords: ["quantum walk", "discrete-time quantum walk"],
    blocks: ["quantum_walk_step_cycle4"],
  };
}

// ---------------------------------------------------------------------------
// 16. shor-order-finding-15 (a=7, N=15, order r=4)

const SHOR_COUNTING_OUTCOMES = ["000", "010", "100", "110"];
const SHOR_ORBIT = ["0001", "0100", "0111", "1101"]; // {1, 4, 7, 13}

function shorOrderFinding15(): WorkedExample {
  const counting = [0, 1, 2];
  const work = [3, 4, 5, 6];
  const prepWork = rawStep("X", [work[0]]); // work register starts at |1>
  const hCounting = place("hadamard_layer", { n: 3 }, counting, "h-counting");
  const mult7 = place("controlled_mult_7_mod_15", {}, [counting[0], ...work], "mult7");
  const mult4 = place("controlled_mult_4_mod_15", {}, [counting[1], ...work], "mult4");
  const inverseQft = place("qft_inverse", { n: 3 }, counting, "iqft");
  const steps = [prepWork, hCounting.step, mult7.step, mult4.step, inverseQft.step];
  return {
    id: "shor-order-finding-15",
    algorithm: "Shor's algorithm (order-finding)",
    title: { en: "Order-finding for 7 mod 15", ja: "15を法とする7の位数発見" },
    instance: { en: "3 counting qubits, 4 work qubits, finding the order of 7 modulo 15 (the order is 4: 7⁴ mod 15 = 1).", ja: "カウント用の量子ビット3個、作業用の量子ビット4個で、15を法とする7の位数を求めます（位数は4で、7⁴ mod 15 = 1です）。" },
    qubitCount: 7,
    steps,
    customGates: [...hCounting.customGates, ...mult7.customGates, ...mult4.customGates, ...inverseQft.customGates],
    notes: [
      note(prepWork.id, "Prepares the work register as |0001⟩ = 1.", "作業レジスタを|0001⟩ = 1に準備します。"),
      note(hCounting.step.id, "Spreads the 3 counting qubits into an equal superposition of all 8 values.", "3個のカウント量子ビットを8通りの値すべての等しい重ね合わせに広げます。"),
      note(mult7.step.id, "Multiplies the work register by 7 mod 15, controlled by the first counting qubit: the k=0 controlled power of the order-finding unitary.", "最初のカウント量子ビットを制御として、作業レジスタに15を法として7を掛けます。位数発見ユニタリのk=0の制御べき乗です。"),
      note(mult4.step.id, "Multiplies the work register by 4 mod 15 (7 squared, mod 15), controlled by the second counting qubit: the k=1 controlled power. The k=2 power would multiply by 7⁴ mod 15 = 1, so it is the identity and is left out entirely.", "2番目のカウント量子ビットを制御として、作業レジスタに15を法として4（7の2乗を15で割った余り）を掛けます。k=1の制御べき乗です。k=2のべき乗は15を法として7⁴ = 1を掛けることになり恒等変換となるため、完全に省略します。"),
      note(inverseQft.step.id, "An inverse QFT on the counting register reads the phase found by the controlled multiplications into a 3-bit estimate.", "カウントレジスタへの逆QFTが、制御された乗算によって見つかった位相を3ビットの推定値として読み出します。"),
    ],
    // Character order follows this file's own convention (character 0 = the
    // highest-numbered qubit): work is qubits 3-6, counting is qubits 0-2,
    // so the work register's 4 characters come first, then counting's 3.
    check: { kind: "support", bitstrings: SHOR_ORBIT.flatMap((workBits) => SHOR_COUNTING_OUTCOMES.map((countingBits) => workBits + countingBits)) },
    readout: {
      en: "The counting register reads 000, 010, 100 or 110, each equally likely, corresponding to the four powers k = 0, 1, 2, 3 of the order r = 4; the work register ends entangled with the counting outcome, holding one of 1, 7, 4 or 13. Repeating this and applying the continued-fractions step of the full algorithm to a nonzero outcome recovers the order r = 4 exactly.",
      ja: "カウントレジスタは000、010、100、110のいずれかを等しい確率で読み取り、これらは位数r = 4の4つのべき乗k = 0, 1, 2, 3に対応します。作業レジスタはカウント結果ともつれた状態になり、1、7、4、13のいずれかを保持します。これを繰り返し、0でない結果に完全なアルゴリズムの連分数展開のステップを適用すると、位数r = 4が正確に復元されます。",
    },
    keywords: ["shor's algorithm", "order finding", "phase estimation"],
    blocks: ["hadamard_layer", "controlled_mult_7_mod_15", "controlled_mult_4_mod_15", "qft_inverse"],
  };
}

// ---------------------------------------------------------------------------
// 17. amplitude-estimation-3

function amplitudeEstimation3(): WorkedExample {
  const t = 3;
  const target = t;
  const counting = [0, 1, 2];
  const prepA = rawStep("RY", [target], "pi/4"); // A|0> = RY(pi/4)|0>, theta = pi/8
  const hCounting = place("hadamard_layer", { n: 3 }, counting, "h-counting");
  const powers = place("amplitude_estimation_powers", { t, theta: "pi/8" }, [...counting, target], "qae-powers");
  const inverseQft = place("qft_inverse", { n: 3 }, counting, "iqft");
  const steps = [prepA, hCounting.step, powers.step, inverseQft.step];
  return {
    id: "amplitude-estimation-3",
    algorithm: "Quantum Amplitude Estimation",
    title: { en: "Canonical amplitude estimation", ja: "標準的な振幅推定" },
    instance: { en: "3 counting qubits estimating a = sin²(θ) for the one-qubit state A|0⟩ = RY(π/4)|0⟩, θ = π/8.", ja: "3個のカウント量子ビットで、1量子ビットの状態A|0⟩ = RY(π/4)|0⟩に対して a = sin²(θ)（θ = π/8）を推定します。" },
    qubitCount: t + 1,
    steps,
    customGates: [...hCounting.customGates, ...powers.customGates, ...inverseQft.customGates],
    notes: [
      note(prepA.id, "Prepares the target qubit as A|0⟩ = cos(θ)|0⟩ + sin(θ)|1⟩; the quantity being estimated is a = sin²(θ), the probability that measuring this qubit alone would give |1⟩.", "対象の量子ビットをA|0⟩ = cos(θ)|0⟩ + sin(θ)|1⟩に準備します。推定する量は a = sin²(θ) で、この量子ビットだけを測定したときに|1⟩が得られる確率です。"),
      note(hCounting.step.id, "Spreads the 3 counting qubits into an equal superposition of all 8 values.", "3個のカウント量子ビットを8通りの値すべての等しい重ね合わせに広げます。"),
      note(powers.step.id, "Applies controlled powers of the Grover operator Q = A Z A⁻¹ Z, one power per counting qubit: phase estimation of Q, using A|0⟩ in place of a single eigenstate.", "グローバー演算子 Q = A Z A⁻¹ Z の制御べき乗を、カウント量子ビット1個につき1回ずつ適用します。単一の固有状態の代わりにA|0⟩を使ったQの位相推定です。"),
      note(inverseQft.step.id, "An inverse QFT on the counting register reads the phase into a 3-bit estimate.", "カウントレジスタへの逆QFTが位相を3ビットの推定値として読み出します。"),
    ],
    check: { kind: "support", bitstrings: ["0001", "0111", "1001", "1111"] },
    readout: {
      en: "The counting register reads 001 or 111, each equally likely: these are θ/π = 1/8 and its mirror 1 − 1/8 = 7/8, both exact in 3 bits by construction. Either one gives a = sin²(π/8) = (2 − √2) / 4 exactly, the standard amplitude-estimation formula a = sin²(πλ) applied to the smaller of the two readings.", ja: "カウントレジスタは001か111のどちらかを等しい確率で読み取ります。これらは θ/π = 1/8 とその鏡像 1 − 1/8 = 7/8 で、構成上どちらも3ビットで正確に表せます。どちらの結果からも a = sin²(π/8) = (2 − √2) / 4 が正確に得られます。これは標準の振幅推定の式 a = sin²(πλ) を2つの読み取り値のうち小さい方に適用したものです。",
    },
    keywords: ["amplitude estimation", "phase estimation", "grover operator"],
    blocks: ["hadamard_layer", "amplitude_estimation_powers", "qft_inverse"],
  };
}

// ---------------------------------------------------------------------------
// 18. hidden-shift-4

function hiddenShift4(): WorkedExample {
  const shift = "0110";
  const n = 4;
  const zerosBefore = [0, 1]; // CZ(0,1)
  const zerosAfter = [2, 3]; // CZ(2,3)
  const hAll1 = place("hadamard_layer", { n }, [0, 1, 2, 3], "h1");
  const shiftIn = Array.from({ length: n }, (_, q) => q).filter((q) => shift[n - 1 - q] === "1").map((q) => rawStep("X", [q]));
  const gOracleCz = [rawStep("CZ", zerosBefore), rawStep("CZ", zerosAfter)];
  const shiftOut = shiftIn.map((s) => rawStep("X", s.qubits));
  const hAll2 = place("hadamard_layer", { n }, [0, 1, 2, 3], "h2");
  const fOracleCz = [rawStep("CZ", zerosBefore), rawStep("CZ", zerosAfter)];
  const hAll3 = place("hadamard_layer", { n }, [0, 1, 2, 3], "h3");
  const steps = [
    hAll1.step,
    ...shiftIn,
    ...gOracleCz,
    ...shiftOut,
    hAll2.step,
    ...fOracleCz,
    hAll3.step,
  ];
  return {
    id: "hidden-shift-4",
    algorithm: "Hidden shift",
    title: { en: "Hidden shift for a bent function", ja: "ベント関数の隠れシフト" },
    instance: { en: "4 qubits, f(x) = x₀x₁ ⊕ x₂x₃ (a bent, self-dual function), hidden shift s = 0110.", ja: "4量子ビット、f(x) = x₀x₁ ⊕ x₂x₃（ベント関数で自己双対）、隠れシフト s = 0110。" },
    qubitCount: n,
    steps,
    customGates: [...hAll1.customGates, ...hAll2.customGates, ...hAll3.customGates],
    notes: [
      note(hAll1.step.id, "Spreads all four qubits into an equal superposition, so the oracles below are asked about all 16 inputs at once rather than one at a time.", "4つの量子ビットすべてを等しい重ね合わせに広げます。これにより、以下のオラクルには16通りの入力すべてについて、一つずつではなく同時に問い合わせることになります。"),
      note(shiftIn[0].id, "Flips qubit 1, the first step of shifting the input by s = 0110 before applying f.", "量子ビット1を反転します。fを適用する前に入力をs = 0110だけシフトする最初のステップです。"),
      note(shiftIn[1].id, "Flips qubit 2, completing the shift by s.", "量子ビット2を反転し、sによるシフトを完了します。"),
      note(gOracleCz[0].id, "Applies CZ(0,1), the x₀x₁ term of f, now acting on the shifted input.", "CZ(0,1)を適用します。シフトされた入力に作用する、fのx₀x₁の項です。"),
      note(gOracleCz[1].id, "Applies CZ(2,3), the x₂x₃ term of f, completing the oracle for g(x) = f(x ⊕ s).", "CZ(2,3)を適用します。fのx₂x₃の項で、g(x) = f(x ⊕ s)のオラクルを完成させます。"),
      note(shiftOut[0].id, "Undoes the shift on qubit 1.", "量子ビット1のシフトを打ち消します。"),
      note(shiftOut[1].id, "Undoes the shift on qubit 2.", "量子ビット2のシフトを打ち消します。"),
      note(hAll2.step.id, "The second Hadamard layer. Everything before it wrote the two functions' values into phase; this is the step that turns those phases into a readable bitstring, and it is where the shift falls out.", "2回目のアダマール層です。これまでのステップは2つの関数の値を位相に書き込んできました。このステップがその位相を読み取れるビット列に変え、シフトが現れます。"),
      note(fOracleCz[0].id, "Applies CZ(0,1) again, this time as the oracle for f itself (unshifted): since f is self-dual, the same two-CZ pattern is its own Fourier dual.", "再びCZ(0,1)を適用します。今度はf自体（シフトなし）のオラクルとしてです。fは自己双対なので、同じ2つのCZのパターンがそれ自身のフーリエ双対になります。"),
      note(fOracleCz[1].id, "Applies CZ(2,3) again, completing the f oracle.", "再びCZ(2,3)を適用し、fのオラクルを完成させます。"),
      note(hAll3.step.id, "A third Hadamard layer reads the shift directly into the computational basis.", "3回目のアダマール層がシフトを直接計算基底に読み出します。"),
    ],
    check: { kind: "peak", bitstring: shift, minProbability: 0.999 },
    readout: { en: "The register reads 0110, the hidden shift, exactly: a bent function's perfect duality makes the hidden-shift algorithm deterministic.", ja: "レジスタは隠れシフトである0110を正確に読み取ります。ベント関数の完全な双対性により、隠れシフトアルゴリズムは確定的になります。" },
    keywords: ["hidden shift", "bent function"],
    blocks: ["hadamard_layer"],
  };
}

// ---------------------------------------------------------------------------
// 19. superdense-coding

function superdenseCoding(): WorkedExample {
  const alice = 0;
  const bob = 1;
  const bellH = rawStep("H", [alice]);
  const bellCx = rawStep("CX", [alice, bob]);
  const encode = rawStep("X", [alice]); // sends the message "10" in this circuit's own encoding (see the notes)
  const decodeCx = rawStep("CX", [alice, bob]);
  const decodeH = rawStep("H", [alice]);
  const steps = [bellH, bellCx, encode, decodeCx, decodeH];
  return {
    id: "superdense-coding",
    algorithm: "Superdense coding",
    title: { en: "Superdense coding sends two classical bits", ja: "超高密度符号化による2ビットの送信" },
    instance: { en: "2 qubits sharing a Bell pair; Alice sends the 2-bit message 10 to Bob by acting on her qubit alone.", ja: "2つの量子ビットがベル対を共有します。アリスは自分の量子ビットだけに作用させて、2ビットのメッセージ10をボブに送ります。" },
    qubitCount: 2,
    steps,
    customGates: [],
    notes: [
      note(bellH.id, "Starts a Bell pair: Alice and Bob each hold one half.", "ベル対を開始します。アリスとボブがそれぞれ半分ずつ持ちます。"),
      note(bellCx.id, "Completes the Bell pair.", "ベル対を完成させます。"),
      note(encode.id, "Alice applies X to her own qubit. In this circuit, X alone encodes the message 10 (X sets the first bit, Z would set the second; neither is applied for the second bit here).", "アリスは自分の量子ビットにXを適用します。この回路ではXだけでメッセージ10を符号化します（Xは1番目のビットを設定し、Zは2番目のビットを設定しますが、ここでは2番目のビットには何も適用しません）。"),
      note(decodeCx.id, "Bob receives Alice's qubit and applies CX, the first half of the Bell-basis decode.", "ボブはアリスの量子ビットを受け取り、CXを適用します。ベル基底での復号の前半です。"),
      note(decodeH.id, "Bob applies H, completing the decode.", "ボブはHを適用し、復号を完了します。"),
    ],
    check: { kind: "peak", bitstring: "10", minProbability: 0.999 },
    readout: { en: "Measuring both qubits gives 10, the message, recovered from a single qubit sent over the channel because it started out entangled with the qubit Bob already held.", ja: "両方の量子ビットを測定するとメッセージである10が得られます。ボブがすでに持っていた量子ビットと最初からもつれていたため、通信路で送られたのは1つの量子ビットだけでした。" },
    keywords: ["superdense coding", "entanglement"],
    blocks: [],
  };
}

// ---------------------------------------------------------------------------
// 20. w-state-3

function wState3(): WorkedExample {
  const built = place("w_state_3", {}, [0, 1, 2], "w");
  const steps = [built.step];
  return {
    id: "w-state-3",
    algorithm: "W state",
    title: { en: "The 3-qubit W state", ja: "3量子ビットW状態" },
    instance: { en: "3 qubits, preparing (|001⟩ + |010⟩ + |100⟩) / √3.", ja: "3量子ビットで (|001⟩ + |010⟩ + |100⟩) / √3 を準備します。" },
    qubitCount: 3,
    steps,
    customGates: built.customGates,
    notes: [
      note(built.step.id, "A staircase of controlled-RY rotations (each built from RY and CX) and a CCX spreads a single excitation evenly across all three qubits, so that exactly one of them reads |1⟩ at a time, with equal probability for each.", "controlled-RY回転（それぞれRYとCXから構成）とCCXの階段状の並びが、単一の励起を3つの量子ビットすべてに均等に広げます。その結果、常にそのうちのちょうど1つだけが|1⟩を示し、どの量子ビットも等しい確率になります。"),
    ],
    check: { kind: "support", bitstrings: ["001", "010", "100"] },
    readout: { en: "Measuring gives 001, 010 or 100, each equally likely, and never 000, 011, 101, 110 or 111: exactly one qubit reads |1⟩.", ja: "測定すると001、010、100のいずれかが等しい確率で得られ、000、011、101、110、111になることはありません。ちょうど1つの量子ビットだけが|1⟩を示します。" },
    keywords: ["w state", "entanglement"],
    blocks: ["w_state_3"],
  };
}

// ---------------------------------------------------------------------------
// 21. simon-2

function simon2(): WorkedExample {
  const q0 = 0;
  const q1 = 1;
  const ancilla = 2;
  const hIn = [rawStep("H", [q0]), rawStep("H", [q1])];
  const oracle = [rawStep("CX", [q0, ancilla]), rawStep("CX", [q1, ancilla])];
  const hOut = [rawStep("H", [q0]), rawStep("H", [q1])];
  const steps = [...hIn, ...oracle, ...hOut];
  return {
    id: "simon-2",
    algorithm: "Simon's algorithm",
    title: { en: "Simon's algorithm with secret 11", ja: "秘密11に対するサイモンのアルゴリズム" },
    instance: { en: "2 input qubits, 1 ancilla, oracle f(x) = x₀ ⊕ x₁ (satisfies f(x) = f(x ⊕ s) for the secret s = 11).", ja: "入力用の量子ビット2個、補助量子ビット1個、オラクルf(x) = x₀ ⊕ x₁（秘密s = 11に対してf(x) = f(x ⊕ s)を満たします）。" },
    qubitCount: 3,
    steps,
    customGates: [],
    notes: [
      note(hIn[0].id, "Puts qubit 0 into superposition. Together with the next step this asks the oracle about all four inputs at once, which is the only query Simon's algorithm gets to make per run.", "量子ビット0を重ね合わせにします。次のステップと合わせて、4通りの入力すべてについて同時にオラクルに問い合わせます。これがサイモンのアルゴリズムが1回の実行で行える唯一の問い合わせです。"),
      note(hIn[1].id, "And qubit 1, completing the equal superposition over 00, 01, 10 and 11. A classical algorithm would have to pick one of those and try it.", "量子ビット1も同様にし、00、01、10、11 の等しい重ね合わせを完成させます。古典アルゴリズムなら、このうちのひとつを選んで試すしかありません。"),
      note(oracle[0].id, "The oracle starts computing f into the ancilla. The algorithm never gets to look at f's definition — only at what it does to this register.", "オラクルが f を補助量子ビットへ計算し始めます。アルゴリズムが f の定義を直接見ることはできず、このレジスタに対する振る舞いだけを見ます。"),
      note(oracle[1].id, "CXs qubit 1 onto the ancilla, so the ancilla ends up holding x₀ ⊕ x₁: the oracle for f.", "量子ビット1を補助量子ビットへCXします。これにより補助量子ビットはx₀ ⊕ x₁を保持することになり、fのオラクルとなります。"),
      note(hOut[0].id, "The second Hadamard layer begins. This is where the interference happens: the branches that disagree with the secret cancel each other, and only those satisfying y · s = 0 survive.", "2回目のアダマール層が始まります。干渉が起こるのはここです。秘密と矛盾する分岐同士が打ち消し合い、y ・ s = 0 を満たすものだけが残ります。"),
      note(hOut[1].id, "Completing it. A single run returns one y with y · s = 0 — not the secret itself, but one linear constraint on it. Simon's algorithm repeats this until it has enough constraints to solve for s.", "それを完成させます1回の実行が返すのは y ・ s = 0 を満たす y がひとつだけで、秘密そのものではなく、秘密に対する1本の線形制約です。サイモンのアルゴリズムは、s を解くのに十分な制約が集まるまでこれを繰り返します。"),
    ],
    check: { kind: "support", bitstrings: ["000", "011", "100", "111"] },
    readout: { en: "The two input qubits read 00 or 11, each equally likely, regardless of the ancilla: both satisfy y · s = 0 for the secret s = 11, exactly as Simon's algorithm predicts for any single run.", ja: "2つの入力量子ビットは、補助量子ビットにかかわらず00か11のどちらかを等しい確率で読み取ります。どちらも秘密s = 11に対してy · s = 0を満たしており、サイモンのアルゴリズムが1回の実行について予測するとおりです。" },
    keywords: ["simon's algorithm", "oracle"],
    blocks: [],
  };
}

// ---------------------------------------------------------------------------

// angle = 3*pi/4 = 2*pi*3/8: exact 3-bit phase, counting register reads 011
// (=3) with probability 1 (verified against the simulator's raw output).
const QPE_EXACT = qpePhaseExample(
  "qpe-3-exact",
  "3*pi/4",
  { kind: "peak", bitstring: "1011", minProbability: 0.999 },
  "3 counting qubits estimating the phase of P(3π/4), which is 2π·3/8 exactly: a phase 3-bit QPE can represent exactly.",
  "3個のカウント量子ビットで、P(3π/4)（すなわち2π・3/8）の位相を推定します。これは3ビットQPEが正確に表現できる位相です。",
  "The counting register reads 011 = 3 with probability 1: angle/(2π) = 3/8, recovered exactly.",
  "カウントレジスタは確率1で011 = 3と読み取られます：angle/(2π) = 3/8が正確に復元されます。",
);

// angle = 2*pi/3: NOT a multiple of 2*pi/8, so 3 bits cannot represent it
// exactly. Peak probability (0.6878...) taken from running this file's own
// simulator once — an honest, not-close-to-1 value, not assumed.
const QPE_INEXACT = qpePhaseExample(
  "qpe-3-inexact",
  "2*pi/3",
  { kind: "peak", bitstring: "1011", minProbability: 0.68 },
  "3 counting qubits estimating the phase of P(2π/3), which is NOT a multiple of 2π/8: 3 bits cannot represent 1/3 exactly.",
  "3個のカウント量子ビットで、P(2π/3)の位相を推定します。これは2π/8の倍数ではないため、3ビットでは1/3を正確に表現できません。",
  "The counting register still peaks at 011 = 3, the best 3-bit approximation of angle/(2π) = 1/3 ≈ 3/8, but with probability well short of 1. The rest of the probability spreads over neighbouring estimates, exactly as QPE theory predicts for a phase that is not exactly representable.",
  "カウントレジスタは依然として011 = 3（angle/(2π) = 1/3 ≈ 3/8に対する3ビットでの最良近似）でピークを迎えますが、その確率は1にはかなり届きません。残りの確率は近傍の推定値に広がり、正確に表現できない位相に対するQPE理論の予測どおりです。",
);

// ---------------------------------------------------------------------------
// Gate demonstrations.
//
// The 29 gate records are the Atlas's most basic components and were its least
// informative pages: a single labelled box and a bar chart. For a whole family
// of them that bar chart is the same picture — Z, S, T, S†, T†, P, RZ, CZ and
// CP applied to a superposition move no probability at all, so the outcome
// bars for the T gate, the Z gate and doing nothing are identical. A reader
// looking at the T-gate page could not tell it apart from the S-gate page by
// anything the page drew.
//
// Each of these is the smallest circuit in which the gate does something, plus
// whatever preparation that takes. The per-step reading and the phase panel
// (atlas-step-effect.ts) then say what happened — and for the phase family they
// say the thing the bars cannot: the probabilities did not move, the state did,
// and here is by how much.
//
// `check` is the same contract the algorithm examples use, so a gate whose
// demonstration stops doing what it claims fails the suite rather than quietly
// drawing something else.

/** H, then the gate — the smallest circuit in which a phase gate is visible at all. */
function phaseGateDemo({
  id,
  slug,
  gate,
  param,
  algorithm,
  titleEn,
  titleJa,
  angleEn,
  angleJa,
  aboutEn,
  aboutJa,
}: {
  id: string;
  slug: string;
  gate: BuilderStep["gate"];
  param?: string;
  algorithm: string;
  titleEn: string;
  titleJa: string;
  /** The bare angle it puts on |1⟩ — "π", "π/4". Goes inside a sentence. */
  angleEn: string;
  angleJa: string;
  /**
   * One complete sentence about this gate specifically, printed after the
   * angle rather than spliced into it. An earlier version interpolated the
   * commentary where the angle goes, and a gate whose blurb carried a clause
   * came out as "...by a phase of π/4 — half of S, and the gate that takes a
   * Clifford circuit out of classical reach, and leaves |0⟩ alone."
   */
  aboutEn: string;
  aboutJa: string;
}): WorkedExample {
  const prepare = rawStep("H", [0]);
  const apply = rawStep(gate, [0], param);
  return {
    id,
    algorithm,
    title: { en: titleEn, ja: titleJa },
    instance: {
      en: `One qubit, put into |+⟩ = (|0⟩ + |1⟩)/√2 first, because on |0⟩ or |1⟩ alone this gate changes nothing a measurement or another gate can ever detect.`,
      ja: `1量子ビットを、まず |+⟩ = (|0⟩ + |1⟩)/√2 にします。|0⟩ や |1⟩ のままではこのゲートは、測定でも他のゲートでも決して検出できない変化しか起こさないからです。`,
    },
    qubitCount: 1,
    steps: [prepare, apply],
    customGates: [],
    notes: [
      note(
        prepare.id,
        "Puts the qubit into an equal superposition. Without this there is no second amplitude for the gate's phase to be measured against, and a phase on the whole state is not observable.",
        "量子ビットを等しい重ね合わせにします。これがないと、ゲートの位相を比較する相手となる2つ目の振幅が存在せず、状態全体にかかる位相は観測できません。",
      ),
      note(
        apply.id,
        `Multiplies the |1⟩ half of the state by a phase of ${angleEn}, and leaves |0⟩ alone. ${aboutEn} The two outcomes stay equally likely — the difference is carried entirely in the phase between them, which is what the panel beside the bars shows.`,
        `状態のうち |1⟩ の側に ${angleJa} の位相を掛け、|0⟩ はそのままにします。${aboutJa} 2つの測定結果は等確率のままで、違いはすべて両者のあいだの位相に入ります。棒グラフの隣のパネルが示しているのがそれです。`,
      ),
    ],
    check: { kind: "distribution", probabilities: { "0": 0.5, "1": 0.5 }, tolerance: 1e-9 },
    readout: {
      en: `Measuring gives 0 or 1, each half the time — exactly as it did before the gate. A single measurement of this qubit cannot detect this gate at all. Its effect becomes visible only when the phase is turned back into probability by a later interference step, which is what every algorithm that uses it does.`,
      ja: `測定すると0か1が半々で得られます。ゲートを適用する前とまったく同じです。この量子ビットを1回測定しても、このゲートの効果は検出できません。効果が見えるのは、後の干渉のステップで位相が確率に戻されたときだけで、このゲートを使うアルゴリズムはどれもそれを行っています。`,
    },
    keywords: [slug.replace(/-/g, " ")],
    blocks: [],
  };
}

const Z_GATE = phaseGateDemo({ id: "gate-z-on-plus", slug: "pauli-z", gate: "Z", algorithm: "Pauli Z", titleEn: "Z, the half-turn of phase", titleJa: "Z：半回転の位相", angleEn: "π", angleJa: "π", aboutEn: "That is a sign flip: the largest phase there is, and the point past which turning further starts coming back.", aboutJa: "これは符号の反転です。位相としては最大で、これ以上回すと戻り始める点です。" });
const S_GATE = phaseGateDemo({ id: "gate-s-on-plus", slug: "s phase", gate: "S", algorithm: "S gate", titleEn: "S, a quarter turn of phase", titleJa: "S：位相の四分の一回転", angleEn: "π/2", angleJa: "π/2", aboutEn: "That is half of what Z does, so applying S twice is exactly Z.", aboutJa: "これはZの半分なので、Sを2回適用するとちょうどZになります。" });
const T_GATE = phaseGateDemo({ id: "gate-t-on-plus", slug: "t phase", gate: "T", algorithm: "T gate", titleEn: "T, an eighth turn of phase", titleJa: "T：位相の八分の一回転", angleEn: "π/4", angleJa: "π/4", aboutEn: "That is half of S again. T is also the gate that takes a Clifford circuit out of classical reach, which is why fault-tolerant cost is counted in T gates.", aboutJa: "これはさらにSの半分です。Tはクリフォード回路を古典計算の手の届かない領域へ運ぶゲートでもあり、誤り耐性のコストがTゲート数で数えられるのはそのためです。" });
const SDG_GATE = phaseGateDemo({ id: "gate-sdg-on-plus", slug: "s dagger", gate: "SDG", algorithm: "S-dagger gate", titleEn: "S†, S turned the other way", titleJa: "S†：Sを逆向きにしたもの", angleEn: "−π/2, which the panel prints as 3π/2", angleJa: "−π/2（パネルには3π/2と表示されます）", aboutEn: "It is the same angle reached from the other side, and it is exactly what undoes an S applied earlier.", aboutJa: "反対側から到達した同じ角度であり、先に適用したSをちょうど打ち消します。" });
const TDG_GATE = phaseGateDemo({ id: "gate-tdg-on-plus", slug: "t dagger", gate: "TDG", algorithm: "T-dagger gate", titleEn: "T†, T turned the other way", titleJa: "T†：Tを逆向きにしたもの", angleEn: "−π/4, printed as 7π/4", angleJa: "−π/4（7π/4と表示されます）", aboutEn: "It is what undoes a T applied earlier, and it costs a fault-tolerant circuit exactly as much as a T does.", aboutJa: "先に適用したTを打ち消すものであり、誤り耐性回路においてTとまったく同じコストがかかります。" });
const P_GATE = phaseGateDemo({ id: "gate-p-on-plus", slug: "phase gate p", gate: "P", param: "2*pi/5", algorithm: "Phase gate", titleEn: "P(θ), phase by any angle you like", titleJa: "P(θ)：好きな角度の位相", angleEn: "2π/5", angleJa: "2π/5", aboutEn: "P takes any angle at all; Z, S and T are simply the three of them that earned their own names.", aboutJa: "Pは任意の角度を取ります。Z・S・Tは、そのうち名前を持つに至った3つというだけです。" });
const RZ_GATE = phaseGateDemo({ id: "gate-rz-on-plus", slug: "rz rotation", gate: "RZ", param: "pi/2", algorithm: "RZ rotation", titleEn: "RZ(θ), a rotation that only moves phase", titleJa: "RZ(θ)：位相だけを動かす回転", angleEn: "π/2 at this angle", angleJa: "この角度では π/2", aboutEn: "RZ splits the angle between the two halves rather than putting all of it on |1⟩, so it differs from P by a phase on the whole state — which is to say, by nothing any measurement can find.", aboutJa: "RZは角度を両側で分け合い、すべてを |1⟩ に載せません。そのためPとは状態全体の位相だけが異なります。つまり、どの測定でも見つけられない違いだけです。" });

/** A rotation on |0⟩ — the pair that shows RX and RY are not the same gate. */
function rotationDemo({ id, gate, algorithm, titleEn, titleJa, phaseNoteEn, phaseNoteJa }: {
  id: string; gate: BuilderStep["gate"]; algorithm: string; titleEn: string; titleJa: string; phaseNoteEn: string; phaseNoteJa: string;
}): WorkedExample {
  const apply = rawStep(gate, [0], "pi/3");
  return {
    id,
    algorithm,
    title: { en: titleEn, ja: titleJa },
    instance: { en: "One qubit starting at |0⟩, rotated by π/3 — a third of a half-turn, so the qubit ends up part way between |0⟩ and |1⟩ rather than at either.", ja: "|0⟩ から始まる1量子ビットを π/3 回転させます。半回転の3分の1なので、量子ビットは |0⟩ と |1⟩ のどちらでもなく、その途中で終わります。" },
    qubitCount: 1,
    steps: [apply],
    customGates: [],
    notes: [note(apply.id, `Rotates the qubit by π/3, leaving it 75% likely to read 0 and 25% to read 1 — cos²(π/6) and sin²(π/6). ${phaseNoteEn}`, `量子ビットを π/3 回転させ、0 と読まれる確率 75%、1 と読まれる確率 25% にします。cos²(π/6) と sin²(π/6) です。${phaseNoteJa}`)],
    check: { kind: "distribution", probabilities: { "0": 0.75, "1": 0.25 }, tolerance: 1e-9 },
    readout: { en: "Measuring gives 0 about three times in four. RX and RY at the same angle give exactly these probabilities, so a bar chart cannot tell them apart — the phase panel can.", ja: "測定するとおよそ4回に3回は0になります。RXとRYは同じ角度では確率がまったく同じなので、棒グラフでは区別できません。位相パネルなら区別できます。" },
    keywords: [algorithm.toLowerCase()],
    blocks: [],
  };
}

const RX_GATE = rotationDemo({ id: "gate-rx-on-zero", gate: "RX", algorithm: "RX rotation", titleEn: "RX(π/3) on |0⟩", titleJa: "|0⟩ への RX(π/3)", phaseNoteEn: "It also leaves a quarter turn of phase between the two halves — the panel prints it as 3π/2, the same angle reached from the other side — and that phase is the whole difference between RX and RY.", phaseNoteJa: "さらに両側のあいだに四分の一回転の位相を残します。パネルには3π/2、すなわち反対側から到達した同じ角度として表示されます。この位相がRXとRYの違いのすべてです。" });
const RY_GATE = rotationDemo({ id: "gate-ry-on-zero", gate: "RY", algorithm: "RY rotation", titleEn: "RY(π/3) on |0⟩", titleJa: "|0⟩ への RY(π/3)", phaseNoteEn: "Both amplitudes stay real and in phase, which is why RY is the rotation people reach for when they want probabilities and nothing else.", phaseNoteJa: "どちらの振幅も実数で同位相のままです。確率だけを動かしたいときにRYが選ばれるのはこのためです。" });

function hadamardDemo(): WorkedExample {
  const apply = rawStep("H", [0]);
  return {
    id: "gate-h-on-zero",
    algorithm: "Hadamard",
    title: { en: "H turns a definite bit into an even superposition", ja: "H：確定したビットを等しい重ね合わせに変える" },
    instance: { en: "One qubit starting at |0⟩, a state that reads 0 with certainty.", ja: "|0⟩ から始まる1量子ビット。確実に0と読まれる状態です。" },
    qubitCount: 1,
    steps: [apply],
    customGates: [],
    notes: [note(apply.id, "Splits the single certainty into two equal halves. Applying H a second time would put it back — H is its own inverse, so this is a change of basis rather than a loss of information.", "ひとつの確定した状態を等しい2つに分けます。Hをもう一度適用すると元に戻ります。Hは自分自身の逆なので、これは情報の消失ではなく基底の変換です。")],
    check: { kind: "distribution", probabilities: { "0": 0.5, "1": 0.5 }, tolerance: 1e-9 },
    readout: { en: "Measuring gives 0 or 1, each half the time. Almost every algorithm in the Atlas starts with a layer of these.", ja: "測定すると0か1が半々で得られます。Atlasのほとんどすべてのアルゴリズムは、この層から始まります。" },
    keywords: ["hadamard"],
    blocks: [],
  };
}

function pauliYDemo(): WorkedExample {
  const apply = rawStep("Y", [0]);
  return {
    id: "gate-y-on-zero",
    algorithm: "Pauli Y",
    title: { en: "Y flips the bit and turns the phase", ja: "Y：ビットを反転し、位相も回す" },
    instance: { en: "One qubit starting at |0⟩. Y is the gate that does what X does and a phase as well.", ja: "|0⟩ から始まる1量子ビット。YはXがすることに加えて、位相も動かすゲートです。" },
    qubitCount: 1,
    steps: [apply],
    customGates: [],
    notes: [note(apply.id, "Takes |0⟩ to i|1⟩. The bit flips exactly as X would flip it, and the amplitude picks up a quarter turn of phase on the way. On this state that phase is global and unobservable; inside a larger circuit, where |0⟩ has amplitude too, it is what separates Y from X.", "|0⟩ を i|1⟩ にします。ビットはXと同じように反転し、その途中で振幅が四分の一回転の位相を受け取ります。この状態ではその位相は全体位相で観測できませんが、|0⟩ にも振幅がある大きな回路の中では、これがYとXを分けるものになります。")],
    check: { kind: "peak", bitstring: "1", minProbability: 0.999 },
    readout: { en: "Measuring always gives 1. By this measurement alone Y is indistinguishable from X — the difference lives in a phase, and a phase needs something to be measured against.", ja: "測定すると必ず1になります。この測定だけではYとXは区別できません。違いは位相にあり、位相には比較の相手が必要です。" },
    keywords: ["pauli y"],
    blocks: [],
  };
}

function cxDemo(): WorkedExample {
  const prepare = rawStep("H", [0]);
  const apply = rawStep("CX", [0, 1]);
  return {
    id: "gate-cx-on-plus-zero",
    algorithm: "Controlled-X",
    title: { en: "CX on a superposed control is what makes entanglement", ja: "重ね合わせた制御へのCXがもつれを作る" },
    instance: { en: "Two qubits: qubit 0 put into |+⟩, qubit 1 left at |0⟩. On a control that is definitely 0 or definitely 1, CX is just a conditional NOT; on a control in superposition it is something a classical circuit has no version of.", ja: "2量子ビット：量子ビット0を |+⟩ にし、量子ビット1は |0⟩ のままにします。制御が0か1に確定しているならCXは条件付きNOTにすぎませんが、制御が重ね合わせにあるとき、古典回路には対応するものがありません。" },
    qubitCount: 2,
    steps: [prepare, apply],
    customGates: [],
    notes: [
      note(prepare.id, "Puts the control into an equal superposition of 0 and 1. Qubit 1 is untouched and still reads 0 with certainty; at this point each qubit still has a state of its own.", "制御を0と1の等しい重ね合わせにします。量子ビット1は手つかずで、確実に0と読まれます。この時点では各量子ビットがまだそれぞれの状態を持っています。"),
      note(apply.id, "Flips qubit 1 in the branch where qubit 0 is 1, and leaves it alone in the branch where qubit 0 is 0 — both at once. Neither qubit has a state of its own after this; only the pair does.", "量子ビット0が1である分岐では量子ビット1を反転し、0である分岐ではそのままにします。その両方を同時に行います。この後はどちらの量子ビットも単独の状態を持たず、対としてのみ状態を持ちます。"),
    ],
    check: { kind: "support", bitstrings: ["00", "11"] },
    readout: { en: "Measuring gives 00 or 11, each half the time, and never 01 or 10: the two qubits always agree, without either of them having been a definite value beforehand. This two-gate circuit is the Bell pair, and it is the smallest entangled state there is.", ja: "測定すると00か11が半々で得られ、01や10にはなりません。どちらの量子ビットも事前に確定した値ではなかったのに、2つは常に一致します。この2ゲートの回路がベル対であり、もっとも小さいもつれ状態です。" },
    keywords: ["controlled-x", "cnot"],
    blocks: [],
  };
}

function czDemo(): WorkedExample {
  const prepare = [rawStep("H", [0]), rawStep("H", [1])];
  const apply = rawStep("CZ", [0, 1]);
  return {
    id: "gate-cz-on-plus-plus",
    algorithm: "Controlled-Z",
    title: { en: "CZ entangles without moving any probability", ja: "CZ：確率をまったく動かさずにもつれさせる" },
    instance: { en: "Two qubits, both put into |+⟩, so all four outcomes are equally likely before the gate.", ja: "2量子ビットをどちらも |+⟩ にします。ゲートの前は4つの測定結果がすべて等確率です。" },
    qubitCount: 2,
    steps: [...prepare, apply],
    customGates: [],
    notes: [
      note(prepare[0].id, "Qubit 0 into an equal superposition.", "量子ビット0を等しい重ね合わせにします。"),
      note(prepare[1].id, "Qubit 1 as well, so all four two-bit outcomes are equally likely.", "量子ビット1も同様にし、4通りの測定結果をすべて等確率にします。"),
      note(apply.id, "Flips the sign of the one branch where both qubits are 1, and leaves the other three alone. Not one outcome changes probability, and the two qubits are entangled afterwards — which is why a bar chart is the wrong instrument for this gate.", "両方の量子ビットが1である分岐だけ符号を反転し、他の3つはそのままにします。どの測定結果も確率は変わらず、その後2つの量子ビットはもつれています。この種のゲートに棒グラフが向かない理由がこれです。"),
    ],
    check: { kind: "distribution", probabilities: { "00": 0.25, "01": 0.25, "10": 0.25, "11": 0.25 }, tolerance: 1e-9 },
    readout: { en: "All four outcomes stay equally likely, before and after. CZ is symmetric in its two qubits — unlike CX there is no telling which one was the control — and it is the gate that builds graph states and cluster states.", ja: "4つの測定結果は前後とも等確率のままです。CZは2つの量子ビットについて対称で、CXと違ってどちらが制御だったか区別できません。グラフ状態やクラスター状態を作るのはこのゲートです。" },
    keywords: ["controlled-z"],
    blocks: [],
  };
}

function cpDemo(): WorkedExample {
  const prepare = [rawStep("H", [0]), rawStep("H", [1])];
  const apply = rawStep("CP", [0, 1], "pi/2");
  return {
    id: "gate-cp-on-plus-plus",
    algorithm: "Controlled phase",
    title: { en: "CP(θ), the gate the Fourier transform is built from", ja: "CP(θ)：フーリエ変換を組み立てているゲート" },
    instance: { en: "Two qubits, both put into |+⟩, then a controlled phase of π/2 — a quarter turn, applied only where both qubits are 1.", ja: "2量子ビットをどちらも |+⟩ にし、π/2 の制御位相を適用します。四分の一回転を、両方の量子ビットが1のときにだけ適用します。" },
    qubitCount: 2,
    steps: [...prepare, apply],
    customGates: [],
    notes: [
      note(prepare[0].id, "Qubit 0 into an equal superposition.", "量子ビット0を等しい重ね合わせにします。"),
      note(prepare[1].id, "Qubit 1 as well.", "量子ビット1も同様にします。"),
      note(apply.id, "Turns the phase of the |11⟩ branch by π/2 and leaves the other three where they are. CZ is this gate at θ = π; the QFT is a ladder of these at halving angles, which is where its phases come from.", "|11⟩ の分岐の位相を π/2 回し、他の3つはそのままにします。CZは θ = π のときのこのゲートです。QFTは角度を半分ずつにしたこのゲートの階段であり、QFTの位相はそこから来ています。"),
    ],
    check: { kind: "distribution", probabilities: { "00": 0.25, "01": 0.25, "10": 0.25, "11": 0.25 }, tolerance: 1e-9 },
    readout: { en: "Every outcome keeps the probability it had. The whole content of this gate is the angle it puts on one branch out of four, and that angle is what the inverse QFT later reads back out as a number.", ja: "どの測定結果も確率は変わりません。このゲートの内容は、4つのうち1つの分岐に載せる角度がすべてです。その角度こそ、後で逆QFTが数として読み出すものです。" },
    keywords: ["controlled phase"],
    blocks: [],
  };
}

function swapDemo(): WorkedExample {
  const prepare = rawStep("X", [0]);
  const apply = rawStep("SWAP", [0, 1]);
  return {
    id: "gate-swap-on-01",
    algorithm: "SWAP",
    title: { en: "SWAP exchanges two qubits", ja: "SWAP：2つの量子ビットを入れ替える" },
    instance: { en: "Two qubits, with qubit 0 set to |1⟩ and qubit 1 left at |0⟩, so there is something to exchange.", ja: "2量子ビットで、量子ビット0を |1⟩、量子ビット1を |0⟩ にします。入れ替える対象があるようにするためです。" },
    qubitCount: 2,
    steps: [prepare, apply],
    customGates: [],
    notes: [
      note(prepare.id, "Sets qubit 0 to |1⟩. Read the outcome right to left: character 0 of the bitstring is the highest-numbered qubit, so this reads 01.", "量子ビット0を |1⟩ にします。測定結果は右から左へ読みます。ビット列の先頭の文字が最大番号の量子ビットなので、これは01と読まれます。"),
      note(apply.id, "Exchanges the two qubits entirely. On hardware this is rarely a gate of its own — it is three CXs, and moving a qubit across a chip is the main cost a router is trying to avoid.", "2つの量子ビットをそっくり入れ替えます。実機ではこれ自体が1つのゲートであることはまれで、3つのCXになります。チップ上で量子ビットを移動させることこそ、ルータが避けようとしている主なコストです。"),
    ],
    check: { kind: "peak", bitstring: "10", minProbability: 0.999 },
    readout: { en: "The register reads 10: what qubit 0 held is now on qubit 1. Nothing is in superposition on either side of this gate, which is exactly why the whole state simply moves from one outcome to another.", ja: "レジスタは10と読まれます。量子ビット0が持っていたものが量子ビット1に移りました。このゲートの前後どちらも重ね合わせではなく、だからこそ状態はひとつの測定結果から別の測定結果へそのまま移ります。" },
    keywords: ["swap"],
    blocks: [],
  };
}

function toffoliDemo(): WorkedExample {
  const prepare = [rawStep("X", [0]), rawStep("X", [1])];
  const apply = rawStep("CCX", [0, 1, 2]);
  return {
    id: "gate-ccx-on-11",
    algorithm: "Toffoli",
    title: { en: "The Toffoli gate computes an AND", ja: "トフォリゲートはANDを計算する" },
    instance: { en: "Three qubits, with both controls set to |1⟩ — the one case out of four in which the target flips.", ja: "3量子ビットで、2つの制御をどちらも |1⟩ にします。4通りのうち、対象が反転する唯一の場合です。" },
    qubitCount: 3,
    steps: [...prepare, apply],
    customGates: [],
    notes: [
      note(prepare[0].id, "First control to |1⟩.", "1つ目の制御を |1⟩ にします。"),
      note(prepare[1].id, "Second control to |1⟩, so both are now set.", "2つ目の制御を |1⟩ にします。これで両方が立ちました。"),
      note(apply.id, "Flips the target only because both controls are 1 — the target ends up holding their AND. This is why Toffoli is universal for classical reversible computation: anything a classical circuit can compute, a circuit of these can compute reversibly.", "両方の制御が1であるときにだけ対象を反転します。対象は2つのANDを保持することになります。トフォリが古典可逆計算に対して万能である理由がこれです。古典回路が計算できることは何でも、このゲートの回路が可逆に計算できます。"),
    ],
    check: { kind: "peak", bitstring: "111", minProbability: 0.999 },
    readout: { en: "The register reads 111. Change either control to 0 and the target stays 0 — the gate is an AND, written so that it can be undone by applying it again.", ja: "レジスタは111と読まれます。どちらかの制御を0にすれば対象は0のままです。このゲートはANDであり、もう一度適用すれば元に戻せる形で書かれています。" },
    keywords: ["toffoli", "ccx"],
    blocks: [],
  };
}

function rzzDemo(): WorkedExample {
  const prepare = [rawStep("H", [0]), rawStep("H", [1])];
  const apply = rawStep("RZZ", [0, 1], "pi/2");
  return {
    id: "gate-rzz-on-plus-plus",
    algorithm: "RZZ interaction",
    title: { en: "RZZ(θ), the two-qubit interaction Ising models are made of", ja: "RZZ(θ)：イジング模型を構成する2量子ビット相互作用" },
    instance: { en: "Two qubits, both put into |+⟩, then coupled by RZZ(π/2).", ja: "2量子ビットをどちらも |+⟩ にし、RZZ(π/2) で結合します。" },
    qubitCount: 2,
    steps: [...prepare, apply],
    customGates: [],
    notes: [
      note(prepare[0].id, "Qubit 0 into an equal superposition.", "量子ビット0を等しい重ね合わせにします。"),
      note(prepare[1].id, "Qubit 1 as well.", "量子ビット1も同様にします。"),
      note(apply.id, "Turns the phase one way where the two qubits agree and the other way where they disagree. No probability moves. This is one term of an Ising Hamiltonian evolved for a short time, and a chain of these is what a Trotter step is made of.", "2つの量子ビットが一致している場合と一致していない場合とで、位相を逆向きに回します。確率は動きません。これはイジング・ハミルトニアンの1項を短時間だけ時間発展させたものであり、これを鎖状に並べたものがトロッターステップです。"),
    ],
    check: { kind: "distribution", probabilities: { "00": 0.25, "01": 0.25, "10": 0.25, "11": 0.25 }, tolerance: 1e-9 },
    readout: { en: "All four outcomes stay equally likely. The gate's whole effect is a phase that depends on whether the two qubits agree — which is exactly what a coupling term in an Ising model is, and why this gate appears in every Trotter step and every QAOA cost layer in the Atlas.", ja: "4つの測定結果は等確率のままです。このゲートの効果は、2つの量子ビットが一致しているかどうかで決まる位相がすべてです。それはイジング模型の結合項そのものであり、Atlasのすべてのトロッターステップ、すべてのQAOAコスト層にこのゲートが現れる理由です。" },
    keywords: ["rzz", "ising"],
    blocks: [],
  };
}

export const WORKED_EXAMPLES: readonly WorkedExample[] = [
  bellPair(),
  ghz4(),
  deutschJozsa3(),
  bernsteinVazirani1011(),
  grover3q101(),
  qft4qRoundtrip(),
  QPE_EXACT,
  QPE_INEXACT,
  draperAdder5Plus3(),
  isingTrotter4(),
  qaoaMaxcut4Cycle(),
  swapTestPlusZero(),
  teleportationDeferred(),
  vqeTransverseIsing(),
  quantumWalkCycle4(),
  shorOrderFinding15(),
  amplitudeEstimation3(),
  hiddenShift4(),
  superdenseCoding(),
  wState3(),
  simon2(),
  // Gate demonstrations — see the block comment above `phaseGateDemo`.
  hadamardDemo(),
  pauliYDemo(),
  Z_GATE,
  S_GATE,
  T_GATE,
  SDG_GATE,
  TDG_GATE,
  P_GATE,
  RZ_GATE,
  RX_GATE,
  RY_GATE,
  cxDemo(),
  czDemo(),
  cpDemo(),
  swapDemo(),
  toffoliDemo(),
  rzzDemo(),
];

export function workedExample(id: string): WorkedExample | undefined {
  return WORKED_EXAMPLES.find((example) => example.id === id);
}
