// The problems the planner can recognise from a sentence, and what each one
// starts from in the Atlas's layer graph.
//
// A problem is a CAPABILITY in `../repository/layer-graph.ts` — the thing the
// reader wants done — plus the parameters its cost depends on. The workflow
// itself is not written here: it is read out of the graph by `./assemble.ts`,
// which is the point. The graph already says which methods realise a
// capability and which smaller capabilities each method needs, so a workflow is
// a walk down that containment, and swapping a block is choosing a different
// method for one capability on the walk. Nothing here duplicates that.
//
// `preferredMethods` only orders the choice at the root; every method that
// realises the capability stays selectable. `workedExample` is a Studio worked
// example (`../worked-examples.ts`) that builds a small instance of the same
// algorithm, asserted to exist by `workflow-planner.test.ts`.
import type { Bilingual, ParamSpec, ProblemId } from "./types.ts";

export interface KeywordRule {
  pattern: RegExp;
  weight: number;
}

export interface ProblemClass {
  id: ProblemId;
  label: Bilingual;
  /** Root capability id in the layer graph. */
  capability: string;
  preferredMethods: string[];
  /**
   * Below the root, the method to start a capability on when the parent's own
   * source names none (`via`), with the reason the page prints. Used where a
   * cost model below applies only to one construction, so the default is the
   * construction the numbers are for, and says so.
   */
  stepDefaults?: Readonly<Record<string, { method: string; reason: Bilingual }>>;
  keywords: KeywordRule[];
  params: ParamSpec[];
  workedExample: string | null;
  example: Bilingual;
}

const EPSILON_HINT: Bilingual = {
  en: "The error you can accept in the answer.",
  ja: "答えに許容できる誤差です。",
};

