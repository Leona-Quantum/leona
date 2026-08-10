/**
 * What a loop's closure costs, in words, in both locales — **written once.**
 *
 * `LoopClosure` is two values and each of them is a sentence about money: a
 * coherent loop pays depth and a success probability that multiplies down the
 * chain; a measured one pays a count of runs. Those sentences were authored on
 * the node page (`repository-layers.tsx`) when it was the only surface that drew
 * a multiplicity at all. The card now draws the same records, and a second copy
 * of a claim is a claim that drifts the first time either copy is edited —
 * which is worse here than usual, because the two would then say different
 * things about the *same* record on two pages a reader moves between by clicking
 * one link.
 *
 * The badge is a function rather than a template because the count is a phrase
 * the source wrote (*"O(1/ε²) shots, and one preparation per shot"*), not a
 * number, and the two locales put it in different places in the sentence.
 *
 * **Not in `layers.ts`.** That file holds the records and the relations over
 * them; this is the prose a surface reads them out with, and the boundary is
 * worth keeping — a locale string in the graph module is a locale string every
 * consumer of the graph then has to ignore.
 */
import type { LoopClosure } from "./layers.ts";

export interface LoopClosureCopy {
  /** The multiplicity itself: "runs O(κ) times — once per amplification round". */
  readonly badge: (count: string) => string;
  /** What one turn costs, per closure. The other fact, and the deciding one. */
  readonly closure: Record<LoopClosure, string>;
}

export const LOOP_CLOSURE_COPY: Record<"en" | "ja", LoopClosureCopy> = {
  en: {
    badge: (count) => `runs ${count}`,
    closure: {
      // NOT "so nothing is prepared again" — that was wrong, and wrong against
      // two of this graph's own records: HHL prepares |b⟩ afresh in every one of
      // its O(κ) amplification rounds, and amplitude estimation runs the
      // preparation forwards and backwards on every iteration. What a coherent
      // loop never pays is a readout.
      coherent:
        "The loop stays coherent: nothing is measured between turns. The preparation may still be reapplied every turn — what the loop never pays is a readout and a restart from classical data. The price is depth, and a success probability that multiplies down the chain.",
      measured:
        "The loop closes through a measurement: every turn ends in a readout and starts from a fresh preparation. The price is a count of runs, not a depth.",
    },
  },
  ja: {
    badge: (count) => `実行回数：${count}`,
    closure: {
      coherent:
        "反復はコヒーレントに閉じます。回と回の間で測定は行われません。準備ユニタリ自体は毎回適用され直すことがありますが、読み出しと、古典的なデータからの再出発は生じません。代価は深さと、連鎖のあいだ掛け合わされていく成功確率です。",
      measured:
        "反復は測定を挟んで閉じます。1 回ごとに読み出しで終わり、次は新たな準備から始まります。代価は深さではなく実行回数です。",
    },
  },
};
