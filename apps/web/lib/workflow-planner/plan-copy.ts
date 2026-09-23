// Labels shared by every surface that draws a `Stage` tree or a `CostLine`:
// today `components/atlas-workflow-planner.tsx` (the full planner) and
// `app/(app)/studio/studio-plan-panel.tsx` (the plan carried into Studio).
//
// Kept as data, not JSX: a `StageChoice` or a `CostKind` means the same thing
// on both surfaces, so the sentence explaining it is written once here. A
// second copy would drift the moment one page's wording changed and the
// other's did not — the Studio panel is a strict subset of what the plan
// says, and it must say it the same way.
import type { StageChoice } from "./assemble.ts";
import { formatPlain } from "./costs.ts";
import type { Bilingual, CostKind, CostLine } from "./types.ts";

export const STAGE_CHOICE_LABEL: Record<StageChoice, Bilingual> = {
  reader: { en: "Your choice", ja: "あなたの選択" },
  published: { en: "As the method's own source does it", ja: "手法の出典どおり" },
  preferred: { en: "Planner's pick", ja: "プランナーの選択" },
  first: { en: "First listed in the Atlas; worth comparing", ja: "アトラスで最初に載っている手法です。比較してみてください" },
  none: { en: "", ja: "" },
};

export const COST_KIND_LABEL: Record<CostKind, Bilingual> = {
  exact: { en: "Exact", ja: "厳密" },
  "upper-bound": { en: "Upper bound", ja: "上界" },
  "leading-order": { en: "Leading order", ja: "主要項" },
  "numerical-estimate": { en: "Paper's numerical estimate", ja: "論文の数値的見積もり" },
  published: { en: "Published figure", ja: "公表値" },
  derived: { en: "Derived", ja: "導出" },
  supplied: { en: "From your input", ja: "入力値から" },
  scaling: { en: "Scaling only", ja: "スケーリングのみ" },
};

export const REPEAT_LABEL: Bilingual = { en: "Runs", ja: "実行回数" };

/**
 * A cost line's value, formatted the same way everywhere this planner draws
 * one: a probability as a percentage — never rounding a near-certain success
 * up to a false "100%" — everything else through `formatPlain`.
 */
export function formatCostValue(line: CostLine): string {
  if (line.value === null) return "—";
  if (line.unit.en === "probability") {
    const percent = line.value * 100;
    if (percent < 100 && percent >= 99.995) return "> 99.99%";
    return `${percent.toFixed(2)}%`;
  }
  return `${line.qualifier ? `${line.qualifier} ` : ""}${formatPlain(line.value)}`;
}
