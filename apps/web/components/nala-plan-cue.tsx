"use client";

/**
 * Beneath the Run composer: when the prompt being typed reads as a problem the
 * Atlas workflow planner knows, offer to see it there first, as a pipeline of
 * blocks with its cost from the papers, before Nala builds a circuit.
 *
 * Nothing is sent anywhere to decide this. `recogniseProblem` is the planner's
 * own deterministic keyword reading, run in the browser on the draft. The
 * prompt travels to the planner in the URL fragment, which the browser never
 * sends to a server, so a draft does not land in any request log.
 */
import { useMemo } from "react";
import type { PublicLocale } from "../lib/public-locale";
import { PLAN_TEXT_MAX, recogniseProblem } from "../lib/workflow-planner/recognise.ts";
import { problemById } from "../lib/workflow-planner/problems.ts";

/** Below this the draft is too short to be a problem statement, and a cue would flicker in and out while typing. */
const MIN_PROMPT_LENGTH = 12;

/** The text the planner will receive: what the cue recognises, and what the link carries. */
function planText(prompt: string): string {
  return prompt.trim().slice(0, PLAN_TEXT_MAX);
}

export function planHref(prompt: string): string {
  return `/repository/plan#q=${encodeURIComponent(planText(prompt))}`;
}

export function NalaPlanCue({ prompt, locale }: { prompt: string; locale: PublicLocale }) {
  const problem = useMemo(() => {
    const sent = planText(prompt);
    if (sent.length < MIN_PROMPT_LENGTH) return null;
    const found = recogniseProblem(sent);
    return found ? problemById(found.problem) ?? null : null;
  }, [prompt]);
  if (!problem) return null;
  const label = locale === "ja" ? problem.label.ja : problem.label.en;
  return (
    <p className="mj-run-plan-cue" data-problem={problem.id}>
      {locale === "ja" ? (
        <>
          <strong>{label}</strong>
          の問題として読めます。Nala が回路を組み立てる前に、アトラスのブロックによるワークフローと、論文に基づくコストを確認できます。
        </>
      ) : (
        <>
          Looks like: <strong>{label}</strong>. Before Nala builds a circuit, you can see the whole workflow as Atlas blocks, with its cost from
          the papers.
        </>
      )}{" "}
      <a href={planHref(prompt)} target="_blank" rel="noreferrer">
        {locale === "ja" ? "アトラスで計画する" : "Plan it in the Atlas"}
      </a>
    </p>
  );
}
