import {
  blockTemplate,
  instantiateBlock,
  type BlockParams,
} from "./circuit-blocks.ts";
import { flattenBuilderSteps, createBuilderStepId, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";
import { idealProbabilities, idealStatevector } from "./studio-simulation.ts";

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

/** One letter per qubit, I/X/Y/Z, same bitstring-reading convention as above
 * (character 0 = the highest-numbered qubit). */
export type PauliTerm = { coefficient: number; pauli: string };

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
// expectationValue — a pure helper over the simulator's raw statevector, so a
// UI can show live energy without a measurement-basis circuit.

function applyPauliLetterInPlace(real: Float64Array, imaginary: Float64Array, qubit: number, letter: "X" | "Y" | "Z") {
  const mask = 1 << qubit;
  for (let index = 0; index < real.length; index += 1) {
    if ((index & mask) !== 0) continue;
    const paired = index | mask;
    if (letter === "Z") {
      real[paired] = -real[paired];
      imaginary[paired] = -imaginary[paired];
      continue;
    }
    const re0 = real[index];
    const im0 = imaginary[index];
    const re1 = real[paired];
    const im1 = imaginary[paired];
    if (letter === "X") {
      real[index] = re1; imaginary[index] = im1;
      real[paired] = re0; imaginary[paired] = im0;
    } else {
      // Y = [[0,-i],[i,0]]: new0 = -i*old1, new1 = i*old0.
      real[index] = im1; imaginary[index] = -re1;
      real[paired] = -im0; imaginary[paired] = re0;
    }
  }
}

function pauliExpectation(state: { real: Float64Array; imaginary: Float64Array }, qubitCount: number, pauli: string): number {
  if (pauli.length !== qubitCount) throw new Error(`pauli string length ${pauli.length} does not match qubitCount ${qubitCount}`);
  const dim = state.real.length;
  const outReal = Float64Array.from(state.real);
  const outImaginary = Float64Array.from(state.imaginary);
  for (let charIndex = 0; charIndex < pauli.length; charIndex += 1) {
    const letter = pauli[charIndex].toUpperCase();
    if (letter === "I") continue;
    if (letter !== "X" && letter !== "Y" && letter !== "Z") throw new Error(`invalid Pauli letter: ${pauli[charIndex]}`);
    const qubit = qubitCount - 1 - charIndex;
    applyPauliLetterInPlace(outReal, outImaginary, qubit, letter);
  }
  let expectation = 0;
  for (let index = 0; index < dim; index += 1) {
    expectation += state.real[index] * outReal[index] + state.imaginary[index] * outImaginary[index];
  }
  return expectation;
}

/** <psi|H|psi> for the state `steps`/`customGates` produce, H = sum of the
 * given Pauli terms. No measurement-basis circuit needed — reads the raw
 * statevector directly. */
export function expectationValue(
  steps: BuilderStep[],
  customGates: CustomGateDefinition[],
  qubitCount: number,
  observable: PauliTerm[],
): number {
  const flat = flattenBuilderSteps(steps, customGates);
  const state = idealStatevector({ qubitCount, steps: flat });
  return observable.reduce((total, term) => total + term.coefficient * pauliExpectation(state, qubitCount, term.pauli), 0);
}

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
    instance: { en: "2 qubits, preparing (|00> + |11>) / sqrt(2).", ja: "2量子ビットで (|00> + |11>) / sqrt(2) を準備します。" },
    qubitCount: 2,
    steps: [h, cx],
    customGates: [],
    notes: [
      note(h.id, "Puts qubit 0 into an equal superposition of |0> and |1>.", "量子ビット0を|0>と|1>の等しい重ね合わせにします。"),
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
  const built = place("ghz", { n: 4 }, [0, 1, 2, 3], "ghz");
  return {
    id: "ghz-4",
    algorithm: "GHZ state",
    title: { en: "A 4-qubit GHZ state", ja: "4量子ビットGHZ状態" },
    instance: { en: "4 qubits, preparing (|0000> + |1111>) / sqrt(2).", ja: "4量子ビットで (|0000> + |1111>) / sqrt(2) を準備します。" },
    qubitCount: 4,
    steps: [built.step],
    customGates: built.customGates,
    notes: [note(built.step.id, "A Hadamard on qubit 0 followed by a CX chain entangles all four qubits together.", "量子ビット0へのアダマールゲートに続くCXの連鎖が、4つの量子ビットすべてをもつれさせます。")],
    check: { kind: "support", bitstrings: ["0000", "1111"] },
    readout: { en: "Measuring all four qubits always gives 0000 or 1111, each about half the time.", ja: "4つの量子ビットすべてを測定すると常に0000か1111が得られ、それぞれ約半分の確率です。" },
    keywords: ["ghz state", "entanglement"],
    blocks: ["ghz"],
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
      note(prepAncilla.id, "Sets the ancilla to |1>, so the next step can put it into |->.", "補助量子ビットを|1>にし、次のステップで|->にできるようにします。"),
      note(hAll.step.id, "Hadamards everything: the ancilla becomes |->, and the three input qubits spread into an equal superposition of all 8 inputs.", "すべての量子ビットにアダマールを適用します。補助量子ビットは|->になり、3つの入力量子ビットは8通りの入力すべての等しい重ね合わせになります。"),
      note(oracle.step.id, "Applies f by CX-ing each input qubit onto the ancilla; against |->, this kicks a phase (-1)^f(x) onto each input branch.", "各入力量子ビットを補助量子ビットへCXすることでfを適用します。補助量子ビットが|->であるため、各入力分岐に位相(-1)^f(x)が乗ります。"),
      note(hInputs.step.id, "A second Hadamard layer on the inputs only turns those phases into a deterministic readout.", "入力量子ビットのみへの2回目のアダマール層が、それらの位相を確定的な読み出し結果に変えます。"),
      note(uncomputeH.id, "Undoes the ancilla's Hadamard.", "補助量子ビットのアダマールを打ち消します。"),
      note(uncomputeX.id, "Returns the ancilla to |0>, purely for a tidy final state — it plays no further role in the algorithm.", "補助量子ビットを|0>に戻します。これは最終状態を整えるためだけのもので、アルゴリズム自体にはこれ以上関与しません。"),
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
      note(prepAncilla.id, "Sets the ancilla to |1>, so the next step can put it into |->.", "補助量子ビットを|1>にし、次のステップで|->にできるようにします。"),
      note(hAll.step.id, "Hadamards everything: the ancilla becomes |->, and the four input qubits spread into an equal superposition.", "すべての量子ビットにアダマールを適用します。補助量子ビットは|->になり、4つの入力量子ビットは等しい重ね合わせになります。"),
      note(oracle.step.id, "CXs the input qubits where the secret has a 1 (positions 0, 1 and 3) onto the ancilla, kicking back a phase that encodes the secret.", "秘密の文字列が1である位置（0, 1, 3番目）の入力量子ビットを補助量子ビットへCXし、秘密を符号化する位相を跳ね返します。"),
      note(hInputs.step.id, "A second Hadamard layer on the inputs turns that phase pattern directly into the secret string.", "入力量子ビットへの2回目のアダマール層が、その位相パターンを秘密の文字列そのものに変換します。"),
      note(uncomputeH.id, "Undoes the ancilla's Hadamard.", "補助量子ビットのアダマールを打ち消します。"),
      note(uncomputeX.id, "Returns the ancilla to |0>, purely for a tidy final state.", "補助量子ビットを|0>に戻します。これは最終状態を整えるためだけのものです。"),
    ],
    check: { kind: "peak", bitstring: "01011", minProbability: 0.999 },
    readout: { en: "The four input qubits read 1011 — the secret, recovered exactly, in one shot; the ancilla reads 0.", ja: "4つの入力量子ビットは1011と読み取られます — 秘密がそのまま、1回で復元されます。補助量子ビットは0です。" },
    keywords: ["bernstein-vazirani", "oracle"],
    blocks: ["hadamard_layer", "bv_oracle"],
  };
}

