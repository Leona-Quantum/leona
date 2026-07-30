// Verification classification for the public repository.
// Taxonomy source: docs/verification/nameko_verification_playbook.md (confidence
// tiers + technique catalog) adapted for catalog records per the owner request of
// 2026-07-16: every entry is classified by HOW it was verified, methods are grouped
// into tiers, and the legend renders from these registries so UI and data cannot
// drift apart. Tones map to the semantic tokens (--ok/--accent/--warn/neutral);
// every tier carries a glyph so meaning never relies on hue alone (the light
// palette is monochrome by owner directive).

export type VerificationTier = 1 | 2 | 3 | 4;

export type VerificationMethodId =
  // Tier 1 — exact & formal
  | "direct_math"
  | "unitary_equivalence"
  | "exact_simulation"
  | "stabilizer_simulation"
  | "truth_table"
  // Tier 2 — strong empirical & design
  | "statistical_counts"
  | "small_instance"
  | "subblock"
  | "echo_inverse"
  | "invariant_checks"
  | "construction"
  // Tier 3 — attested & literature
  | "research_paper"
  | "textbook_citation"
  | "expert_review"
  | "tangential"
  // Tier 4 — automated & unreviewed
  | "llm_reviewed"
  | "community_submission";

export type VerificationTone = "ok" | "accent" | "warn" | "neutral";

export interface VerificationTierInfo {
  tier: VerificationTier;
  name: string;
  nameJa: string;
  glyph: string;
  tone: VerificationTone;
  summary: string;
  summaryJa: string;
}

export interface VerificationMethodInfo {
  id: VerificationMethodId;
  tier: VerificationTier;
  label: string;
  labelJa: string;
  description: string;
  descriptionJa: string;
}

export const VERIFICATION_TIERS: readonly VerificationTierInfo[] = [
  {
    tier: 1,
    name: "Exact & formal",
    nameJa: "厳密・形式的",
    glyph: "≡",
    tone: "ok",
    summary:
      "The defining behavior was checked exactly: a mathematical identity, a full statevector or stabilizer simulation, or an exhaustive basis-state truth table.",
    summaryJa:
      "数学的恒等式、完全な状態ベクトル/スタビライザーシミュレーション、または網羅的な真理値表によって、定義そのものを厳密に検証しています。",
  },
  {
    tier: 2,
    name: "Strong empirical",
    nameJa: "実測による検証",
    glyph: "✓",
    tone: "accent",
    summary:
      "The design was verified by construction plus measured evidence: statistical re-execution, small-instance analytic agreement, sub-block, echo, or invariant checks. Scale-specific bugs can still survive.",
    summaryJa:
      "構成の確認に加え、統計的な再実行、小規模での解析結果との一致、サブブロック、エコー、不変量などの実測結果で設計を検証しています。規模に固有の問題は残る可能性があります。",
  },
  {
    tier: 3,
    name: "Attested & literature",
    nameJa: "文献・専門家による裏付け",
    glyph: "◐",
    tone: "warn",
    summary:
      "The record rests on external authority: peer-reviewed papers, standard textbooks, expert review, or evidence carried over from related verified entries. Nothing here was re-executed by this catalog.",
    summaryJa:
      "査読論文、標準的な教科書、専門家レビュー、関連する検証済み項目など、外部の裏付けに基づきます。このAtlas上では再実行していません。",
  },
  {
    tier: 4,
    name: "Automated & unreviewed",
    nameJa: "自動・未レビュー",
    glyph: "○",
    tone: "neutral",
    summary:
      "Only automated (LLM-assisted) review or an unreviewed community submission backs this record so far. Treat it as a starting point, not evidence.",
    summaryJa:
      "現時点ではLLMによる確認、または未レビューのコミュニティ投稿です。正しさが確認済みとはみなさず、参考情報として扱ってください。",
  },
] as const;

