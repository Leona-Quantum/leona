"use client";

/**
 * The plan a reader built on `/repository/plan`, carried into Studio and
 * shown beside the canvas they are about to draw on.
 *
 * Reads `#plan=` on mount and on `hashchange` (the same pattern
 * `atlas-workflow-planner.tsx` uses for its own `#q=`), decodes it with
 * `decodeStudioPlanHash`, and RE-RUNS `planWorkflow` locally over the `graph`
 * Studio already has. Nothing here trusts a number, a label or a source out
 * of the link — the link carries only the reader's sentence, the problem they
 * picked, the numbers they typed and the blocks they swapped; every cost line
 * on screen is freshly computed from those inputs, so a crafted or stale link
 * cannot put a false cited number in front of anyone.
 *
 * Three states, and only one of them renders anything past a bare "loading"
 * moment: no `plan=` in the hash at all (this feature is simply not in play —
 * render nothing), a `plan=` that failed to decode (say so, point back at the
 * planner), or a plan that decoded (show it).
 */
import { useEffect, useMemo, useState } from "react";
import { planWorkflow, type Stage } from "../../../lib/workflow-planner/index.ts";
import { indexPlannerGraph, type PlannerGraph } from "../../../lib/workflow-planner/graph.ts";
import { decodeStudioPlanHash, hashHasStudioPlan, type StudioPlanLink } from "../../../lib/workflow-planner/studio-link.ts";
import { STAGE_CHOICE_LABEL, COST_KIND_LABEL, REPEAT_LABEL, formatCostValue } from "../../../lib/workflow-planner/plan-copy.ts";
import { STAGE_BLOCKS } from "../../../lib/workflow-planner/stage-blocks.ts";
import { PLANNER_SOURCES } from "../../../lib/workflow-planner/sources.ts";
import { blockTemplate } from "../../../lib/circuit-blocks.ts";
import type { CostLine, ParamKey } from "../../../lib/workflow-planner/types.ts";
import type { WorkedExample } from "../../../lib/worked-examples.ts";
import type { PublicLocale } from "../../../lib/public-locale";

const COPY = {
  en: {
    heading: "From your plan",
    sentence: (text: string) => `“${text}”`,
    backToPlan: "Back to the full plan",
    pipelineHeading: "The pipeline",
    sizeHeading: "At your size",
    sizeIntro: "What the algorithm needs, at the size you gave the planner — recomputed here, not carried from the link.",
    needs: (names: string) => `Needs ${names}.`,
    buildHeading: "Build a stage here",
    insert: "Insert",
    canvasNote: (instance: string) =>
      `The canvas below builds a small instance — ${instance} — so the numbers above are for the size in your plan, not for what is on screen.`,
    invalidHeading: "This plan link could not be read",
    invalidBody: "It may be from an older version, or damaged in copying. Open the planner to build a new one.",
    openPlanner: "Open the planner",
    logicalQubits: "Logical qubits",
    toffolis: "Toffoli gates",
    tGates: "T gates",
    queries: "Queries or repetitions",
    source: "Source",
  },
  ja: {
    heading: "計画から",
    sentence: (text: string) => `「${text}」`,
    backToPlan: "計画全体に戻る",
    pipelineHeading: "パイプライン",
    sizeHeading: "指定した規模では",
    sizeIntro: "プランナーに与えた規模でアルゴリズムが必要とするものです。リンクの値ではなく、ここで計算し直しています。",
    needs: (names: string) => `${names} が必要です。`,
    buildHeading: "ここでステージを組み立てる",
    insert: "挿入",
    canvasNote: (instance: string) =>
      `下のキャンバスが組み立てるのは小さな例（${instance}）です。上の数値は画面上のものではなく、計画で指定した規模のものです。`,
    invalidHeading: "この計画リンクを読み取れませんでした",
    invalidBody: "古いバージョンのものか、コピー中に壊れた可能性があります。プランナーを開いて新しく作ってください。",
    openPlanner: "プランナーを開く",
    logicalQubits: "論理量子ビット",
    toffolis: "Toffoli ゲート",
    tGates: "T ゲート",
    queries: "問い合わせ・繰り返し",
    source: "出典",
  },
} as const;

