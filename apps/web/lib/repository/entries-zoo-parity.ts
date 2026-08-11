// Zoo-parity intake: catalog records for algorithms the Quantum Algorithm Zoo
// carries and this repository did not.
//
// ## Why this file exists
//
// The north-star direction is "expand the repository and the map until they
// match, and then beyond" (plans/atlas-revamp/NORTH-STAR.md, stage C). The
// repository half of that had never been measured against an outside index. It
// is now: `node scripts/check-zoo-parity.mjs` diffs the Zoo's own entry list
// against this catalog and prints covered / missing / not-applicable with the
// denominator, the same discipline `check-match-gauge.mjs` applies to the map
// half. The first reading, before this file, was **8 of 60 Zoo entries covered**.
//
// Two of the twelve records below close a gap that had been visible from the
// other side for weeks: the map has drawn `linear-ode-solve` and
// `nonlinear-ode-solve` — a whole region, tens of methods — while the repository
// held no record for either, so a reader who arrived from the catalog could not
// reach the region at all. Those two anchor; the other ten are repository-only,
// because inventing a map slot to hold a record is the failure the map-eligibility
// rules exist to prevent (see ./map-eligibility.ts).
//
// ## What a record here claims, and what it does not
//
// These are **literature records**: `language: "text"`, nothing runnable, and the
// verification prose says so. What was actually checked, per record, is:
//
//   1. the problem statement and speedup class against the Zoo's own entry text,
//   2. the primary reference's title, author list and v1 year against the arXiv
//      abs page (the verifiable-complete route — the API 503s from here),
//   3. the complexity claim against a clause of that paper's abstract, quoted in
//      `complexityBasis`.
//
// A record whose sources state no bound carries `complexity: ""` and says which
// source was read in `complexityBasis`. Correct-empty is a state a field holds on
// purpose here, exactly as in the linear-ODE `cost` backlog; a plausible bound
// written from memory is the failure mode this convention exists to refuse.
//
// Adding a record: append a concept below, add its paper to ./paper-register.ts
// FIRST (the citation checkers refuse an unregistered paper), give its family a
// rule in ./topics.ts if it has no existing one, and regenerate
// services/api/catalog_bootstrap/manifest.json in the same PR.
import { makeReferenceEntry } from "./factory";
import type { PublicRepositoryEntry } from "./types";

type ZooAlgorithm = {
  slug: string;
  title: string;
  titleJa: string;
  /** Must resolve to a rule in ./topics.ts — an entry with no role fails the build. */
  family: string;
  /** The Quantum Algorithm Zoo entry this record covers, verbatim. */
  zooName: string;
  zooSection: string;
  /** The Zoo's own speedup class for that entry, verbatim. */
  speedup: string;
  problem: string;
  problemJa: string;
  idea: string;
  ideaJa: string;
  /** Empty when the read sources state no bound — see `complexityBasis` for which were read. */
  complexity: string;
  complexityBasis: string;
  caveat: string;
  caveatJa: string;
  tags: string[];
  source: { id: string; title: string; authors: string; year: string; url: string };
  literature?: Array<{
    title: string;
    authors: string;
    year: string;
    url: string;
    relevance: string;
    relevanceJa: string;
  }>;
  relatedSlugs: string[];
};