// ---------------------------------------------------------------------------
// 5. grover-3q-101

function grover3q101(): WorkedExample {
  const n = 3;
  const hAll = place("hadamard_layer", { n }, [0, 1, 2], "h-all");
  const iteration1 = place("grover_iteration", { bitstring: "101" }, [0, 1, 2], "iter1");
  const iteration2 = place("grover_iteration", { bitstring: "101" }, [0, 1, 2], "iter2");
  const steps = [hAll.step, iteration1.step, iteration2.step];
  return {
    id: "grover-3q-101",
    algorithm: "Grover search",
    title: { en: "Grover's algorithm finds |101>", ja: "グローバーのアルゴリズムが|101>を発見" },
    instance: { en: "3 qubits, searching for |101> among 8 states, with 2 Grover iterations.", ja: "3量子ビット、8状態の中から|101>を2回のグローバー反復で探索します。" },
    qubitCount: n,
    steps,
    customGates: [...hAll.customGates, ...iteration1.customGates, ...iteration2.customGates],
    notes: [
      note(hAll.step.id, "Spreads the state into an equal superposition of all 8 three-qubit strings.", "状態を8通りの3量子ビット文字列すべての等しい重ね合わせに広げます。"),
      note(iteration1.step.id, "First Grover iteration: the oracle flips the sign of |101> and leaves the other seven states alone, then the diffuser reflects about the average, boosting |101>'s amplitude.", "最初のグローバー反復：オラクルが|101>の符号を反転し、他の7状態はそのままにします。その後、拡散変換が平均に関して反射し、|101>の振幅を増幅します。"),
      note(iteration2.step.id, "Second Grover iteration: the same oracle and diffuser, boosting |101> further — 2 iterations is close to the optimal number for 8 states.", "2回目のグローバー反復：同じオラクルと拡散変換により、|101>をさらに増幅します。8状態に対しては2回の反復がほぼ最適な回数です。"),
    ],
    check: { kind: "peak", bitstring: "101", minProbability: 0.9 },
    readout: { en: "Measuring gives 101 with high probability — the marked state, found without checking each of the 8 possibilities individually.", ja: "測定すると高い確率で101が得られます — 8通りの可能性を個別に確認することなく、目印を付けた状態が見つかります。" },
    keywords: ["grover", "amplitude amplification"],
    blocks: ["hadamard_layer", "grover_iteration"],
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
    title: { en: "QFT then its inverse, on |0101>", ja: "|0101>へのQFTとその逆変換" },
    instance: { en: "4 qubits, starting at |0101>, applying the QFT then immediately undoing it.", ja: "4量子ビット、|0101>から開始し、QFTを適用した直後に元に戻します。" },
    qubitCount: n,
    steps,
    customGates: [...qft.customGates, ...qftInverse.customGates],
    notes: [
      note(prep[0].id, "Prepares qubit 2 as |1>.", "量子ビット2を|1>に準備します。"),
      note(prep[1].id, "Prepares qubit 0 as |1>, so the register reads |0101>.", "量子ビット0を|1>に準備し、レジスタが|0101>になるようにします。"),
      note(qft.step.id, "Applies the Quantum Fourier Transform, spreading the single input state into an equal-magnitude superposition over all 16 outputs, each carrying a different phase.", "量子フーリエ変換を適用し、単一の入力状態を16通りの出力すべてにわたる等しい大きさの重ね合わせに広げます。それぞれが異なる位相を持ちます。"),
      note(qftInverse.step.id, "Applies the exact inverse QFT, which collapses the superposition straight back to the original input.", "厳密な逆QFTを適用し、重ね合わせを元の入力へそのまま戻します。"),
    ],
    check: { kind: "peak", bitstring: "0101", minProbability: 0.999 },
    readout: { en: "The register reads 0101 again, exactly — the QFT and its inverse cancel, the way any unitary and its adjoint do.", ja: "レジスタは再び正確に0101と読み取られます — QFTとその逆変換は、ユニタリ演算とその随伴演算がそうであるように打ち消し合います。" },
    keywords: ["quantum fourier transform", "qft"],
    blocks: ["qft", "qft_inverse"],
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
  const example = place("qpe_phase", { t, angle }, [0, 1, 2, target], "qpe");
  const steps = [example.step];
  return {
    id,
    algorithm: "Quantum Phase Estimation",
    title: { en: `Phase estimation of P(${angle})`, ja: `P(${angle})の位相推定` },
    instance: { en: instanceEn, ja: instanceJa },
    qubitCount: t + 1,
    steps,
    customGates: example.customGates,
    notes: [
      note(
        example.step.id,
        `Prepares the target in the P(${angle}) eigenstate |1>, Hadamards the 3 counting qubits, applies controlled powers of P(${angle}), then an inverse QFT to read the phase into the counting register.`,
        `対象量子ビットをP(${angle})の固有状態|1>に準備し、3個のカウント量子ビットにアダマールを適用し、P(${angle})の制御べき乗を適用した後、逆QFTで位相をカウントレジスタに読み出します。`,
      ),
    ],
    check,
    readout: { en: readoutEn, ja: readoutJa },
    keywords: ["phase estimation"],
    blocks: ["qpe_phase"],
  };
}

// ---------------------------------------------------------------------------
// 9. draper-adder-5-plus-3

function draperAdder5Plus3(): WorkedExample {
  const n = 4;
  const a = 3;
  // |5> = 0101: qubit2=1, qubit0=1.
  const prep = [rawStep("X", [0]), rawStep("X", [2])];
  const adder = place("draper_add_constant", { n, a }, [0, 1, 2, 3], "adder");
  const steps = [...prep, adder.step];
  return {
    id: "draper-adder-5-plus-3",
    algorithm: "Draper adder",
    title: { en: "Draper adder: 5 + 3", ja: "ドレイパー加算器：5 + 3" },
    instance: { en: "4 qubits, adding the constant 3 to the input 5, giving 8 mod 16.", ja: "4量子ビットで、入力5に定数3を加算し、16を法として8を得ます。" },
    qubitCount: n,
    steps,
    customGates: adder.customGates,
    notes: [
      note(prep[0].id, "Prepares qubit 0 as |1>.", "量子ビット0を|1>に準備します。"),
      note(prep[1].id, "Prepares qubit 2 as |1>, so the register reads |0101> = 5.", "量子ビット2を|1>に準備し、レジスタが|0101> = 5になるようにします。"),
      note(adder.step.id, "QFTs the register, applies a phase rotation per qubit proportional to the constant 3, then inverse-QFTs — arithmetic done entirely in the Fourier basis, no ancilla.", "レジスタにQFTを適用し、定数3に比例した位相回転を各量子ビットに適用した後、逆QFTを適用します — 補助量子ビットを使わず、フーリエ基底のみで演算を行います。"),
    ],
    check: { kind: "peak", bitstring: "1000", minProbability: 0.999 },
    readout: { en: "The register reads 1000 = 8: 5 + 3, exactly.", ja: "レジスタは1000 = 8と読み取られます：5 + 3が正確に得られます。" },
    keywords: ["draper adder", "quantum arithmetic", "quantum fourier transform"],
    blocks: ["draper_add_constant"],
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
    instance: { en: "4 qubits starting at |0000>, J=1, h=0.5, dt=0.3, 2 first-order Trotter steps.", ja: "4量子ビットが|0000>から開始し、J=1、h=0.5、dt=0.3で、1次のトロッター・ステップを2回行います。" },
    qubitCount: n,
    steps,
    customGates: [...step1.customGates, ...step2.customGates],
    notes: [
      note(step1.step.id, "First Trotter step: RZZ(2*J*dt) couples each neighbouring pair on the line, then RX(2*h*dt) applies the transverse field to every qubit.", "1回目のトロッター・ステップ：RZZ(2*J*dt)が直線上の隣接するペアを結合し、続いてRX(2*h*dt)が横磁場をすべての量子ビットに適用します。"),
      note(step2.step.id, "Second Trotter step, identical to the first — together they approximate exp(-i*H*2*dt) for this chain's Hamiltonian.", "2回目のトロッター・ステップは1回目と同一です — 合わせて、この鎖のハミルトニアンに対するexp(-i*H*2*dt)を近似します。"),
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
    readout: { en: "The state spreads from |0000> across several nearby basis states — this is a regression value from this file's own simulator, not a claim about a real material.", ja: "状態は|0000>からいくつかの近い基底状態に広がります — これはこのファイル自身のシミュレータによる回帰値であり、実在する物質についての主張ではありません。" },
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
    readout: { en: "0101 and 1010 are the two optimal cuts of a 4-cycle (alternating around the ring); each comes out around 0.266, well above the roughly 0.078 the next tier of cuts gets.", ja: "0101と1010は4サイクルの2つの最適カットです（リング上で交互）。それぞれ約0.266となり、次の層のカットの約0.078を大きく上回ります。" },
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
    title: { en: "Swap test: |+> versus |0>", ja: "スワップテスト：|+> と |0>" },
    instance: { en: "One ancilla plus two single-qubit registers, comparing |+> against |0>.", ja: "1個の補助量子ビットと2つの単一量子ビットレジスタで、|+>と|0>を比較します。" },
    qubitCount: 3,
    steps,
    customGates: built.customGates,
    notes: [
      note(prep.id, "Prepares the first register (qubit 1) as |+>; the second register (qubit 2) is left at |0>.", "最初のレジスタ（量子ビット1）を|+>に準備します。2番目のレジスタ（量子ビット2）は|0>のままにします。"),
      note(built.step.id, "Hadamards the ancilla, applies a controlled swap between the two registers, then Hadamards the ancilla again.", "補助量子ビットにアダマールを適用し、2つのレジスタ間で制御スワップを適用した後、補助量子ビットに再びアダマールを適用します。"),
    ],
    // Full distribution (qubit 2 = register B, qubit 1 = register A, qubit 0
    // = ancilla — see the module-level convention note), verified against the
    // simulator: 000 (both registers read 0) carries the whole "identical
    // outcome" mass at 0.5, and each state with register A=1 or B=1 alone
    // carries 0.125, all with the ancilla split 0/1 evenly within each.
    check: { kind: "distribution", probabilities: { "000": 0.5, "010": 0.125, "011": 0.125, "100": 0.125, "101": 0.125 }, tolerance: 1e-6 },
    readout: { en: "The ancilla (qubit 0) reads 0 with probability 0.75 — since |<+|0>|^2 = 0.5, the swap test formula (1 + |<+|0>|^2) / 2 gives exactly 0.75.", ja: "補助量子ビット（量子ビット0）は確率0.75で0と読み取られます — |<+|0>|^2 = 0.5なので、スワップテストの式 (1 + |<+|0>|^2) / 2 はちょうど0.75になります。" },
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
    instance: { en: "3 qubits, teleporting RY(pi/3)|0> from qubit 0 to qubit 2, with the corrections applied as controlled gates instead of classically-controlled ones after a measurement.", ja: "3量子ビットで、RY(pi/3)|0>を量子ビット0から量子ビット2へテレポートします。補正は測定後の古典制御ゲートではなく、制御ゲートとして適用されます。" },
    qubitCount: 3,
    steps,
    customGates: [],
    notes: [
      note(prepState.id, "Prepares the state to teleport on qubit 0: RY(pi/3)|0>.", "テレポートする状態を量子ビット0に準備します：RY(pi/3)|0>。"),
      note(bellH.id, "Starts a Bell pair between qubit 1 (Alice's half) and qubit 2 (Bob's half).", "量子ビット1（アリスの半分）と量子ビット2（ボブの半分）の間でベル対を開始します。"),
      note(bellCx.id, "Completes the Bell pair.", "ベル対を完成させます。"),
      note(measureCx.id, "The first half of Alice's Bell measurement on her two qubits (0 and 1) — ordinarily followed by an actual measurement.", "アリスが自分の2つの量子ビット（0と1）に対して行うベル測定の前半です — 通常はここで実際の測定が行われます。"),
      note(measureH.id, "The second half of Alice's Bell measurement.", "アリスのベル測定の後半です。"),
      note(correctX.id, "The correction that would classically depend on Alice's qubit-1 outcome, applied instead as a genuine controlled gate (the 'deferred measurement' trick).", "本来はアリスの量子ビット1の測定結果に古典的に依存する補正を、実際の制御ゲートとして適用します（「遅延測定」のトリック）。"),
      note(correctZ.id, "The correction that would classically depend on Alice's qubit-0 outcome, applied the same way.", "本来はアリスの量子ビット0の測定結果に依存する補正を、同様に適用します。"),
    ],
    check: { kind: "expectation", value: 0.5, tolerance: 1e-9 },
    readout: { en: "Qubit 2's marginal state matches RY(pi/3)|0> exactly: <Z> = cos(pi/3) = 0.5 — the state teleported across without qubit 0 and qubit 2 ever directly interacting.", ja: "量子ビット2の周辺状態はRY(pi/3)|0>と正確に一致します：<Z> = cos(pi/3) = 0.5 — 量子ビット0と量子ビット2が直接相互作用することなく、状態がテレポートされました。" },
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
    instance: { en: "2 qubits, H = Z@Z + 0.5*(X@I + I@X), a stated toy Hamiltonian (not a molecule), minimised with a hardware-efficient ansatz.", ja: "2量子ビット、H = Z@Z + 0.5*(X@I + I@X)、明示されたおもちゃのハミルトニアン（分子ではありません）を、ハードウェア効率の良いアンザッツで最小化します。" },
    qubitCount: 2,
    steps,
    customGates: [],
    notes: [
      note(steps[0].id, "RY on qubit 0, the first variational layer.", "量子ビット0へのRY、1番目の変分層です。"),
      note(steps[1].id, "RY on qubit 1, the first variational layer.", "量子ビット1へのRY、1番目の変分層です。"),
      note(steps[2].id, "A CX entangles the two qubits, letting the ansatz reach states a product of single-qubit rotations alone cannot.", "CXが2つの量子ビットをもつれさせ、単一量子ビット回転の積だけでは到達できない状態にアンザッツが到達できるようにします。"),
      note(steps[3].id, "RY on qubit 0, the second variational layer.", "量子ビット0へのRY、2番目の変分層です。"),
      note(steps[4].id, "RY on qubit 1, the second variational layer.", "量子ビット1へのRY、2番目の変分層です。"),
    ],
    check: { kind: "expectation", value: VQE_GROUND_ENERGY, tolerance: 1e-6 },
    readout: {
      en: "At these angles the ansatz's energy <H> reaches E0 = -sqrt(2) ~= -1.41421, the Hamiltonian's exact ground energy; a real VQE run reaches these angles by repeating measure-the-energy then update-the-angles, not by a closed-form solution.",
      ja: "これらの角度において、アンザッツのエネルギー<H>はこのハミルトニアンの厳密な基底エネルギー E0 = -sqrt(2) ~= -1.41421 に到達します。実際のVQE実行では、閉形式の解ではなく、エネルギーを測定してから角度を更新することを繰り返してこれらの角度に到達します。",
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
      note(hAll1.step.id, "Spreads all four qubits into an equal superposition.", "4つの量子ビットすべてを等しい重ね合わせに広げます。"),
      note(shiftIn[0].id, "Flips qubit 1, the first step of shifting the input by s = 0110 before applying f.", "量子ビット1を反転します。fを適用する前に入力をs = 0110だけシフトする最初のステップです。"),
      note(shiftIn[1].id, "Flips qubit 2, completing the shift by s.", "量子ビット2を反転し、sによるシフトを完了します。"),
      note(gOracleCz[0].id, "Applies CZ(0,1), the x₀x₁ term of f, now acting on the shifted input.", "CZ(0,1)を適用します。シフトされた入力に作用する、fのx₀x₁の項です。"),
      note(gOracleCz[1].id, "Applies CZ(2,3), the x₂x₃ term of f, completing the oracle for g(x) = f(x ⊕ s).", "CZ(2,3)を適用します。fのx₂x₃の項で、g(x) = f(x ⊕ s)のオラクルを完成させます。"),
      note(shiftOut[0].id, "Undoes the shift on qubit 1.", "量子ビット1のシフトを打ち消します。"),
      note(shiftOut[1].id, "Undoes the shift on qubit 2.", "量子ビット2のシフトを打ち消します。"),
      note(hAll2.step.id, "A second Hadamard layer on all four qubits.", "4つの量子ビットすべてへの2回目のアダマール層です。"),
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
      note(hIn[0].id, "Spreads qubit 0 into superposition.", "量子ビット0を重ね合わせに広げます。"),
      note(hIn[1].id, "Spreads qubit 1 into superposition.", "量子ビット1を重ね合わせに広げます。"),
      note(oracle[0].id, "CXs qubit 0 onto the ancilla.", "量子ビット0を補助量子ビットへCXします。"),
      note(oracle[1].id, "CXs qubit 1 onto the ancilla, so the ancilla ends up holding x₀ ⊕ x₁: the oracle for f.", "量子ビット1を補助量子ビットへCXします。これにより補助量子ビットはx₀ ⊕ x₁を保持することになり、fのオラクルとなります。"),
      note(hOut[0].id, "A second Hadamard on qubit 0.", "量子ビット0への2回目のアダマールです。"),
      note(hOut[1].id, "A second Hadamard on qubit 1, completing the readout register.", "量子ビット1への2回目のアダマールで、読み出しレジスタを完成させます。"),
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
  "3 counting qubits estimating the phase of P(3*pi/4), which is 2*pi*3/8 exactly — a phase 3-bit QPE can represent exactly.",
  "3個のカウント量子ビットで、P(3*pi/4)（すなわち2*pi*3/8）の位相を推定します。これは3ビットQPEが正確に表現できる位相です。",
  "The counting register reads 011 = 3 with probability 1: angle/(2*pi) = 3/8, recovered exactly.",
  "カウントレジスタは確率1で011 = 3と読み取られます：angle/(2*pi) = 3/8が正確に復元されます。",
);

// angle = 2*pi/3: NOT a multiple of 2*pi/8, so 3 bits cannot represent it
// exactly. Peak probability (0.6878...) taken from running this file's own
// simulator once — an honest, not-close-to-1 value, not assumed.
const QPE_INEXACT = qpePhaseExample(
  "qpe-3-inexact",
  "2*pi/3",
  { kind: "peak", bitstring: "1011", minProbability: 0.68 },
  "3 counting qubits estimating the phase of P(2*pi/3), which is NOT a multiple of 2*pi/8 — 3 bits cannot represent 1/3 exactly.",
  "3個のカウント量子ビットで、P(2*pi/3)の位相を推定します。これは2*pi/8の倍数ではないため、3ビットでは1/3を正確に表現できません。",
  "The counting register still peaks at 011 = 3 (the best 3-bit approximation of angle/(2*pi) = 1/3 ~= 3/8), but only with probability ~0.69, not 1 — the rest of the probability spreads over neighbouring estimates, exactly as QPE theory predicts for a phase that isn't exactly representable.",
  "カウントレジスタは依然として011 = 3（angle/(2*pi) = 1/3 ~= 3/8に対する3ビットでの最良近似）でピークを迎えますが、確率は1ではなく約0.69にとどまります。残りの確率は近傍の推定値に広がり、正確に表現できない位相に対するQPE理論の予測どおりです。",
);

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
];

export function workedExample(id: string): WorkedExample | undefined {
  return WORKED_EXAMPLES.find((example) => example.id === id);
}
