// The numbers: per-problem cost models, each line tied to its source.
//
// ## What a cost model here is allowed to do
//
// Evaluate a formula a paper states, at the reader's parameters, and say which
// kind of number the result is (`CostKind`). It may do arithmetic ON a stated
// formula — invert Brassard et al.'s error bound for the smallest M, multiply
// Costa et al.'s 834κ by a per-step Toffoli count the reader typed — and when
// it does, the line is `derived` or `supplied` and carries a note saying what
// was done. It may not supply a constant a source does not state: a bound given
// only as O(·) is left to the Atlas block's own cost text, which the page shows
// on every stage, and gets no number here.
//
// ## Why a model is keyed by problem AND checks the chosen blocks
//
// A formula belongs to one construction. Babbush et al.'s query count is for
// phase estimation of the qubitized walk; swap the simulation block for a
// product formula and the count no longer describes the workflow on screen. So
// each model reads the stage tree (`chosenMethodFor`) and returns nothing for
// a combination it does not describe, with a note saying so — rather than a
// number for a different circuit than the one the reader assembled.
import { chosenMethodFor, type Stage } from "./assemble.ts";
import type { Bilingual, CostLine, LogicalSummary, ParamKey, ParamValues, ProblemId, Suggestion } from "./types.ts";

export interface CostReport {
  lines: CostLine[];
  /** What a classical approach costs on the same task, where a comparison is meaningful and computable. */
  classical: CostLine[];
  /** Published whole-machine estimates, only at the sizes their papers state. */
  published: CostLine[];
  logical: LogicalSummary;
  suggestions: Suggestion[];
  /** Said on the page when the blocks chosen have no numeric model here. */
  notes: Bilingual[];
}

const EMPTY_LOGICAL: LogicalSummary = { logicalQubits: null, toffolis: null, tGates: null, queries: null };