const ZOO_ALGORITHMS: ZooAlgorithm[] = [
  {
    slug: "discrete-logarithm",
    title: "Discrete logarithm on a quantum computer",
    titleJa: "量子計算による離散対数問題",
    family: "Hidden-period / factoring",
    zooName: "Discrete-log",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Superpolynomial",
    problem: "Given three n-bit numbers a, b and N with the promise that b = a^s mod N for some s, recover the exponent s.",
    problemJa: "n ビットの整数 a, b, N が与えられ、ある s について b = a^s mod N が成り立つと約束されているとき、その指数 s を求める問題です。",
    idea: "Shor's paper gives efficient randomized quantum algorithms for two problems believed hard classically, integer factoring and discrete logarithms, and both take a number of steps polynomial in the input size. The Zoo entry points the reader to the abelian hidden subgroup problem, and it states that by similar techniques quantum computers can solve the discrete logarithm problem on elliptic curves, thereby breaking elliptic-curve cryptography. Roetteler, Naehrig, Svore and Lauter make that elliptic-curve variant concrete by giving reversible circuits for modular addition, multiplication and inversion and for elliptic-curve point addition, then counting the qubits and Toffoli gates such a circuit needs.",
    ideaJa: "Shor の論文は、古典的には困難と考えられている素因数分解と離散対数の双方について、入力サイズの多項式ステップで動作する効率的な確率的量子アルゴリズムを与えています。Zoo はこの項目から可換隠れ部分群問題を参照しており、同様の技法によって量子計算機は楕円曲線上の離散対数問題も解くことができ、楕円曲線暗号を破ることになると述べています。Roetteler らは、剰余加算・乗算・逆元計算と楕円曲線の点加算に対する可逆回路を与え、必要な量子ビット数と Toffoli ゲート数を数え上げることで、この楕円曲線版を具体化しています。",
    complexity: "Polynomial in the input size: the Zoo states that s can be found in poly(n) time for n-bit inputs while the fastest known classical algorithm takes time superpolynomial in n, and neither source quotes an exponent or constant. For the elliptic-curve variant over an n-bit prime field, Roetteler et al. estimate at most 9n + 2⌈log₂(n)⌉ + 10 qubits and a circuit of at most 448 n³ log₂(n) + 4090 n³ Toffoli gates.",
    complexityBasis: 'Zoo entry "Discrete-log": "this can be achieved on a quantum computer in poly( n ) time. The fastest known classical algorithm requires time superpolynomial in n"; abstract of arXiv:quant-ph/9508027: "These algorithms take a number of steps polynomial in the input size, e.g., the number of digits of the integer to be factored"; abstract of arXiv:1706.06752: "can be computed on a quantum computer with at most 9n + 2⌈log_2(n)⌉+10 qubits using a quantum circuit of at most 448 n^3 log_2(n) + 4090 n^3 Toffoli gates".',
    caveat: "This is a literature record. No circuit was built, compiled or executed here, and no instance of a, b, N was solved. The poly(n) claim is asymptotic: neither the Zoo nor Shor's abstract states an exponent, a constant factor, or a modular-arithmetic gate count for the mod-N group, so nothing here bounds the cost of a specific key size. The classical side is stated as the fastest algorithm currently known, not a proven lower bound, so the superpolynomial separation is conditional on that state of the art. The Roetteler et al. counts are qubit and Toffoli-gate estimates for the elliptic-curve problem over prime fields, not for the mod-N statement above, and the abstract quoted here reports neither an error-correction cost nor a running time on hardware. The further optimizations to Shor's algorithm and the semigroup extension that the Zoo cites rest on papers outside this record.",
    caveatJa: "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・実行したことはなく、具体的な a, b, N の実例を解いたわけでもありません。poly(n) は漸近的な主張であり、Zoo も Shor の要旨も指数・定数因子・mod N における剰余演算のゲート数を示していないため、特定の鍵長に対するコストはここからは分かりません。古典側は「現在知られている最速のアルゴリズム」に関する記述であって証明された下界ではなく、超多項式的な差はその前提に依存します。Roetteler らの数値は素体上の楕円曲線問題に対する量子ビット数と Toffoli ゲート数の見積りであり、上記の mod N の定式化に対するものではなく、ここで引用した要旨は誤り訂正のコストも実機での所要時間も報告していません。Zoo が挙げる追加の最適化や半群への拡張は、本記録の対象外の論文に基づきます。",
    tags: ["discrete logarithm", "shor", "hidden subgroup", "elliptic curves", "cryptanalysis"],
    source: {
      id: "arxiv:quant-ph/9508027",
      title: "Polynomial-Time Algorithms for Prime Factorization and Discrete Logarithms on a Quantum Computer",
      authors: "Peter W. Shor",
      year: "1995",
      url: "https://arxiv.org/abs/quant-ph/9508027",
    },
    literature: [
      {
        title: "Quantum resource estimates for computing elliptic curve discrete logarithms",
        authors: "Martin Roetteler, Michael Naehrig, Krysta M. Svore, Kristin Lauter",
        year: "2017",
        url: "https://arxiv.org/abs/1706.06752",
        relevance: "Resource-estimate companion for the elliptic-curve case. The authors give circuit implementations for reversible modular arithmetic and elliptic-curve point addition, and report qubit and Toffoli-gate counts for an n-bit prime field. The paper states that these estimates are derived from a simulation of a Toffoli gate network for controlled elliptic curve point addition, implemented within the software tool suite LIQUi|⟩, and that the authors were able to simulate those networks classically for the NIST standard curves P-192, P-224, P-256, P-384 and P-521. It also reports that the results indicate a lower qubit requirement for tackling elliptic curves than for attacking RSA, for current parameters at comparable classical security levels, which the authors suggest makes ECC the easier target.",
        relevanceJa: "楕円曲線版の資源見積りを与える論文です。可逆な剰余演算と楕円曲線の点加算の回路構成を示し、n ビット素体に対する量子ビット数と Toffoli ゲート数を報告しています。この見積りは、制御付き楕円曲線点加算に対応する Toffoli ゲートネットワークをソフトウェアツール群 LIQUi|⟩ の枠組みで実装したシミュレーションから導かれたものであり、NIST 標準曲線 P-192, P-224, P-256, P-384, P-521 についてはこのネットワークを古典的にシミュレートできたと述べています。また、現在のパラメータのもとで同等の古典的安全性水準を比べると、楕円曲線に必要な量子ビット数は RSA を攻撃する場合より少ないことを結果が示していると報告し、ECC のほうが攻撃しやすい標的であることを示唆しています。",
      },
    ],
    relatedSlugs: ["shor-period-finding", "quantum-fourier-transform", "quantum-phase-estimation", "qft-resource-screen"],
  },
  {
    slug: "nand-tree-evaluation",
    title: "NAND tree evaluation with discrete queries",
    titleJa: "離散クエリによるNAND木の評価",
    family: "Quantum query algorithm",
    zooName: "Formula Evaluation",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    problem: "Determine the value at the root of a read-once Boolean formula, canonically a NAND tree on N variables, given only oracle access to the variables and using as few queries as possible.",
    problemJa: "各変数が一度しか現れないブール式、すなわちファンアウトを持たない木構造の回路について、変数へのオラクルアクセスだけを用いて、できるだけ少ないクエリ数で根の値を決定する問題です。代表例は N 変数のNAND木です。",
    idea: "Farhi, Goldstone and Gutmann gave a quantum algorithm for evaluating NAND trees with a continuous-time quantum walk, running in time O(√(N log N)) in the Hamiltonian query model, which is not the model in which a discrete circuit calls an oracle. Childs, Cleve, Jordan and Yonge-Mallo point out that their algorithm can be converted into one that works in the conventional quantum query model, at the price of an arbitrarily small polynomial overhead: O(N^(1/2 + ε)) queries for any fixed ε > 0. The Zoo places NAND-tree evaluation inside a longer line of work on formula evaluation, in which Reichardt's span-program formalism finally settled the quantum query complexity of any formula of O(1) fanin on N variables at Θ(√N), and in which Grover's algorithm can be regarded as the special case where every gate is OR.",
    ideaJa: "Farhi、Goldstone、Gutmann は、連続時間量子ウォークによってNAND木を評価する量子アルゴリズムを与えました。これはHamiltonianクエリモデルで O(√(N log N)) 時間で動作しますが、このモデルは、離散的な回路がオラクルを呼び出す通常のモデルとは異なります。Childs、Cleve、Jordan、Yonge-Mallo は、このアルゴリズムを通常の量子クエリモデルで動くものへ変換できることを指摘しました。オーバーヘッドは任意に小さい多項式で、固定した任意の ε > 0 に対し O(N^(1/2 + ε)) クエリとなります。Zoo はNAND木の評価を式評価に関する一連の研究の中に位置づけています。そこでは Reichardt のspanプログラム形式により、ファンインが O(1) の任意の式に対する量子クエリ計算量が Θ(√N) と確定し、Grover のアルゴリズムはすべてのゲートがORである特別な場合とみなせます。",
    complexity: "O(N^(1/2 + ε)) queries in the conventional quantum query model for any fixed ε > 0, converted from a continuous-time algorithm running in time O(√(N log N)) in the Hamiltonian query model; the Zoo states the walk's cost separately, in exponential form, as NAND trees on 2^n variables evaluable in time O(2^(0.5n)), against Ω(2^(0.753n)) queries required classically.",
    complexityBasis: "abstract of arXiv:quant-ph/0702160: \"their algorithm can be converted into an algorithm using O(N^{1/2 + epsilon}) queries in the conventional quantum query model, for any fixed epsilon > 0\", and, for the model it starts from, \"a quantum algorithm for evaluating NAND trees that runs in time O(sqrt(N log N)) in the Hamiltonian query model\". The exponential form is from the Quantum Algorithm Zoo entry \"Formula Evaluation\": \"NAND trees on 2^n variables can be evaluated on quantum computers in time O(2^{0.5n}) using a continuous-time quantum walk, whereas classical computers require Ω(2^{0.753n}) queries.\"",
    caveat: "This is a literature record: no circuit was built, compiled, simulated, or run, and no NAND-tree instance was evaluated. The figures are query counts in an oracle model, so gate counts, constant factors, and the cost of realizing the leaf oracle on hardware are not addressed, and the paper is explicit that its own contribution is the model conversion, not the O(√(N log N)) Hamiltonian-model algorithm, which is Farhi, Goldstone and Gutmann's. The ε in O(N^(1/2 + ε)) is an overhead that can be made small but does not vanish, so this bound approaches without meeting the Θ(√N) quantum query complexity that the Zoo attributes to Reichardt's span-program formalism. The bound also assumes the read-once formula structure; the Zoo notes separately that allowing repeated input variables changes the query count.",
    caveatJa: "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、実行は行っておらず、具体的なNAND木の評価も行っていません。示されている値はオラクルモデルでのクエリ数であり、ゲート数、定数因子、葉のオラクルを実機で実現するコストは対象外です。また論文自身が述べるとおり、その寄与はモデル間の変換であって、O(√(N log N)) というHamiltonianクエリモデルのアルゴリズムは Farhi、Goldstone、Gutmann によるものです。O(N^(1/2 + ε)) の ε はいくらでも小さくできますが消えるわけではなく、Zoo が Reichardt のspanプログラム形式に帰する量子クエリ計算量 Θ(√N) には到達していません。さらにこの評価は、各変数が一度しか現れないという式の構造を前提としており、Zoo は入力変数の重複を許すとクエリ数が変わることを別途述べています。",
    tags: ["nand tree", "formula evaluation", "quantum walk", "query complexity", "oracle"],
    source: {
      id: "arxiv:quant-ph/0702160",
      title: "Discrete-query quantum algorithm for NAND trees",
      authors: "Andrew M. Childs, Richard Cleve, Stephen P. Jordan, David Yonge-Mallo",
      year: "2007",
      url: "https://arxiv.org/abs/quant-ph/0702160",
    },
    literature: [
      {
        title: "Discrete-query quantum algorithm for NAND trees",
        authors: "Andrew M. Childs, Richard Cleve, Stephen P. Jordan, David Yonge-Mallo",
        year: "2007",
        url: "https://arxiv.org/abs/quant-ph/0702160",
        relevance: "Primary source for the discrete-query bound: it points out that the continuous-time NAND-tree algorithm can be converted from the Hamiltonian query model into the conventional quantum query model at O(N^(1/2 + ε)) queries for any fixed ε > 0. Consult it for what the conversion assumes and for how the overhead depends on ε.",
        relevanceJa: "離散クエリ版の評価の一次資料です。連続時間のNAND木アルゴリズムをHamiltonianクエリモデルから通常の量子クエリモデルへ変換できることを指摘し、固定した任意の ε > 0 に対し O(N^(1/2 + ε)) クエリとなることを述べています。変換が前提とする条件や、オーバーヘッドの ε 依存性は原論文で確認してください。",
      },
    ],
    relatedSlugs: ["quantum-walk-line", "grover-unstructured-search", "amplitude-amplification"],
  },
  {
    slug: "hidden-shift-problem",
    title: "Hidden shift problem",
    titleJa: "隠れシフト問題",
    family: "Quantum query algorithm",
    zooName: "Hidden Shift",
    zooSection: "Oracular Algorithms",
    speedup: "Superpolynomial",
    problem: "Given oracle access to a function f on the integers mod N together with the promise that f(x) = g(x+s) for a known function g and an unknown shift s, recover s.",
    problemJa: "既知の関数 g に対して f(x) = g(x+s) が成り立つという約束のもとで、N を法とする整数上の関数 f へのオラクルアクセスから未知のシフト s を求める問題です。",
    idea: "Nearly all of the successful quantum algorithms use the Fourier transform to recover subgroup structure, above all periodicity; van Dam, Hallgren and Ip point out that the same transform also captures shift structure, which had received far less attention. They give three unknown-shift problems that can be solved efficiently on a quantum computer using the quantum Fourier transform, and they define the hidden coset problem, one framework that contains both the hidden shift problem and the hidden subgroup problem. The Quantum Algorithm Zoo records that their construction covers the case where f is a multiplicative character of a finite ring or field, and that the previously discovered shifted Legendre symbol algorithm is subsumed as a special case, because the Legendre symbol is a multiplicative character of Fₚ.",
    ideaJa: "これまでに成功した量子アルゴリズムの多くは、Fourier変換によって関数の部分群構造、とりわけ周期性を取り出してきました。van Dam、Hallgren、Ip は、同じ変換がシフト構造も捉えられる点に着目しています。この点は、これまで注目される度合いがはるかに低いままでした。論文では、量子Fourier変換によって量子計算機上で効率的に解ける「未知のシフト」問題を3つ挙げ、さらに隠れシフト問題と隠れ部分群問題の双方を含む枠組みとして隠れコセット問題を定義しています。Zoo の記述によれば、この構成は f が有限環または有限体の乗法指標である場合を扱い、Legendre記号が Fₚ の乗法指標であることから、先行するシフトLegendre記号アルゴリズムは特別な場合として含まれます。",
    complexity: "O(1) quantum queries for the special case in which f is a multiplicative character of a finite ring or field; for hidden shift in general, at least √N queries are necessary, by reduction from Grover's problem.",
    complexityBasis: "Quantum Algorithm Zoo entry \"Hidden Shift\": \"certain special cases of the hidden shift problem are solvable on quantum computers using O(1) queries. In particular, van Dam et al. showed that this can be done if f is a multiplicative character of a finite ring or field\", and \"By reduction from Grover's problem it is clear that at least √N queries are necessary to solve hidden shift in general.\" The abstract of arXiv:quant-ph/0211140 states no query count or running time of its own; it says only that three unknown-shift problems \"can be solved efficiently on a quantum computer using the quantum Fourier transform\".",
    caveat: "Nothing here was executed: no circuit was written, compiled, simulated, or benchmarked, and no instance was solved. The O(1) figure is a query count in an oracle model for one special class of f, not a gate count and not a statement about general hidden shift. Query cost and circuit cost come apart badly in this family: the Zoo notes that for an injective function on the integers mod N the quantum query complexity is O(log n) while the best known quantum circuit complexity is O(2^(C √log N)), from Kuperberg's sieve. The classical side is an absence rather than a proof, since the Zoo says only that no classical algorithm running in time O(polylog(N)) is known for these problems. The cost of building the oracle for a concrete g, and any hardware feasibility question, are outside this record.",
    caveatJa: "本項目は文献に基づく記録であり、回路の記述、コンパイル、シミュレーション、ベンチマークは一切行っておらず、具体的な問題例も解いていません。O(1) はオラクルモデルにおける特定の関数クラスに対するクエリ数であり、ゲート数でも、一般の隠れシフト問題についての主張でもありません。この問題族では、クエリ数と量子回路計算量が大きく乖離します。Zoo によれば、N を法とする整数上の単射関数の場合、量子クエリ計算量は O(log n) である一方、知られている中で最良の量子回路計算量は Kuperberg のふるいによる O(2^(C √log N)) です。古典側についても、O(polylog(N)) 時間のアルゴリズムが「知られていない」と述べられているだけで、下界が証明されているわけではありません。具体的な g に対するオラクルの実装コストや実機での実行可能性も、本項目の対象外です。",
    tags: ["hidden shift", "oracle", "fourier transform", "hidden coset", "query complexity"],
    source: {
      id: "arxiv:quant-ph/0211140",
      title: "Quantum Algorithms for some Hidden Shift Problems",
      authors: "Wim van Dam, Sean Hallgren, Lawrence Ip",
      year: "2002",
      url: "https://arxiv.org/abs/quant-ph/0211140",
    },
    literature: [
      {
        title: "Quantum Algorithms for some Hidden Shift Problems",
        authors: "Wim van Dam, Sean Hallgren, Lawrence Ip",
        year: "2002",
        url: "https://arxiv.org/abs/quant-ph/0211140",
        relevance: "Primary source: it presents three unknown-shift problems that can be solved efficiently by the quantum Fourier transform and defines the hidden coset problem, which generalizes both the hidden shift problem and the hidden subgroup problem. Consult it for the promise conditions on f and g, since the abstract states no query bound.",
        relevanceJa: "一次資料です。量子Fourier変換で効率的に解ける未知シフト問題を3つ示し、隠れシフト問題と隠れ部分群問題を一般化する隠れコセット問題を定義しています。要旨にはクエリ数の記載がないため、f と g に課される約束条件は原論文で確認してください。",
      },
    ],
    relatedSlugs: ["quantum-fourier-transform", "shor-period-finding", "grover-unstructured-search"],
  },
  {
    slug: "ordered-search",
    title: "Ordered search",
    titleJa: "順序付き探索",
    family: "Quantum query algorithm",
    zooName: "Ordered Search",
    zooSection: "Oracular Algorithms",
    speedup: "Constant factor",
    problem: "Given oracle access to a list of N numbers held in order from least to greatest, together with a number x, determine where in the list x would fit.",
    problemJa: "小さい順に並んだN個の数のリストへのオラクルアクセスが与えられ、さらに数xが与えられたとき、xがリストのどの位置に入るかを求める問題です。",
    idea: "The paper characterizes a class of quantum query algorithms for ordered search as a semidefinite program, and solving that program yields new algorithms for small instances of the problem. Those small-instance algorithms are then extended to arbitrarily large N by recursion, which produces an exact quantum ordered search algorithm improving on the previously best known exact algorithm. Because classical binary search already costs log₂ N queries, the quantum gain here is a constant factor on that logarithm rather than a change of order.",
    ideaJa: "この論文は、順序付き探索に対する量子クエリアルゴリズムのクラスを半正定値計画として特徴付け、その計画を解くことで小さなインスタンス向けの新しいアルゴリズムを得ます。得られたアルゴリズムを再帰によって任意の大きさのNへ拡張すると、従来の最良の厳密アルゴリズムを改善する厳密な量子順序付き探索アルゴリズムが得られます。古典の二分探索がすでにlog₂ Nクエリで済むため、量子側の利得はこの対数に掛かる定数倍であり、オーダーの改善ではありません。",
    complexity: "4 log₆₀₅ N ≈ 0.433 log₂ N oracle queries for the exact quantum algorithm, against log₂ N queries for classical binary search; a lower bound of (ln 2)/π · log₂ N quantum queries is known for the problem.",
    complexityBasis: 'abstract of arXiv:quant-ph/0608161: "we show that there is an exact quantum ordered search algorithm using 4 log_{605} N ≈ 0.433 log_2 N queries, which improves upon the previously best known exact algorithm". The classical baseline ("the best possible algorithm is binary search which takes log₂ N queries") and the (ln 2)/π · log₂ N lower bound ("A lower bound of ... quantum queries has been proven for this problem") are from the Quantum Algorithm Zoo entry "Ordered Search"; in the quotations from both sources, LaTeX has been rendered into Unicode where shown, including the abstract\'s approximation sign as ≈.',
    caveat: "This is a query-complexity record in the oracle model, not an executed result: nothing here was compiled, simulated, or run. The count is of queries to the ordered list only, and says nothing about gate counts, ancilla requirements, or the cost of implementing the comparison oracle on hardware; constant factors and small-N behaviour of the recursion are also outside it. The 0.433 log₂ N figure is for the exact (deterministic) setting, while the Zoo separately reports a randomized quantum algorithm whose expected query complexity is below (1/3) log₂ N, and the abstract states that the precise value of the constant factor by which a quantum computer improves on the classical query count is unknown.",
    caveatJa: "本項目はオラクルモデルにおけるクエリ計算量の記録であり、実行結果ではありません。コンパイル、シミュレーション、実機実行はいずれも行っていません。数えているのは順序付きリストへのクエリ回数のみで、ゲート数、補助量子ビット、比較オラクルの実装コストは含まれず、定数因子や再帰の小さなNでの挙動も対象外です。0.433 log₂ Nは厳密（決定的）な設定の値であり、Zooは期待クエリ数が(1/3) log₂ N未満の乱択量子アルゴリズムを別に挙げています。論文の要旨は、量子計算機が古典より少ないクエリ数で解けるときの定数因子について、その正確な値は未知であると述べています。",
    tags: ["oracular", "query complexity", "sorted list", "semidefinite programming"],
    source: {
      id: "arxiv:quant-ph/0608161",
      title: "Improved quantum algorithms for the ordered search problem via semidefinite programming",
      authors: "Andrew M. Childs, Andrew J. Landahl, Pablo A. Parrilo",
      year: "2006",
      url: "https://arxiv.org/abs/quant-ph/0608161",
    },
    literature: [
      {
        title: "Improved quantum algorithms for the ordered search problem via semidefinite programming",
        authors: "Andrew M. Childs, Andrew J. Landahl, Pablo A. Parrilo",
        year: "2006",
        url: "https://arxiv.org/abs/quant-ph/0608161",
        relevance: "Primary paper: it recasts ordered-search quantum query algorithms as a semidefinite program, solves small instances, and lifts them by recursion to the exact 4 log₆₀₅ N ≈ 0.433 log₂ N query algorithm quoted in the complexity field.",
        relevanceJa: "一次文献です。順序付き探索の量子クエリアルゴリズムを半正定値計画として定式化し、小さなインスタンスを解いたうえで再帰により拡張し、計算量欄に引いた4 log₆₀₅ N ≈ 0.433 log₂ Nクエリの厳密アルゴリズムを与えています。",
      },
    ],
    relatedSlugs: ["grover-unstructured-search", "amplitude-amplification", "quantum-counting"],
  },
  {
    slug: "welded-tree-traversal",
    title: "Welded tree traversal by continuous-time quantum walk",
    titleJa: "連続時間量子ウォークによる溶接木グラフの探索",
    family: "Quantum walk",
    zooName: "Welded Tree",
    zooSection: "Oracular Algorithms",
    speedup: "Superpolynomial",
    problem:
      "Given oracle access to a graph built by joining two depth-n binary trees with a random weld, so that every node except the two roots has degree three, start from the label of one root and find the label of the other root.",
    problemJa:
      "深さnの二分木2本をランダムな溶接で接続し、2つの根以外のすべてのノードの次数が3となるグラフへのオラクルアクセスが与えられたとき、一方の根のラベルから出発してもう一方の根のラベルを見つける問題です。",
    idea:
      "The oracle, queried with a node label, returns the labels of that node's neighbours. Childs, Cleve, Deotto, Farhi, Gutmann and Spielman base their algorithm on a continuous-time quantum walk on this graph, a different technique from earlier quantum algorithms based on quantum Fourier transforms, and show how to implement that walk efficiently in the oracular setting. The walk traverses the graph rapidly enough to reach the far root, and the same paper proves that no classical algorithm solves the problem with high probability in subexponential time.",
    ideaJa:
      "オラクルにノードのラベルを問い合わせると、隣接ノードのラベルの一覧が返されます。Childsらは、量子フーリエ変換に基づく従来の量子アルゴリズムとは異なる手法として、このグラフ上の連続時間量子ウォークに基づくアルゴリズムを構成し、オラクル設定においてそのウォークを効率的に実装する方法を示しています。ウォークはグラフ上を高速に伝播してもう一方の根に到達し、同じ論文は、いかなる古典アルゴリズムも、この問題を劣指数時間で高い確率で解くことはできないことを証明しています。",
    complexity:
      "poly(n) oracle queries for a pair of depth-n trees, against a proved classical lower bound: no classical algorithm solves the problem with high probability in subexponential time.",
    complexityBasis:
      'Quantum Algorithm Zoo entry "Welded Tree": "a quantum computer can find the other root using poly( n ) queries, whereas this is provably impossible using classical queries"; abstract of arXiv:quant-ph/0209131: "we prove that no classical algorithm can solve this problem with high probability in subexponential time". Neither source states an exponent inside poly(n) or any constant factor.',
    caveat:
      "This is a query-complexity statement about an oracle that returns neighbour labels; neither source gives the gate cost of realising that oracle for a concrete graph, so the separation is about queries rather than end-to-end runtime. The separation is proved for this welded-tree family, not for graph traversal in general. Nothing here was compiled, simulated or run, and with no exponent or constant behind poly(n) the record supports no statement about instance sizes, qubit counts or hardware feasibility.",
    caveatJa:
      "これは隣接ラベルを返すオラクルに対するクエリ計算量の主張であり、具体的なグラフでそのオラクルを実装するゲートコストはいずれの資料にも示されていないため、全体の実行時間ではなくクエリ数についての分離です。分離が示されているのは溶接木という特定のグラフ族であって、一般のグラフ探索ではありません。回路の作成、シミュレーション、実行は行っておらず、poly(n)の指数や定数因子も示されていないため、扱える問題規模、量子ビット数、ハードウェア上の実現可能性についてはこの項目からは何も言えません。",
    tags: ["quantum walk", "oracle", "graph traversal", "query complexity", "separation"],
    source: {
      id: "arxiv:quant-ph/0209131",
      title: "Exponential algorithmic speedup by quantum walk",
      authors:
        "Andrew M. Childs, Richard Cleve, Enrico Deotto, Edward Farhi, Sam Gutmann, Daniel A. Spielman",
      year: "2002",
      url: "https://arxiv.org/abs/quant-ph/0209131",
    },
    literature: [
      {
        title: "Exponential algorithmic speedup by quantum walk",
        authors:
          "Andrew M. Childs, Richard Cleve, Enrico Deotto, Edward Farhi, Sam Gutmann, Daniel A. Spielman",
        year: "2002",
        url: "https://arxiv.org/abs/quant-ph/0209131",
        relevance:
          "Primary source: constructs the welded-tree oracle problem, gives the continuous-time quantum walk that traverses it, shows how to implement the walk in the oracular setting, and proves the classical subexponential-time lower bound.",
        relevanceJa:
          "一次資料です。溶接木のオラクル問題を構成し、そのグラフ上を伝播する連続時間量子ウォークとそのオラクル設定での実装法を与え、古典側の劣指数時間下界を証明しています。",
      },
    ],
    relatedSlugs: ["quantum-walk-line", "grover-unstructured-search", "hamiltonian-simulation-ising"],
  },
  {
    slug: "element-distinctness",
    title: "Element distinctness by quantum walk",
    titleJa: "量子ウォークによる要素相異性問題",
    family: "Quantum walk",
    zooName: "Collision Finding and Element Distinctness",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    problem: "Given oracle access to N items carrying no promise about the underlying function, find two items that are equal, or establish that all N are distinct.",
    problemJa: "写像の構造に関する約束が一切ない N 個の要素へオラクル経由でアクセスできるとき、値の等しい 2 要素を見つける、あるいは N 個すべてが相異なることを確かめる問題です。",
    idea: "Ambainis builds the algorithm out of a quantum walk instead of a direct search, which is what improves on the earlier O(N^(3/4))-query quantum algorithm the abstract credits to Buhrman et al. and matches the query lower bound of Shi. The same construction also solves the generalization in which k equal items must be found among N. The easier promised version is older: when f is r-to-one, Brassard, Hoyer and Tapp give an algorithm that finds a collision by using Grover's search in a novel way, and their technique also yields a claw-finding algorithm for a pair of functions and a space-time tradeoff. The Zoo groups the two under one entry because dropping the two-to-one promise is exactly what turns collision finding into element distinctness.",
    ideaJa: "Ambainis は直接的な探索ではなく量子ウォークを用いてアルゴリズムを構成しており、これにより、要旨が Buhrman らによるものとしている O(N^(3/4)) クエリの量子アルゴリズムを改良し、Shi が示したクエリ下界と一致します。同じ構成は、N 個の中から k 個の等しい要素を見つける一般化も解きます。約束付きのより易しい版はこれより古く、f が r 対 1 の場合に Brassard, Hoyer, Tapp は Grover 探索を新しい形で用いて衝突を発見するアルゴリズムを与えており、同じ技法から 2 つの写像に対する claw 探索と時空間のトレードオフも得られます。2 対 1 の約束を外すことが衝突発見を要素相異性問題に変えるため、Zoo は両者を 1 つの項目にまとめています。",
    complexity: "O(N^(2/3)) queries for element distinctness on N items, matching the lower bound of Shi and improving the previous O(N^(3/4))-query quantum algorithm; the same algorithm uses O(N^(k/(k+1))) queries to find k equal items among N. The Zoo gives Θ(N) classical query complexity for element distinctness, and for the two-to-one collision problem O(N^(1/3)) quantum queries against Θ(√N) classical randomized queries, with Brassard, Hoyer and Tapp stating O((N/r)^(1/3)) expected function evaluations for r-to-one functions.",
    complexityBasis: 'abstract of arXiv:quant-ph/0311001: "For element distinctness (the problem of finding two equal items among N given items), we get an O(N^{2/3}) query quantum algorithm. This improves the previous O(N^{3/4}) query quantum algorithm of Buhrman [link mangled to \'this http URL\' on the abs page] (quant-ph/0007016) and matches the lower bound by Shi (quant-ph/0112086)", and "For this problem, we get an O(N^{k/(k+1)}) query quantum algorithm"; Zoo entry "Collision Finding and Element Distinctness": element distinctness "has Θ(N) classical query complexity", and for the collision problem "The classical randomized query complexity of this problem is Θ(√N), whereas ... a quantum computer can achieve this using O(N^{1/3}) queries"; abstract of arXiv:quant-ph/9705002: "finds collisions in arbitrary r-to-one functions after only O((N/r)^(1/3)) expected evaluations of the function".',
    caveat: "This is a literature record. No oracle was instantiated, no circuit compiled, and no walk simulated or run. Every figure above is a query count in the black-box model, so none of it bounds gate count, circuit depth, the cost of holding and addressing the data the walk moves over, or the constant factors hidden by O(·); the collision paper asserts a space-time tradeoff exists without this record fixing the space. Optimality is reported: the Zoo calls the O(N^(2/3)) bound optimal and the Ambainis abstract attributes the matching lower bound to Shi, neither of which is re-derived here. The remaining results in the same Zoo entry, the k-distinctness bounds, time-complexity claims, many-collision and claw-finding work for N ≠ M, frequency-moment estimation and the graph collision problem, rest on papers outside this record.",
    caveatJa: "本項目は文献に基づく記録です。オラクルを具体化したことも、回路をコンパイルしたことも、ウォークをシミュレートしたり実行したりしたこともありません。上記の数値はいずれもブラックボックスモデルでのクエリ数であり、ゲート数、回路深さ、ウォークが渡り歩くデータの保持と参照にかかるコスト、O(·) に隠れた定数因子のいずれについても上界を与えるものではありません。衝突発見の論文は時空間トレードオフの存在を述べていますが、本記録で空間量を特定してはいません。最適性については文献の記述を引用したものであり、Zoo は O(N^(2/3)) を最適と記し、Ambainis の要旨は一致する下界を Shi の結果としています。いずれも本記録で導出し直したものではありません。同じ Zoo 項目に含まれる k-distinctness の評価、時間計算量の主張、多重衝突や N ≠ M の場合の claw 探索、頻度モーメント推定、グラフ衝突問題は、本記録の対象外の論文に基づきます。",
    tags: ["element distinctness", "quantum walk", "collision finding", "query complexity", "oracle"],
    source: {
      id: "arxiv:quant-ph/0311001",
      title: "Quantum walk algorithm for element distinctness",
      authors: "Andris Ambainis",
      year: "2003",
      url: "https://arxiv.org/abs/quant-ph/0311001",
    },
    literature: [
      {
        title: "Quantum Algorithm for the Collision Problem",
        authors: "Gilles Brassard, Peter Hoyer, Alain Tapp",
        year: "1997",
        url: "https://arxiv.org/abs/quant-ph/9705002",
        relevance: "The promised half of the same Zoo entry. For arbitrary r-to-one functions given as a black box the authors find collisions in O((N/r)^(1/3)) expected evaluations, more efficient than any classical algorithm even with randomization, and they extend the technique to claw finding in pairs of functions and exhibit a space-time tradeoff.",
        relevanceJa: "同じ Zoo 項目のうち、約束が付いた側を担う論文です。ブラックボックスとして与えられた任意の r 対 1 写像に対し、期待評価回数 O((N/r)^(1/3)) で衝突を発見し、確率的手法を許したいかなる古典アルゴリズムよりも効率的だと述べています。さらに同じ技法を 2 つの写像に対する claw 探索へ拡張し、時空間のトレードオフも示しています。",
      },
    ],
    relatedSlugs: ["quantum-walk-line", "grover-unstructured-search", "amplitude-amplification"],
  },
  {
    slug: "gibbs-state-sampling",
    title: "Thermal Gibbs state sampling",
    titleJa: "熱的 Gibbs 状態のサンプリング",
    family: "Quantum sampling algorithm",
    zooName: "Preparing Eigenstates and Thermal States",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Superpolynomial",
    problem: "Prepare the thermal Gibbs state of an interacting quantum system on a quantum computer, and use that preparation to evaluate the system's partition function to a target accuracy.",
    problemJa: "相互作用する量子系の熱的 Gibbs 状態を量子計算機上で準備し、その準備を用いて分配関数を目標精度で評価する問題です。",
    idea: "Poulin and Wocjan's algorithm prepares the thermal Gibbs state of an interacting quantum system directly on the quantum register. The paper states that the algorithm sets a universal upper bound D^α on the thermalization time of a quantum system, with D the Hilbert space dimension and the exponent α < 1/2 proportional to the Helmholtz free energy density. A second algorithm derived from the same preparation evaluates the partition function, its running time proportional to the system's thermalization time and inversely proportional to the targeted accuracy squared. In the Zoo this sits among methods for approximating ground states, low energy states, and thermal states for some classes of Hamiltonians; the Zoo notes that simulating Hamiltonian time evolution, as well as some problems of preparing ground and thermal states, can all be done as special cases of the quantum singular value transformation.",
    ideaJa: "Poulin と Wocjan のアルゴリズムは、相互作用する量子系の熱的 Gibbs 状態を量子レジスタ上で直接準備します。論文によれば、このアルゴリズムは量子系の熱化時間に対する普遍的な上界 D^α を与えます。ここで D は Hilbert 空間の次元、指数 α < 1/2 は Helmholtz 自由エネルギー密度に比例します。同じ準備から導かれるもう一つのアルゴリズムは分配関数を評価し、その実行時間は系の熱化時間に比例し、目標精度の二乗に反比例します。Zoo ではこの手法を、あるクラスの Hamiltonian に対する基底状態、低エネルギー状態、熱状態の近似手法群の中に位置づけており、Hamiltonian の時間発展のシミュレーション、および基底状態と熱状態を準備するいくつかの問題は、量子特異値変換の特別な場合として実行できると述べています。",
    complexity: "The preparation sets a universal upper bound D^α on the thermalization time, where D is the Hilbert space dimension and α < 1/2 is proportional to the Helmholtz free energy density; the derived partition-function algorithm runs in time proportional to that thermalization time and inversely proportional to the targeted accuracy squared.",
    complexityBasis: "abstract of arXiv:0905.2199 (plain-text Greek names rendered as Unicode): \"This algorithm sets a universal upper bound D^α on the thermalization time of a quantum system, where D is the system's Hilbert space dimension and α < 1/2 is proportional to the Helmholtz free energy density of the system\", and \"an algorithm to evaluate the partition function of a quantum system in a time proportional to the system's thermalization time and inversely proportional to the targeted accuracy squared\". The Zoo entry for this section states no bound of its own; its \"Superpolynomial\" label is the Zoo's classification, not a measured comparison, and is recorded in the speedup field rather than here.",
    caveat: "Nothing here was constructed, compiled, simulated, or benchmarked; this is a literature record. D^α is stated as a universal upper bound on thermalization time, not as an achieved cost for any named Hamiltonian, and the exponent α depends on the free energy density of the system in question, so it has to be bounded per system before the figure means anything operationally. The abstract gives no gate counts, ancilla counts, error-correction overhead, or hardware requirements, and gives no target accuracy or temperature range for a worked instance. The Zoo section collects many separate methods for eigenstates and thermal states; this record covers only the Poulin and Wocjan construction and does not establish which Hamiltonian classes admit efficient preparation.",
    caveatJa: "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、ベンチマークは一切行っていません。D^α は熱化時間の普遍的な上界として述べられたものであり、特定の Hamiltonian で達成されたコストではありません。指数 α は対象系の自由エネルギー密度に依存するため、実用的な意味を持たせるには系ごとに上界を与える必要があります。要旨にはゲート数、補助量子ビット数、誤り訂正のオーバーヘッド、ハードウェア要件は示されておらず、具体例に対する目標精度や温度範囲も示されていません。Zoo の該当節は固有状態と熱状態に関する多数の手法をまとめたものですが、本項目が扱うのは Poulin と Wocjan の構成のみであり、どのクラスの Hamiltonian が効率的な準備を許すかについては何も確定していません。",
    tags: ["gibbs state", "thermal state", "partition function", "quantum sampling", "hamiltonian"],
    source: {
      id: "arxiv:0905.2199",
      title: "Sampling from the thermal quantum Gibbs state and evaluating partition functions with a quantum computer",
      authors: "David Poulin, Pawel Wocjan",
      year: "2009",
      url: "https://arxiv.org/abs/0905.2199",
    },
    literature: [
      {
        title: "Sampling from the thermal quantum Gibbs state and evaluating partition functions with a quantum computer",
        authors: "David Poulin, Pawel Wocjan",
        year: "2009",
        url: "https://arxiv.org/abs/0905.2199",
        relevance: "Primary source: it states the Gibbs-state preparation for interacting quantum systems, the universal D^α thermalization-time bound with α < 1/2 tied to the Helmholtz free energy density, and the partition-function algorithm's dependence on thermalization time and on the squared target accuracy.",
        relevanceJa: "一次資料です。相互作用する量子系に対する Gibbs 状態の準備、Helmholtz 自由エネルギー密度に結びついた α < 1/2 を伴う普遍的な熱化時間の上界 D^α、および分配関数アルゴリズムの熱化時間と目標精度の二乗への依存が述べられています。",
      },
    ],
    relatedSlugs: ["quantum-singular-value-transformation", "qite-imaginary-time", "hamiltonian-simulation-ising"],
  },
  {
    slug: "jones-polynomial-approximation",
    title: "Additive approximation of the Jones polynomial at a primitive root of unity",
    titleJa: "1の原始k乗根におけるJones多項式の加法的近似",
    family: "Topological invariants",
    zooName: "Knot Invariants",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Superpolynomial",
    problem:
      "Given a braid on n strands with m crossings and an integer k, compute a certain additive approximation to the Jones polynomial of the link obtained by closing the braid, evaluated at the primitive root of unity e^(2πi/k).",
    problemJa:
      "n本のストランドとm個の交差を持つブレイドと整数kが与えられたとき、ブレイドを閉じて得られる絡み目のJones多項式を1の原始k乗根 e^(2πi/k) で評価した値について、ある加法的近似を求める問題です。",
    idea:
      "Freedman, Kitaev, Larsen and Wang had shown that a quantum computer can efficiently simulate topological quantum field theory and vice versa, which implicitly implies an efficient additive approximation of the Jones polynomial at e^(2πi/5) and makes that approximation BQP-complete, but the algorithm was never explicitly formulated and its TQFT footing left it inaccessible to computer scientists. Aharonov, Jones and Landau write that algorithm down explicitly, resting it on well known mathematical results instead of TQFT. Their algorithm takes a braid of n strands with m crossings and returns the additive approximation at any primitive root of unity e^(2πi/k), and the paper states that, by the results of Freedman et al., its algorithm solves a BQP-complete problem.",
    ideaJa:
      "Freedman、Kitaev、Larsen、Wangは量子計算機が位相的量子場理論を効率的にシミュレートでき、その逆も成り立つことを示しました。これは e^(2πi/5) におけるJones多項式を加法的に近似する効率的なアルゴリズムが存在すること、およびその問題がBQP完全であることを暗に導きますが、アルゴリズム自体は明示的に定式化されず、位相的量子場理論に依拠するため計算機科学者には扱いにくいままでした。Aharonov、Jones、Landauは位相的量子場理論ではなくよく知られた数学的結果に基づき、そのアルゴリズムを明示的に書き下しています。このアルゴリズムはn本のストランドとm個の交差を持つブレイドを入力として、任意の1の原始k乗根 e^(2πi/k) における加法的近似を返します。論文は、Freedmanらの結果により、このアルゴリズムがBQP完全な問題を解くと述べています。",
    complexity:
      "Running time polynomial in m, n and k for an n-strand braid with m crossings, at any primitive root of unity e^(2πi/k); the guarantee is an additive approximation.",
    complexityBasis:
      'Abstract of arXiv:quant-ph/0511096: "an explicit and simple polynomial quantum algorithm to approximate the Jones polynomial of an n-strands braid with m crossings at any primitive root of unity ... where the running time of the algorithm is polynomial in m,n and k". The abstract gives no exponent, no constant, and no numeric size for the additive approximation window.',
    caveat:
      "The word additive is load-bearing and left unquantified: neither the Zoo entry nor the abstract states how large the approximation window is, so this record does not establish that the output is useful as a multiplicative estimate of the Jones polynomial. The BQP-completeness quoted by the Zoo is for the plat closure of a braid at e^(2πi/5); the Zoo separately reports that the trace closure at the same point is DQC1-complete, so the closure convention changes the complexity claim. Nothing here was compiled, simulated or run: no braid instance, qubit count, circuit depth, or exponent for the polynomial in m, n and k is attached, and BQP-completeness is a statement about quantum hardness, not evidence about any device.",
    caveatJa:
      "近似が加法的であるという点が本質ですが、Zooの記述にも要旨にも誤差幅の定量的な言及はないため、この項目は出力がJones多項式の乗法的な推定として使えることを保証しません。Zooが引用するBQP完全性はブレイドのプラット閉包を e^(2πi/5) で評価した場合のものであり、同じ点でもトレース閉包ではDQC1完全になるとZooは述べているため、閉包の取り方によって計算量の主張は変わります。回路の作成、シミュレーション、実行は行っておらず、具体的なブレイド事例、量子ビット数、回路深さ、m・n・kに対する多項式の次数はいずれも示されていません。BQP完全性は量子計算の難しさに関する主張であって、実機についての証拠ではありません。",
    tags: ["jones polynomial", "knot invariants", "braid", "bqp-complete", "approximation"],
    source: {
      id: "arxiv:quant-ph/0511096",
      title: "A Polynomial Quantum Algorithm for Approximating the Jones Polynomial",
      authors: "Dorit Aharonov, Vaughan Jones, Zeph Landau",
      year: "2005",
      url: "https://arxiv.org/abs/quant-ph/0511096",
    },
    literature: [
      {
        title: "A Polynomial Quantum Algorithm for Approximating the Jones Polynomial",
        authors: "Dorit Aharonov, Vaughan Jones, Zeph Landau",
        year: "2005",
        url: "https://arxiv.org/abs/quant-ph/0511096",
        relevance:
          "Primary source: makes the previously implicit algorithm explicit, extends it from e^(2πi/5) to any primitive root of unity e^(2πi/k), and states the running time as polynomial in m, n and k. The authors also flag the Potts model partition function as a candidate for the same approach.",
        relevanceJa:
          "一次資料です。それまで暗黙にしか存在しなかったアルゴリズムを明示的に構成し、e^(2πi/5) から任意の1の原始k乗根 e^(2πi/k) へ拡張したうえで、実行時間がm、n、kの多項式であることを述べています。著者らは同じ手法の適用候補としてPottsモデルの分配関数にも言及しています。",
      },
    ],
    relatedSlugs: ["amplitude-estimation", "hamiltonian-simulation-ising"],
  },
  {
    slug: "quantum-simulated-annealing",
    title: "Quantum simulated annealing",
    titleJa: "量子シミュレーテッドアニーリング",
    family: "Markov-chain sampling",
    zooName: "Simulated Annealing",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Polynomial",
    problem: "Sample from the final limiting distribution πₙ of a slowly varying sequence of Markov chains, where πₙ is chosen to concentrate on good solutions of a combinatorial optimization problem.",
    problemJa: "ゆっくり変化するマルコフ連鎖の列の最終的な極限分布 πₙ からサンプリングする問題です。πₙ は組合せ最適化問題の良い解に集中するように選ばれます。",
    idea: "Classical simulated annealing applies stochastic matrices M₁, M₂, …, Mₙ whose limiting distributions satisfy |πₜ₊₁ − πₜ| < ε for some small ε, so that an easily prepared π₁ can be carried step by step to πₙ; these distributions are typically thermal distributions at successively lower temperatures. Somma, Boixo, Barnum and Knill describe a quantum algorithm that simulates that annealing process on a quantum computer, using quantum walks together with the quantum Zeno effect induced by randomizing the evolution. The cost is governed by δ, the minimum over the schedule of the gap between the largest and second largest eigenvalues of each Mᵢ, and the quantum algorithm requires only the square root of the classical dependence on that gap. The Zoo describes this construction as building upon results of Szegedy.",
    ideaJa: "古典のシミュレーテッドアニーリングでは、ある小さな ε に対して極限分布が |πₜ₊₁ − πₜ| < ε を満たす確率行列 M₁, M₂, …, Mₙ を順に適用し、準備しやすい π₁ から πₙ へ段階的に移します。これらの分布は通常、温度を下げていく熱平衡分布に対応します。Somma、Boixo、Barnum、Knill は、このシミュレーテッドアニーリング過程を量子計算機上でシミュレートする量子アルゴリズムを記述しており、そこでは量子ウォークと、時間発展のランダム化によって誘起される量子 Zeno 効果が用いられます。コストは各 Mᵢ の最大固有値と第2固有値の差の最小値 δ で決まり、量子アルゴリズムはこのギャップに対する古典の依存性の平方根で済みます。Zoo はこの構成を Szegedy の結果の上に構築されたものと位置づけています。",
    complexity: "Order 1/√δ steps to find an optimal solution with bounded error probability, where δ is the minimum spectral gap of the stochastic matrices used in the classical annealing process; this is a quadratic improvement over the order 1/δ steps required by the classical procedure.",
    complexityBasis: "abstract of arXiv:0804.1571 (TeX rendered as Unicode): \"It requires order 1/√δ steps to find an optimal solution with bounded error probability, where δ is the minimum spectral gap of the stochastic matrices used in the classical annealing process. This is a quadratic improvement over the order 1/δ steps required by the latter.\" The Zoo entry states the same contrast: \"The run time of this classical algorithm is proportional to 1/δ … quantum computers can sample from π_n with a runtime proportional to 1/√δ.\"",
    caveat: "Nothing here was constructed, compiled, simulated, or benchmarked; this is a literature record. The 1/√δ figure is a step count in the paper's own model, not a gate count, a qubit count, or a wall-clock time, and the cost of implementing one walk step is not stated in the cited abstract. δ is a property of a particular annealing schedule and class of instances, and neither the abstract nor the Zoo entry supplies δ, constant factors, or an error-correction budget for any concrete optimization problem, so no claim is made about which instances actually benefit or about hardware feasibility.",
    caveatJa: "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、ベンチマークは一切行っていません。1/√δ は論文のモデルにおけるステップ数であり、ゲート数、量子ビット数、実時間ではありません。1ステップの実装コストは引用した要旨に示されていません。δ は個々のシミュレーテッドアニーリングのスケジュールと問題例のクラスに依存する量で、要旨にも Zoo の記述にも、具体的な最適化問題に対する δ の値、定数因子、誤り訂正の見積もりは示されていません。したがって、どの問題例が実際に恩恵を受けるか、実機で実行可能かについては何も主張していません。",
    tags: ["simulated annealing", "quantum walk", "markov chain", "optimization", "spectral gap"],
    source: {
      id: "arxiv:0804.1571",
      title: "Quantum Simulations of Classical Annealing Processes",
      authors: "R. D. Somma, S. Boixo, H. Barnum, E. Knill",
      year: "2008",
      url: "https://arxiv.org/abs/0804.1571",
    },
    literature: [
      {
        title: "Quantum Simulations of Classical Annealing Processes",
        authors: "R. D. Somma, S. Boixo, H. Barnum, E. Knill",
        year: "2008",
        url: "https://arxiv.org/abs/0804.1571",
        relevance: "Primary source for the quantum construction: it states the quantum-walk plus evolution-randomization (quantum Zeno) mechanism, the order 1/√δ step count with bounded error probability, and the quadratic improvement over the classical order 1/δ.",
        relevanceJa: "量子的構成の一次資料です。量子ウォークと時間発展のランダム化による量子 Zeno 効果という機構、有界誤り確率での 1/√δ 程度のステップ数、古典の 1/δ に対する二次（二乗）の改善が述べられています。",
      },
    ],
    relatedSlugs: ["quantum-walk-line", "quantum-adiabatic-evolution", "qaoa-maxcut-ring"],
  },
  {
    slug: "decoded-quantum-interferometry",
    title: "Optimization by decoded quantum interferometry",
    titleJa: "復号量子干渉法（DQI）による最適化",
    family: "Optimization · decoded interferometry",
    zooName: "Optimization by Decoded Quantum Interferometry",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Superpolynomial",
    problem: "Given a set of constraints over a finite field, such as a max-XORSAT instance or the task of finding a degree-n polynomial over 𝔽ₚ that approximates a given data set as well as possible, produce an assignment that satisfies as many constraints as possible.",
    problemJa: "有限体上の制約集合、たとえばmax-XORSATインスタンスや、与えられたデータ集合を𝔽ₚ上でできるだけよく近似する次数nの多項式を求める課題に対し、満たす制約の数ができるだけ多い割り当てを出力します。",
    idea: "Decoded Quantum Interferometry uses the quantum Fourier transform to reduce the optimization problem to a decoding problem, so the number of constraints the output satisfies is set by the number of errors that can be decoded. When each constraint depends on only a few variables, the induced code is a classical LDPC code, which efficient classical decoders such as belief propagation handle at large error counts. When the constraints carry algebraic structure, as in polynomial fitting over 𝔽ₚ, that structure carries over to the decoding problem and yields Reed-Solomon codes, which classical algorithms decode up to half their distance; this is the regime where the paper claims its speedup. The construction is built on Regev's reduction.",
    ideaJa: "DQIは量子フーリエ変換を用いて最適化問題を復号問題へ帰着させ、出力が満たす制約の個数は復号できる誤りの個数によって決まります。各制約が少数の変数にしか依存しない場合、得られる符号は古典LDPC符号となり、信念伝播などの効率的な古典復号器が多数の誤りを訂正できます。制約に代数的構造がある場合、たとえば𝔽ₚ上の多項式フィッティングでは、その構造が復号問題側へ引き継がれてReed-Solomon符号となり、最小距離の半分まで古典的に復号できます。論文が高速化を主張しているのはこの領域で、全体はRegevの帰着の上に構成されています。",
    complexity: "",
    complexityBasis: 'abstract of arXiv:2408.08292: "For approximating optimal polynomial fits over finite fields, DQI achieves a superpolynomial speedup over known classical algorithms." That abstract states no explicit query, gate, or qubit count, and the Quantum Algorithm Zoo entry likewise quotes no bound, classing the entry as "Superpolynomial" and describing the polynomial-regression case as "apparent exponential speedup".',
    caveat: "This record cites a published claim; no circuit was constructed, simulated, run, or benchmarked here. The speedup is stated relative to known classical algorithms for optimal polynomial fits over finite fields rather than proven as a separation, and the paper itself reports that on the max-XORSAT instance it constructs, a tailored classical solver outperforms DQI even though DQI finds an approximate optimum significantly faster than general-purpose classical heuristics such as simulated annealing. How many constraints are satisfied is inherited from whichever decoder is used, so no approximation guarantee is recorded here independent of that decoder, and no qubit count, circuit depth, or fault-tolerance estimate is established.",
    caveatJa: "本項目は文献の主張を記録したものであり、回路の構成、シミュレーション、実行、ベンチマークはいずれも行っていません。超多項式的な高速化は有限体上の多項式フィッティングについて既知の古典アルゴリズムと比較した主張であり、分離の証明ではありません。論文自身も、構成したmax-XORSATインスタンスではDQIが焼きなまし法などの汎用的な古典ヒューリスティクスよりも大幅に速く近似最適解を見つける一方、専用の古典ソルバーはDQIを上回ると述べています。満たされる制約数は用いる復号器に依存するため、その復号器と独立した近似保証はここでは記録していません。量子ビット数、回路深さ、誤り耐性を含む資源見積もりも確立していません。",
    tags: ["optimization", "decoding", "quantum fourier transform", "ldpc", "reed-solomon"],
    source: {
      id: "arxiv:2408.08292",
      title: "Optimization by Decoded Quantum Interferometry",
      authors: "Stephen P. Jordan, Noah Shutty, Mary Wootters, Adam Zalcman, Alexander Schmidhuber, Robbie King, Sergei V. Isakov, Tanuj Khattar, Ryan Babbush",
      year: "2024",
      url: "https://arxiv.org/abs/2408.08292",
    },
    literature: [
      {
        title: "Optimization by Decoded Quantum Interferometry",
        authors: "Stephen P. Jordan, Noah Shutty, Mary Wootters, Adam Zalcman, Alexander Schmidhuber, Robbie King, Sergei V. Isakov, Tanuj Khattar, Ryan Babbush",
        year: "2024",
        url: "https://arxiv.org/abs/2408.08292",
        relevance: "Primary paper introducing DQI, the reduction from optimization to decoding via the quantum Fourier transform, the polynomial-fit speedup claim over finite fields, and the max-XORSAT instance on which DQI is compared with classical heuristics.",
        relevanceJa: "DQIを導入した一次文献です。量子フーリエ変換による最適化から復号への帰着、有限体上の多項式フィッティングにおける高速化の主張、古典ヒューリスティクスと比較したmax-XORSATインスタンスが記載されています。",
      },
    ],
    relatedSlugs: ["quantum-fourier-transform", "qaoa-maxcut-ring"],
  },
  {
    slug: "linear-differential-equations",
    title: "Quantum algorithms for linear differential equations",
    titleJa: "線形微分方程式を解く量子アルゴリズム",
    family: "Quantum differential equations · linear",
    zooName: "Solving Linear Differential Equations",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Superpolynomial",
    problem:
      "Given a first-order linear differential equation d/dt x = A(t)x + b(t) with N-dimensional vectors x and b and an N×N matrix A, and given an initial condition x(0), produce the solution x(t) at a later time t to precision ε, in the sense that the normalized vector x(t)/‖x(t)‖ returned is at distance at most ε from the exact solution.",
    problemJa:
      "N次元ベクトルxおよびbとN×N行列Aからなる一階線形微分方程式 d/dt x = A(t)x + b(t)について、初期条件x(0)が与えられたとき、後の時刻tにおける解x(t)を精度εで求める問題です。ここでの精度は、得られる規格化ベクトルx(t)/‖x(t)‖と厳密解との距離がε以下であることを指します。",
    idea:
      "Quantum simulation already handles the restricted linear differential equations that describe quantum systems; the construction extends it to general inhomogeneous sparse linear differential equations by turning time evolution into one large linear-algebra problem and handing that problem to a quantum linear algebra primitive. Berry discretizes the evolution with a high-order finite difference method, and it is the use of high-order methods that gives scaling close to Δt² in the evolution time Δt. The answer arrives as a superposition on O(log N) qubits whose amplitudes carry the components of x(t), from which global features of the solution can be extracted. The later Berry, Childs, Ostrander and Wang algorithm replaces the difference stencil with a Taylor series approximation of the propagator encoded in a sparse, well-conditioned linear system, which drops the extra hypotheses finite differences need for numerical stability.",
    ideaJa:
      "量子系を記述する限られた形の線形微分方程式は量子シミュレーションで既に扱えますが、この手法は時間発展を1つの大きな線形代数問題に帰着させ、量子線形代数プリミティブに渡すことで、一般の非斉次かつ疎な線形微分方程式へ拡張します。Berryは高次精度差分法で時間発展を離散化しており、高次精度であることにより発展時間Δtに対しΔt²に近いスケーリングが得られます。解はO(log N)量子ビット上の重ね合わせとして、その振幅にx(t)の成分が含まれる形で現れ、解の大域的な特徴を取り出せます。後続のBerry、Childs、Ostrander、Wangのアルゴリズムは、差分ステンシルの代わりに伝播作用素のTaylor展開を疎で条件の良い線形系に符号化し、差分法が数値安定性のために課していた追加の仮定を不要にします。",
    complexity:
      "Time O(t² poly(1/ε) poly log N) for the Berry algorithm, against O(t poly N) for the fastest classical algorithms; for systems with constant coefficients the Berry, Childs, Ostrander and Wang variant is polynomial in the logarithm of the inverse error, an exponential improvement in the precision dependence.",
    complexityBasis:
      'Quantum Algorithm Zoo entry "Solving Linear Differential Equations": "Berry gives a quantum algorithm for this problem that runs in time O(t^2 poly(1/epsilon) poly log N), whereas the fastest classical algorithms run in time O(t poly N)"; precision dependence from the abstract of arXiv:1701.03684: "The complexity of the algorithm is polynomial in the logarithm of the inverse error, an exponential improvement over previous quantum algorithms for this problem." The abstract of the primary paper arXiv:1010.2745 states only "scaling close to Δt² in the evolution time Δt", with no full cost expression.',
    caveat:
      "This is a literature record. No circuit was constructed, compiled, simulated, or run for it, and it carries no resource estimate. The bounds above are the Zoo's and the papers' own statements about sparse systems under the assumptions those papers adopt, checked against no instance data here; the Zoo itself notes that a general formulation leaves tasks such as preparation of the relevant initial state unspecified. The output is a normalized quantum state, so the cost of reading out individual components of x(t), as opposed to global features, is not established here, and neither are constant factors, condition-number dependence, or hardware feasibility.",
    caveatJa:
      "本項目は文献記録であり、回路の構成、コンパイル、シミュレーション、実行はいずれも行っていません。資源見積りも含みません。上記の計算量はZooと各論文が疎な系について自ら述べた主張であり、論文が置く仮定に依存します。ここで具体的な問題例に照らして検証したものではなく、Zoo自身も、一般的な定式化では該当する初期状態の準備などの作業が未規定のまま残ると述べています。出力は規格化された量子状態であるため、大域的な特徴ではなくx(t)の個々の成分を読み出すコストは本項目では確立されておらず、定数因子、条件数への依存、ハードウェア上の実現可能性も同様です。",
    tags: ["differential equations", "linear systems", "amplitude encoding", "sparse matrix"],
    source: {
      id: "arxiv:1010.2745",
      title: "High-order quantum algorithm for solving linear differential equations",
      authors: "Dominic W. Berry",
      year: "2010",
      url: "https://arxiv.org/abs/1010.2745",
    },
    literature: [
      {
        title: "High-order quantum algorithm for solving linear differential equations",
        authors: "Dominic W. Berry",
        year: "2010",
        url: "https://arxiv.org/abs/1010.2745",
        relevance:
          "The algorithm the Zoo entry cites for this problem: quantum simulation extended to general inhomogeneous sparse linear differential equations, with high-order methods giving scaling close to Δt² in the evolution time and the solution encoded in the amplitudes of the state.",
        relevanceJa:
          "Zooの項目がこの問題に対して挙げているアルゴリズムです。量子シミュレーションを一般の非斉次かつ疎な線形微分方程式へ拡張し、高次精度の手法により発展時間Δtに対しΔt²に近いスケーリングを与え、解は状態の振幅に符号化されます。",
      },
      {
        title:
          "Quantum algorithm for linear differential equations with exponentially improved dependence on precision",
        authors: "Dominic W. Berry, Andrew M. Childs, Aaron Ostrander, Guoming Wang",
        year: "2017",
        url: "https://arxiv.org/abs/1701.03684",
        relevance:
          "The improvement the Zoo credits with bringing the error dependence down to a polynomial in log(1/ε): for constant-coefficient systems the evolution is encoded into a sparse, well-conditioned linear system approximating the propagator by a Taylor series, which unlike finite differences needs no extra hypotheses for numerical stability.",
        relevanceJa:
          "Zooが誤差依存性をlog(1/ε)の多項式まで下げたと評価している改良です。定数係数の系について、伝播作用素をTaylor展開で近似した疎で条件の良い線形系に時間発展を符号化しており、差分法と異なり数値安定性のための追加仮定を必要としません。",
      },
    ],
    relatedSlugs: [
      "hhl-linear-systems",
      "linear-combination-unitaries",
      "quantum-singular-value-transformation",
      "hamiltonian-simulation-ising",
    ],
  },
  {
    slug: "nonlinear-differential-equations",
    title: "Quantum algorithms for nonlinear differential equations",
    titleJa: "非線形微分方程式を解く量子アルゴリズム",
    family: "Quantum differential equations · nonlinear",
    zooName: "Solving Nonlinear Differential Equations",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Superpolynomial",
    problem:
      "Given a system of nonlinear ordinary differential equations, in the primary algorithm's case a dissipative quadratic n-dimensional system, produce the solution at a chosen evolution time T to error ε, encoded in the amplitudes of a quantum state.",
    problemJa:
      "非線形の常微分方程式系、とりわけ本項目の主論文が扱う散逸的な二次のn次元系について、指定した発展時間Tにおける解を誤差ε以内で求め、量子状態の振幅に符号化して出力する問題です。",
    idea:
      "Carleman linearization maps the nonlinear system to an infinite-dimensional system of linear differential equations, which is then truncated, discretized with the forward Euler method, and solved with the quantum linear system algorithm; the paper supplies a new convergence theorem for the Carleman linearization. Efficiency is conditional on the parameter R, which compares the nonlinearity and the forcing against the linear dissipation, staying below 1, and the same work proves a worst-case lower bound making general quadratic differential equations intractable once R ≥ √2. Exponential decay of the solution precludes efficiency, but driven equations can avoid that issue despite the presence of dissipation. The earlier route of Leyton and Osborne is structurally different: it combines a subroutine that applies a nonlinear transformation to the probability amplitudes of an unknown state with a quantum implementation of Euler's method, and is nondeterministic.",
    ideaJa:
      "Carleman線形化により非線形系を無限次元の線形微分方程式系へ写し、これを打ち切って離散化し、前進Euler法と量子線形システムアルゴリズムで解きます。論文はこのCarleman線形化に対する新しい収束定理を与えています。効率性は、非線形項と強制項を線形散逸と比べたパラメータRが1未満であることを前提としており、同じ論文はR ≥ √2では一般の二次の微分方程式が困難であるという最悪計算量の下界も示しています。解が指数的に減衰する場合は効率が失われますが、散逸があっても駆動項のある方程式であればこの問題を避けられます。より初期のLeytonとOsborneの手法は構成が異なり、未知状態の確率振幅に非線形変換を施すサブルーチンとEuler法の量子的実装を組み合わせた非決定的なアルゴリズムです。",
    complexity:
      "For dissipative quadratic n-dimensional ODEs with R < 1, complexity T² q poly(log T, log n, log 1/ε)/ε, where T is the evolution time, ε the allowed error and q measures decay of the solution; a worst-case lower bound in the same paper shows the general quadratic problem is intractable for R ≥ √2. The earlier Leyton and Osborne algorithm has expected resource requirements polylogarithmic in the number of variables but exponential in the integration time, against a best classical algorithm scaling linearly in the number of variables.",
    complexityBasis:
      'abstract of arXiv:2011.03185: "Assuming R < 1, where R is a parameter characterizing the ratio of the nonlinearity and forcing to the linear dissipation, this algorithm has complexity T^2 q poly(log T, log n, log 1/epsilon)/epsilon, where T is the evolution time, epsilon is the allowed error, and q measures decay of the solution", and "a lower bound on the worst-case complexity of quantum algorithms for general quadratic differential equations, showing that the problem is intractable for R >= sqrt(2)"; second bound from the abstract of arXiv:0812.4423: "its expected resource requirements are polylogarithmic in the number of variables and exponential in the integration time. The best classical algorithm runs in a time scaling linearly with the number of variables."',
    caveat:
      "This is a literature record. Nothing was executed for it: no circuit was built, compiled, simulated, or benchmarked, and no resource count is claimed. The T² bound holds only inside the stated regime, a dissipative quadratic system with R < 1, and says nothing about systems outside it; the paper's support for larger R in a fluid-dynamics model is described in its own abstract as numerical evidence, not a proof. Because the solution lives in the amplitudes of a quantum state, unitarity means the approach is inefficient when the solution's norm grows or shrinks too rapidly, and the cost of reading individual solution components back out is not established here, nor are constant factors, the input-access model, or hardware feasibility.",
    caveatJa:
      "本項目は文献記録です。回路の構成、コンパイル、シミュレーション、ベンチマークはいずれも行っておらず、資源量の主張も含みません。T²の計算量は、R < 1を満たす散逸的な二次の系という限られた条件の中でのみ成り立ち、その外側の系については何も述べていません。より大きなRを含む流体力学モデルへの適用可能性は、論文の要旨自身が数値的な証拠として述べているものであり、証明ではありません。解が量子状態の振幅に置かれるため、ユニタリ性により解のノルムが急激に増大または減少する場合には効率が失われます。個々の解成分を読み出すコスト、定数因子、入力アクセスモデル、ハードウェア上の実現可能性は、いずれも本項目では確立していません。",
    tags: ["differential equations", "nonlinear", "carleman linearization", "amplitude encoding"],
    source: {
      id: "arxiv:2011.03185",
      title: "Efficient quantum algorithm for dissipative nonlinear differential equations",
      authors:
        "Jin-Peng Liu, Herman Øie Kolden, Hari K. Krovi, Nuno F. Loureiro, Konstantina Trivisa, Andrew M. Childs",
      year: "2020",
      url: "https://arxiv.org/abs/2011.03185",
    },
    literature: [
      {
        title: "Efficient quantum algorithm for dissipative nonlinear differential equations",
        authors:
          "Jin-Peng Liu, Herman Øie Kolden, Hari K. Krovi, Nuno F. Loureiro, Konstantina Trivisa, Andrew M. Childs",
        year: "2020",
        url: "https://arxiv.org/abs/2011.03185",
        relevance:
          "The Carleman linearization algorithm the Zoo credits with T² scaling, together with its convergence theorem, its R < 1 condition, and the accompanying intractability bound for R ≥ √2; it also reports that the condition can be met in realistic epidemiological models.",
        relevanceJa:
          "ZooがT²のスケーリングを与えるとしているCarleman線形化に基づくアルゴリズムです。収束定理、R < 1という条件、R ≥ √2での困難性の下界を示し、この条件が現実的な感染症モデルで満たされうることも報告しています。",
      },
      {
        title: "A quantum algorithm to solve nonlinear differential equations",
        authors: "Sarah K. Leyton, Tobias J. Osborne",
        year: "2008",
        url: "https://arxiv.org/abs/0812.4423",
        relevance:
          "The earlier approach the Zoo describes as exponential in t: a nondeterministic algorithm for sparse nonlinear systems with polynomial nonlinear terms, built from a nonlinear transformation of the amplitudes of an unknown state and a quantum implementation of Euler's method.",
        relevanceJa:
          "Zooが時間tについて指数的と述べている初期の手法です。非線形項が多項式である疎な非線形系を対象とし、未知状態の振幅への非線形変換とEuler法の量子的実装から構成される非決定的なアルゴリズムです。",
      },
    ],
    relatedSlugs: ["hhl-linear-systems", "linear-combination-unitaries", "amplitude-amplification"],
  },
];

