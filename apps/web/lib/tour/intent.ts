import type { TourShowId } from "./types.ts";

/**
 * "How do I convert this to Cirq?" → the Show-me that answers it on the page.
 *
 * Deliberately a keyword table and not a model call: this only decides whether a
 * thirty-second walkthrough exists for the question. It never answers anything
 * itself. A real answer comes from Nala, through the run pipeline, and only when
 * the reader asks for one (see `lib/tour/ask.ts`).
 */
const KEYWORDS: Record<TourShowId, { en: readonly string[]; ja: readonly string[] }> = {
  "show-cirq": { en: ["cirq", "convert", "translate", "pennylane", "pytket", "framework of the code", "other framework"], ja: ["cirq", "変換", "書き換え", "pennylane"] },
  "show-visual": { en: ["visual", "diagram", "draw", "gate", "builder", "playhead", "probabilit", "beside", "side by side", "split"], ja: ["ビジュアル", "回路図", "ゲート", "確率", "横に", "並べ"] },
  "show-simulate": { en: ["simulat", "cpu", "sandbox", "shots", "run the circuit"], ja: ["シミュレーション", "シミュレート", "cpu", "サンドボックス", "ショット"] },
  "show-export": { en: ["export", "qasm", "openqasm", "download", "version", "evidence"], ja: ["エクスポート", "qasm", "ダウンロード", "バージョン", "証拠"] },
  "show-mode": { en: ["mode", "execute", "ideate", "explain mode", "auto"], ja: ["モード", "実行", "アイデア", "説明モード"] },
  "show-framework": { en: ["qiskit", "which framework", "framework picker", "library"], ja: ["qiskit", "フレームワーク", "ライブラリ"] },
  "show-attach": { en: ["attach", "upload", "file", "notebook file", "my code"], ja: ["添付", "アップロード", "ファイル"] },
  "show-usage": { en: ["usage", "limit", "quota", "tokens", "plan", "credits", "how much"], ja: ["使用量", "上限", "制限", "トークン", "プラン", "クレジット"] },
  "show-theme": { en: ["theme", "dark", "light", "colour", "color", "language", "japanese", "settings"], ja: ["テーマ", "ダーク", "ライト", "色", "言語", "英語", "設定"] },
  "show-lesson": { en: ["lesson", "notebook", "teach", "quiz", "lab", "course", "student"], ja: ["レッスン", "ノートブック", "教え", "クイズ", "ラボ", "コース", "学生"] },
  "show-qapp": { en: ["qapp", "app", "interactive", "demo", "slider"], ja: ["qapp", "アプリ", "インタラクティブ", "デモ"] },
  "show-atlas": { en: ["atlas", "search", "paper", "method", "algorithm list", "find an algorithm", "repository"], ja: ["アトラス", "検索", "論文", "手法", "アルゴリズム"] },
};

/**
 * The best Show-me for a question, or null. Scored by keyword hits so "export
 * the circuit as QASM" picks export over visual; ties go to the earlier entry.
 * Both languages are checked whatever the interface language is, because people
 * mix them ("Cirqに変換したい").
 */
export function matchShow(question: string): TourShowId | null {
  const text = question.toLocaleLowerCase();
  if (!text.trim()) return null;
  let best: TourShowId | null = null;
  let bestScore = 0;
  for (const [id, words] of Object.entries(KEYWORDS) as Array<[TourShowId, (typeof KEYWORDS)[TourShowId]]>) {
    const score = [...words.en, ...words.ja].reduce((sum, word) => (text.includes(word.toLocaleLowerCase()) ? sum + 1 : sum), 0);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/** Exposed for the targets test: every Show-me has keywords in both languages. */
export function showKeywords(id: TourShowId): { en: readonly string[]; ja: readonly string[] } {
  return KEYWORDS[id];
}
