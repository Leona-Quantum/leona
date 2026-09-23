"use client";

/**
 * Under a prompt in a Run thread: the Atlas planner's cited workflow for the
 * problem the prompt names, when it names one the planner knows.
 *
 * It is built from the same `contextForPrompt` output the composer sends to
 * Nala (`lib/workflow-planner/run-context.ts`), so a reader can hold Nala's
 * "Proposed approach" against the table it was told to quote from: each cost
 * with its kind and its paper. The card says what the Atlas holds for the
 * problem; it does not claim this particular run was sent it, because a run
 * from Studio, a follow-up turn or an older run was not.
 *
 * Collapsed by default: it sits in a conversation, and the full plan is one
 * link away.
 */
import { useMemo } from "react";
import type { PublicLocale } from "../lib/public-locale";
import { formatPlain } from "../lib/workflow-planner/costs.ts";
import { indexPlannerGraph, type IndexedGraph, type PlannerGraph } from "../lib/workflow-planner/graph.ts";
import { contextForPrompt } from "../lib/workflow-planner/run-context.ts";
import { COST_KIND_LABEL } from "../lib/workflow-planner/plan-copy.ts";

const COPY = {
  en: {
    summary: (problem: string) => `The Atlas workflow for this problem: ${problem}`,
    pipeline: "Pipeline",
    costs: "Cost at the size in the prompt",
    notStated: "not stated",
    openPlan: "Open the full plan",
  },
  ja: {
    summary: (problem: string) => `この問題のアトラスのワークフロー：${problem}`,
    pipeline: "パイプライン",
    costs: "プロンプトの規模でのコスト",
    notStated: "記載なし",
    openPlan: "計画全体を開く",
  },
} as const;

/** How many cost lines the card shows before "Open the full plan" takes over. */
const COST_LINES = 4;

export function AtlasWorkflowNote({
  prompt,
  graph,
  exampleTitles = {},
  locale,
}: {
  prompt: string;
  graph: PlannerGraph | IndexedGraph;
  exampleTitles?: Readonly<Record<string, string>>;
  locale: PublicLocale;
}) {
  const index = useMemo(() => ("byId" in graph ? graph : indexPlannerGraph(graph)), [graph]);
  const context = useMemo(() => contextForPrompt(index, prompt, locale, exampleTitles), [index, prompt, locale, exampleTitles]);
  if (!context) return null;
  const copy = COPY[locale];
  const methods = context.stages.filter((stage) => stage.method).map((stage) => stage.method as string);
  const costs = context.costs.filter((line) => line.kind !== "scaling").slice(0, COST_LINES);
  return (
    <details className="mj-run-atlas-note" data-problem={context.problem}>
      <summary>{copy.summary(context.problem_label)}</summary>
      {methods.length > 0 ? (
        <p>
          <span className="mj-run-atlas-note-label">{copy.pipeline}</span> {methods.join(" → ")}
        </p>
      ) : null}
      {costs.length > 0 ? (
        <>
          <span className="mj-run-atlas-note-label">{copy.costs}</span>
          <ul>
            {costs.map((line) => (
              <li key={line.id}>
                {line.label}: <strong>{line.value === null ? copy.notStated : `${formatPlain(line.value)} ${line.unit}`}</strong>
                <span className="mj-run-atlas-note-meta">
                  {" "}
                  ({COST_KIND_LABEL[line.kind][locale]}
                  {line.source ? `; ${line.source}` : ""})
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <a href={context.planner_path} target="_blank" rel="noreferrer">
        {copy.openPlan}
      </a>
    </details>
  );
}