type PlanLinkState = { kind: "empty" } | { kind: "invalid" } | { kind: "ready"; link: StudioPlanLink };

function readPlanState(): PlanLinkState {
  const hash = window.location.hash;
  if (!hashHasStudioPlan(hash)) return { kind: "empty" };
  const link = decodeStudioPlanHash(hash);
  return link ? { kind: "ready", link } : { kind: "invalid" };
}

/** A stage's repeat mark and the label for why its method was chosen — the same two facts `atlas-workflow-planner.tsx`'s `StageCard` shows, read from the shared tables so the wording matches exactly. */
function StageReasoning({ stage, locale }: { stage: Stage; locale: PublicLocale }) {
  if (!stage.method) return null;
  return (
    <>
      {stage.choice !== "none" ? (
        <p className="mj-plan-choice">
          {STAGE_CHOICE_LABEL[stage.choice][locale]}
          {stage.reason ? `: ${stage.reason[locale]}` : ""}
        </p>
      ) : null}
      {stage.repeat ? (
        <p className="mj-plan-repeat" title={stage.repeat.count}>
          {REPEAT_LABEL[locale]} {stage.repeat.mark}
        </p>
      ) : null}
    </>
  );
}

function StageBlocks({ methodId, locale, onInsertBlock }: { methodId: string; locale: PublicLocale; onInsertBlock: (blockKey: string) => void }) {
  const copy = COPY[locale];
  const keys = STAGE_BLOCKS[methodId] ?? [];
  const templates = keys.map((key) => blockTemplate(key)).filter((t): t is NonNullable<typeof t> => Boolean(t));
  if (templates.length === 0) return null;
  return (
    <div className="mj-plan-stage-blocks">
      <p className="mj-plan-muted">{copy.buildHeading}</p>
      <ul className="mj-plan-stage-block-list">
        {templates.map((template) => (
          <li key={template.key}>
            <span>{template.name}</span>
            <button type="button" className="mj-secondary-button" onClick={() => onInsertBlock(template.key)}>
              {copy.insert}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanStageNode({ stage, locale, onInsertBlock }: { stage: Stage; locale: PublicLocale; onInsertBlock: (blockKey: string) => void }) {
  return (
    <li className="mj-plan-stage">
      <details className="mj-plan-stage-card" open={stage.depth === 0}>
        <summary>
          <span className="mj-plan-capability">{stage.capability.label}</span>
          {stage.method ? <strong>{stage.method.label}</strong> : null}
        </summary>
        {stage.method ? (
          <>
            <StageReasoning stage={stage} locale={locale} />
            <StageBlocks methodId={stage.method.id} locale={locale} onInsertBlock={onInsertBlock} />
          </>
        ) : null}
        {stage.children.length > 0 ? (
          <ol className="mj-plan-stages mj-plan-substages">
            {stage.children.map((child) => (
              <PlanStageNode key={child.path} stage={child} locale={locale} onInsertBlock={onInsertBlock} />
            ))}
          </ol>
        ) : null}
      </details>
    </li>
  );
}

function sourceText(line: CostLine, locale: PublicLocale): string | null {
  if (!line.source) return null;
  const entry = PLANNER_SOURCES[line.source];
  return `${entry.paperId}, ${locale === "ja" ? entry.locatorJa : entry.locator}`;
}

function SizeTile({
  label,
  line,
  locale,
  paramName,
}: {
  label: string;
  line: CostLine;
  locale: PublicLocale;
  paramName: (key: ParamKey) => string;
}) {
  const copy = COPY[locale];
  const source = sourceText(line, locale);
  return (
    <div className="mj-plan-tiles-tile">
      <dt>{label}</dt>
      {line.missing?.length ? (
        <dd className="mj-plan-muted">{copy.needs(line.missing.map(paramName).join(", "))}</dd>
      ) : (
        <>
          <dd>
            {formatCostValue(line)} {line.unit.en === "probability" ? "" : line.unit[locale]}
          </dd>
          <dd className="mj-plan-muted">{COST_KIND_LABEL[line.kind][locale]}</dd>
          {source ? (
            <dd className="mj-plan-muted">
              {copy.source}: {source}
            </dd>
          ) : null}
        </>
      )}
    </div>
  );
}

export function StudioPlanPanel({
  graph,
  locale,
  activeExample,
  onInsertBlock,
}: {
  graph: PlannerGraph;
  locale: PublicLocale;
  /** Studio's own currently-loaded example, already tracked by `StudioWorkspace` — reused here only for its `instance` sentence, so the panel does not need to look the example up a second time. */
  activeExample: WorkedExample | null;
  onInsertBlock: (blockKey: string) => void;
}) {
  const copy = COPY[locale];
  const [state, setState] = useState<PlanLinkState>({ kind: "empty" });

  useEffect(() => {
    const apply = () => setState(readPlanState());
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const index = useMemo(() => indexPlannerGraph(graph), [graph]);
  const plan = useMemo(() => {
    if (state.kind !== "ready") return null;
    return planWorkflow(index, state.link.text, {
      problem: state.link.problem,
      params: state.link.params,
      choices: state.link.choices,
    });
  }, [index, state]);

  if (state.kind === "empty") return null;

  if (state.kind === "invalid" || !plan || !plan.problem) {
    return (
      <section className="mj-plan-callout" role="alert" aria-labelledby="studio-plan-invalid-heading">
        <p id="studio-plan-invalid-heading">
          <strong>{copy.invalidHeading}</strong>
        </p>
        <p>{copy.invalidBody}</p>
        <a className="mj-secondary-button" href="/repository/plan">
          {copy.openPlanner}
        </a>
      </section>
    );
  }

  const paramName = (key: ParamKey): string => {
    const spec = plan.problem?.params.find((p) => p.key === key);
    return spec ? spec.label[locale] : key;
  };

  const logical = plan.costs?.logical;
  const sizeTiles: { label: string; line: CostLine }[] = logical
    ? ([
        [copy.logicalQubits, logical.logicalQubits],
        [copy.toffolis, logical.toffolis],
        [copy.tGates, logical.tGates],
        [copy.queries, logical.queries],
      ] as [string, CostLine | null][]).flatMap(([label, line]) => (line ? [{ label, line }] : []))
    : [];

  return (
    <section className="mj-studio-plan-panel" aria-labelledby="studio-plan-heading">
      <header>
        <h3 id="studio-plan-heading">{copy.heading}</h3>
        <p className="mj-plan-muted">{copy.sentence(state.link.text)}</p>
        <a className="mj-plan-atlas-link" href={`/repository/plan#q=${encodeURIComponent(state.link.text)}`}>
          {copy.backToPlan}
        </a>
      </header>

      {plan.root ? (
        <section className="mj-plan-section" aria-label={copy.pipelineHeading}>
          <h4 className="mj-plan-subheading">{copy.pipelineHeading}</h4>
          <ol className="mj-plan-stages">
            <PlanStageNode stage={plan.root} locale={locale} onInsertBlock={onInsertBlock} />
          </ol>
        </section>
      ) : null}

      {sizeTiles.length > 0 ? (
        <section className="mj-plan-section" aria-label={copy.sizeHeading}>
          <h4 className="mj-plan-subheading">{copy.sizeHeading}</h4>
          <p className="mj-plan-muted">{copy.sizeIntro}</p>
          <dl className="mj-plan-tiles">
            {sizeTiles.map(({ label, line }) => (
              <SizeTile key={label} label={label} line={line} locale={locale} paramName={paramName} />
            ))}
          </dl>
        </section>
      ) : null}

      {activeExample ? <p className="mj-plan-muted">{copy.canvasNote(locale === "ja" ? activeExample.instance.ja : activeExample.instance.en)}</p> : null}
    </section>
  );
}
