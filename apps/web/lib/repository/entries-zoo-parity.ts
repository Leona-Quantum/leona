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
  {
    slug: "matrix-product-verification",
    title: "Matrix product verification by quantum walk",
    titleJa: "量子ウォークによる行列積の検証",
    family: "Quantum query algorithm",
    zooName: "Verifying Matrix Products",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Polynomial",
    problem:
      "Given three n×n matrices A, B and C over a field, decide whether AB = C, rather than computing the product and comparing it entry by entry.",
    problemJa:
      "体上の n×n 行列 A, B, C が三つ与えられたとき、積を計算して成分ごとに比べるのではなく、AB = C が成り立つかどうかを判定する問題です。",
    idea:
      "The paper describes a quantum algorithm that decides whether AB = C over any field with bounded error. Its cost is sensitive to how wrong the claimed product is: the worst-case time is n^(5/3), while the expected time is n^(5/3) / min(w, √n)^(1/3) when w entries are wrong, so the expected figure falls as w grows until w reaches √n, past which the minimum in the denominator stops changing. The Zoo records that this algorithm rests on results about quantum walks proven in a separate paper, and that it improves the n^(7/4) algorithm the Zoo credits to Ambainis et al. The same paper also presents a quantum matrix multiplication algorithm that its authors describe as efficient when the result has few nonzero entries.",
    ideaJa:
      "この論文は、任意の体上で AB = C が成り立つかどうかを有界誤りで判定する量子アルゴリズムを示しています。コストは主張された積がどれだけ誤っているかに依存し、最悪時間は n^(5/3) である一方、誤っている成分が w 個ある場合の期待時間は n^(5/3) / min(w, √n)^(1/3) となります。この期待時間は w が大きくなるほど小さくなりますが、w が √n に達したあとは分母の min が変わらなくなります。Zoo は、このアルゴリズムが別の論文で証明された量子ウォークに関する結果に基づいており、Zoo が Ambainis らに帰する n^(7/4) のアルゴリズムを改良したものだと記しています。同じ論文には、結果の非零成分が少ない場合に効率的だと著者らが述べる、行列の積を計算する量子アルゴリズムも示されています。",
    complexity:
      "Worst-case time n^(5/3) to verify a product of two n×n matrices over any field with bounded error, and expected time n^(5/3) / min(w, √n)^(1/3), where w is the number of wrong entries; the Zoo gives O(n^(7/4)) for the earlier quantum algorithm it credits to Ambainis et al., O(n^2) for the best known randomized classical verification, and O(n^(2.373)) for the best known classical matrix multiplication.",
    complexityBasis:
      'abstract of arXiv:quant-ph/0409035: "We present a quantum algorithm that verifies a product of two n*n matrices over any field with bounded error in worst-case time n^{5/3} and expected time n^{5/3} / min(w,sqrt(n))^{1/3}, where w is the number of wrong entries. This improves the previous best algorithm that runs in time n^{7/4}." The comparison figures are from the Quantum Algorithm Zoo entry "Verifying Matrix Products" (LaTeX rendered into plain text): "Classically, the best known (randomized) algorithm achieves this in time O(n^2), whereas the best known classical algorithm for matrix multiplication runs in time O(n^{2.373})", "Ambainis et al. discovered a quantum algorithm for this problem with runtime O(n^{7/4})", and "Buhrman and Špalek improved upon this, obtaining a quantum algorithm for this problem with runtime O(n^{5/3})". The Zoo spells the second author Špalek; the author list recorded for the primary reference gives Robert Spalek, which is the spelling carried in the source field.',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated, or run, and no matrix instance was verified. The abstract states its times as bare n^(5/3) and n^(5/3) / min(w, √n)^(1/3), with no O(·) notation, constant factor, gate or qubit count, and no statement of how the entries of A, B and C are made available, so nothing here bounds the cost of a concrete n. The expected-time refinement is governed by w, the number of wrong entries in the claimed product, which is a property of the instance and is not known in advance; the worst-case figure is the one that holds without it. The classical baselines are the fastest algorithms currently known, as the Zoo says, not proven lower bounds, so the polynomial separation is conditional on that state of the art. The quantum-walk results the algorithm is built on, and the earlier n^(7/4) algorithm it improves, are in papers outside this record, and the second result in the same abstract, a quantum matrix multiplication algorithm for results with few nonzero entries, is described only as efficient, with no bound quoted anywhere in the sources read here.",
    caveatJa:
      "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な行列の検証も行っていません。要旨は計算時間を n^(5/3) および n^(5/3) / min(w, √n)^(1/3) とだけ述べており、O(·) の記法も定数因子もゲート数も量子ビット数も示されず、A, B, C の各成分をどのように参照するかも述べられていないため、具体的な n におけるコストはここからは分かりません。期待時間の改善は主張された積のうち誤っている成分の個数 w に支配されますが、w は問題例ごとの性質であり事前には分かりません。w に依存せず成り立つのは最悪時間のほうです。古典側は Zoo が述べるとおり現在知られている最速のアルゴリズムであって証明された下界ではないため、多項式的な差はその前提に依存します。アルゴリズムの土台となる量子ウォークの結果も、改良の対象である n^(7/4) のアルゴリズムも本記録の対象外の論文にあり、同じ要旨のもう一つの結果である、非零成分が少ない場合の行列の積を計算する量子アルゴリズムについては「効率的」と述べられるのみで、ここで参照した資料には計算量の記載がありません。",
    tags: ["matrix verification", "quantum walk", "linear algebra", "query complexity", "bounded error"],
    source: {
      id: "arxiv:quant-ph/0409035",
      title: "Quantum Verification of Matrix Products",
      authors: "Harry Buhrman, Robert Spalek",
      year: "2004",
      url: "https://arxiv.org/abs/quant-ph/0409035",
    },
    literature: [
      {
        title: "Quantum Verification of Matrix Products",
        authors: "Harry Buhrman, Robert Spalek",
        year: "2004",
        url: "https://arxiv.org/abs/quant-ph/0409035",
        relevance: "Primary source and the origin of every figure in the cost claim: bounded-error verification of an n×n matrix product over any field in worst-case time n^(5/3), the expected time n^(5/3) / min(w, √n)^(1/3) in terms of the number w of wrong entries, and the improvement on the previous n^(7/4) algorithm. The same abstract announces a quantum matrix multiplication algorithm for the case where the result has few nonzero entries; consult the paper for what that algorithm costs, since the abstract states no bound for it.",
        relevanceJa: "一次資料であり、計算量欄の数値はすべてここに由来します。任意の体上での n×n 行列積の有界誤り検証が最悪時間 n^(5/3) であること、誤っている成分の個数 w を用いた期待時間 n^(5/3) / min(w, √n)^(1/3)、および従来の n^(7/4) のアルゴリズムに対する改良が述べられています。同じ要旨では、結果の非零成分が少ない場合に向けた行列の積を計算する量子アルゴリズムにも触れていますが、その計算量は要旨に示されていないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["quantum-walk-line", "element-distinctness", "grover-unstructured-search"],
  },
  {
    slug: "polynomial-interpolation",
    title: "Polynomial interpolation from oracle queries",
    titleJa: "オラクルクエリによる多項式補間",
    family: "Quantum query algorithm",
    zooName: "Polynomial interpolation",
    zooSection: "Oracular Algorithms",
    speedup: "Varies",
    problem:
      "Given an oracle that returns the value p(x) of an unknown degree-d polynomial p over the finite field GF(q) at any queried point x, determine the coefficients of p using as few queries as possible.",
    problemJa:
      "有限体 GF(q) 上の未知の d 次多項式 p について、問い合わせた点 x での値 p(x) を返すオラクルが与えられたとき、できるだけ少ないクエリ数で p の係数を決定する問題です。",
    idea:
      "Classically the d + 1 coefficients cannot be pinned down with fewer than d + 1 queries, and a lower bound proved independently by Kane and Kutin and by Meyer and Pommersheim puts the quantum cost at d/2 + 1/2 queries. Childs, van Dam, Hung and Shparlinski describe an algorithm that attains that lower bound rather than the d queries of the earlier Boneh and Zhandry algorithm, and they show that its success probability, as a function of the number of queries, is precisely optimal. Their abstract states that the algorithm can be implemented with gate complexity poly(log q) with negligible decrease in the success probability. Chen, Childs and Hung carry the same question to a degree-d polynomial in n variables, where their abstract reports a speedup over the classical count (n+d choose d) by a factor of n+1 over ℂ, (n+1)/2 over ℝ and (n+d)/d over GF(q), which it calls a much larger gap than the factor of 2 available in the univariate case.",
    ideaJa:
      "古典的には、d + 1 個の係数を決めるのに d + 1 クエリが必要であり、Kane と Kutin、および Meyer と Pommersheim がそれぞれ独立に証明した下界により、量子では d/2 + 1/2 クエリが必要です。Childs、van Dam、Hung、Shparlinski は、先行する Boneh と Zhandry のアルゴリズムの d クエリではなく、この下界に到達するアルゴリズムを示し、クエリ数の関数としての成功確率がちょうど最適であることも示しています。要旨によれば、このアルゴリズムはゲート計算量 poly(log q) で実装でき、その際の成功確率の低下は無視できる程度です。Chen、Childs、Hung は同じ問いを n 変数の d 次多項式へ広げており、古典のクエリ計算量 (n+d choose d) に対して、ℂ 上では n+1 倍、ℝ 上では (n+1)/2 倍、GF(q) 上では (n+d)/d 倍の高速化が得られると要旨は述べており、これは一変数の場合に得られる 2 倍の高速化よりもはるかに大きな差だとしています。",
    complexity:
      "Univariate over GF(q): d/2 + 1/2 quantum queries suffice to determine a degree-d polynomial with bounded error, which matches the lower bound, and d/2 + 1 queries suffice for success probability approaching 1 at large q, against d + 1 queries necessary and sufficient classically; the algorithm can be implemented with gate complexity poly(log q) with negligible decrease in the success probability. Multivariate, for degree d in n variables: ⌈(1/(n+1))·(n+d choose d)⌉ queries suffice for probability 1 over ℂ and twice that over ℝ, except for d = 2 and four other special cases, and ⌈(d/(n+d))·(n+d choose d)⌉ queries suffice for probability approaching 1 over GF(q) at large field order, against a classical query complexity of (n+d choose d).",
    complexityBasis:
      'abstract of arXiv:1509.09271: "A lower bound shown independently by Kane and Kutin and by Meyer and Pommersheim shows that d/2+1/2 quantum queries are needed to solve this problem with bounded error, whereas an algorithm of Boneh and Zhandry shows that d quantum queries are sufficient. We show that the lower bound is achievable: d/2+1/2 quantum queries suffice to determine the polynomial with bounded error. Furthermore, we show that d/2+1 queries suffice to achieve probability approaching 1 for large q", and "the algorithm can be implemented with gate complexity poly(log q) with negligible decrease in the success probability". The classical univariate count is from the Quantum Algorithm Zoo entry "Polynomial interpolation" (LaTeX rendered into plain text): "Classically, d + 1 queries are necessary and sufficient." The multivariate figures are from the abstract of arXiv:1701.03990, with TeX rendered into Unicode, the binomial written as (n+d choose d) and the subscript of k written as C rather than ℂ: "We show that k_C and 2k_C queries suffice to achieve probability 1 for ℂ and ℝ, respectively, where k_C=⌈(1/(n+1))(n+d choose d)⌉ except for d=2 and four other special cases. For 𝔽_q, we show that ⌈(d/(n+d))(n+d choose d)⌉ queries suffice to achieve probability approaching 1 for large field order q", and "The classical query complexity of this problem is (n+d choose d), so our result provides a speedup by a factor of n+1, (n+1)/2, and (n+d)/d for ℂ, ℝ, and 𝔽_q, respectively." Outside the quotations the finite field is written GF(q) throughout, as in the Zoo entry; the multivariate paper writes the same field as a blackboard-bold F with subscript q, and the Zoo states the multivariate quantum counts in O(·) form rather than as the paper\'s ceilings.',
    caveat:
      "This is a literature record: no oracle was instantiated, no circuit was compiled, simulated, or run, and no polynomial was reconstructed here. Every count above is a number of queries in the oracle model, and the two univariate upper bounds are not interchangeable, since d/2 + 1/2 queries are for bounded error while d/2 + 1 queries buy success probability approaching 1 and hold for large q, an asymptotic statement in the field order rather than a guarantee at a fixed q. The multivariate ⌈(1/(n+1))·(n+d choose d)⌉ count is stated with exceptions, for d = 2 and four other special cases, the GF(q) multivariate result again requires large field order, and the authors leave open their conjecture that twice that count also suffices over GF(q). The gate complexity poly(log q) is quoted with no exponent or constant, and no qubit count, circuit depth, or error-correction cost is established. The abstract's cryptographic remark, that these upper bounds improve results of Boneh and Zhandry on the insecurity of cryptographic protocols against quantum attacks, is a statement about query bounds, not a demonstrated attack on any deployed protocol. The remaining variants collected in the same Zoo entry, an oracle returning a quadratic character χ(f(x)), an oracle returning f(x)^e, and reconstruction of rational functions from noisy and incomplete values, rest on papers outside this record, and the speedup class \"Varies\" is the Zoo's classification of its entry rather than anything measured here.",
    caveatJa:
      "本項目は文献に基づく記録であり、オラクルを具体化したことも、回路をコンパイル・シミュレート・実行したことも、実際に多項式を復元したこともありません。上記の数値はいずれもオラクルモデルにおけるクエリ数です。一変数の二つの上界は互換ではなく、d/2 + 1/2 は有界誤りに対する値であるのに対し、d/2 + 1 は成功確率が 1 に近づく場合の値で、しかも q が大きい極限での主張であり、特定の q における保証ではありません。多変数の ⌈(1/(n+1))·(n+d choose d)⌉ には d = 2 とその他四つの特別な場合という例外が付き、GF(q) 上の結果も体の位数が大きい場合の主張です。GF(q) 上でもその 2 倍のクエリ数で足りるという予想は、著者らによって未解決のまま残されています。ゲート計算量 poly(log q) は指数も定数も伴わない形で引用したものであり、量子ビット数、回路深さ、誤り訂正のコストはいずれも確立していません。要旨の暗号に関する言及、すなわちこれらの上界が Boneh と Zhandry による暗号プロトコルの量子攻撃に対する脆弱性の結果を改良するという記述は、クエリ数の上界についての主張であって、実運用されているプロトコルへの攻撃を実証したものではありません。同じ Zoo 項目にまとめられている他の変種、すなわち二次指標 χ(f(x)) を返すオラクル、f(x)^e を返すオラクル、雑音を含む不完全な値からの有理関数の復元は、本記録の対象外の論文に基づきます。速度向上の区分「Varies」も Zoo による項目の分類であって、ここで測定した結果ではありません。",
    tags: ["polynomial interpolation", "oracle", "query complexity", "finite field", "multivariate"],
    source: {
      id: "arxiv:1509.09271",
      title: "Optimal quantum algorithm for polynomial interpolation",
      authors: "Andrew M. Childs, Wim van Dam, Shih-Han Hung, Igor E. Shparlinski",
      year: "2015",
      url: "https://arxiv.org/abs/1509.09271",
    },
    literature: [
      {
        title: "Optimal quantum algorithm for polynomial interpolation",
        authors: "Andrew M. Childs, Wim van Dam, Shih-Han Hung, Igor E. Shparlinski",
        year: "2015",
        url: "https://arxiv.org/abs/1509.09271",
        relevance: "Primary source for the univariate bounds: it reports that the d/2 + 1/2 lower bound of Kane and Kutin and of Meyer and Pommersheim is achievable with bounded error, that d/2 + 1 queries reach success probability approaching 1 for large q, that the success probability as a function of the number of queries is precisely optimal, and that gate complexity poly(log q) suffices with negligible decrease in that probability. It ends with a conjecture about the quantum query complexity of multivariate interpolation, which the companion paper below takes up.",
        relevanceJa: "一変数の場合の上界の一次資料です。Kane と Kutin、Meyer と Pommersheim による下界 d/2 + 1/2 が有界誤りで達成可能であること、d/2 + 1 クエリで成功確率が 1 に近づくこと（q が大きい場合）、クエリ数の関数としての成功確率がちょうど最適であること、成功確率の低下を無視できる範囲でゲート計算量 poly(log q) の実装が可能であることが述べられています。末尾には多変数補間の量子クエリ計算量に関する予想が置かれており、それを引き継ぐのが下記の論文です。",
      },
      {
        title: "Quantum algorithm for multivariate polynomial interpolation",
        authors: "Jianxin Chen, Andrew M. Childs, Shih-Han Hung",
        year: "2017",
        url: "https://arxiv.org/abs/1701.03990",
        relevance: "The multivariate half of the same Zoo entry. The authors present and analyze algorithms over GF(q), ℝ and ℂ, report that ⌈(1/(n+1))·(n+d choose d)⌉ and twice that many queries suffice for probability 1 over ℂ and ℝ apart from d = 2 and four other special cases, and that ⌈(d/(n+d))·(n+d choose d)⌉ queries suffice over GF(q) at large field order, giving speedup factors of n+1, (n+1)/2 and (n+d)/d against the classical (n+d choose d). Consult it for the special cases and for the conjecture it leaves open over GF(q).",
        relevanceJa: "同じ Zoo 項目のうち多変数の側を担う論文です。GF(q)、ℝ、ℂ 上のアルゴリズムを提示・解析し、d = 2 とその他四つの特別な場合を除いて、ℂ では ⌈(1/(n+1))·(n+d choose d)⌉ クエリ、ℝ ではその 2 倍のクエリで成功確率 1 が得られること、GF(q) では体の位数が大きい場合に ⌈(d/(n+d))·(n+d choose d)⌉ クエリで足りることを報告し、古典の (n+d choose d) に対してそれぞれ n+1 倍、(n+1)/2 倍、(n+d)/d 倍の高速化になると述べています。例外となる場合や GF(q) 上で未解決のまま残された予想は原論文で確認してください。",
      },
    ],
    relatedSlugs: ["hidden-shift-problem", "bernstein-vazirani-qiskit", "ordered-search"],
  },
  {
    slug: "string-pattern-matching",
    title: "String pattern matching by quantum search and deterministic sampling",
    titleJa: "量子探索と決定的サンプリングによる文字列パターン照合",
    family: "Quantum query algorithm",
    zooName: "Pattern matching",
    zooSection: "Oracular Algorithms",
    speedup: "Superpolynomial",
    problem:
      "Given a text T of length n and a pattern P of length m < n, both over a finite alphabet, find an occurrence of P as a substring of T or report that P is not a substring of T. The Zoo also states the problem for d-dimensional arrays rather than strings, where the task is to return the location of P as an m × m × ... × m block within the n × n × ... × n array T or report that no such location exists.",
    problemJa:
      "有限アルファベット上の長さ n のテキスト T と長さ m (< n) のパターン P が与えられたとき、T の部分文字列として P が現れる位置を一つ見つけるか、P が T の部分文字列ではないことを報告する問題です。また Zoo は、文字列ではなく d 次元配列を対象とする形でもこの問題を述べています。その場合は、n × n × ... × n の配列 T の中に P が m × m × ... × m のブロックとして現れる位置を返すか、そのような位置が存在しないことを報告します。",
    idea:
      "Ramesh and Vinay describe an algorithm that combines quantum searching algorithms with a technique from parallel string matching called deterministic sampling, which the Zoo restates as Grover's algorithm used together with that classical method. The Zoo records that the Ω(√N) query lower bound for unstructured search implies a worst-case quantum query complexity of Ω(√n + √m) for this problem, and that a quantum algorithm achieving that bound up to logarithmic factors was obtained in a work it identifies only by a reference number; the Ramesh and Vinay abstract separately states a running time of Õ(√n + √m), a bound of a different kind, so this record does not assert that the two are the same result. Montanaro's later work takes a different route to the average case in d dimensions: the Zoo describes it as generalizing Kuperberg's quantum sieve algorithm for the dihedral hidden subgroup and hidden shift problems so that it operates in d dimensions and accommodates small amounts of noise, after which pattern matching is classically reduced to that noisy d-dimensional hidden shift. The superpolynomial label the Zoo attaches to this entry belongs to that average-case result: the Zoo states that superpolynomial quantum speedup can be achieved on average-case instances provided m is greater than logarithmic in n.",
    ideaJa:
      "Ramesh と Vinay は、量子探索アルゴリズムと、並列文字列照合の技法である決定的サンプリングを組み合わせたアルゴリズムを記述しており、Zoo はこれを Grover のアルゴリズムとその古典的手法の併用として言い換えています。Zoo によれば、非構造化探索に対する Ω(√N) のクエリ下界から、この問題の最悪時の量子クエリ計算量は Ω(√n + √m) となり、この下界を対数因子を除いて達成する量子アルゴリズムが得られていますが、Zoo はその出典を参照番号でしか示していません。Ramesh と Vinay の要旨が述べるのは Õ(√n + √m) の実行時間であり、これは種類の異なる評価であるため、本記録は両者を同一の結果としては扱いません。Montanaro の後年の研究は、d 次元における平均的な場合へ別の道筋で到達しています。Zoo の説明では、二面体隠れ部分群問題および隠れシフト問題に対する Kuperberg の量子ふるいアルゴリズムを、d 次元で動作し少量の雑音を許容するように一般化したうえで、パターン照合をこの雑音を含む d 次元の隠れシフト問題へ古典的に帰着させます。Zoo がこの項目に与えている超多項式的という区分はこの平均的な場合の結果に対するものであり、Zoo は、m が n の対数より大きい場合に平均的な問題例で超多項式的な量子高速化が得られると述べています。",
    complexity:
      "Õ(√n + √m) quantum time to determine whether a pattern of length m occurs in a text of length n, with inverse polynomial failure probability, where Õ allows for logarithmic factors in m and n/m; the Zoo gives Ω(√n + √m) as the worst-case quantum query complexity of the problem, implied by the Ω(√N) lower bound for unstructured search. For the average case in d dimensions, Montanaro's algorithm solves the pattern matching problem for random patterns and texts in time Õ((n/m)^(d/2) 2^(O(d^(3/2) √(log m)))), against Ω̃((n/m)^d + n^(d/2)) for the best possible classical algorithm, a separation Montanaro's abstract calls super-polynomial for large m.",
    complexityBasis:
      'abstract of arXiv:quant-ph/0011049 (TeX rendered as Unicode throughout: tilde O and widetilde O as Õ, widetilde Omega as Ω̃; square-bracket reference numbers dropped from the Zoo quote): "We show how to determine whether a given pattern p of length m occurs in a given text t of length n in Õ(√n+√m) [abstract footnote: Õ allows for logarithmic factors in m and n/m] time, with inverse polynomial failure probability. This algorithm combines quantum searching algorithms with a technique from parallel string matching, called Deterministic Sampling."; Quantum Algorithm Zoo entry "Pattern matching": "The Ω(√N) query lower bound for unstructured search implies that the worst-case quantum query complexity of this problem is Ω(√n + √m). A quantum algorithm achieving this, up to logarithmic factors, was obtained"; abstract of arXiv:1408.1816: "This work describes a quantum algorithm which solves the pattern matching problem for random patterns and texts in time Õ((n/m)^(d/2) 2^(O(d^(3/2)√(log m)))). For large m this is super-polynomially faster than the best possible classical algorithm, which requires time Ω̃((n/m)^d + n^(d/2))."',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated, or run, and no text was searched for any pattern here. The two headline figures are quoted in different currencies and are not converted into one another: the Ramesh and Vinay abstract states Õ(√n + √m) as a running time whose Õ hides logarithmic factors in m and n/m, whereas Ω(√n + √m) is the Zoo's statement about worst-case quantum query complexity, and neither source gives gate counts, qubit counts, constant factors, or the cost of supplying the oracle. The algorithm is not exact: its abstract claims only inverse polynomial failure probability. Montanaro's bound is an average-case result over random patterns and texts, so it establishes nothing about worst-case instances; the Zoo's condition that m be greater than logarithmic in n governs the superpolynomial speedup it reports there, not the running time itself, and the abstract calls the algorithm super-polynomially faster than the best possible classical algorithm only for large m. The constant inside the 2^(O(d^(3/2) √(log m))) factor is not stated. Cost here also depends on the input model: the Zoo reports a separate Õ(√n) string-matching algorithm in a model where the strings are written out in their entirety using n + m qubits rather than through quantum queries to an oracle providing individual bits, and the paper giving it is outside this record.",
    caveatJa:
      "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的なテキストからパターンを探索したわけでもありません。中心となる二つの数値は単位が異なり、本記録は両者を換算していません。Ramesh と Vinay の要旨が与える Õ(√n + √m) は実行時間で、Õ は m と n/m に関する対数因子を隠しています。一方 Ω(√n + √m) は最悪時の量子クエリ計算量についての Zoo の記述であり、いずれの資料にもゲート数、量子ビット数、定数因子、オラクルを用意するコストは示されていません。このアルゴリズムは厳密ではなく、要旨は失敗確率が逆多項式であるとだけ述べています。Montanaro の評価はランダムなパターンとテキストに対する平均的な場合の結果であり、最悪の問題例については何も示しません。m が n の対数より大きいという Zoo の条件は、そこで報告されている超多項式的な高速化に付く条件であって、実行時間そのものに付く条件ではありません。最良の古典アルゴリズムより超多項式的に速いと要旨が述べているのも、m が大きい場合に限られます。2^(O(d^(3/2) √(log m))) の O の中の定数も示されていません。さらにコストは入力モデルにも依存します。Zoo は、個々のビットを返すオラクルへの量子クエリではなく文字列全体を n + m 量子ビットに書き出すモデルにおいて、Õ(√n) の文字列照合アルゴリズムがあることを別に述べていますが、その論文は本記録の対象外です。",
    tags: ["pattern matching", "string matching", "grover search", "hidden shift", "query complexity"],
    source: {
      id: "arxiv:quant-ph/0011049",
      title: "String Matching in ${\\tilde O}(\\sqrt{n}+\\sqrt{m})$ Quantum Time",
      authors: "H. Ramesh, V. Vinay",
      year: "2000",
      url: "https://arxiv.org/abs/quant-ph/0011049",
    },
    literature: [
      {
        title: "Quantum pattern matching fast on average",
        authors: "Ashley Montanaro",
        year: "2014",
        url: "https://arxiv.org/abs/1408.1816",
        relevance: "The average-case half of the same Zoo entry, in d dimensions: the paper describes a quantum algorithm that solves pattern matching for random patterns and texts in time Õ((n/m)^(d/2) 2^(O(d^(3/2) √(log m)))), which for large m Montanaro states is super-polynomially faster than the best possible classical algorithm, that classical bound being Ω̃((n/m)^d + n^(d/2)). The algorithm is based on a quantum subroutine for finding hidden shifts in d dimensions, described as a variant of algorithms proposed by Kuperberg. Consult it for what counts as a random instance, since the bound is an average-case one.",
        relevanceJa: "同じ Zoo 項目のうち、d 次元での平均的な場合を担う論文です。ランダムなパターンとテキストに対してパターン照合を時間 Õ((n/m)^(d/2) 2^(O(d^(3/2) √(log m)))) で解く量子アルゴリズムを記述しており、m が大きい場合には、時間 Ω̃((n/m)^d + n^(d/2)) を要する最良の古典アルゴリズムより超多項式的に速いと述べています。このアルゴリズムは d 次元で隠れシフトを見つける量子サブルーチンに基づいており、Kuperberg が提案したアルゴリズムの変種と説明されています。評価は平均的な場合のものであるため、何をランダムな問題例とみなすかは原論文で確認してください。",
      },
    ],
    relatedSlugs: ["grover-unstructured-search", "hidden-shift-problem", "amplitude-amplification"],
  },
  {
    slug: "graph-properties-adjacency-matrix",
    title: "Quantum query complexity of graph properties in the adjacency matrix model",
    titleJa: "隣接行列モデルにおけるグラフの性質の量子クエリ計算量",
    family: "Quantum query algorithm",
    zooName: "Graph Properties in the Adjacency Matrix Model",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    problem:
      "Given access only to an oracle that, for a pair of integers in {1, 2, ..., n}, says whether the corresponding vertices of an n-vertex graph are joined by an edge, decide a property of that graph or find a structure in it, such as connectivity, a minimum spanning tree, a lowest weight path, or a triangle, using as few queries as possible.",
    problemJa:
      "n 頂点のグラフについて、{1, 2, ..., n} の整数の組に対して対応する二頂点が辺で結ばれているかどうかを答えるオラクルだけが与えられたとき、連結性、最小全域木、最小重みの経路、三角形といったグラフの性質や構造を、できるだけ少ないクエリ数で判定または発見する問題です。",
    idea:
      "Durr, Heiligman, Hoyer and Mhalla treat these tasks in two input models, the adjacency matrix model in which the oracle answers about a pair of vertices and an adjacency list-like array model, and they give almost tight lower and upper bounds for the bounded error quantum query complexity of Connectivity, Strong Connectivity, Minimum Spanning Tree and Single Source Shortest Paths. Their abstract states that the upper bounds utilize search procedures for finding minima of functions under various conditions, without naming them; an earlier algorithm of Durr and Hoyer, catalogued here alongside that paper, finds the index of the minimum entry of a table of size N in time O(c√N) with probability at least 1 - 1/2^c. The Zoo places this work inside a wider body of results in the same model: bipartiteness, cycle detection and st-connectivity in Õ(n^(3/2)) queries and quantum gates using only logarithmically many qubits, and Childs and Kothari's Θ(n^(2/3)) for sparse graph properties, sparse meaning that some constant bounds the ratio of edges to vertices for every graph with the property, provided the property cannot be characterized by a list of forbidden subgraphs. Finding a subgraph is treated separately there, the simplest case being the triangle, for which the Zoo reports O(n^(5/4)) quantum queries as the fastest known.",
    ideaJa:
      "Durr、Heiligman、Hoyer、Mhalla は、これらの課題を二つの入力モデルで扱っています。一つは頂点の組について辺の有無を答える隣接行列モデル、もう一つは隣接リストに近い配列モデルです。論文は、Connectivity、Strong Connectivity、Minimum Spanning Tree、Single Source Shortest Paths の有界誤り量子クエリ計算量について、ほぼ厳密な上界と下界を与えています。要旨は、上界がさまざまな条件のもとで関数の最小値を見つける探索手続きを利用すると述べるだけで、その手続きを名指ししてはいません。本記録が同じ項目に併せて収めている Durr と Hoyer の先行アルゴリズムは、大きさ N の表の最小要素の位置を、時間 O(c√N) で確率 1 - 1/2^c 以上で見つけます。Zoo はこの研究を、同じモデルにおけるより広い結果群の中に位置づけています。二部性の判定、閉路の検出、st 連結性は Õ(n^(3/2)) のクエリ数と量子ゲート数、かつ対数個の量子ビットで実現でき、辺と頂点の比がある定数以下に収まるという意味で疎なグラフの性質については、禁止部分グラフの一覧で特徴付けられない限り Childs と Kothari が Θ(n^(2/3)) を示しています。部分グラフの発見は Zoo では別に扱われており、最も簡単な場合である三角形については、知られている中で最速のものとして O(n^(5/4)) の量子クエリが挙げられています。",
    complexity:
      "Θ(n^(3/2)) quantum queries in the adjacency matrix model for Minimum Spanning Tree and for Connectivity, against Θ(√(nm)) and Θ(n) respectively in the array model; the Zoo adds O(n^(3/2) log² n) for finding lowest weight paths, Õ(n^(3/2)) queries and quantum gates for bipartiteness, cycle detection and st-connectivity, Θ(n^(2/3)) for sparse graph properties that cannot be characterized by a list of forbidden subgraphs, and O(n^(5/4)) queries for finding a triangle. On the classical side the Zoo puts every problem it lists ahead of triangle finding at Ω(n²) queries only under the widely-believed Aanderaa-Karp-Rosenberg conjecture, whereas for triangle finding it states Ω(n²) classical queries outright. Durr and Hoyer's minimum-finding algorithm runs in time O(c√N) on a table of size N and returns the index of the minimum with probability at least 1 - 1/2^c.",
    complexityBasis:
      'abstract of arXiv:quant-ph/0401091 (plain-text TeX rendered as Unicode, and widetilde O written as Õ where quoted from the Zoo): "we show that the query complexity of Minimum Spanning Tree is in Θ(n^(3/2)) in the matrix model and in Θ(√(nm)) in the array model, while the complexity of Connectivity is also in Θ(n^(3/2)) in the matrix model, but in Θ(n) in the array model", and "The upper bounds utilize search procedures for finding minima of functions under various conditions."; Quantum Algorithm Zoo entry "Graph Properties in the Adjacency Matrix Model": "finding lowest weight paths has O(n^(3/2) log² n) quantum query complexity", "Deciding whether a graph is bipartite, detecting cycles, and deciding whether a given vertex can be reached from another (st-connectivity) can all be achieved using a number of queries and quantum gates that both scale as Õ(n^(3/2)), and only logarithmically many qubits", "all sparse graph properties have query complexity Θ(n^(2/3)) if they cannot be characterized by a list of forbidden subgraphs and o(n^(2/3)) (little-o) if they can", "The fastest known quantum algorithm for this finds a triangle in O(n^(5/4)) quantum queries", "According to the widely-believed Aanderaa-Karp-Rosenberg conjecture, all of the above problems have Ω(n²) classical query complexity", and "Classically, triangle finding requires Ω(n²) queries"; abstract of arXiv:quant-ph/9607014: "We give a quantum algorithm to find the index y in a table T of size N such that in time O(c sqrt N), T[y] is minimum with probability at least 1-1/2^c."',
    caveat:
      "This is a literature record: no oracle was instantiated, no circuit was compiled, simulated, or run, and no graph was decided here. Every figure above is a count of queries in a black-box model except where stated otherwise, so gate counts, ancilla requirements, the cost of realizing the adjacency oracle, and constant factors all sit outside it; the only gate and qubit statement quoted is the Zoo's own, for bipartiteness, cycle detection and st-connectivity. A bound here means little without its input model, since the primary paper reports Connectivity at Θ(n^(3/2)) in the matrix model but Θ(n) in the array model, and Minimum Spanning Tree at Θ(n^(3/2)) against Θ(√(nm)), where the abstract introduces m without defining it and it is reproduced here unexplained; that paper also describes its bounds as almost tight rather than exact. The classical Ω(n²) side is conditional, because the Zoo attributes it to the widely-believed Aanderaa-Karp-Rosenberg conjecture; the exception is triangle finding, for which the Zoo states the classical Ω(n²) outright. The Õ(n^(3/2)) figure for bipartiteness, cycle detection and st-connectivity, the Θ(n^(2/3)) sparse-property result, the O(n^(5/4)) triangle bound and its classical Ω(n²), the Õ(n) span-program algorithm for detecting tree minors, the general k-vertex subgraph exponent and the O(n^(1.883)) result for sub-hypergraphs of 3-uniform hypergraphs all rest on papers outside this record, cited by the Zoo and not read here. The minimum-finding figure is a running time on a table of size N whose success probability, at least 1 - 1/2^c, is set by c, and the graph paper's abstract does not name which minimum-finding procedure its upper bounds use, so no citation between the two papers is claimed here.",
    caveatJa:
      "本項目は文献に基づく記録であり、オラクルを具体化したことも、回路をコンパイル、シミュレーション、実行したこともなく、具体的なグラフの判定も行っていません。上記の数値は、断りのある箇所を除きすべてブラックボックスモデルでのクエリ数であり、ゲート数、補助量子ビット、隣接オラクルを実現するコスト、定数因子はいずれも対象外です。ゲート数と量子ビット数に触れているのは、二部性の判定、閉路の検出、st 連結性についての Zoo 自身の記述だけです。また、評価は入力モデルを離れてはほとんど意味を持ちません。主論文は Connectivity を隣接行列モデルで Θ(n^(3/2))、配列モデルでは Θ(n) と報告し、Minimum Spanning Tree についても Θ(n^(3/2)) と Θ(√(nm)) を対比しています。この Θ(√(nm)) の m は要旨では定義されておらず、本記録でも説明のないまま引き写しています。また同論文は、これらの上下界を厳密ではなく「ほぼ厳密」と述べています。古典側の Ω(n²) は条件付きで、Zoo はこれを広く信じられている Aanderaa-Karp-Rosenberg 予想に帰しています。例外は三角形の発見で、こちらは古典的に Ω(n²) クエリを要すると Zoo が断定しています。二部性の判定、閉路の検出、st 連結性に対する Õ(n^(3/2))、疎なグラフの性質に対する Θ(n^(2/3))、三角形の O(n^(5/4)) とその古典的な Ω(n²)、木のマイナーを検出する span プログラムに基づく Õ(n)、k 頂点の部分グラフ一般に対する指数、3 一様ハイパーグラフの部分ハイパーグラフに対する O(n^(1.883)) は、いずれも Zoo が引用している本記録の対象外の論文に基づくもので、それらの原論文は参照していません。最小値探索の数値は大きさ N の表に対する実行時間であり、成功確率は c によって決まり、少なくとも 1 - 1/2^c です。グラフの論文の要旨は、上界がどの最小値探索手続きを用いるかを明示していないため、二つの論文の間に引用関係があるとは本記録では主張していません。",
    tags: ["graph properties", "adjacency matrix", "query complexity", "minimum finding", "oracle"],
    source: {
      id: "arxiv:quant-ph/0401091",
      title: "Quantum query complexity of some graph problems",
      authors: "Christoph Durr, Mark Heiligman, Peter Hoyer, Mehdi Mhalla",
      year: "2004",
      url: "https://arxiv.org/abs/quant-ph/0401091",
    },
    literature: [
      {
        title: "A Quantum Algorithm for Finding the Minimum",
        authors: "Christoph Durr, Peter Hoyer",
        year: "1996",
        url: "https://arxiv.org/abs/quant-ph/9607014",
        relevance: "A minimum-finding algorithm, catalogued alongside the graph paper rather than as a component of it. Durr and Hoyer give a quantum algorithm that finds the index y in a table T of size N such that T[y] is minimum, in time O(c√N) and with probability at least 1 - 1/2^c. The graph paper's abstract states that its upper bounds utilize search procedures for finding minima of functions under various conditions; it does not name them, so consult both papers before treating this one as the subroutine used there.",
        relevanceJa: "最小値探索のアルゴリズムを与える論文で、グラフの論文の構成要素としてではなく、それと併せて本項目に収めています。大きさ N の表 T について T[y] が最小となる位置 y を、時間 O(c√N) で確率 1 - 1/2^c 以上で見つける量子アルゴリズムを示しています。グラフの論文の要旨は、上界がさまざまな条件のもとで関数の最小値を見つける探索手続きを利用するとだけ述べており、その手続きを名指ししてはいないため、これをそこで用いられたサブルーチンとみなす前に双方の原論文を確認してください。",
      },
    ],
    relatedSlugs: ["grover-unstructured-search", "element-distinctness", "quantum-walk-line"],
  },
  {
    slug: "counterfeit-coin-problem",
    title: "Counterfeit coin problem by quantum queries",
    titleJa: "量子クエリによる偽コイン問題",
    family: "Quantum query algorithm",
    zooName: "Counterfeit Coins",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    problem:
      "Given N coins of which exactly k are counterfeit, where the real coins all share one weight and the counterfeit coins all share another, and given a pan balance that can compare the weight of any pair of subsets of the coins but reports only whether they balance or tilt, identify all of the counterfeit coins in as few weighings as possible.",
    problemJa:
      "N枚のコインのうちちょうどk枚が偽コインであり、本物のコインはすべて同じ重さ、偽コインもすべてそれとは別の同じ重さであるとします。コインの任意の2つの部分集合の重さを比較できるものの、釣り合ったか傾いたかだけを報告する天秤が与えられたとき、できるだけ少ない秤量回数ですべての偽コインを特定する問題です。",
    idea:
      "Both sources turn the balance into an oracle. The Zoo introduces one that, given a pair of subsets of the coins of equal cardinality, outputs one bit indicating balanced or unbalanced; the paper says the balance scale gives only balanced or tilted information, and that the query complexity of such an oracle measures the cost of a weighing algorithm, namely the number of weighings. Iwama, Nishimura, Raymond and Teruyama study the quantum query complexity Q(k,N) of finding all k false coins among N given coins, with the number k assumed known in advance, and their abstract contrasts the O(k^(1/4)) bound they obtain with the classical query complexity Ω(k log(N/k)), which it says depends on N. The Zoo describes the core techniques behind the quantum speedup as amplitude amplification and the Bernstein-Vazirani algorithm, and records the construction as building on previous work by Terhal and Smolin. The paper states that it has no matching lower bound, offering instead evidence that its upper bound is tight: any algorithm that satisfies certain properties, the paper's own included, needs Ω(k^(1/4)) queries.",
    ideaJa:
      "いずれの出典も天秤をオラクルとして扱います。Zoo は、枚数の等しい2つの部分集合を受け取って釣り合ったか否かを1ビットで返すオラクルを導入しており、論文は、天秤が釣り合ったか傾いたかの情報のみを与えること、およびそのオラクルのクエリ計算量が秤量アルゴリズムのコスト、すなわち秤量回数を測る尺度になることを述べています。Iwama、Nishimura、Raymond、Teruyama は、偽コインの枚数kが既知であるという前提のもとで、N枚のコインからk枚の偽コインをすべて見つける量子クエリ計算量 Q(k,N) を調べており、その要旨は、得られた上界 O(k^(1/4)) を、Nに依存すると述べる古典クエリ計算量 Ω(k log(N/k)) と対比しています。Zoo は、この高速化の中核をなす技法として振幅増幅と Bernstein-Vazirani アルゴリズムを挙げ、この構成が Terhal と Smolin の先行研究の上に築かれていると記しています。論文は、一致する下界は得られていないと述べたうえで、代わりに、論文自身のものを含め、ある性質を満たす任意のアルゴリズムには Ω(k^(1/4)) クエリが必要であるという、上界が最良であることの証拠を示しています。",
    complexity:
      "Q(k,N) = O(k^(1/4)) quantum queries to the balance oracle for any k and N with k < N/2, where Q(k,N) is the quantum query complexity of finding all k false coins among the N given coins; the classical query complexity is Ω(k log(N/k)), a bound that depends on N, so the paper reports a quartic speed-up. No matching lower bound is given: the paper shows only that any algorithm that satisfies certain properties, its own algorithm included, needs Ω(k^(1/4)) queries.",
    complexityBasis:
      'abstract of arXiv:1009.0416, quoted verbatim except that TeX control sequences are rendered as Unicode while superscripts are left in TeX form: "Let Q(k,N) be the quantum query complexity of finding all k false coins from the N given coins. We show that for any k and N such that k < N/2, Q(k,N)=O(k^{1/4}), contrasting with the classical query complexity, Ω(k log(N/k)), that depends on N. So our quantum algorithm achieves a quartic speed-up for this problem", and, for the absence of a matching lower bound, "We do not have a matching lower bound, but we show some evidence that the upper bound is tight: any algorithm, including our algorithm, that satisfies certain properties needs Ω(k^{1/4}) queries." The Quantum Algorithm Zoo entry "Counterfeit Coins" states the same two figures, quoted here the same way: "Classically, we need Ω(k log(N/k)) weighings to identify all of the counterfeit coins", and, attributing the upper bound to Iwama et al., "on a quantum computer, one can identify all of the counterfeit coins using O(k^{1/4}) queries". Neither source states a constant factor or a gate count.',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated, or run, and no set of coins was weighed. Every figure above is a count of queries to the balance oracle, so gate counts, qubit counts, circuit depth, and the cost of realizing that oracle for an actual pan balance all fall outside it, as do the constant factors hidden by O(·). The upper bound is stated under the condition k < N/2 and assumes the number k of counterfeit coins is known in advance, so it establishes nothing about instances where k is unknown or where k is at least N/2. Optimality is not settled: the paper says it has no matching lower bound, and the Ω(k^(1/4)) evidence it offers is restricted to algorithms satisfying certain properties, which the abstract does not spell out and which this record does not reproduce. The attribution of the speedup to amplitude amplification and the Bernstein-Vazirani algorithm is the Zoo's account of how the construction works, and the earlier Terhal and Smolin result the Zoo credits rests on a paper outside this record.",
    caveatJa:
      "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、実際にコインを秤量したわけでもありません。上記の数値はすべて天秤オラクルへのクエリ数であるため、ゲート数、量子ビット数、回路深さ、実際の天秤に対してそのオラクルを実装するコストはいずれも対象外であり、O(·) に隠れた定数因子も同様です。上界は k < N/2 という条件のもとでの主張であり、偽コインの枚数kが事前に既知であることを前提としています。したがって、kが未知の場合や k が N/2 以上の場合については何も述べていません。最適性も確定していません。論文自身が一致する下界を持たないと述べており、示されている Ω(k^(1/4)) の証拠も、ある性質を満たすアルゴリズムに限られます。その性質は要旨に明示されておらず、本記録でも再現していません。高速化を振幅増幅と Bernstein-Vazirani アルゴリズムに帰する説明は Zoo による構成の解説であり、Zoo が挙げる Terhal と Smolin の先行結果は本記録の対象外の論文に基づきます。",
    tags: ["counterfeit coins", "query complexity", "oracle", "amplitude amplification", "bernstein-vazirani"],
    source: {
      id: "arxiv:1009.0416",
      title: "Quantum Counterfeit Coin Problems",
      authors: "Kazuo Iwama, Harumichi Nishimura, Rudy Raymond, Junichi Teruyama",
      year: "2010",
      url: "https://arxiv.org/abs/1009.0416",
    },
    literature: [
      {
        title: "Quantum Counterfeit Coin Problems",
        authors: "Kazuo Iwama, Harumichi Nishimura, Rudy Raymond, Junichi Teruyama",
        year: "2010",
        url: "https://arxiv.org/abs/1009.0416",
        relevance:
          "Primary source: it models the balance scale as an oracle giving only balanced or tilted information, takes the number of weighings as the cost measure, and gives the O(k^(1/4)) upper bound on the quantum query complexity Q(k,N) for k < N/2, against the classical Ω(k log(N/k)). Consult it for the properties an algorithm must satisfy for the accompanying Ω(k^(1/4)) tightness evidence to apply.",
        relevanceJa:
          "一次資料です。天秤を、釣り合ったか傾いたかの情報のみを返すオラクルとしてモデル化し、秤量回数をコストの尺度としたうえで、k < N/2 のときの量子クエリ計算量 Q(k,N) に対する上界 O(k^(1/4)) を、古典の Ω(k log(N/k)) と対比して与えています。付随する Ω(k^(1/4)) の最良性の証拠がどのような性質を満たすアルゴリズムに適用されるかは、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "amplitude-amplification",
      "bernstein-vazirani-qiskit",
      "grover-unstructured-search",
      "element-distinctness",
    ],
  },
  {
    slug: "spectral-sum-estimation",
    title: "Estimating log-determinants and other spectral sums",
    titleJa: "対数行列式をはじめとするスペクトル和の推定",
    family: "Quantum linear algebra",
    zooName: "Estimating Determinants and Other Spectral Sums",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Superpolynomial",
    problem:
      "Given a function f and a positive semi-definite matrix A whose eigenvalues are λⱼ, estimate the spectral sum Tr[f(A)] = Σⱼ f(λⱼ), a family whose typical examples the paper gives as the von Neumann entropy, the trace of A⁻¹, the log-determinant and the Schatten p-norm, the last of which it says does not require the matrix to be positive semi-definite.",
    problemJa:
      "関数fと、固有値をλⱼとする半正定値行列Aが与えられたとき、スペクトル和 Tr[f(A)] = Σⱼ f(λⱼ) を推定する問題です。論文はその典型例として von Neumannエントロピー、A⁻¹のトレース、対数行列式、Schatten p-ノルムを挙げ、このうち Schatten p-ノルムについては行列が半正定値である必要はないと述べています。",
    idea:
      "The Zoo sets out one route. For a 2ⁿ × 2ⁿ Hermitian matrix A with only poly(n) nonzero entries per row, given an oracle for those entries, Hamiltonian simulation approximates the unitary e^(-iAt) with poly(n,t) gates, Kitaev's phase estimation turns such time evolutions into an approximate measurement in the eigenbasis of A, and applying that measurement to the maximally mixed state samples uniformly from the eigenvalues, so a Monte Carlo estimate of a spectral sum can be assembled from those samples; taking f(λ) = log(λ) makes the logarithm of the determinant one such sum. Luongo and Shao propose new quantum algorithms for estimating spectral sums of positive semi-definite matrices, stating their results under the assumption of access to a block-encoding of the matrix; their abstract does not mention the entry oracle the Zoo's route assumes. They state that the resulting algorithms are sub-linear in the matrix size and depend at most quadratically on other parameters such as the condition number and the approximation error, and that this polynomially improves the runtime of other quantum algorithms proposed for the same problems. The paper also shows how the same algorithms and techniques apply to three problems in spectral graph theory: approximating the number of triangles, the effective resistance and the number of spanning trees within a graph.",
    ideaJa:
      "Zoo は一つの道筋を示しています。各行の非零成分が poly(n) 個しかない 2ⁿ × 2ⁿ のエルミート行列Aについて、それらの成分を返すオラクルが与えられれば、Hamiltonian シミュレーションによりユニタリ e^(-iAt) を poly(n,t) 個のゲートで近似でき、Kitaev の位相推定はこうした時間発展をAの固有基底での近似的な測定に変えます。この測定を最大混合状態に対して行うとAの固有値から一様にサンプリングでき、得られたサンプルからスペクトル和の Monte Carlo 推定を組み立てられます。f(λ) = log(λ) と取れば、行列式の対数がこの形のスペクトル和になります。Luongo と Shao は、半正定値行列のスペクトル和を推定する新しい量子アルゴリズムを提案しており、その結果は行列のブロック符号化へのアクセスを仮定したうえで述べられています。要旨には、Zoo の道筋が仮定する成分オラクルへの言及はありません。得られるアルゴリズムは行列のサイズについて劣線形であり、条件数や近似誤差といった他のパラメータへの依存も高々二次であって、同じ問題に対して提案されてきた他の量子アルゴリズムの実行時間を多項式的に改善すると述べられています。論文はさらに、同じアルゴリズムと技法がスペクトルグラフ理論の3つの問題、すなわち三角形の個数、実効抵抗、全域木の個数の近似に適用できることを示しています。",
    complexity:
      "Sub-linear in the matrix size, assuming access to a block-encoding of the matrix, and at most quadratic in other parameters such as the condition number and the approximation error, against what the abstract calls the current best classical randomized algorithms for these quantities, whose runtime it states is at least linear in the number of nonzero entries of the matrix and quadratic in the estimation error; that abstract states no closed-form runtime expression, exponent or constant for the quantum algorithms. The Zoo supplies the surrounding costs for its own route: the unitary e^(-iAt) is approximable by a circuit with only poly(n,t) gates for a 2ⁿ × 2ⁿ Hermitian matrix with poly(n) nonzero entries per row, while computing such a sum classically has worst case computational cost that is exponential in n.",
    complexityBasis:
      'abstract of arXiv:2011.06475: "The current best classical randomized algorithms estimating these quantities have a runtime that is at least linearly in the number of nonzero entries of the matrix and quadratic in the estimation error. Assuming access to a block-encoding of a matrix, our algorithms are sub-linear in the matrix size, and depend at most quadratically on other parameters, like the condition number and the approximation error, and thus can compete with most of the randomized and distributed classical algorithms proposed in the literature, and polynomially improve the runtime of other quantum algorithms proposed for the same problems." That abstract gives no closed-form runtime and names no exponent or constant. The Quantum Algorithm Zoo entry "Estimating Determinants and Other Spectral Sums" supplies the costs quoted for its own route, quoted verbatim except that the source\'s LaTeX is rendered here as plain text, e^{-i A t} written e^(-iAt): "the unitary e^(-iAt) can be approximated by a quantum circuit with only poly( n,t ) gates using standard techniques for Hamiltonian simulation", and "Computing such a sum classically has worst case computational cost that is exponential in n."',
    caveat:
      "This is a literature record. Nothing was constructed, compiled, simulated, run or benchmarked for it, and no spectral sum of any matrix was estimated. The cost statement is qualitative: sub-linear in the matrix size and at most quadratic in the condition number and the approximation error, with no closed-form expression, exponent or constant stated for it in either source, so nothing here fixes the cost for a given matrix, accuracy or success probability. It is also conditional on the input model. The paper assumes access to a block-encoding of the matrix, and the cost of producing that block-encoding is not established here; the Zoo's route instead assumes an oracle for the poly(n) nonzero entries per row of a 2ⁿ × 2ⁿ Hermitian matrix, so the two cost statements are made in different input models and are not directly comparable. The matrices are positive semi-definite, with the Schatten p-norm the stated exception that does not require the matrix to be PSD, and the classical comparison is against the current best classical randomized algorithms rather than a proved separation. The Zoo attaches its superpolynomial classification to the phase-estimation-on-maximally-mixed-states method of two references it cites by number only; this record does not establish that the paper cited here is either of them, and the exposition and analysis the Zoo credits to the second of those numbers rests on a paper outside this record.",
    caveatJa:
      "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行、ベンチマークはいずれも行っておらず、具体的な行列のスペクトル和を推定したこともありません。コストに関する記述は定性的で、行列のサイズについて劣線形、条件数と近似誤差については高々二次というものであり、この主張について閉じた形の式、指数、定数を示した出典はありません。したがって、特定の行列・精度・成功確率に対するコストは本記録からは分かりません。この記述は入力モデルにも依存します。論文は行列のブロック符号化へのアクセスを仮定していますが、そのブロック符号化を用意するコストはここでは確立していません。一方 Zoo の道筋は、各行の非零成分が poly(n) 個である 2ⁿ × 2ⁿ のエルミート行列に対する成分オラクルを仮定しており、両者のコストは異なる入力モデルにおける主張であって直接は比較できません。対象は半正定値行列であり、要旨が明示する例外は行列の半正定値性を必要としない Schatten p-ノルムのみです。古典との比較も、現在知られている最良の古典乱択アルゴリズムに対する比較であって、証明された分離ではありません。Zoo が超多項式的と分類しているのは、最大混合状態に位相推定を適用するこの手法であり、Zoo はその出典を番号でのみ引用しています。本記録は、ここで引用した論文がそのいずれかであることを確認したものではなく、Zoo が2番目の番号に帰している詳しい解説と解析も、本記録の対象外の論文に基づきます。",
    tags: ["spectral sums", "log-determinant", "phase estimation", "block encoding", "trace estimation"],
    source: {
      id: "arxiv:2011.06475",
      title: "Quantum algorithms for spectral sums",
      authors: "Alessandro Luongo, Changpeng Shao",
      year: "2020",
      url: "https://arxiv.org/abs/2011.06475",
    },
    literature: [
      {
        title: "Quantum algorithms for spectral sums",
        authors: "Alessandro Luongo, Changpeng Shao",
        year: "2020",
        url: "https://arxiv.org/abs/2011.06475",
        relevance:
          "Primary source: it defines the spectral sum Tr[f(A)] = Σⱼ f(λⱼ) of a positive semi-definite matrix, names the log-determinant, the von Neumann entropy, the trace of A⁻¹ and the Schatten p-norm as its typical examples, and states the block-encoding input model together with the sub-linear-in-matrix-size, at-most-quadratic-in-condition-number-and-error scaling quoted in the complexity field. It also applies the techniques to approximating the number of triangles, the effective resistance and the number of spanning trees within a graph.",
        relevanceJa:
          "一次資料です。半正定値行列のスペクトル和 Tr[f(A)] = Σⱼ f(λⱼ) を定義し、その典型例として対数行列式、von Neumannエントロピー、A⁻¹のトレース、Schatten p-ノルムを挙げ、ブロック符号化という入力モデルと、計算量欄に引用した「行列サイズについて劣線形、条件数と近似誤差については高々二次」というスケーリングを述べています。さらに、グラフの三角形の個数、実効抵抗、全域木の個数の近似にもこの技法を適用しています。",
      },
    ],
    relatedSlugs: [
      "quantum-phase-estimation",
      "quantum-singular-value-transformation",
      "hhl-linear-systems",
      "hamiltonian-simulation-ising",
    ],
  },
  {
    slug: "matrix-commutativity-testing",
    title: "Commutativity testing of a matrix set by quantum walk",
    titleJa: "量子ウォークによる行列集合の可換性判定",
    family: "Quantum query algorithm",
    zooName: "Matrix Commutativity",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    problem:
      "Given oracle access to k matrices of size n × n, where a query names a matrix index x together with a pair of indices i, j and returns the ij entry of the x-th matrix, decide whether all k of the matrices commute with one another.",
    problemJa:
      "n × n の行列 k 個へオラクル経由でアクセスでき、行列の番号 x と添字の組 i, j を指定するとその行列の ij 成分が返されるとき、k 個の行列がすべて互いに可換であるかどうかを判定する問題です。",
    idea:
      "The paper uses a theorem of Mario Szegedy that relates the hitting time of a classical random walk to that of a quantum walk, and it also takes a look at Ambainis's method of quantum walk, applying both walks to the triangle finding problem and to the matrix verification problem in order to compare the powers of the two different walks. The abstract reports that Szegedy's algorithm turns out to be generalizable to similar problems and that Szegedy's theorem is therefore the one the paper uses to analyze matrix set commutativity, and it states that the technique behind the upper bound is generalized to a broader range of similar problems. The paper also presents Ambainis's method of lower bounding technique in order to obtain a lower bound for this problem. The abstract records that this is probably the first problem to be studied on the quantum query complexity using quantum walks that involves more than one parameter, here k and n.",
    ideaJa:
      "論文は、古典ランダムウォークのヒッティング時間を量子ウォークのそれと関係づける Mario Szegedy の定理を用い、あわせて Ambainis による量子ウォークの手法も取り上げて、両者を三角形発見問題と行列検証問題に適用することで2つのウォークの能力を比較しています。要旨は、Szegedy のアルゴリズムが類似の問題へ一般化できることが分かったため、行列集合の可換性の解析には Szegedy の定理を用いると述べており、さらに上界を導く際の技法をより広い範囲の類似問題へ一般化したとしています。論文はまた、この問題の下界を得るために Ambainis の下界導出の技法を提示しています。要旨は、量子ウォークを用いて量子クエリ計算量が調べられた問題のうち、k と n という2つのパラメータを含むものはおそらくこれが最初であると述べています。",
    complexity:
      "O(k^(4/5) n^(9/5)) oracle queries to decide whether all k of the n × n matrices commute; the Zoo states that classically the task requires Ω(k n²) queries. The abstract separately states a lower bound of Ω(k^(1/2) n) for the problem, obtained with Ambainis's lower-bounding technique, so the two bounds the abstract gives do not meet.",
    complexityBasis:
      'abstract of arXiv:quant-ph/0509206: "We give an O(k^{4/5}n^{9/5}) algorithm as well as a lower bound of Omega(k^{1/2}n)", with the technique named earlier in the same abstract, "We also present Ambainis\'s method of lower bounding technique (quant-ph/0002066) to obtain a lower bound for this problem"; Quantum Algorithm Zoo entry "Matrix Commutativity" (LaTeX rendered into Unicode): "this can be achieved on a quantum computer using O(k^(4/5)n^(9/5)) queries, whereas classically this requires Ω( k n² ) queries."',
    caveat:
      "This is a literature record: no oracle was instantiated, no circuit was built, compiled, simulated or run, and no set of matrices was tested for commutativity. All three figures above count oracle queries in the black-box model, so gate count, circuit depth, the memory the walk needs in order to hold matrix entries and the constant factors hidden by O(·) and Ω(·) are all outside this record. The paper's upper and lower bounds do not meet — O(k^(4/5) n^(9/5)) against Ω(k^(1/2) n) — so nothing here establishes that the algorithm is optimal, and because both expressions carry two free parameters, which term dominates depends on how k and n are related. The Zoo's Ω(k n²) is the Zoo's own statement about the classical query cost and is a different claim from the paper's Ω(k^(1/2) n); the quoted clause of the abstract does not name the model its lower bound is stated for, attributing only the technique to Ambainis. The generalization the abstract claims to \"a broader range of similar problems\" is not delimited here, and the comparison of Szegedy's walk with Ambainis's on triangle finding and matrix verification is reported, not reproduced.",
    caveatJa:
      "本項目は文献に基づく記録です。オラクルを具体化したことも、回路を構成・コンパイル・シミュレーション・実行したこともなく、実際に行列集合の可換性を判定したわけでもありません。上記の3つの数値はいずれもブラックボックスモデルにおけるオラクルへのクエリ数であり、ゲート数、回路深さ、ウォークが行列成分を保持するために必要な記憶量、O(·) や Ω(·) に隠れた定数因子は、いずれも本項目の対象外です。論文の上界 O(k^(4/5) n^(9/5)) と下界 Ω(k^(1/2) n) は一致しておらず、このアルゴリズムが最適であることは本項目からは言えません。また双方の式が k と n という2つのパラメータを含むため、どちらの項が支配的になるかは両者の関係に依存します。Zoo が挙げる Ω(k n²) は古典クエリ数についての Zoo 自身の記述であり、論文の Ω(k^(1/2) n) とは別の主張です。ここで引用した要旨の一節は、下界がどのモデルに対するものかを明示しておらず、技法が Ambainis によるものであることを述べるにとどまります。要旨のいう「より広い範囲の類似問題」への一般化についても、その範囲は本項目では特定しておらず、三角形発見問題と行列検証問題における2つのウォークの比較も、報告を記録したものであって追試ではありません。",
    tags: ["matrix commutativity", "quantum walk", "query complexity", "oracle", "szegedy quantization"],
    source: {
      id: "arxiv:quant-ph/0509206",
      title: "Quantum Algorithm for Commutativity Testing of a Matrix Set",
      authors: "Yuki Kelly Itakura",
      year: "2005",
      url: "https://arxiv.org/abs/quant-ph/0509206",
    },
    literature: [
      {
        title: "Quantum Algorithm for Commutativity Testing of a Matrix Set",
        authors: "Yuki Kelly Itakura",
        year: "2005",
        url: "https://arxiv.org/abs/quant-ph/0509206",
        relevance:
          "Primary source: it applies Szegedy's theorem relating the hitting time of a classical random walk to that of a quantum walk to the commutativity of a matrix set, states the O(k^(4/5) n^(9/5)) algorithm quoted in the complexity field together with a lower bound of Ω(k^(1/2) n), and compares Szegedy's walk against Ambainis's on the triangle finding and matrix verification problems. Consult it for the walk the upper bound is built on and for which similar problems the generalized technique is claimed to cover.",
        relevanceJa:
          "一次資料です。古典ランダムウォークのヒッティング時間を量子ウォークのそれと結びつける Szegedy の定理を行列集合の可換性判定に適用し、計算量欄に引いた O(k^(4/5) n^(9/5)) のアルゴリズムと下界 Ω(k^(1/2) n) を示すとともに、三角形発見問題と行列検証問題において Szegedy のウォークと Ambainis のウォークを比較しています。上界の基礎となるウォークの構成や、一般化された技法が対象とする類似問題の範囲は原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "matrix-product-verification",
      "element-distinctness",
      "quantum-walk-line",
      "graph-properties-adjacency-matrix",
    ],
  },
  {
    slug: "group-commutativity-testing",
    title: "Testing commutativity of a black-box group",
    titleJa: "ブラックボックス群の可換性判定",
    family: "Quantum query algorithm",
    zooName: "Group Commutativity",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    problem:
      "Given a list of k generators for a group G together with black-box access to group multiplication, decide whether G is commutative using as few queries to that black box as possible.",
    problemJa:
      "群 G の生成元 k 個の一覧と、群の乗法を実行するブラックボックスへのアクセスが与えられたとき、そのブラックボックスへのクエリ数をできるだけ少なくして、G が可換であるかどうかを判定する問題です。",
    idea:
      "The paper considers the commutativity of a black-box group specified by its k generators, a problem whose complexity in terms of k was first considered by Pak, whose randomized algorithm involves O(k) group operations. Magniez and Nayak construct a quantum algorithm for this problem whose complexity is in O(k^(2/3)), and the paper states that the algorithm uses and highlights the power of the quantization method of Szegedy. For the lower bound of Ω(k^(2/3)) the paper gives a reduction from a special case of Element Distinctness to the commutativity problem, and it describes its own construction, in the abstract's own wording, as a quite optimal one. The authors also report that along the way they prove the optimality of Pak's algorithm for the randomized model, while the Zoo describes Pak's O(k) algorithm as the best known classical one.",
    ideaJa:
      "論文が扱うのは、k 個の生成元で指定されるブラックボックス群の可換性であり、k に関するこの問題の計算量を最初に検討したのは Pak で、その乱択アルゴリズムは O(k) 回の群演算を要します。Magniez と Nayak は、計算量が O(k^(2/3)) に収まる量子アルゴリズムを構成しており、論文はこのアルゴリズムが Szegedy の量子化手法の威力を活用し、かつそれを際立たせるものであると述べています。下界 Ω(k^(2/3)) については、要素相異性問題の特別な場合から可換性判定問題への帰着が与えられており、論文は自らの構成を、要旨自身の表現によれば「ほぼ最適」なものと述べています。著者らはさらに、その過程で Pak のアルゴリズムが乱択モデルにおいて最適であることを証明したと報告しており、Zoo は Pak の O(k) のアルゴリズムを既知の古典アルゴリズムのうち最良のものとしています。",
    complexity:
      "O(k^(2/3)) for a black-box group given by k generators, with a lower bound of Ω(k^(2/3)) obtained by reduction from a special case of Element Distinctness; the Zoo records the resulting quantum query complexity as Θ̃(k^(2/3)). The classical baseline is Pak's randomized algorithm involving O(k) group operations, which the same paper states it proves optimal for the randomized model.",
    complexityBasis:
      'abstract of arXiv:quant-ph/0506265, quoted as it is written there: "We construct a quite optimal quantum algorithm for this problem whose complexity is in O (k^{2/3})", "For the lower bound of Omega(k^{2/3}), we give a reduction from a special case of Element Distinctness to our problem", and, for the classical side, "who gave a randomized algorithm involving O(k) group operations" together with "we prove the optimality of the algorithm of Pak for the randomized model"; Quantum Algorithm Zoo entry "Group Commutativity" (LaTeX rendered into Unicode): "Magniez and Nayak have shown that the quantum query complexity of this task is Θ̃(k^(2/3))". The Zoo\'s tilde absorbs logarithmic factors that the abstract\'s "O (k^{2/3})" does not display.',
    caveat:
      "This is a literature record: no group was represented, no multiplication black box was implemented, and no circuit was built, compiled, simulated or run. The counts are queries to that black box — group operations — so they bound neither gate count nor circuit depth, and the cost of realizing group multiplication for a concrete G on hardware is outside this record. The two sources state the bound in two notations that are not identical: the Zoo writes Θ̃(k^(2/3)), whose tilde absorbs logarithmic factors, while the abstract's clause carries no tilde and calls the algorithm quite optimal rather than optimal; this record does not resolve the gap those two hedges leave. Everything above is measured in k, the number of generators supplied, and not in the order of G or the length of its element encodings, so nothing here bounds cost as a function of group size. The Ω(k^(2/3)) lower bound is recorded as the paper's, by reduction from a special case of Element Distinctness that is not characterized here, and the proof of optimality for Pak's randomized algorithm is likewise reported rather than re-derived.",
    caveatJa:
      "本項目は文献に基づく記録です。群を具体的に表現したことも、乗法のブラックボックスを実装したことも、回路を構成・コンパイル・シミュレーション・実行したこともありません。数えているのはそのブラックボックスへのクエリ数、すなわち群演算の回数であり、ゲート数も回路深さも押さえるものではなく、具体的な G について群の乗法を実機で実現するコストも本項目の対象外です。2つの出典が示す評価の表記は同一ではありません。Zoo は対数因子を吸収するチルダを付して Θ̃(k^(2/3)) と書くのに対し、要旨の該当箇所にはチルダがなく、アルゴリズムを「最適」ではなく「ほぼ最適」と表現しています。この2つの留保が残す差を本項目で埋めてはいません。上記の量はいずれも与えられる生成元の個数 k で測られており、G の位数や元の符号化長で測られてはいないため、群の大きさに対するコストについては何も述べていません。下界 Ω(k^(2/3)) は論文の主張として記録したものであり、帰着に用いられる要素相異性問題の特別な場合の内容は本項目では特定していません。Pak の乱択アルゴリズムの最適性の証明も同様に、報告を記録したものであって再導出ではありません。",
    tags: ["group commutativity", "black-box group", "element distinctness", "query complexity", "szegedy quantization"],
    source: {
      id: "arxiv:quant-ph/0506265",
      title: "Quantum Complexity of Testing Group Commutativity",
      authors: "Frederic Magniez, Ashwin Nayak",
      year: "2005",
      url: "https://arxiv.org/abs/quant-ph/0506265",
    },
    literature: [
      {
        title: "Quantum Complexity of Testing Group Commutativity",
        authors: "Frederic Magniez, Ashwin Nayak",
        year: "2005",
        url: "https://arxiv.org/abs/quant-ph/0506265",
        relevance:
          "Primary source: it constructs the quantum algorithm whose complexity is in O(k^(2/3)) for a black-box group given by k generators, credits the construction to the quantization method of Szegedy, derives the Ω(k^(2/3)) lower bound by reduction from a special case of Element Distinctness, and reports a proof that Pak's O(k) randomized algorithm is optimal for the randomized model. Consult it for the black-box group model it assumes and for the special case of Element Distinctness the reduction uses.",
        relevanceJa:
          "一次資料です。k 個の生成元で与えられるブラックボックス群に対し計算量が O(k^(2/3)) に収まる量子アルゴリズムを構成し、その構成を Szegedy の量子化手法によるものとしたうえで、要素相異性問題の特別な場合からの帰着により下界 Ω(k^(2/3)) を導き、さらに Pak の O(k) の乱択アルゴリズムが乱択モデルで最適であることの証明を報告しています。前提となるブラックボックス群のモデルや、帰着に用いる要素相異性問題の特別な場合は原論文で確認してください。",
      },
    ],
    relatedSlugs: ["element-distinctness", "quantum-walk-line", "quantum-simulated-annealing"],
  },
  {
    slug: "hidden-nonlinear-structures",
    title: "Hidden nonlinear structures over finite fields",
    titleJa: "有限体上の隠れた非線形構造",
    family: "Quantum query algorithm",
    zooName: "Hidden Nonlinear Structures",
    zooSection: "Oracular Algorithms",
    speedup: "Superpolynomial",
    problem:
      "Given oracle access to a hidden subset over a finite field that is not a lattice, that is, a hidden nonlinear structure, identify that subset.",
    problemJa:
      "有限体上の、格子ではない隠れた部分集合、すなわち隠れた非線形構造が与えられ、それにオラクル経由でアクセスできるとき、その部分集合を同定する問題です。",
    idea:
      "The Zoo pictures an Abelian group as a lattice, a subgroup as a sublattice and the cosets of that subgroup as the shifts of the sublattice, and records that the Abelian hidden subgroup problem is then normally solved by obtaining a superposition over a random coset of the hidden subgroup and taking the Fourier transform, so as to sample from the dual lattice. Rather than generalizing that picture to non-Abelian groups, Childs, Schulman and Vazirani suggest an alternative generalization, to hidden subsets that are not lattices at all, which the paper calls hidden nonlinear structures over finite fields. The paper gives examples of two such problems that it states can be solved efficiently by a quantum computer but not by a classical computer, and it also gives some positive results on the quantum query complexity of finding hidden nonlinear structures. The Zoo records that, as shown by Childs et al., this problem is efficiently solvable on quantum computers for certain subsets defined by polynomials, such as spheres, and that Decker et al. showed how to efficiently solve some related problems.",
    ideaJa:
      "Zoo は可換群を格子として、部分群をその部分格子として、部分群の剰余類を部分格子の平行移動として描き、可換な隠れ部分群問題は通常、隠れ部分群のランダムな剰余類上の重ね合わせを得たうえで Fourier 変換を施し、双対格子からサンプリングすることで解かれると記しています。Childs、Schulman、Vazirani は、この描像を非可換群へ一般化するのではなく、そもそも格子ではない隠れた部分集合へ一般化する方向を代替案として提案しており、これを有限体上の隠れた非線形構造と呼んでいます。論文は、量子計算機では効率的に解けるが古典計算機では解けないと述べる例を 2 つ挙げ、さらに隠れた非線形構造を見つける問題の量子クエリ計算量について肯定的な結果を与えています。Zoo は、Childs らが示したとおり、この問題が球面のような多項式で定義される特定の部分集合については量子計算機で効率的に解けること、および Decker らが関連するいくつかの問題を効率的に解く方法を示したことを記しています。",
    complexity: "",
    complexityBasis:
      'Two sources were read and neither states a bound. The Quantum Algorithm Zoo entry "Hidden Nonlinear Structures" says only that "this problem is efficiently solvable on quantum computers for certain subsets defined by polynomials, such as spheres", with no query count and no running time. The abstract of arXiv:0705.2784 likewise quotes no figure: "We give examples of two such problems that can be solved efficiently by a quantum computer, but not by a classical computer. We also give some positive results on the quantum query complexity of finding hidden nonlinear structures." Since neither source states an exponent, a constant, a query count or a gate count, the complexity field is left empty rather than filled from elsewhere.',
    caveat:
      "This is a literature record: nothing was constructed, compiled, simulated or run here, and no hidden subset was identified. Neither source states a query count, a running time, a gate count or a qubit count, so the record fixes no cost for any instance and supports no claim about problem sizes or hardware feasibility; the word efficiently is doing all the work in both sources and is left unquantified in each. Efficient solution is stated for two example problems and, in the Zoo, for certain subsets defined by polynomials such as spheres, not for hidden nonlinear structures in general. The separation from classical computation is the paper's own claim as reported here, not a bound re-derived in this record, and the positive results on quantum query complexity that the abstract mentions are not itemized by either source. The related problems the Zoo attributes to Decker et al. rest on papers outside this record, as does the cost of building the oracle for any concrete polynomial subset.",
    caveatJa:
      "本項目は文献に基づく記録であり、ここで回路の構成、コンパイル、シミュレーション、実行を行ったことはなく、隠れた部分集合を実際に同定したわけでもありません。いずれの資料もクエリ数、実行時間、ゲート数、量子ビット数を示していないため、具体的な問題例に対するコストは確定しておらず、扱える問題規模やハードウェア上の実現可能性についても何も言えません。両資料とも「効率的」という語が主張の中心にありますが、その定量的な内容は示されていません。効率的に解けるとされているのは 2 つの例題、および Zoo の記述では球面のような多項式で定義される特定の部分集合についてであって、隠れた非線形構造一般についてではありません。古典計算との差は論文自身の主張をそのまま記録したものであり、本記録で導出し直したものではありません。要旨が言及する量子クエリ計算量に関する肯定的な結果も、いずれの資料にも個別の内容は示されていません。Zoo が Decker らに帰する関連問題は本記録の対象外の論文に基づいており、具体的な多項式部分集合に対するオラクルの実装コストも同様です。",
    tags: ["hidden nonlinear structures", "oracle", "finite fields", "query complexity", "hidden subgroup"],
    source: {
      id: "arxiv:0705.2784",
      title: "Quantum algorithms for hidden nonlinear structures",
      authors: "Andrew M. Childs, Leonard J. Schulman, Umesh V. Vazirani",
      year: "2007",
      url: "https://arxiv.org/abs/0705.2784",
    },
    literature: [
      {
        title: "Quantum algorithms for hidden nonlinear structures",
        authors: "Andrew M. Childs, Leonard J. Schulman, Umesh V. Vazirani",
        year: "2007",
        url: "https://arxiv.org/abs/0705.2784",
        relevance:
          "Primary source: it proposes finding hidden nonlinear structures over finite fields as an alternative to the nonabelian hidden subgroup problem, gives two such problems it states are solvable efficiently by a quantum computer but not classically, and reports positive results on the quantum query complexity of the task. Consult it for the two example problems and for the query complexity results themselves, since the abstract names neither.",
        relevanceJa:
          "一次資料です。非可換な隠れ部分群問題に代わる方向として、有限体上の隠れた非線形構造を見つける問題を提案し、量子計算機では効率的に解けるが古典計算機では解けないとする問題を 2 つ示したうえで、その量子クエリ計算量について肯定的な結果を報告しています。2 つの例題の内容も、量子クエリ計算量の結果そのものも要旨には示されていないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["hidden-shift-problem", "quantum-fourier-transform", "discrete-logarithm", "shor-period-finding"],
  },
  {
    slug: "matrix-rank-span-program",
    title: "Matrix rank by a span program",
    titleJa: "spanプログラムによる行列の階数問題",
    family: "Quantum query algorithm",
    zooName: "Matrix Rank",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    problem:
      "Given oracle access to the integer entries of an n×m matrix A, determine the rank of A.",
    problemJa:
      "n×m の整数行列 A の各成分へオラクル経由でアクセスできるとき、その行列の階数を求める問題です。",
    idea:
      "Belovs' paper opens from the statement that span programs have recently been shown to be equivalent to quantum query algorithms, calls it an open problem whether that equivalence can be used to come up with new quantum algorithms, and addresses that problem by providing span programs for some linear algebra problems. It develops a notion of a high level span program, which abstracts away the loading of input vectors into a span program, and gives such a high level span program for the rank problem. Its closing section reduces a high level span program to an ordinary span program, which known quantum query algorithms can then evaluate. The Zoo describes the result as an algorithm that can use fewer queries than the classical order-nm cost given a promise that the rank of the matrix is at least r, with the count depending on the r largest singular values of A and on how sparse A is.",
    ideaJa:
      "Belovs の論文は、spanプログラムと量子クエリアルゴリズムが等価であることが近年示されたという記述から出発し、この等価性を新しい量子アルゴリズムの構成に活用できるかは未解決の問題であるとしたうえで、いくつかの線形代数の問題に対するspanプログラムを与えることでこの問題に取り組んでいます。論文は、入力ベクトルをspanプログラムへ読み込む部分を抽象化した高水準spanプログラムという概念を導入し、階数問題に対する高水準spanプログラムを与えています。最後の節では、高水準spanプログラムを通常のspanプログラムへ還元しており、こちらは既知の量子クエリアルゴリズムで評価できます。Zoo は、こうして得られる結果を、階数が r 以上であるという約束のもとで古典側の nm のオーダーより少ないクエリ数で済むアルゴリズムとして紹介しており、そのクエリ数は A の大きいほうから r 個の特異値と A の疎性に依存します。",
    complexity:
      "O(√(r(n-r+1)) L T) queries to the entries of an n×m integer matrix A under a promise that the rank of A is at least r, where L is the root-mean-square of the reciprocals of the r largest singular values of A and T is a factor set by the sparsity of A: T = O(√(nm)) for general A, and T = O(k log(n+m)) when A has at most k nonzero entries in any row or column. The Zoo gives the classical cost as order nm queries. Every figure here is the Zoo's; the paper's own abstract states no query count.",
    complexityBasis:
      'Quantum Algorithm Zoo entry "Matrix Rank" (LaTeX rendered into Unicode): "Belovs\' algorithm uses O(√(r(n-r+1))LT) queries, where L is the root-mean-square of the reciprocals of the r largest singular values of A and T is a factor that depends on the sparsity of the matrix. For general A , T = O(√(nm)) . If A has at most k nonzero entries in any row or column then T = O(k log(n+m))"; the classical side and the problem statement are from the same entry: "Suppose we are given oracle access to the (integer) entries of an n × m matrix A . We wish to determine the rank of the matrix. Classically this requires order nm queries." The abstract of arXiv:1103.0842 quotes no query count, gate count or runtime anywhere; it describes the construction only, closing "The last section of the paper deals with reducing a high level span program to an ordinary span program that can be solved using known quantum query algorithms." The bound above therefore rests on the Zoo entry alone, not on the primary paper\'s abstract.',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated or run, and no matrix instance was solved. The query count above is the Zoo's summary of Belovs' result, and the paper's abstract states no bound at all, so nothing here was checked against the paper's own analysis. The count is stated under a promise that the rank is at least r, and it carries two instance-dependent factors that are not known in advance: L is the root-mean-square of the reciprocals of the r largest singular values of A, so on that definition a matrix whose r largest singular values are small gives a larger L and a larger count, and T is set by the sparsity of A. The Zoo is explicit that the k-sparse figure T = O(k log(n+m)) requires a stronger oracle than the entry access in which the problem is posed, one that takes a column index as input and returns a list of the nonzero elements of that column. Everything is counted in queries, so gate counts, circuit depth, the arithmetic on the integer entries and the cost of realising either oracle are outside this record. For the special case of deciding whether a square matrix is singular, the determinant problem, the Zoo reports on a paper outside this record that for general A the quantum query complexity is no lower than the classical one, while noting that this does not rule out a speedup under a promise such as sparseness or the absence of small singular values.",
    caveatJa:
      "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な行列を解いたわけでもありません。上記のクエリ数は Zoo が Belovs の結果をまとめたものであり、論文の要旨自体は計算量を一切述べていないため、論文の解析と突き合わせた確認はここでは行っていません。この評価は階数が r 以上であるという約束のもとで述べられており、さらに事前には分からない二つの量に依存します。L は A の大きいほうから r 個の特異値の逆数の二乗平均平方根であり、この定義に従えば、大きいほうから r 個の特異値が小さい行列ほど L は大きくなり、クエリ数も増えます。T は A の疎性で決まります。また Zoo は、k 疎の場合の T = O(k log(n+m)) を得るには、問題設定にある成分アクセスのオラクルより強いオラクル、すなわち列の添字を入力として受け取り、その列の非零成分の一覧を返すオラクルが必要だと明記しています。数えているのはクエリ数のみであり、ゲート数、回路深さ、整数成分に対する算術、いずれのオラクルを実装するコストも対象外です。正方行列が特異かどうかを判定する特別な場合、すなわち行列式の問題については、一般の A に対する量子クエリ計算量は古典のそれを下回らないと Zoo が本記録の対象外の論文を引いて報告しており、同時に、疎であることや小さい特異値を持たないことといった約束のもとでの高速化までは否定されていないと述べています。",
    tags: ["matrix rank", "span program", "query complexity", "oracle", "linear algebra"],
    source: {
      id: "arxiv:1103.0842",
      title: "Span-program-based quantum algorithm for the rank problem",
      authors: "Aleksandrs Belovs",
      year: "2011",
      url: "https://arxiv.org/abs/1103.0842",
    },
    literature: [
      {
        title: "Span-program-based quantum algorithm for the rank problem",
        authors: "Aleksandrs Belovs",
        year: "2011",
        url: "https://arxiv.org/abs/1103.0842",
        relevance:
          "Primary source. It provides span programs for some linear algebra problems, develops the notion of a high level span program that abstracts from loading input vectors into a span program, gives a high level span program for the rank problem, and reduces it to an ordinary span program solvable by known quantum query algorithms. The abstract states no query count, so the cost claim recorded here comes from the Zoo entry rather than from this paper; consult the paper itself for the analysis behind it.",
        relevanceJa:
          "一次資料です。いくつかの線形代数の問題に対するspanプログラムを与え、入力ベクトルの読み込みを抽象化した高水準spanプログラムという概念を導入し、階数問題に対する高水準spanプログラムを示したうえで、既知の量子クエリアルゴリズムで解ける通常のspanプログラムへ還元しています。要旨に計算量の記載はないため、計算量欄の主張は本論文ではなく Zoo の項目に由来します。その根拠となる解析は原論文で確認してください。",
      },
      {
        title:
          "Span programs and quantum query complexity: The general adversary bound is nearly tight for every boolean function",
        authors: "Ben W. Reichardt",
        year: "2009",
        url: "https://arxiv.org/abs/0904.2759",
        relevance:
          "Companion source for the equivalence the primary paper opens from. Belovs' abstract states that span programs have recently been shown to be equivalent to quantum query algorithms without naming a source for it, and this paper states that equivalence as a result of its own. It turns the general adversary bound, a semi-definite program that lower-bounds quantum query complexity, into an upper bound: one SDP outputs for any boolean function a span program of optimal witness size, that optimal witness size is shown to coincide with the general adversary bound, and a quantum algorithm evaluates span programs with only a logarithmic query overhead on the witness size. The paper states the resulting universality in both directions, that a good quantum query algorithm for a problem implies a good span program and vice versa, and it reports a corollary of an optimal quantum algorithm for evaluating balanced formulas over any finite boolean gate set.",
        relevanceJa:
          "一次資料が出発点とする等価性に対応する関連資料です。Belovs の要旨は、spanプログラムと量子クエリアルゴリズムが等価であることが近年示されたと述べるだけで出典を挙げていませんが、本論文はこの等価性を自らの結果として述べています。量子クエリ計算量の下界を与える半正定値計画である一般敵対者限界を上界へ転じており、まず一つの半正定値計画が任意のブール関数に対して最適な証拠サイズを持つspanプログラムを出力し、その最適な証拠サイズが一般敵対者限界と一致することを示したうえで、証拠サイズに対して対数のクエリオーバーヘッドだけでspanプログラムを評価する量子アルゴリズムを与えています。論文はこの結果を双方向の普遍性として述べており、ある問題に対する良い量子クエリアルゴリズムは良いspanプログラムを含意し、その逆も成り立つとしています。また系として、任意の有限ブールゲート集合上の均衡な式を評価する最適な量子アルゴリズムが得られると報告しています。",
      },
    ],
    relatedSlugs: ["matrix-product-verification", "nand-tree-evaluation", "graph-properties-adjacency-matrix"],
  },
  {
    slug: "search-with-wildcards",
    title: "Search with wildcards",
    titleJa: "ワイルドカード付き探索",
    family: "Quantum query algorithm",
    zooName: "Search with Wildcards",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    problem:
      "Identify a hidden n-bit string x using an oracle that, for a chosen subset S of the n positions and a string y of length |S|, returns one when the substring of x specified by S equals y and zero otherwise.",
    problemJa:
      "隠された n ビット文字列 x を、n 個の位置のうち選んだ部分集合 S と長さ |S| の文字列 y に対して、S が指定する x の部分文字列が y と一致するとき 1 を、そうでないとき 0 を返すオラクルへの問い合わせだけから同定する問題です。",
    idea:
      "Each query tests a partial guess: the chosen positions S carry the guessed bits y, the positions left out of S are left unconstrained, and the query is answered yes only when the guess is right on every position it commits to. Ambainis and Montanaro describe an algorithm for recovering x that rests neither on amplitude amplification nor on a quantum walk, but ultimately on the solution to a state discrimination problem; the Zoo names the measurement it uses as the Pretty Good Measurement. The same paper gives a separate and, in its own description, simple quantum algorithm for combinatorial group testing, the task of identifying at most k special items among n when each query asks whether a chosen subset contains any special item.",
    ideaJa:
      "各クエリは部分的な推測を検査するものです。選んだ位置の集合 S に推測したビット列 y を置き、S に含めなかった位置には何も課さないため、1 回のクエリに肯定が返るのは、確定させた位置すべてで推測が正しい場合に限られます。Ambainis と Montanaro は、x を復元するアルゴリズムを与えていますが、それは振幅増幅にも量子ウォークにも依拠せず、最終的には状態識別問題の解に基づいています。Zoo は、そこで用いられる測定を Pretty Good Measurement と呼んでいます。同じ論文は、組合せ的グループテスト、すなわち各クエリで選んだ部分集合が特別な要素を含むかどうかを尋ねながら、n 個の中から高々 k 個の特別な要素を同定する課題に対しても、著者ら自身が単純と述べる別の量子アルゴリズムを与えています。",
    complexity:
      "O(√n log n) quantum queries to recover the hidden n-bit string, against the classical lower bound of Ω(n) queries. The Zoo states the problem's quantum query complexity as Θ(√n) and its classical query complexity as Θ(n); the paper's abstract claims only the upper bound and calls its algorithm nearly optimal, so the Zoo's Θ(√n) is the stronger of the two statements and both are recorded rather than reconciled. For combinatorial group testing, the second problem in the same paper, O(k log k) queries against the classical lower bound of Ω(k log(n/k)) queries, where n counts the items in the set and k bounds the special items among them rather than the bits of the hidden string above.",
    complexityBasis:
      'abstract of arXiv:1210.1148: "We give a nearly optimal O(sqrt(n) log n) quantum query algorithm for search with wildcards, beating the classical lower bound of Omega(n) queries", and, for the second problem, "We give a simple quantum algorithm which uses O(k log k) queries to solve this problem, as compared with the classical lower bound of Omega(k log(n/k)) queries". The tight figures are from the Quantum Algorithm Zoo entry "Search with Wildcards" (LaTeX rendered into Unicode, spacing inside the reference bracket normalized): "Classically, this problem has query complexity Θ(n). As shown in [167], the quantum query complexity of this problem is Θ(√n)." The Zoo asserts a tight Θ(√n) where the abstract quoted above states only the upper bound O(sqrt(n) log n); this record carries both and settles neither.',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated or run, and no hidden string was recovered here. The two sources do not agree on the tightness of the quantum bound, the abstract giving O(√n log n) as nearly optimal and the Zoo giving Θ(√n), and this record reports the disagreement rather than resolving it. Everything above is a query count in the oracle model, so gate counts, circuit depth, the number of bits a query carries and the cost of realising the wildcard oracle on hardware are outside it, as are the constant factors hidden by O(·). The attribution of the measurement to the Pretty Good Measurement is the Zoo's wording; the abstract says only that the algorithm is ultimately based on the solution to a state discrimination problem. The classical Ω(n) is quoted from the abstract as a lower bound, which is a stronger kind of claim than a comparison against the best algorithm currently known, but this record re-derives neither it nor the quantum bounds. The group-testing result is the paper's second problem and is not the subject of this Zoo entry; the Zoo places it, together with later and faster quantum algorithms for group testing that rest on papers outside this record, under its Junta Testing and Group Testing entry.",
    caveatJa:
      "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、ここで隠された文字列を復元したわけでもありません。量子側の評価が緊密かどうかについて二つの資料は一致しておらず、要旨は O(√n log n) をほぼ最適と述べ、Zoo は Θ(√n) としています。本記録はこの相違を解消せず、そのまま記載しています。上記はいずれもオラクルモデルにおけるクエリ数であり、ゲート数、回路深さ、1 回のクエリが運ぶビット数、ワイルドカード付きのオラクルを実機で実現するコスト、および O(·) に隠れた定数因子は対象外です。測定を Pretty Good Measurement とする言い方は Zoo によるものであり、要旨は、アルゴリズムが最終的に状態識別問題の解に基づくとしか述べていません。古典側の Ω(n) は要旨から引いた下界であり、現在知られている最良のアルゴリズムとの比較よりも強い種類の主張ですが、本記録ではこれも量子側の評価も導出し直してはいません。グループテストの結果は同じ論文の二つ目の問題であって、この Zoo 項目の主題ではありません。Zoo はこれを、本記録の対象外の論文による後年のより高速な量子アルゴリズムとあわせて、Junta Testing and Group Testing の項目に置いています。",
    tags: ["search with wildcards", "query complexity", "oracle", "state discrimination", "group testing"],
    source: {
      id: "arxiv:1210.1148",
      title: "Quantum algorithms for search with wildcards and combinatorial group testing",
      authors: "Andris Ambainis, Ashley Montanaro",
      year: "2012",
      url: "https://arxiv.org/abs/1210.1148",
    },
    literature: [
      {
        title: "Quantum algorithms for search with wildcards and combinatorial group testing",
        authors: "Andris Ambainis, Ashley Montanaro",
        year: "2012",
        url: "https://arxiv.org/abs/1210.1148",
        relevance:
          "Primary source and the origin of the upper bounds in the cost claim: the O(√n log n) query algorithm for search with wildcards, described as nearly optimal and as beating the classical lower bound of Ω(n) queries, and the O(k log k) query algorithm for combinatorial group testing against the classical lower bound of Ω(k log(n/k)) queries. The abstract also records what the algorithm is not built from, stating that rather than using amplitude amplification or a quantum walk it is ultimately based on the solution to a state discrimination problem.",
        relevanceJa:
          "一次資料であり、計算量欄の上界はここに由来します。ワイルドカード付き探索に対する O(√n log n) クエリのアルゴリズムはほぼ最適であり、古典側の下界 Ω(n) クエリを下回ると述べられています。組合せ的グループテストについては、古典側の下界 Ω(k log(n/k)) クエリに対し O(k log k) クエリのアルゴリズムが示されています。要旨は、このアルゴリズムが何に基づいていないかも記しており、振幅増幅や量子ウォークではなく、最終的には状態識別問題の解に基づくと述べています。",
      },
    ],
    relatedSlugs: [
      "bernstein-vazirani-qiskit",
      "grover-unstructured-search",
      "string-pattern-matching",
      "counterfeit-coin-problem",
    ],
  },
  {
    slug: "hypercube-dynamic-programming",
    title: "Quantum dynamic programming for path in the hypercube",
    titleJa: "超立方体上の路問題に対する量子動的計画法",
    family: "Quantum query algorithm",
    zooName: "Quantum Dynamic Programming for path-in-the-hypercube",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Polynomial",
    problem:
      "Given a subgraph of the Boolean hypercube on bit strings of length n, whose edges all run from smaller to larger Hamming weight, decide whether it contains a path from the all-zeros vertex 0^n to the all-ones vertex 1^n.",
    problemJa:
      "長さ n のビット列を頂点とするブール超立方体の部分グラフで、辺がすべて Hamming 重みの小さい側から大きい側へ向いているものが与えられたとき、全 0 の頂点 0^n から全 1 の頂点 1^n への路が存在するかどうかを判定する問題です。",
    idea:
      "Ambainis, Balodis, Iraids, Kokainis, Prūsis and Vihrovs introduce the path in the hypercube problem, which the paper states models many of the NP-complete problems whose best classical algorithm is an exponential-time application of dynamic programming, and the Zoo likewise records that many such problems can be modelled as instances of it. The technique the paper describes combines Grover's search with computing a partial dynamic programming table, and the bound it reports for that technique, O*(1.817^n), has a smaller base than the O*(2^n) the Zoo gives for the fastest known classical algorithm. The same approach is then applied to a variety of vertex ordering problems on graphs and to graph bandwidth, and similar ideas to the travelling salesman problem and minimum set cover. The Zoo adds the reading of the graph itself, that the vertices of the hypercube graph correspond to bit strings of length n and that the graph joins vertices of Hamming distance one, and it lists feedback arc set alongside the travelling salesman problem among the problems this primitive is applied to.",
    ideaJa:
      "Ambainis、Balodis、Iraids、Kokainis、Prūsis、Vihrovs は超立方体上の路問題を導入しており、論文はこの問題が、最良の古典アルゴリズムが指数時間の動的計画法となる NP 完全問題の多くをモデル化すると述べています。Zoo も同様に、そうした問題の多くがこの問題の事例としてモデル化できると記しています。論文が述べる手法は Grover 探索と動的計画法の部分表の計算を組み合わせたものであり、報告されている評価 O*(1.817^n) の底は、Zoo が最速の既知の古典アルゴリズムとして挙げる O*(2^n) の底を下回ります。同じ手法はグラフ上の各種の頂点順序付け問題とグラフ帯域幅に適用され、同様の考え方が巡回セールスマン問題と最小集合被覆にも適用されています。Zoo はさらにグラフ自体の読み方として、超立方体グラフの頂点が長さ n のビット列に対応し、Hamming 距離 1 の頂点どうしが結ばれることを述べ、この基本手法の適用先として巡回セールスマン問題と並べてフィードバック辺集合問題も挙げています。",
    complexity:
      "O*(1.817^n) for path in the hypercube on bit strings of length n, where O* omits polynomial factors, against O*(2^n) for the fastest known classical algorithm; the abstract reports the same approach for vertex ordering problems in O*(1.817^n), which the Zoo sets against O*(2^n) classically, and for graph bandwidth in O*(2.946^n), set against O*(4.383^n) classically, and reports similar ideas for the travelling salesman problem and minimum set cover in O*(1.728^n), with minimum set cover stated by the Zoo as O(poly(m,n) 1.728^n) against O(nm2^n) classically. The two sources differ on one figure: where the abstract writes 1.728^n for the travelling salesman problem and minimum set cover together, the Zoo writes 1.729^n for traveling salesman and feedback arc set against O*(2^n) classically and gives minimum set cover a figure of its own.",
    complexityBasis:
      'Abstract of arXiv:1807.05209 (TeX math delimiters removed, exponents left in caret form): "We give a quantum algorithm that solves path in the hypercube in time O^*(1.817^n). The technique combines Grover\'s search with computing a partial dynamic programming table. We use this approach to solve a variety of vertex ordering problems on graphs in the same time O^*(1.817^n), and graph bandwidth in time O^*(2.946^n). Then we use similar ideas to solve the travelling salesman problem and minimum set cover in time O^*(1.728^n)." The classical baselines and the per-problem contrasts are from the Quantum Algorithm Zoo entry "Quantum Dynamic Programming for path-in-the-hypercube" (LaTeX rendered into Unicode: math delimiters removed, the mathrm markup around poly dropped, spacing inside the math closed up): "a quantum algorithm can solve path-in-the-hypercube in time O^*(1.817^n), where the notation O^* indicates that polynomial factors are being omitted. The fastest known classical algorithm for this problem runs in time O^*(2^n)", and "vertex ordering problems in O^*(1.817^n) vs. O^*(2^n) classically, graph bandwidth in O^*(2.946^n) vs. O^*(4.383^n) classically, traveling salesman and feedback arc set in O^*(1.729^n) vs. O^*(2^n) classically, and minimum set cover in O(poly(m,n) 1.728^n) vs. O(nm2^n) classically." The 1.728 / 1.729 difference is recorded as both sources read: the abstract pairs 1.728^n with the travelling salesman problem and minimum set cover together, while the Zoo gives 1.728^n to minimum set cover alone and 1.729^n to traveling salesman and feedback arc set. Neither reading was reconciled here.',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated or run, and no instance of path in the hypercube was decided here. Every figure above is an asymptotic running time as the two sources state it, with O* omitting polynomial factors, so none of it fixes a gate count, a circuit depth, a qubit count, a constant factor or an error-correction budget, and none of it says which n is reachable on a device. The comparison is against the fastest classical algorithm currently known, which the Zoo gives as O*(2^n) for this problem, rather than against a proved classical lower bound, and both sides remain exponential in n. The Zoo classes the speedup as polynomial; neither source gives a reason for that classification and none is supplied here. The two sources also attach the 1.728^n figure to different problems, as noted above, and give the travelling salesman problem different bases, 1.728 in the abstract against 1.729 in the Zoo; nothing here resolves either difference. How the partial dynamic programming table is held and addressed on a quantum device, and the cost of the Grover subroutine's oracle for a concrete graph, are outside this record, as are the NP-complete problems the Zoo says can be modelled as instances of path-in-the-hypercube beyond the ones named.",
    caveatJa:
      "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、実行は行っておらず、超立方体上の路問題の具体例を判定したこともありません。上記の値はいずれも 2 つの資料が示すとおりの漸近的な実行時間であり、O* は多項式因子を省略した記法です。したがってゲート数、回路深さ、量子ビット数、定数因子、誤り訂正の見積もりはいずれも確定しておらず、実機でどの程度の n まで扱えるかについても何も言えません。比較対象は現在知られている最速の古典アルゴリズム、この問題については Zoo が挙げる O*(2^n) であって、証明された古典側の下界ではありません。量子側も古典側も n について指数時間のままです。Zoo は高速化を多項式的と分類していますが、その理由はいずれの資料にも示されておらず、ここでも補っていません。1.728^n という値がどの問題に対応するかは 2 つの資料で異なり、巡回セールスマン問題の底も要旨では 1.728、Zoo では 1.729 と食い違っています。上記のとおり記録するにとどめ、どちらが正しいかはここでは判断していません。動的計画法の部分表を量子デバイス上でどのように保持し参照するか、また具体的なグラフに対する Grover 探索のオラクルの実装コストは本記録の対象外です。Zoo が超立方体上の路問題としてモデル化できるとする NP 完全問題のうち、名前の挙がっていないものも同様です。",
    tags: ["dynamic programming", "grover search", "hypercube", "np-complete", "exponential time"],
    source: {
      id: "arxiv:1807.05209",
      title: "Quantum Speedups for Exponential-Time Dynamic Programming Algorithms",
      authors: "Andris Ambainis, Kaspars Balodis, Jānis Iraids, Martins Kokainis, Krišjānis Prūsis, Jevgēnijs Vihrovs",
      year: "2018",
      url: "https://arxiv.org/abs/1807.05209",
    },
    literature: [
      {
        title: "Quantum Speedups for Exponential-Time Dynamic Programming Algorithms",
        authors: "Andris Ambainis, Kaspars Balodis, Jānis Iraids, Martins Kokainis, Krišjānis Prūsis, Jevgēnijs Vihrovs",
        year: "2018",
        url: "https://arxiv.org/abs/1807.05209",
        relevance:
          "Primary source: it introduces path in the hypercube as a model for NP-complete problems whose best classical algorithm is an exponential-time dynamic program, states the O*(1.817^n) algorithm built from Grover's search plus a partial dynamic programming table, and carries the technique to vertex ordering problems, graph bandwidth, the travelling salesman problem and minimum set cover. Consult it for what the partial table costs and for the assumptions behind each derived bound, none of which the abstract states.",
        relevanceJa:
          "一次資料です。最良の古典アルゴリズムが指数時間の動的計画法となる NP 完全問題のモデルとして超立方体上の路問題を導入し、Grover 探索と動的計画法の部分表を組み合わせた O*(1.817^n) のアルゴリズムを示したうえで、その手法を頂点順序付け問題、グラフ帯域幅、巡回セールスマン問題、最小集合被覆へ広げています。部分表の計算コストや各評価が前提とする条件は要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["grover-unstructured-search", "amplitude-amplification", "qaoa-maxcut-ring"],
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
