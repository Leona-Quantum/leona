// A Run prompt the planner recognises, turned into the `workflow_context` Nala
// plans with. The same reading the composer's cue shows (`NalaPlanCue`), so
// what the reader was told Nala would use is what Nala is given.
import { workflowContext, type WorkflowContext } from "./digest.ts";
import type { IndexedGraph, PlannerLocale } from "./graph.ts";
import { planWorkflow } from "./index.ts";
import { PLAN_TEXT_MAX, recogniseProblem } from "./recognise.ts";

/** Below this a draft is too short to be a problem statement, and the cue would flicker while typing. */
export const MIN_PROMPT_LENGTH = 12;

/** The text the planner reads: the prompt, trimmed to the planner's own cap. */
export function planText(prompt: string): string {
  return prompt.trim().slice(0, PLAN_TEXT_MAX);
}

export function contextForPrompt(
  graph: IndexedGraph,
  prompt: string,
  locale: PlannerLocale,
  exampleTitles: Readonly<Record<string, string>> = {},
): WorkflowContext | null {
  const text = planText(prompt);
  if (text.length < MIN_PROMPT_LENGTH || !recogniseProblem(text)) return null;
  return workflowContext(planWorkflow(graph, text), text, locale, exampleTitles);
}