/** The Zoo entry each record covers — read by scripts/check-zoo-parity.mjs. */
export const ZOO_PARITY_COVERAGE: ReadonlyArray<{ slug: string; zooName: string }> =
  ZOO_ALGORITHMS.map((concept) => ({ slug: concept.slug, zooName: concept.zooName }));

function zooEntry(concept: ZooAlgorithm): PublicRepositoryEntry {
  const complexityLine = concept.complexity === ""
    ? "Not stated by the sources read"
    : concept.complexity;
  return makeReferenceEntry({
    slug: concept.slug,
    title: concept.title,
    titleJa: concept.titleJa,
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: concept.family,
    framework: "Qiskit",
    status: "verified_caveats",
    verification:
      "Literature record · problem statement and speedup class checked against the Quantum Algorithm Zoo entry"
      + " · primary reference checked against its arXiv abs page",
    verificationMethods: ["research_paper"],
    method:
      "Curation only. The problem statement and speedup class were checked against the Quantum Algorithm Zoo's"
      + ` entry "${concept.zooName}" (${concept.zooSection}); the primary reference's title, authors and`
      + " submission year were read from its arXiv abs page; the complexity claim was taken from a clause of that"
      + ` paper's abstract (${concept.complexityBasis}). No circuit was constructed, simulated or run.`,
    result:
      "Pass · the record's problem, speedup class and primary reference agree with the two sources named above.",
    caveat: concept.caveat,
    exportStatus: "Literature reference · no circuit supplied",
    provenance: "Leona Quantum Zoo-parity intake",
    updatedAt: "2026-08-12",
    description: concept.problem,
    descriptionJa: concept.problemJa,
    introduction: `${concept.problem} ${concept.idea}`,
    introductionJa: `${concept.problemJa}${concept.ideaJa}`,
    explanation:
      `${concept.idea} The Quantum Algorithm Zoo files this under ${concept.zooSection} with speedup class`
      + ` "${concept.speedup}". ${
        concept.complexity === ""
          ? `The sources read state no complexity bound for this record (${concept.complexityBasis}).`
          : `Reported cost: ${concept.complexity}.`
      }`,
    explanationJa:
      `${concept.ideaJa}Quantum Algorithm Zooでは「${concept.zooSection}」に分類され、速度向上の区分は`
      + `「${concept.speedup}」です。${
        concept.complexity === ""
          ? "参照した出典は本記録に対する計算量の上界を述べていません。"
          : `報告されている計算量は ${concept.complexity} です。`
      }`,
    tags: concept.tags,
    resources: [
      { label: "Record type", value: "Literature reference" },
      // Named for whose classification it is. The Zoo assigns a speedup class to
      // its *entry* — sometimes to a whole section of them — and a reader who sees
      // a bare "Speedup" on a single-paper record will read it as a claim this
      // record is making about that paper. It is not; it is a quotation.
      { label: "Speedup class (Quantum Algorithm Zoo)", value: concept.speedup },
      { label: "Reported cost", value: complexityLine },
    ],
    metadata: [
      { label: "Quantum Algorithm Zoo entry", value: concept.zooName },
      { label: "Zoo section", value: concept.zooSection },
      { label: "Complexity basis", value: concept.complexityBasis },
      { label: "Circuit", value: "Not supplied" },
    ],
    sourceTitle: concept.source.title,
    sourceUrl: concept.source.url,
    sourceLicense: "Citation metadata only; source publication terms apply",
    wires: ["problem", "algorithm", "readout"],
    operations: [
      { label: "encode", qubits: [0], tone: "neutral" },
      { label: "transform", qubits: [0, 1], tone: "accent" },
      { label: "measure", qubits: [1, 2], tone: "warn" },
    ],
    outcomes: [],
    code:
      `ALGORITHM: ${concept.title}\n`
      + `PROBLEM: ${concept.problem}\n`
      + `IDEA: ${concept.idea}\n`
      + `REPORTED COST: ${complexityLine}\n`
      + `BASIS: ${concept.complexityBasis}\n`
      + `PRIMARY SOURCE: ${concept.source.authors} (${concept.source.year}), ${concept.source.title} — ${concept.source.url}\n\n`
      + "This is a literature reference record, not an executable circuit.",
    filename: `${concept.slug}.txt`,
    language: "text",
    relatedSlugs: concept.relatedSlugs,
    // The primary source is always cited. A concept that already carries its own,
    // better-written line for that same url keeps it — citing one paper twice under
    // two different `relevance` strings is how a record starts disagreeing with itself.
    literature: (concept.literature ?? []).some((cited) => cited.url === concept.source.url)
      ? concept.literature ?? []
      : [
        {
          title: concept.source.title,
          authors: concept.source.authors,
          year: concept.source.year,
          url: concept.source.url,
          relevance: `Primary reference for ${concept.title.toLowerCase()}; the source of this record's cost claim.`,
          relevanceJa: `${concept.titleJa}の主要文献であり、本記録の計算量の出典です。`,
        },
        ...(concept.literature ?? []),
      ],
  });
}

export const ZOO_PARITY_ENTRIES: PublicRepositoryEntry[] = ZOO_ALGORITHMS.map(zooEntry);