export const PROBLEMS: readonly ProblemClass[] = [
  {
    id: "search",
    label: { en: "Search for an item a check accepts", ja: "チェックが受理する項目の探索" },
    capability: "marked-item-search",
    preferredMethods: ["grover-fixed-iteration-search"],
    keywords: [
      { pattern: /\bunstructured search\b|\bgrover\b/i, weight: 3 },
      { pattern: /\b(search|find|look ?up)\b[^.]{0,40}\b(database|list|table|items?|entries|keys?|candidates?|space)\b/i, weight: 2 },
      { pattern: /\b(marked items?|needle in a haystack|satisfying assignment|brute[- ]force|password|preimage)\b/i, weight: 2 },
      { pattern: /探索|検索|グローバー|総当たり/, weight: 2 },
      { pattern: /(データベース|リスト|表|候補)[^。]{0,40}(探し|探す|見つけ)/, weight: 2 },
    ],
    params: [
      {
        key: "domainSize",
        label: { en: "Items to search (N)", ja: "探索する項目数 (N)" },
        hint: { en: "How many candidates the check could be asked about.", ja: "チェックにかけうる候補の総数です。" },
        min: 2,
        max: 1e30,
        integer: true,
      },
      {
        key: "markedCount",
        label: { en: "Items the check accepts (M)", ja: "受理される項目数 (M)" },
        hint: { en: "How many candidates pass. If you do not know, see the suggestion below.", ja: "条件を満たす候補の数です。不明な場合は下の提案を見てください。" },
        min: 1,
        max: 1e30,
        integer: true,
        assumed: {
          value: 1,
          reason: { en: "Grover's paper assumes exactly one accepted item.", ja: "Grover の論文は受理される項目がちょうど一つだと仮定しています。" },
          source: "grover-unique",
        },
      },
      {
        key: "oracleToffolis",
        label: { en: "Toffoli gates in one check (optional)", ja: "チェック 1 回の Toffoli ゲート数（任意）" },
        hint: {
          en: "The check is your circuit, so its cost is yours to state. With it, the plan can total the Toffoli count.",
          ja: "チェックはあなたの回路なので、そのコストはあなたが決めます。入力すると Toffoli 数の合計を出せます。",
        },
        min: 0,
        max: 1e15,
        integer: true,
      },
    ],
    workedExample: "grover-3q-101",
    example: {
      en: "Search a database of one million records for the single record that matches.",
      ja: "100 万件のデータベースから、条件に合う 1 件を探したい。",
    },
  },
  {
    id: "factoring",
    label: { en: "Factor an integer (RSA)", ja: "整数の素因数分解（RSA）" },
    capability: "hidden-period-finding",
    preferredMethods: ["cyclic-period-finding"],
    keywords: [
      { pattern: /\bRSA\b|\bshor\b/i, weight: 3 },
      { pattern: /\bfactor(ing|ise|ize|isation|ization)?\b[^.]{0,30}\b(integer|number|modulus|key|semiprime|bit)/i, weight: 3 },
      { pattern: /\bprime factors?\b|\bfactori[sz]e\b/i, weight: 2 },
      { pattern: /素因数分解|因数分解|ショア/, weight: 3 },
    ],
    params: [
      {
        key: "bits",
        label: { en: "Size of the number (bits)", ja: "整数のサイズ（ビット）" },
        hint: { en: "RSA-2048 is a 2048-bit modulus.", ja: "RSA-2048 の法は 2048 ビットです。" },
        min: 8,
        max: 16384,
        integer: true,
        assumed: {
          value: 2048,
          reason: { en: "The size both headline estimates are for.", ja: "代表的な二つの見積もりが対象としているサイズです。" },
          source: "gidney2025-headline",
        },
      },
    ],
    workedExample: "shor-order-finding-15",
    example: { en: "Factor a 2048-bit RSA modulus.", ja: "2048 ビットの RSA 法を素因数分解したい。" },
  },
  {
    id: "ecdlp",
    label: { en: "Break an elliptic-curve key (discrete logarithm)", ja: "楕円曲線暗号の鍵を解く（離散対数）" },
    capability: "hidden-period-finding",
    preferredMethods: ["cyclic-period-finding"],
    keywords: [
      { pattern: /\belliptic[- ]curve|\bECDLP\b|\bECDSA\b|\bECC\b|\bsecp\d{3}[rk]1\b|\bP-(192|224|256|384|521)\b|\bed25519\b|\bcurve25519\b/i, weight: 4 },
      { pattern: /\bdiscrete log(arithm)?s?\b/i, weight: 2 },
      { pattern: /楕円曲線|離散対数/, weight: 4 },
    ],
    params: [
      {
        key: "bits",
        label: { en: "Size of the prime field (bits)", ja: "素体のサイズ（ビット）" },
        hint: { en: "P-256 and secp256k1 are defined over 256-bit prime fields.", ja: "P-256 と secp256k1 は 256 ビットの素体上で定義されています。" },
        min: 8,
        max: 1024,
        integer: true,
        assumed: {
          value: 256,
          reason: { en: "The field size of P-256 and secp256k1.", ja: "P-256 と secp256k1 の素体のサイズです。" },
        },
      },
    ],
    workedExample: null,
    example: { en: "Recover a secp256k1 private key from its public key.", ja: "secp256k1 の公開鍵から秘密鍵を求めたい。" },
  },
  {
    id: "ground-state",
    label: { en: "Ground-state energy of a molecule or material", ja: "分子・物質の基底状態エネルギー" },
    capability: "ground-state-energy",
    preferredMethods: ["phase-estimation-ground-state", "variational-ground-state"],
    stepDefaults: {
      "hamiltonian-simulation": {
        method: "qubitization-simulation",
        reason: {
          en: "The walk Babbush et al. phase-estimate, so their query and T counts below apply.",
          ja: "Babbush らが位相推定するウォークです。下の問い合わせ数と T 数はこの構成のものです。",
        },
      },
    },
    keywords: [
      { pattern: /\bground[- ]state\b|\bVQE\b|\bFeMoco\b/i, weight: 3 },
      { pattern: /\b(molecul(e|ar)|chemistry|electronic structure|spin[- ]orbitals?|hartree|chemical accuracy|binding energy|catalyst)\b/i, weight: 2 },
      { pattern: /基底状態|分子|量子化学|電子状態|化学精度/, weight: 3 },
    ],
    params: [
      {
        key: "lambda",
        label: { en: "λ, the sum of |coefficients|", ja: "λ（係数の絶対値の和）" },
        hint: {
          en: "Write the Hamiltonian as a sum of Pauli strings; λ adds up the absolute values of their coefficients. Both costs below grow with it.",
          ja: "ハミルトニアンをパウリ列の和で書いたときの、係数の絶対値の合計です。下のどちらのコストもこれに比例して増えます。",
        },
        unit: { en: "Ha", ja: "Ha" },
        min: 1e-6,
        max: 1e12,
        integer: false,
      },
      {
        key: "deltaE",
        label: { en: "Target precision ΔE", ja: "目標精度 ΔE" },
        hint: EPSILON_HINT,
        unit: { en: "Ha", ja: "Ha" },
        min: 1e-12,
        max: 10,
        integer: false,
        assumed: {
          value: 0.0016,
          reason: { en: "Chemical accuracy, 0.0016 hartree, as Babbush et al. define it.", ja: "Babbush らの定義による化学精度 0.0016 ハートリーです。" },
          source: "babbush2018-chemical-accuracy",
        },
      },
      {
        key: "orbitals",
        label: { en: "Spin-orbitals (N)", ja: "スピン軌道の数 (N)" },
        hint: { en: "One qubit per spin-orbital in the usual encodings.", ja: "一般的な符号化では、スピン軌道 1 つにつき 1 量子ビットです。" },
        min: 2,
        max: 1e6,
        integer: true,
      },
    ],
    workedExample: "vqe-2q-transverse-ising",
    example: {
      en: "Ground-state energy of a molecule with 100 spin-orbitals and λ = 500 hartree, to chemical accuracy.",
      ja: "スピン軌道 100 個、λ = 500 ハートリーの分子の基底状態エネルギーを化学精度で求めたい。",
    },
  },
  {
    id: "hamiltonian-simulation",
    label: { en: "Simulate how a quantum system evolves in time", ja: "量子系の時間発展のシミュレーション" },
    capability: "hamiltonian-simulation",
    preferredMethods: ["qubitization-simulation", "product-formula-simulation", "lcu-taylor-simulation"],
    keywords: [
      { pattern: /\btime[- ]evolution\b|\bhamiltonian simulation\b|\btrotter/i, weight: 3 },
      { pattern: /\b(simulat(e|ion)|evolv(e|ing))\b[^.]{0,40}\b(dynamics|spin chain|heisenberg|ising|hubbard|lattice|quench|over time|for time)\b/i, weight: 3 },
      { pattern: /\b(quantum dynamics|spin dynamics|real[- ]time evolution)\b/i, weight: 2 },
      { pattern: /時間発展|ダイナミクス|ハミルトニアンシミュレーション|トロッター/, weight: 3 },
    ],
    params: [
      {
        key: "lambda",
        label: { en: "λ, the sum of |coefficients|", ja: "λ（係数の絶対値の和）" },
        hint: { en: "The same 1-norm the query count scales with.", ja: "問い合わせ回数が比例する 1-ノルムです。" },
        min: 1e-9,
        max: 1e12,
        integer: false,
      },
      {
        key: "time",
        label: { en: "Evolution time (t)", ja: "発展時間 (t)" },
        hint: { en: "In the Hamiltonian's own units.", ja: "ハミルトニアンと同じ単位系で指定します。" },
        min: 1e-9,
        max: 1e12,
        integer: false,
      },
      {
        key: "epsilon",
        label: { en: "Error (ε)", ja: "誤差 (ε)" },
        hint: EPSILON_HINT,
        min: 1e-15,
        max: 0.5,
        integer: false,
      },
    ],
    workedExample: "ising-trotter-4",
    example: {
      en: "Simulate a 100-spin Heisenberg chain for time t = 100.",
      ja: "100 スピンのハイゼンベルク鎖を時間 t = 100 まで時間発展させたい。",
    },
  },
  {
    id: "linear-system",
    label: { en: "Solve a linear system Ax = b", ja: "連立一次方程式 Ax = b を解く" },
    capability: "quantum-linear-solve",
    preferredMethods: ["discrete-adiabatic-inversion", "qsvt-matrix-inversion", "hhl-qpe-inversion"],
    keywords: [
      { pattern: /\bHHL\b|\bAx ?= ?b\b|\blinear systems? of equations\b|\bsystem of (linear )?equations\b/i, weight: 4 },
      { pattern: /\blinear (system|solve|solver)\b|\bmatrix inversion\b|\binvert (a|the) matrix\b|\bcondition number\b/i, weight: 3 },
      { pattern: /連立一次方程式|線形方程式|逆行列|条件数/, weight: 4 },
    ],
    params: [
      {
        key: "kappa",
        label: { en: "Condition number (κ)", ja: "条件数 (κ)" },
        hint: { en: "Largest over smallest singular value of A. Every solver's cost grows with it.", ja: "A の最大特異値と最小特異値の比です。どの解法のコストもこれに応じて増えます。" },
        min: 1,
        max: 1e15,
        integer: false,
      },
      {
        key: "epsilon",
        label: { en: "Error in the output state (ε)", ja: "出力状態の誤差 (ε)" },
        hint: EPSILON_HINT,
        min: 1e-15,
        max: 0.5,
        integer: false,
      },
      {
        key: "dimension",
        label: { en: "Size of the system (N unknowns)", ja: "未知数の数 (N)" },
        hint: { en: "Enters only as log N, through how A is accessed.", ja: "A へのアクセスを通じて log N としてのみ効きます。" },
        min: 2,
        max: 1e30,
        integer: true,
      },
      {
        key: "stepToffolis",
        label: { en: "Toffoli gates per walk step (optional)", ja: "ウォーク 1 ステップの Toffoli 数（任意）" },
        hint: {
          en: "One step queries the block-encoding of A once, and that circuit is yours. With it, the plan can total a Toffoli count.",
          ja: "1 ステップで A のブロック符号化を 1 回呼びます。その回路はあなたのものです。入力すると Toffoli 数の合計を出せます。",
        },
        min: 0,
        max: 1e15,
        integer: true,
      },
    ],
    workedExample: null,
    example: {
      en: "Solve a sparse linear system with 2^30 unknowns and condition number κ = 1000 to ε = 0.001.",
      ja: "未知数 2^30 個、条件数 κ = 1000 の疎な連立一次方程式を誤差 0.001 で解きたい。",
    },
  },
  {
    id: "maxcut",
    label: { en: "Combinatorial optimisation (MaxCut, QUBO)", ja: "組合せ最適化（最大カット、QUBO）" },
    capability: "combinatorial-optimization",
    preferredMethods: ["qaoa-cost-mixer-alternation", "adiabatic-hamiltonian-interpolation"],
    keywords: [
      { pattern: /\bmax[- ]?cut\b|\bQAOA\b|\bQUBO\b|\bising (formulation|model optimi[sz])/i, weight: 4 },
      { pattern: /\bcombinatorial optimi[sz]ation\b|\bgraph partition|\btravell?ing salesman\b|\bportfolio optimi[sz]ation\b|\bscheduling problem\b/i, weight: 3 },
      { pattern: /最大カット|組合せ最適化|ポートフォリオ最適化/, weight: 4 },
    ],
    params: [
      {
        key: "nodes",
        label: { en: "Nodes in the graph (n)", ja: "グラフの頂点数 (n)" },
        hint: { en: "One qubit per node.", ja: "頂点 1 つにつき 1 量子ビットです。" },
        min: 2,
        max: 1e6,
        integer: true,
      },
      {
        key: "edges",
        label: { en: "Edges (|E|)", ja: "辺の数 (|E|)" },
        hint: { en: "For a d-regular graph, |E| = n·d/2.", ja: "d-正則グラフなら |E| = n·d/2 です。" },
        min: 1,
        max: 1e12,
        integer: true,
      },
      {
        key: "layers",
        label: { en: "Layers (p)", ja: "層の数 (p)" },
        hint: { en: "Each layer applies the cost phase once and the mixer once.", ja: "各層でコスト位相とミキサーを 1 回ずつかけます。" },
        min: 1,
        max: 1000,
        integer: true,
        assumed: {
          value: 1,
          reason: { en: "The smallest depth. Raise it to see how the circuit grows.", ja: "最小の深さです。増やすと回路がどう大きくなるかがわかります。" },
        },
      },
    ],
    workedExample: "qaoa-maxcut-4-cycle",
    example: {
      en: "MaxCut on a 3-regular graph with 50 nodes using QAOA with p = 3.",
      ja: "頂点 50 個の 3-正則グラフの最大カットを、p = 3 の QAOA で解きたい。",
    },
  },
  {
    id: "amplitude-estimation",
    label: { en: "Estimate a probability or an average (Monte Carlo)", ja: "確率や平均値の推定（モンテカルロ）" },
    capability: "observable-estimation",
    preferredMethods: ["amplitude-estimation-readout", "direct-sampling-readout"],
    keywords: [
      { pattern: /\bamplitude estimation\b|\bmonte carlo\b|\boption pric/i, weight: 4 },
      { pattern: /\b(expected value|mean estimation|estimate (a|the) (probability|mean|average)|value at risk|risk analysis|numerical integration)\b/i, weight: 3 },
      { pattern: /振幅推定|モンテカルロ|オプション価格|期待値/, weight: 4 },
    ],
    params: [
      {
        key: "epsilon",
        label: { en: "Additive error (ε)", ja: "加法誤差 (ε)" },
        hint: { en: "How close the estimate must be to the true probability.", ja: "推定値が真の確率にどれだけ近ければよいかです。" },
        min: 1e-12,
        max: 0.5,
        integer: false,
      },
    ],
    workedExample: "amplitude-estimation-3",
    example: {
      en: "Price an option by Monte Carlo to within 0.001.",
      ja: "オプション価格をモンテカルロ法で誤差 0.001 以内で求めたい。",
    },
  },
  {
    id: "phase-estimation",
    label: { en: "Estimate an eigenphase of a unitary", ja: "ユニタリの固有位相の推定" },
    capability: "phase-estimation",
    preferredMethods: ["register-phase-estimation", "single-ancilla-phase-estimation"],
    keywords: [
      { pattern: /\bphase estimation\b|\bQPE\b|\beigenphase\b/i, weight: 4 },
      { pattern: /\beigenvalue of (a|the) unitary\b/i, weight: 3 },
      { pattern: /位相推定|固有位相/, weight: 4 },
    ],
    params: [
      {
        key: "precisionBits",
        label: { en: "Bits of precision (n)", ja: "精度のビット数 (n)" },
        hint: { en: "The phase to within 1/2^(n+1).", ja: "位相を 1/2^(n+1) 以内で求めます。" },
        min: 1,
        max: 64,
        integer: true,
      },
      {
        key: "failureProbability",
        label: { en: "Allowed failure probability", ja: "許容する失敗確率" },
        hint: { en: "The chance the estimate misses by more than that.", ja: "推定がそれ以上外れる確率です。" },
        min: 1e-15,
        max: 0.5,
        integer: false,
        assumed: {
          value: 0.01,
          reason: { en: "A round number the planner chose, not a source. Change it.", ja: "出典ではなく、プランナーが選んだ切りのよい値です。変更してください。" },
        },
      },
    ],
    workedExample: null,
    example: {
      en: "Estimate the eigenphase of a unitary to 10 bits of precision with 99% confidence.",
      ja: "ユニタリの固有位相を 10 ビットの精度、信頼度 99% で推定したい。",
    },
  },
  {
    id: "linear-ode",
    label: { en: "Solve a linear differential equation", ja: "線形微分方程式を解く" },
    capability: "linear-ode-solve",
    preferredMethods: [],
    keywords: [
      { pattern: /\blinear (ODE|differential equation)s?\b|\bheat equation\b|\bdiffusion equation\b|\badvection\b|\bwave equation\b/i, weight: 3 },
      { pattern: /\b(ODE|PDE)s?\b|\bdifferential equations?\b/i, weight: 1 },
      { pattern: /線形微分方程式|熱方程式|拡散方程式|偏微分方程式/, weight: 3 },
    ],
    params: [],
    workedExample: null,
    example: { en: "Solve the heat equation on a fine grid.", ja: "細かい格子の上で熱方程式を解きたい。" },
  },
  {
    id: "nonlinear-ode",
    label: { en: "Solve a nonlinear differential equation", ja: "非線形微分方程式を解く" },
    capability: "nonlinear-ode-solve",
    preferredMethods: [],
    keywords: [
      { pattern: /\bnonlinear (ODE|differential|dynamics|system)|\bnavier[- ]stokes\b|\bburgers\b|\blorenz\b|\bcarleman\b|\b(reaction|enzyme) kinetics\b/i, weight: 4 },
      { pattern: /非線形|ナビエ|反応速度/, weight: 4 },
    ],
    params: [],
    workedExample: null,
    example: { en: "Simulate nonlinear enzyme kinetics with Carleman linearisation.", ja: "カーレマン線形化で非線形の酵素反応速度論を解きたい。" },
  },
];

export function problemById(id: string): ProblemClass | undefined {
  return PROBLEMS.find((problem) => problem.id === id);
}