function value(params: ParamValues, key: ParamKey): number | null {
  const v = params[key]?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function missing(params: ParamValues, keys: ParamKey[]): ParamKey[] {
  return keys.filter((key) => value(params, key) === null);
}

const lg = Math.log2;

const U = {
  queries: { en: "queries", ja: "回の問い合わせ" },
  iterations: { en: "iterations", ja: "回の反復" },
  qubits: { en: "qubits", ja: "量子ビット" },
  logicalQubits: { en: "logical qubits", ja: "論理量子ビット" },
  physicalQubits: { en: "physical qubits", ja: "物理量子ビット" },
  toffolis: { en: "Toffoli gates", ja: "Toffoli ゲート" },
  tGates: { en: "T gates", ja: "T ゲート" },
  probability: { en: "probability", ja: "確率" },
  measurements: { en: "measurements", ja: "回の測定" },
  samples: { en: "samples", ja: "回のサンプル" },
  steps: { en: "walk steps", ja: "ウォークステップ" },
  gates: { en: "gates", ja: "ゲート" },
  layers: { en: "measurement layers", ja: "測定層" },
  none: { en: "", ja: "" },
} satisfies Record<string, Bilingual>;

function line(partial: Omit<CostLine, "value"> & { value: number | null }): CostLine {
  const needs = partial.missing?.length ? partial.missing : undefined;
  return { ...partial, value: needs ? null : partial.value, missing: needs };
}

const QUADRATIC_CAUTION: Suggestion = {
  id: "quadratic-caution",
  title: {
    en: "A quadratic speedup may not pay on early error-corrected machines",
    ja: "2 乗の高速化は、初期の誤り訂正マシンでは元が取れない可能性があります",
  },
  body: {
    en: "Babbush et al. conclude that quadratic speedups will not give an advantage on early fault-tolerant hardware unless error correction gets much cheaper. Grover-type search is a quadratic speedup, so compare the iteration count with the classical count below before planning hardware.",
    ja: "Babbush らは、誤り訂正が大幅に安くならない限り、2 乗の高速化は初期のフォールトトレラント機では優位にならないと結論しています。Grover 型の探索は 2 乗の高速化なので、ハードウェアを計画する前に、反復回数を下の古典的な回数と比べてください。",
  },
  source: "babbush2021-quadratic",
};

// ---------------------------------------------------------------------------

function searchCosts(params: ParamValues, root: Stage | null): CostReport {
  const report: CostReport = { lines: [], classical: [], published: [], logical: { ...EMPTY_LOGICAL }, suggestions: [QUADRATIC_CAUTION], notes: [] };
  if (root?.method?.id !== "grover-fixed-iteration-search") {
    report.notes.push({
      en: "The numbers here are for fixed-iteration Grover search. The block you chose has its cost stated on its card.",
      ja: "ここの数値は反復回数固定の Grover 探索のものです。選んだブロックのコストはそのカードに記載されています。",
    });
    return report;
  }
  const N = value(params, "domainSize");
  const M = value(params, "markedCount");
  const needs = missing(params, ["domainSize", "markedCount"]);
  if (N !== null && M !== null && M >= N) {
    report.notes.push({ en: "The accepted count M has to be smaller than N.", ja: "受理される項目数 M は N より小さくなければなりません。" });
    return report;
  }
  const theta = N !== null && M !== null ? Math.asin(Math.sqrt(M / N)) : NaN;
  const iterations = Number.isFinite(theta) ? Math.floor(Math.PI / (4 * theta)) : null;
  const success = iterations !== null ? Math.sin((2 * iterations + 1) * theta) ** 2 : null;
  const queries = line({
    id: "grover-iterations",
    label: { en: "Grover iterations (one check each)", ja: "Grover 反復（各 1 回のチェック）" },
    value: iterations,
    unit: U.iterations,
    formula: "⌊π / (4θ)⌋,  sin²θ = M/N",
    kind: "exact",
    source: "bbht-iterations",
    missing: needs,
  });
  report.lines.push(queries);
  report.lines.push(
    line({
      id: "grover-success",
      label: { en: "Chance the measured item is accepted", ja: "測定した項目が受理される確率" },
      value: success,
      unit: U.probability,
      formula: "sin²((2j + 1)θ)",
      kind: "exact",
      source: "bbht-iterations",
      missing: needs,
    }),
  );
  const register = line({
    id: "grover-register",
    label: { en: "Qubits to index the items", ja: "項目の番号付けに使う量子ビット" },
    value: N !== null ? Math.ceil(lg(N)) : null,
    unit: U.qubits,
    formula: "⌈log₂ N⌉",
    kind: "derived",
    source: null,
    note: { en: "The index register only. The check's own workspace comes on top.", ja: "番号を持つレジスタだけです。チェック自体の作業領域はこれに加わります。" },
    missing: missing(params, ["domainSize"]),
  });
  report.lines.push(register);
  const oracle = value(params, "oracleToffolis");
  let toffolis: CostLine | null = null;
  if (oracle !== null) {
    toffolis = line({
      id: "grover-toffolis",
      label: { en: "Toffoli gates in the checks", ja: "チェック内の Toffoli ゲート" },
      value: iterations !== null ? iterations * oracle : null,
      unit: U.toffolis,
      formula: "iterations × Toffolis per check",
      kind: "supplied",
      source: null,
      note: { en: "Your per-check count times the iterations. The reflection between checks adds more.", ja: "入力したチェック 1 回分に反復回数を掛けたものです。チェックの間の反射がさらに加わります。" },
      missing: needs,
    });
    report.lines.push(toffolis);
  }
  report.logical = { logicalQubits: register, toffolis, tGates: null, queries };
  report.classical.push(
    line({
      id: "classical-search",
      label: { en: "Checks a classical search makes in the worst case", ja: "古典探索が最悪の場合に行うチェック回数" },
      value: N !== null && M !== null ? N - M + 1 : null,
      unit: U.queries,
      formula: "N − M + 1",
      kind: "derived",
      source: null,
      note: { en: "By counting: N − M checks can all land on items the check rejects.", ja: "数え上げによります。N − M 回のチェックがすべて不受理の項目に当たりえます。" },
      missing: needs,
    }),
  );
  if (N !== null && M !== null && M <= (3 * N) / 4) {
    const m0 = 1 / Math.sin(2 * theta);
    const expected = (9 / 2) * m0;
    report.suggestions.unshift({
      id: "unknown-count",
      title: { en: "If you do not know how many items the check accepts", ja: "受理される項目数がわからない場合" },
      body: {
        en: `A fixed iteration count needs M. Boyer, Brassard, Høyer and Tapp's randomised schedule finds an item without knowing it. Here its expected number of iterations is at most (9/2)·m₀ ≈ ${formatPlain(expected)} (m₀ = 1/sin 2θ), against ${formatPlain(iterations ?? 0)} when M is known.`,
        ja: `反復回数を固定するには M が必要です。Boyer、Brassard、Høyer、Tapp のランダム化スケジュールなら M なしで見つけられ、ここでは期待反復回数は (9/2)·m₀ ≈ ${formatPlain(expected)} 回以下です（m₀ = 1/sin 2θ）。M がわかっている場合は ${formatPlain(iterations ?? 0)} 回です。`,
      },
      source: "bbht-unknown-count",
    });
  }
  return report;
}

// ---------------------------------------------------------------------------

/** Gidney 2025, Table 5: bits → [expected Toffolis per factoring, logical qubits]. Only these sizes. */
export const GIDNEY_2025_TABLE_5: Readonly<Record<number, readonly [number, number]>> = {
  1024: [1.1e9, 742],
  1536: [3.1e9, 1074],
  2048: [6.5e9, 1399],
  3072: [1.9e10, 2043],
  4096: [4.0e10, 2692],
  6144: [1.2e11, 3978],
  8192: [2.7e11, 5261],
};

function factoringCosts(params: ParamValues, root: Stage | null): CostReport {
  const report: CostReport = { lines: [], classical: [], published: [], logical: { ...EMPTY_LOGICAL }, suggestions: [], notes: [] };
  if (root?.method?.id !== "cyclic-period-finding") {
    report.notes.push({ en: "The numbers here are for Shor-style period finding. The block you chose has its cost stated on its card.", ja: "ここの数値は Shor 型の周期発見のものです。選んだブロックのコストはそのカードに記載されています。" });
    return report;
  }
  const n = value(params, "bits");
  const needs = missing(params, ["bits"]);
  const qubits = line({
    id: "ge2021-qubits",
    label: { en: "Logical qubits (Gidney–Ekerå 2019)", ja: "論理量子ビット（Gidney–Ekerå 2019）" },
    value: n !== null ? Math.ceil(3 * n + 0.002 * n * lg(n)) : null,
    unit: U.logicalQubits,
    formula: "3n + 0.002·n·lg n",
    kind: "leading-order",
    source: "ge2021-logical",
    missing: needs,
  });
  const toffolis = line({
    id: "ge2021-toffolis",
    label: { en: "Toffoli gates (Gidney–Ekerå 2019)", ja: "Toffoli ゲート（Gidney–Ekerå 2019）" },
    value: n !== null ? 0.3 * n ** 3 + 0.0005 * n ** 3 * lg(n) : null,
    unit: U.toffolis,
    formula: "0.3n³ + 0.0005·n³·lg n",
    kind: "leading-order",
    source: "ge2021-logical",
    missing: needs,
  });
  const depth = line({
    id: "ge2021-depth",
    label: { en: "Measurement depth (Gidney–Ekerå 2019)", ja: "測定深さ（Gidney–Ekerå 2019）" },
    value: n !== null ? 500 * n ** 2 + n ** 2 * lg(n) : null,
    unit: U.layers,
    formula: "500n² + n²·lg n",
    kind: "leading-order",
    source: "ge2021-logical",
    missing: needs,
  });
  report.lines.push(qubits, toffolis, depth);
  // Gidney–Ekerå's measurement depth is the chain of dependent measurements
  // the reaction time applies to, so it is the estimator's serial depth. At
  // their 10 µs reaction time it gives 5.9 hours at 2048 bits, against the
  // 8 hours their abstract states for the whole run.
  report.logical = { logicalQubits: qubits, toffolis, tGates: null, queries: null, serialDepth: depth };
  const row = n !== null ? GIDNEY_2025_TABLE_5[n] : undefined;
  if (row) {
    report.lines.push(
      line({ id: "g2025-qubits", label: { en: "Logical qubits (Gidney 2025)", ja: "論理量子ビット（Gidney 2025）" }, value: row[1], unit: U.logicalQubits, formula: `Table 5, n = ${n}`, kind: "published", source: "gidney2025-table5" }),
      line({ id: "g2025-toffolis", label: { en: "Toffoli gates per factoring (Gidney 2025)", ja: "1 回の素因数分解の Toffoli ゲート（Gidney 2025）" }, value: row[0], unit: U.toffolis, formula: `Table 5, n = ${n}`, kind: "published", source: "gidney2025-table5" }),
    );
    if (qubits.value !== null && toffolis.value !== null) {
      report.suggestions.push({
        id: "trade-toffolis-for-qubits",
        title: { en: "Trade Toffoli gates for qubits", ja: "Toffoli ゲートと量子ビットを交換する" },
        body: {
          en: `At ${n} bits, Gidney's 2025 construction uses ${formatPlain(qubits.value / row[1])}× fewer logical qubits than the 2019 one and ${formatPlain(row[0] / toffolis.value)}× more Toffoli gates. The machine can be smaller, but the run is longer.`,
          ja: `${n} ビットでは、Gidney の 2025 年の構成は 2019 年の構成より論理量子ビットが ${formatPlain(qubits.value / row[1])} 分の 1 で、Toffoli ゲートは ${formatPlain(row[0] / toffolis.value)} 倍です。量子ビットが少ないほど機械は小さく、Toffoli が多いほど実行は長くなります。`,
        },
        source: "gidney2025-table5",
      });
    }
  } else if (n !== null) {
    report.notes.push({
      en: "Gidney 2025 tabulates 1024, 1536, 2048, 3072, 4096, 6144 and 8192 bits only, so its counts are shown only at those sizes.",
      ja: "Gidney 2025 は 1024、1536、2048、3072、4096、6144、8192 ビットのみを表にしているため、その数値はこれらのサイズでだけ表示します。",
    });
  }
  if (n === 2048) {
    report.published.push(
      line({
        id: "ge2021-machine",
        label: { en: "Noisy qubits, 8 hours (Gidney–Ekerå 2019)", ja: "ノイズのある量子ビット、8 時間（Gidney–Ekerå 2019）" },
        value: 2e7,
        unit: U.physicalQubits,
        formula: "gate error 10⁻³, 1 µs cycle, 10 µs reaction time",
        kind: "published",
        source: "ge2021-headline",
      }),
      line({
        id: "g2025-machine",
        label: { en: "Noisy qubits, under a week (Gidney 2025)", ja: "ノイズのある量子ビット、1 週間未満（Gidney 2025）" },
        value: 1e6,
        qualifier: "<",
        unit: U.physicalQubits,
        formula: "less than a million; same assumptions as 2019",
        kind: "published",
        source: "gidney2025-headline",
      }),
    );
  }
  return report;
}

function ecdlpCosts(params: ParamValues, root: Stage | null): CostReport {
  const report: CostReport = { lines: [], classical: [], published: [], logical: { ...EMPTY_LOGICAL }, suggestions: [], notes: [] };
  if (root?.method?.id !== "cyclic-period-finding") {
    report.notes.push({ en: "The numbers here are for Shor-style period finding. The block you chose has its cost stated on its card.", ja: "ここの数値は Shor 型の周期発見のものです。選んだブロックのコストはそのカードに記載されています。" });
    return report;
  }
  const n = value(params, "bits");
  const needs = missing(params, ["bits"]);
  const qubits = line({
    id: "roetteler-qubits",
    label: { en: "Qubits (Roetteler et al. 2017)", ja: "量子ビット（Roetteler ら 2017）" },
    value: n !== null ? 9 * n + 2 * Math.ceil(lg(n)) + 10 : null,
    unit: U.logicalQubits,
    formula: "9n + 2⌈log₂ n⌉ + 10",
    kind: "upper-bound",
    source: "roetteler-ecdlp",
    missing: needs,
  });
  const toffolis = line({
    id: "roetteler-toffolis",
    label: { en: "Toffoli gates (Roetteler et al. 2017)", ja: "Toffoli ゲート（Roetteler ら 2017）" },
    value: n !== null ? 448 * n ** 3 * lg(n) + 4090 * n ** 3 : null,
    unit: U.toffolis,
    formula: "448n³·log₂ n + 4090n³",
    kind: "upper-bound",
    source: "roetteler-ecdlp",
    missing: needs,
  });
  report.lines.push(qubits, toffolis);
  report.logical = { logicalQubits: qubits, toffolis, tGates: null, queries: null };
  return report;
}

// ---------------------------------------------------------------------------

function groundStateCosts(params: ParamValues, root: Stage | null): CostReport {
  const report: CostReport = { lines: [], classical: [], published: [], logical: { ...EMPTY_LOGICAL }, suggestions: [], notes: [] };
  const lambda = value(params, "lambda");
  const dE = value(params, "deltaE");
  const N = value(params, "orbitals");
  const rootId = root?.method?.id;
  const qpeReady = lambda !== null && dE !== null;
  const qpeBits = qpeReady ? Math.max(0, Math.ceil(lg((Math.SQRT2 * Math.PI * lambda) / (2 * dE)))) : null;
  const qpeQueries = qpeBits !== null ? 2 ** qpeBits : null;
  const vqeShots = qpeReady ? (lambda / dE) ** 2 : null;

  if (rootId === "phase-estimation-ground-state") {
    if (chosenMethodFor(root, "hamiltonian-simulation") !== "qubitization-simulation") {
      report.notes.push({
        en: "The query and T counts here are for phase estimation of the qubitized walk. Put the simulation block back on qubitization to see them.",
        ja: "ここの問い合わせ数と T 数は、量子ビット化したウォークの位相推定のものです。見るには、シミュレーションのブロックを量子ビット化に戻してください。",
      });
      return report;
    }
    const needsQpe = missing(params, ["lambda", "deltaE"]);
    const register = line({
      id: "babbush-bits",
      label: { en: "Phase-estimation qubits (m)", ja: "位相推定の量子ビット (m)" },
      value: qpeBits,
      unit: U.qubits,
      formula: "⌈log₂(√2·π·λ / 2ΔE)⌉",
      kind: "exact",
      source: "babbush2018-queries",
      missing: needsQpe,
    });
    const queries = line({
      id: "babbush-queries",
      label: { en: "Calls to the Hamiltonian's select circuit", ja: "ハミルトニアンの select 回路の呼び出し" },
      value: qpeQueries,
      unit: U.queries,
      formula: "2^m < √2·π·λ / ΔE",
      kind: "upper-bound",
      source: "babbush2018-queries",
      note: { en: "Prepare is called at most twice as often.", ja: "prepare の呼び出しは多くてもその 2 倍です。" },
      missing: needsQpe,
    });
    const tGates = line({
      id: "babbush-t",
      label: { en: "T gates, leading term", ja: "T ゲート（主要項）" },
      value: qpeReady && N !== null ? (24 * Math.SQRT2 * Math.PI * N * lambda) / dE : null,
      unit: U.tGates,
      formula: "24·√2·π·N·λ / ΔE",
      kind: "leading-order",
      source: "babbush2018-tcount",
      note: {
        en: "Theorem 1 is for electronic structure in a basis that diagonalises the Coulomb operator (plane-wave dual basis). It drops an O((λ/ΔE)·log(N/ΔE)) term.",
        ja: "定理 1 はクーロン演算子を対角化する基底（平面波の双対基底）での電子状態に対するものです。O((λ/ΔE)·log(N/ΔE)) の項は省かれています。",
      },
      missing: missing(params, ["lambda", "deltaE", "orbitals"]),
    });
    const logicalQubits = line({
      id: "babbush-qubits",
      label: { en: "Logical qubits: system plus ancillas", ja: "論理量子ビット（系＋補助）" },
      value: qpeReady && N !== null ? N + Math.ceil(lg((4 * Math.SQRT2 * Math.PI * lambda ** 3 * N ** 5) / dE ** 3)) : null,
      unit: U.logicalQubits,
      formula: "N + log₂(4·√2·π·λ³·N⁵ / ΔE³)",
      kind: "leading-order",
      source: "babbush2018-ancilla",
      note: { en: "Eq. (55) counts the ancillas up to an additive O(1) the paper says can usually be neglected.", ja: "式 (55) は補助量子ビットを、通常は無視できると論文が述べる O(1) の加算を除いて数えています。" },
      missing: missing(params, ["lambda", "deltaE", "orbitals"]),
    });
    report.lines.push(register, queries, tGates, logicalQubits);
    report.logical = { logicalQubits, toffolis: null, tGates, queries };
  } else if (rootId === "variational-ground-state") {
    const shots = line({
      id: "wecker-measurements",
      label: { en: "Measurements for one energy estimate", ja: "エネルギー 1 回の推定に必要な測定" },
      value: vqeShots,
      unit: U.measurements,
      formula: "(Σ|hᵢ|)² / ε²  =  λ² / ΔE²",
      kind: "leading-order",
      source: "wecker-measurements",
      note: { en: "Per evaluation. The optimiser repeats it at every step, and no paper here bounds the number of steps.", ja: "評価 1 回あたりです。最適化は各ステップでこれを繰り返し、そのステップ数を見積もる論文はここにはありません。" },
      missing: missing(params, ["lambda", "deltaE"]),
    });
    report.lines.push(shots);
    report.lines.push(
      line({
        id: "vqe-qubits",
        label: { en: "Qubits", ja: "量子ビット" },
        value: N,
        unit: U.qubits,
        formula: "N",
        kind: "derived",
        source: null,
        note: { en: "One per spin-orbital under the usual encodings.", ja: "一般的な符号化ではスピン軌道 1 つにつき 1 つです。" },
        missing: missing(params, ["orbitals"]),
      }),
    );
    report.logical = { ...EMPTY_LOGICAL, queries: shots };
  } else {
    report.notes.push({ en: "No numeric model here for the block you chose. Its cost is stated on its card.", ja: "選んだブロックの数値モデルはここにはありません。コストはカードに記載されています。" });
  }
  if (qpeQueries !== null && vqeShots !== null) {
    report.suggestions.push({
      id: "vqe-versus-qpe",
      title: { en: "Phase estimation against VQE, at your λ and ΔE", ja: "あなたの λ と ΔE での、位相推定と VQE の比較" },
      body: {
        en: `Phase estimation on the qubitized walk makes at most ${formatPlain(qpeQueries)} select calls, once. One VQE energy estimate needs about ${formatPlain(vqeShots)} measurements, and the optimiser asks for one at every step. Halving ΔE doubles the first and quadruples the second.`,
        ja: `量子ビット化したウォークの位相推定では select の呼び出しは多くても ${formatPlain(qpeQueries)} 回で、1 回で済みます。VQE ではエネルギー 1 回の推定に約 ${formatPlain(vqeShots)} 回の測定が必要で、最適化の各ステップで繰り返します。ΔE を半分にすると前者は 2 倍、後者は 4 倍になります。`,
      },
      source: "wecker-measurements",
    });
    report.suggestions.push({
      id: "lower-lambda",
      title: { en: "A smaller λ lowers both costs", ja: "λ を小さくすると両方のコストが下がります" },
      body: {
        en: "Both counts grow with λ, the phase-estimation count linearly and the VQE count as its square. How the Hamiltonian is written sets λ, so compare the block-encodings the Atlas lists before choosing one.",
        ja: "どちらの回数も λ とともに増え、位相推定は λ に比例し、VQE は λ の 2 乗に比例します。λ はハミルトニアンの書き方で決まるので、アトラスにあるブロック符号化を比べてから選んでください。",
      },
      source: "babbush2018-queries",
      swapTo: { capability: "block-encode-matrix", method: "thc-block-encoding" },
    });
  }
  return report;
}

// ---------------------------------------------------------------------------

function hamiltonianSimulationCosts(params: ParamValues, root: Stage | null): CostReport {
  const report: CostReport = { lines: [], classical: [], published: [], logical: { ...EMPTY_LOGICAL }, suggestions: [], notes: [] };
  const lambda = value(params, "lambda");
  const t = value(params, "time");
  if (root?.method?.id === "qubitization-simulation") {
    report.lines.push(
      line({
        id: "qubitization-leading",
        label: { en: "Leading term of the query bound, λt", ja: "問い合わせ回数の上界の主要項 λt" },
        value: lambda !== null && t !== null ? lambda * t : null,
        unit: U.none,
        formula: "O(λt + log(1/ε))",
        kind: "scaling",
        source: "lowchuang-queries",
        note: {
          en: "The size of the term the bound grows with. Corollary 16 states no constant, so this is not a query count.",
          ja: "上界が比例して増える項の大きさです。系 16 は定数を示していないので、これは問い合わせ回数ではありません。",
        },
        missing: missing(params, ["lambda", "time"]),
      }),
    );
    // A `scaling` line's value is a magnitude, not a count: keep it out of the logical summary on purpose.
  } else {
    report.notes.push({ en: "The block you chose has its cost stated on its card. There is no numeric model for it here.", ja: "選んだブロックのコストはカードに記載されています。ここには数値モデルはありません。" });
  }
  report.suggestions.push({
    id: "trotter-in-studio",
    title: { en: "See step-size error on a small chain in Studio", ja: "Studio の小さな鎖でステップ幅の誤差を見る" },
    body: {
      en: "The 4-spin Trotter example runs in the browser. Sweep the step angle with Studio's parameter sweep and watch the result move, before committing to a method at full size.",
      ja: "4 スピンのトロッター例はブラウザで動きます。本番サイズで手法を決める前に、Studio のパラメータスイープでステップ角を動かし、結果の変化を確かめてください。",
    },
    source: null,
  });
  return report;
}

// ---------------------------------------------------------------------------

function linearSystemCosts(params: ParamValues, root: Stage | null): CostReport {
  const report: CostReport = { lines: [], classical: [], published: [], logical: { ...EMPTY_LOGICAL }, suggestions: [], notes: [] };
  const kappa = value(params, "kappa");
  const eps = value(params, "epsilon");
  if (root?.method?.id === "discrete-adiabatic-inversion") {
    const steps = line({
      id: "costa-steps",
      label: { en: "Adiabatic walk steps, per attempt", ja: "断熱ウォークのステップ数（1 回の試行あたり）" },
      value: kappa !== null ? 834 * kappa : null,
      unit: U.steps,
      formula: "≈ 834κ",
      kind: "numerical-estimate",
      source: "costa-constant",
      note: {
        en: "The paper's constant from a numerically computed bound, for Hermitian positive-definite A. About two attempts are needed on average, and a filtering stage adds order κ·ln(2/ε).",
        ja: "エルミートかつ正定値の A について、論文が数値的に求めた上界からの定数です。平均で約 2 回の試行が必要で、フィルタリングの段階が κ·ln(2/ε) 程度を加えます。",
      },
      missing: missing(params, ["kappa"]),
    });
    report.lines.push(steps);
    report.lines.push(
      line({
        id: "costa-filter",
        label: { en: "Filtering factor ln(2/ε)", ja: "フィルタリングの係数 ln(2/ε)" },
        value: eps !== null ? Math.log(2 / eps) : null,
        unit: U.none,
        formula: "ln(2/ε)",
        kind: "derived",
        source: "costa-constant",
        note: { en: "The paper's own example: about 20 at ε = 10⁻⁹.", ja: "論文自身の例では、ε = 10⁻⁹ で約 20 です。" },
        missing: missing(params, ["epsilon"]),
      }),
    );
    const perStep = value(params, "stepToffolis");
    let toffolis: CostLine | null = null;
    if (perStep !== null) {
      toffolis = line({
        id: "costa-toffolis",
        label: { en: "Toffoli gates in the adiabatic stage", ja: "断熱段階の Toffoli ゲート" },
        value: kappa !== null ? 834 * kappa * perStep : null,
        unit: U.toffolis,
        formula: "834κ × Toffolis per step",
        kind: "supplied",
        source: "costa-constant",
        note: { en: "One attempt, adiabatic stage only.", ja: "1 回の試行の、断熱段階だけです。" },
        missing: missing(params, ["kappa"]),
      });
      report.lines.push(toffolis);
    }
    report.logical = { ...EMPTY_LOGICAL, queries: steps, toffolis };
  } else {
    report.notes.push({ en: "The numbers here are for the discrete adiabatic solver. The block you chose has its cost stated on its card.", ja: "ここの数値は離散断熱法のものです。選んだブロックのコストはカードに記載されています。" });
  }
  if (kappa !== null) {
    report.suggestions.push({
      id: "kappa-dominates",
      title: { en: "The condition number sets the cost", ja: "コストを決めるのは条件数です" },
      body: {
        en: `HHL's runtime grows as κ², the discrete adiabatic solver's as κ·log(1/ε), which is optimal. At κ = ${formatPlain(kappa)} that is a factor of ${formatPlain(kappa)} in κ alone, before constants HHL does not state. Preconditioning that lowers κ helps every solver.`,
        ja: `HHL の実行時間は κ² で、離散断熱法は最適な κ·log(1/ε) で増えます。κ = ${formatPlain(kappa)} では、HHL が示していない定数を除いても κ だけで ${formatPlain(kappa)} 倍の差です。κ を下げる前処理はどの解法にも効きます。`,
      },
      source: "hhl-runtime",
      swapTo: { capability: "quantum-linear-solve", method: "discrete-adiabatic-inversion" },
    });
  }
  report.suggestions.push({
    id: "solution-is-a-state",
    title: { en: "The answer is a quantum state, not the vector", ja: "答えはベクトルではなく量子状態です" },
    body: {
      en: "The solver returns a state proportional to x. Reading a number out of it is another block, observable estimation, and its repetitions multiply everything above.",
      ja: "解法が返すのは x に比例する状態です。そこから数値を読み出すのは別のブロック（観測量の推定）で、その繰り返しが上のすべてに掛かります。",
    },
    source: "costa-optimal",
  });
  return report;
}

// ---------------------------------------------------------------------------

function maxcutCosts(params: ParamValues, root: Stage | null): CostReport {
  const report: CostReport = { lines: [], classical: [], published: [], logical: { ...EMPTY_LOGICAL }, suggestions: [], notes: [] };
  if (root?.method?.id !== "qaoa-cost-mixer-alternation") {
    report.notes.push({ en: "The gate counts here are for QAOA. The block you chose has its cost stated on its card.", ja: "ここのゲート数は QAOA のものです。選んだブロックのコストはカードに記載されています。" });
    return report;
  }
  const n = value(params, "nodes");
  const edges = value(params, "edges");
  const p = value(params, "layers");
  const qubits = line({ id: "qaoa-qubits", label: { en: "Qubits", ja: "量子ビット" }, value: n, unit: U.qubits, formula: "n", kind: "exact", source: "farhi-qaoa", missing: missing(params, ["nodes"]) });
  const twoQubit = line({
    id: "qaoa-two-qubit",
    label: { en: "Two-qubit cost phases", ja: "2 量子ビットのコスト位相" },
    value: edges !== null && p !== null ? p * edges : null,
    unit: U.gates,
    formula: "p·|E|",
    kind: "exact",
    source: "farhi-qaoa",
    note: { en: "U(C,γ) is one ZZ phase per edge, applied once per layer.", ja: "U(C,γ) は辺ごとに 1 つの ZZ 位相で、各層に 1 回かけます。" },
    missing: missing(params, ["edges", "layers"]),
    counts: { ops: ["RZZ"], note: "one RZZ per edge, per layer — Farhi et al.'s U(C,γ). Leona's qaoa_maxcut_layer block builds exactly one layer's worth." },
  });
  const oneQubit = line({
    id: "qaoa-mixer",
    label: { en: "Single-qubit gates (start and mixers)", ja: "1 量子ビットゲート（初期化とミキサー）" },
    value: n !== null && p !== null ? n + p * n : null,
    unit: U.gates,
    formula: "n + p·n",
    kind: "exact",
    source: "farhi-qaoa",
    note: { en: "n Hadamards for |s⟩, then U(B,β) is one X rotation per node per layer.", ja: "|s⟩ のためのアダマール n 個と、各層で頂点ごとに 1 つの X 回転 U(B,β) です。" },
    missing: missing(params, ["nodes", "layers"]),
    counts: {
      ops: ["H", "RX"],
      note: "n Hadamards preparing |s⟩ plus one RX(2β) per node per layer — Farhi et al.'s U(B,β). Leona's qaoa_maxcut_layer block builds only the mixer's RX rotations; the initial |s⟩ layer is a separate hadamard_layer block — see block-audit.ts.",
    },
  });
  report.lines.push(qubits, twoQubit, oneQubit);
  report.logical = { ...EMPTY_LOGICAL, logicalQubits: qubits };
  report.suggestions.push(
    {
      id: "qaoa-sweep",
      title: { en: "Find good angles on a small graph first", ja: "まず小さなグラフでよい角度を探す" },
      body: {
        en: "The 4-node example runs in Studio. Its parameter sweep scans γ and β and shows the cut distribution at each point, which is the loop the optimiser will run on hardware.",
        ja: "4 頂点の例は Studio で動きます。パラメータスイープで γ と β を走査し、各点でのカットの分布を確認できます。これはハードウェア上で最適化が回すループと同じです。",
      },
      source: null,
    },
    {
      id: "qaoa-mitigation",
      title: { en: "On today's hardware, correct the readout", ja: "現行のハードウェアでは読み出しを補正する" },
      body: {
        en: "QAOA runs without error correction, so noise lands in the answer. Studio's hardware page offers readout correction and zero-noise extrapolation, and the Atlas lists the mitigation methods with their costs.",
        ja: "QAOA は誤り訂正なしで動くので、ノイズが答えに直接入ります。Studio のハードウェアページには読み出し補正とゼロノイズ外挿があり、アトラスには緩和手法とそのコストが載っています。",
      },
      source: null,
      swapTo: { capability: "error-mitigation", method: "zero-noise-extrapolation" },
    },
  );
  return report;
}

// ---------------------------------------------------------------------------

/** Smallest M with π/M + π²/M² ≤ ε: Theorem 12 at k = 1 in its worst case, a = 1/2. */
export function amplitudeEstimationEvaluations(epsilon: number): number {
  return Math.ceil((Math.PI * (1 + Math.sqrt(1 + 4 * epsilon))) / (2 * epsilon));
}

/** Chebyshev: samples so a mean of Bernoulli draws is within ε with probability 8/π². */
export function chebyshevSamples(epsilon: number): number {
  return Math.ceil(1 / (4 * epsilon ** 2 * (1 - 8 / Math.PI ** 2)));
}

function amplitudeEstimationCosts(params: ParamValues, root: Stage | null): CostReport {
  const report: CostReport = { lines: [], classical: [], published: [], logical: { ...EMPTY_LOGICAL }, suggestions: [], notes: [] };
  const eps = value(params, "epsilon");
  const needs = missing(params, ["epsilon"]);
  const classical = line({
    id: "chebyshev-samples",
    label: { en: "Samples for the same accuracy by plain sampling", ja: "単純なサンプリングで同じ精度に必要な回数" },
    value: eps !== null ? chebyshevSamples(eps) : null,
    unit: U.samples,
    formula: "⌈1 / (4ε²·(1 − 8/π²))⌉",
    kind: "derived",
    source: null,
    note: { en: "Chebyshev's inequality at the same 8/π² ≈ 81% confidence, worst case a = 1/2.", ja: "同じ 8/π² ≈ 81% の信頼度で、最悪の場合 a = 1/2 に対するチェビシェフの不等式によります。" },
    missing: needs,
  });
  report.classical.push(classical);
  if (root?.method?.id === "amplitude-estimation-readout") {
    const M = eps !== null ? amplitudeEstimationEvaluations(eps) : null;
    const evaluations = line({
      id: "brassard-evaluations",
      label: { en: "Evaluations of the state-preparation circuit", ja: "状態準備回路の評価回数" },
      value: M,
      unit: U.queries,
      formula: "smallest M with π/M + π²/M² ≤ ε",
      kind: "derived",
      source: "brassard-estimation",
      note: { en: "Theorem 12 with k = 1 at its worst case a = 1/2; succeeds with probability at least 8/π².", ja: "定理 12 を k = 1、最悪の場合 a = 1/2 で使ったものです。成功確率は 8/π² 以上です。" },
      missing: needs,
    });
    const register = line({
      id: "brassard-register",
      label: { en: "Counting-register qubits", ja: "カウント用レジスタの量子ビット" },
      value: M !== null ? Math.ceil(lg(M)) : null,
      unit: U.qubits,
      formula: "⌈log₂ M⌉",
      kind: "derived",
      source: "brassard-estimation",
      missing: needs,
    });
    report.lines.push(evaluations, register);
    report.logical = { ...EMPTY_LOGICAL, queries: evaluations };
    if (M !== null && classical.value !== null) {
      report.suggestions.push({
        id: "estimation-versus-sampling",
        title: { en: "What amplitude estimation saves at your ε", ja: "あなたの ε で振幅推定が節約するもの" },
        body: {
          en: `${formatPlain(M)} evaluations against ${formatPlain(classical.value)} samples, about ${formatPlain(classical.value / M)}× fewer. The saving grows as 1/ε, but each evaluation is a longer, coherent circuit, which today's hardware may not hold.`,
          ja: `評価 ${formatPlain(M)} 回に対してサンプル ${formatPlain(classical.value)} 回で、約 ${formatPlain(classical.value / M)} 分の 1 です。節約は 1/ε で増えますが、評価 1 回はより長いコヒーレントな回路で、現行のハードウェアでは保てないかもしれません。`,
        },
        source: "brassard-estimation",
      });
    }
  } else if (root?.method?.id !== "direct-sampling-readout") {
    report.notes.push({ en: "The block you chose has its cost stated on its card. There is no numeric model for it here.", ja: "選んだブロックのコストはカードに記載されています。ここには数値モデルはありません。" });
  }
  return report;
}

// ---------------------------------------------------------------------------

function phaseEstimationCosts(params: ParamValues, root: Stage | null): CostReport {
  const report: CostReport = { lines: [], classical: [], published: [], logical: { ...EMPTY_LOGICAL }, suggestions: [], notes: [] };
  if (root?.method?.id !== "register-phase-estimation") {
    report.notes.push({ en: "The numbers here are for phase estimation with a register. The block you chose has its cost stated on its card.", ja: "ここの数値はレジスタを使う位相推定のものです。選んだブロックのコストはカードに記載されています。" });
    return report;
  }
  const n = value(params, "precisionBits");
  const eps = value(params, "failureProbability");
  const needs = missing(params, ["precisionBits", "failureProbability"]);
  const m = n !== null && eps !== null ? n + Math.ceil(lg(1 / (2 * eps) + 1 / 2)) : null;
  const register = line({ id: "cemm-register", label: { en: "Counting qubits (m)", ja: "カウント用量子ビット (m)" }, value: m, unit: U.qubits, formula: "n + ⌈log₂(1/(2ε) + 1/2)⌉", kind: "exact", source: "cemm-counting-register", missing: needs });
  const uses = line({
    id: "cemm-uses",
    label: { en: "Applications of U", ja: "U の適用回数" },
    value: m !== null ? 2 ** m - 1 : null,
    unit: U.queries,
    formula: "2^m − 1",
    kind: "derived",
    source: "cemm-counting-register",
    note: { en: "The controlled powers U^(2^k), k = 0 … m−1, each built from repeated U.", ja: "制御付きべき乗 U^(2^k)（k = 0 … m−1）を、それぞれ U の繰り返しで作った場合です。" },
    missing: needs,
  });
  const qft = line({
    id: "cemm-qft",
    label: { en: "Gates in the inverse Fourier transform", ja: "逆フーリエ変換のゲート数" },
    value: m !== null ? m + (m * (m - 1)) / 2 : null,
    unit: U.gates,
    formula: "m + m(m − 1)/2",
    kind: "derived",
    source: "cemm-counting-register",
    note: { en: "m Hadamards and m(m−1)/2 controlled phase rotations, counted from the network the paper draws.", ja: "論文の回路図から数えた、アダマール m 個と制御位相回転 m(m−1)/2 個です。" },
    missing: needs,
    counts: {
      ops: ["H", "CP"],
      note: "the network the source draws for the inverse QFT: m Hadamards, m(m−1)/2 controlled-phase rotations. It does not include the network's own final swap step (Leona's qft_inverse block adds ⌊m/2⌋ SWAPs to reorder the output register) — see block-audit.ts.",
    },
  });
  report.lines.push(register, uses, qft);
  report.logical = { ...EMPTY_LOGICAL, logicalQubits: register, queries: uses };
  return report;
}

// ---------------------------------------------------------------------------

const NO_MODEL: Bilingual = {
  en: "No numeric cost model for this problem yet. Each block below shows its cost as its source states it.",
  ja: "この問題にはまだ数値のコストモデルがありません。下の各ブロックに、出典が述べるコストを示しています。",
};

export function costReport(problem: ProblemId, params: ParamValues, root: Stage | null): CostReport {
  switch (problem) {
    case "search":
      return searchCosts(params, root);
    case "factoring":
      return factoringCosts(params, root);
    case "ecdlp":
      return ecdlpCosts(params, root);
    case "ground-state":
      return groundStateCosts(params, root);
    case "hamiltonian-simulation":
      return hamiltonianSimulationCosts(params, root);
    case "linear-system":
      return linearSystemCosts(params, root);
    case "maxcut":
      return maxcutCosts(params, root);
    case "amplitude-estimation":
      return amplitudeEstimationCosts(params, root);
    case "phase-estimation":
      return phaseEstimationCosts(params, root);
    case "linear-ode":
    case "nonlinear-ode":
      return { lines: [], classical: [], published: [], logical: { ...EMPTY_LOGICAL }, suggestions: [], notes: [NO_MODEL] };
  }
}

// ---------------------------------------------------------------------------
// Formatting, shared with the page so a number in a sentence and in the table read the same.

const SUPERSCRIPT: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/** `1,048,576`, `2.62 × 10⁹`, `0.0016`, `81%`-free: probabilities are printed by the caller. */
export function formatPlain(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e7 || abs < 1e-3)) {
    const exponent = Math.floor(Math.log10(abs));
    const mantissa = value / 10 ** exponent;
    const digits = mantissa.toFixed(2).replace(/\.?0+$/, "");
    const sup = String(exponent).split("").map((c) => SUPERSCRIPT[c] ?? c).join("");
    return `${digits} × 10${sup}`;
  }
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  if (abs >= 100) return Math.round(value).toLocaleString("en-US");
  return String(Number(value.toPrecision(3)));
}