export const VERIFICATION_METHODS: readonly VerificationMethodInfo[] = [
  {
    id: "direct_math",
    tier: 1,
    label: "Direct mathematics",
    labelJa: "直接の数学的検証",
    description: "An analytic identity or closed-form derivation proves the defining property (e.g. H² = I, Y = iXZ).",
    descriptionJa: "解析的な恒等式や閉形式の導出で定義的性質を証明します（例: H² = I、Y = iXZ）。",
  },
  {
    id: "unitary_equivalence",
    tier: 1,
    label: "Unitary / matrix equivalence",
    labelJa: "ユニタリ／行列の等価性",
    description: "The circuit's unitary was computed and compared against the reference matrix.",
    descriptionJa: "回路のユニタリを計算し、参照行列と比較しています。",
  },
  {
    id: "exact_simulation",
    tier: 1,
    label: "Exact statevector simulation",
    labelJa: "厳密な状態ベクトルシミュレーション",
    description: "A full statevector simulation reproduced the exact expected state or distribution.",
    descriptionJa: "完全な状態ベクトルシミュレーションで、期待される状態や分布を厳密に再現しています。",
  },
  {
    id: "stabilizer_simulation",
    tier: 1,
    label: "Stabilizer simulation",
    labelJa: "スタビライザーシミュレーション",
    description: "Clifford structure allowed exact verification with stabilizer methods beyond statevector limits.",
    descriptionJa: "クリフォード構造により、状態ベクトルの限界を超えてスタビライザー法で厳密に検証しています。",
  },
  {
    id: "truth_table",
    tier: 1,
    label: "Basis-state truth table",
    labelJa: "基底状態の真理値表",
    description: "Reversible classical logic was checked exhaustively (or at edge cases) on computational-basis inputs.",
    descriptionJa: "可逆な古典論理を計算基底の入力で、網羅的または境界値を使って検証しています。",
  },
  {
    id: "statistical_counts",
    tier: 2,
    label: "Statistical re-execution",
    labelJa: "統計的再実行",
    description: "Measured counts from independent executions agreed within statistical tolerance (e.g. TVD bounds).",
    descriptionJa: "独立した実行の測定結果が統計的な許容範囲（例: TVDの許容範囲）で一致しています。",
  },
  {
    id: "small_instance",
    tier: 2,
    label: "Small-instance agreement",
    labelJa: "小規模での解析的一致",
    description: "The same generator matched analytic results at tractable sizes; large instances are inferred.",
    descriptionJa: "同じ生成器が扱える規模で解析結果と一致しています。大規模な回路での一致は未確認です。",
  },
  {
    id: "subblock",
    tier: 2,
    label: "Sub-block verification",
    labelJa: "サブブロック検証",
    description: "Reusable modules (oracle, QFT block, Trotter step, adder…) were verified independently.",
    descriptionJa: "再利用モジュール（オラクル、QFTブロック、トロッターステップ、加算器など）を個別に検証しています。",
  },
  {
    id: "echo_inverse",
    tier: 2,
    label: "Echo / inverse test",
    labelJa: "エコー／逆演算テスト",
    description: "U followed by U† returned the input exactly, catching wiring, phase, and ancilla bugs.",
    descriptionJa: "UにU†を続けて入力が厳密に戻ることを確認し、配線・位相・補助量子ビットのバグを検出します。",
  },
  {
    id: "invariant_checks",
    tier: 2,
    label: "Invariant & structural checks",
    labelJa: "不変量・構造チェック",
    description: "Scale-independent invariants held: qubit counts, unitarity, symmetry, conservation laws, ancilla cleanup.",
    descriptionJa: "量子ビット数、ユニタリ性、対称性、保存則、補助量子ビットの初期化などスケール非依存の不変量を確認しています。",
  },
  {
    id: "construction",
    tier: 2,
    label: "Verified by construction",
    labelJa: "構成による検証",
    description: "The circuit follows a specification whose correctness argument is standard; the construction was audited against it.",
    descriptionJa: "正しさの議論が標準的な仕様に従って構成され、その仕様に照らして監査されています。",
  },
  {
    id: "research_paper",
    tier: 3,
    label: "Peer-reviewed paper",
    labelJa: "査読付き論文",
    description: "The record's claims trace to one or more peer-reviewed publications cited on the entry.",
    descriptionJa: "この項目の説明は、引用された査読付き論文に基づきます。",
  },
  {
    id: "textbook_citation",
    tier: 3,
    label: "Textbook / standard citation",
    labelJa: "教科書・標準規格の引用",
    description: "The behavior is standard material (e.g. Nielsen & Chuang, OpenQASM spec) and is cross-referenced, not re-derived.",
    descriptionJa: "標準的な教科書や仕様（例: Nielsen & Chuang、OpenQASM仕様）との照合であり、再導出ではありません。",
  },
  {
    id: "expert_review",
    tier: 3,
    label: "Expert review",
    labelJa: "専門家レビュー",
    description: "A named human reviewer with domain expertise checked the record.",
    descriptionJa: "該当分野の専門知識を持つレビュアーが内容を確認しています。",
  },
  {
    id: "tangential",
    tier: 3,
    label: "Tangential evidence",
    labelJa: "傍証",
    description: "Correctness is supported indirectly through related verified entries (e.g. a gate verified inside a verified algorithm).",
    descriptionJa: "関連する検証済み項目を通じて間接的に裏付けられています（例: 検証済みアルゴリズム内で使われたゲート）。",
  },
  {
    id: "llm_reviewed",
    tier: 4,
    label: "LLM-assisted review",
    labelJa: "LLM支援レビュー",
    description: "An LLM checked the record for internal consistency. Useful screening, not evidence of correctness.",
    descriptionJa: "LLMで記述内容の内部整合性を確認しました。初期確認には有用ですが、正しさを保証するものではありません。",
  },
  {
    id: "community_submission",
    tier: 4,
    label: "Community submission",
    labelJa: "コミュニティ投稿",
    description: "Submitted by the community and not yet through the review pipeline.",
    descriptionJa: "コミュニティから投稿され、まだレビュープロセスを通過していません。",
  },
] as const;

const METHOD_BY_ID = new Map(VERIFICATION_METHODS.map((method) => [method.id, method]));
const TIER_BY_LEVEL = new Map(VERIFICATION_TIERS.map((tier) => [tier.tier, tier]));

export function getVerificationMethod(id: VerificationMethodId): VerificationMethodInfo {
  const method = METHOD_BY_ID.get(id);
  if (!method) throw new Error(`Unknown verification method: ${id}`);
  return method;
}

export function getVerificationTierInfo(tier: VerificationTier): VerificationTierInfo {
  const info = TIER_BY_LEVEL.get(tier);
  if (!info) throw new Error(`Unknown verification tier: ${tier}`);
  return info;
}

/** The strongest (lowest-numbered) tier among an entry's methods drives its badge. */
export function strongestTier(methodIds: readonly VerificationMethodId[]): VerificationTier {
  let best: VerificationTier = 4;
  for (const id of methodIds) {
    const method = METHOD_BY_ID.get(id);
    if (method && method.tier < best) best = method.tier;
  }
  return best;
}
