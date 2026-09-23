"use client";

/**
 * The workflow planner page: describe a problem, get a pipeline of Atlas
 * blocks with its cost. All of the reasoning is in `lib/workflow-planner/`;
 * this file only lays it out and holds the reader's edits.
 *
 * Three kinds of edit, all client state, so the page itself stays a single
 * prerendered document:
 * - the sentence, and the problem the reader picks if the sentence reads wrong;
 * - a parameter the reader types, which outranks the sentence and any assumption;
 * - a block swapped for another that fills the same slot, keyed by its path.
 *
 * The sentence can arrive in the URL fragment (`#q=…`), so another surface can
 * link a reader straight to a plan of their own words. A fragment rather than
 * a query string: it never reaches a server log or the CDN key, and the page
 * stays one cached document for every visitor.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicLocale } from "../lib/public-locale";
import { planWorkflow, PROBLEMS, formatPlain, type PlannerGraph, type Stage, type CostReport } from "../lib/workflow-planner/index.ts";
import { indexPlannerGraph } from "../lib/workflow-planner/graph.ts";
import { parseNumber } from "../lib/workflow-planner/recognise.ts";
import { PLANNER_SOURCES, type SourceKey } from "../lib/workflow-planner/sources.ts";
import type { Bilingual, CostKind, CostLine, ParamKey, ParamValue, ProblemId, Suggestion } from "../lib/workflow-planner/types.ts";
import type { ProblemClass } from "../lib/workflow-planner/problems.ts";
import { workedExampleSignInHref, workedExampleStudioHref } from "../lib/atlas-worked-example-steps";
import { writeLandingPromptHandoff } from "../lib/landing-prompt-handoff";
import { MathText } from "./math-text";
import { SignInLink } from "./sign-in-link";

export interface PlannerPaper {
  id: string;
  title: string;
  authors: string;
  year: string;
  url: string;
}

export interface PlannerExample {
  id: string;
  title: string;
  instance: string;
  blocks: string[];
}

const COPY = {
  en: {
    heading: "Plan a quantum workflow",
    intro:
      "Describe the problem in a sentence. The planner builds it from Atlas blocks, costs each part from the papers, and suggests where it could be cheaper. Every number says where it came from and what kind of number it is.",
    inputLabel: "Your problem",
    inputPlaceholder: "e.g. Factor a 2048-bit RSA modulus",
    examples: "Try one",
    readingAs: "Reading this as",
    pickProblem: "Pick the kind of problem",
    becauseOf: "Because of",
    pickedByYou: "You chose this.",
    noRecognition: "The planner found no problem it knows in that sentence. Pick one to continue, or add a few words about the task.",
    paramsHeading: "The numbers it depends on",
    fromText: (words: string) => `From your text: “${words}”`,
    assumed: "Assumed:",
    notSet: "Not set. Lines that need it stay blank.",
    readerSet: "You set this.",
    workflowHeading: "The workflow",
    workflowIntro:
      "Each block is an Atlas method filling one step. Swap any block for another that fills the same step; the costs follow the blocks you pick.",
    compileHeading: "Running it on hardware",
    compileNisq: "The planner starts on today's hardware, because this method is built to run without error correction.",
    compileFt: "The planner starts on error-corrected hardware, because the costs above are counted in Toffoli and T gates.",
    choice: {
      reader: "Your choice",
      published: "As the method's own source does it",
      preferred: "Planner's pick",
      first: "First listed in the Atlas; worth comparing",
      none: "",
    },
    swapLabel: "Block",
    costAsStated: "Cost, as the source states it",
    noCostStated: "No cost is recorded for this block.",
    openInAtlas: "Open in the Atlas",
    repeats: "Runs",
    stopCycle: "This step already appears above, so it is not expanded again.",
    stopDepth: "This block has more steps inside. Open it in the Atlas to follow them.",
    costHeading: "What it costs",
    costColumns: ["Quantity", "Value", "Formula", "Kind", "Source"],
    needs: (names: string) => `needs ${names}`,
    classicalHeading: "Compared with a classical approach",
    publishedHeading: "Published whole-machine estimates",
    logicalHeading: "Logical-level cost",
    logicalIntro:
      "This is what the algorithm needs before a machine is chosen. Physical qubits and runtime also depend on the hardware; where a paper states them for this size, they are listed above.",
    logicalQubits: "Logical qubits",
    toffolis: "Toffoli gates",
    tGates: "T gates",
    queries: "Queries or repetitions",
    suggestionsHeading: "Ways to make it cheaper",
    trySwap: "Swap in this block",
    smallHeading: "Try a small instance first",
    smallIntro: "A worked example in Studio builds the same algorithm at a size the browser can simulate.",
    blocksLine: "Blocks:",
    openInStudio: "Open in Studio",
    openingSignIn: "Opening sign in…",
    askNala: "Ask Nala to build it",
    noSmall: "There is no small worked example for this problem yet. Nala can build one from the plan.",
    kinds: {
      exact: "Exact",
      "upper-bound": "Upper bound",
      "leading-order": "Leading order",
      "numerical-estimate": "Paper's numerical estimate",
      published: "Published figure",
      derived: "Derived",
      supplied: "From your input",
      scaling: "Scaling only",
    } satisfies Record<CostKind, string>,
    kindsHelp:
      "Exact: the count itself. Upper bound: at most this. Leading order: the paper's formula without its smaller terms. Derived: arithmetic on a stated formula, explained in the note.",
    nalaPrompt: (problem: string, method: string, stages: string) =>
      `Build a small, runnable instance of this workflow and verify it. Problem: ${problem}. Method: ${method}. Blocks: ${stages}.`,
  },
  ja: {
    heading: "量子ワークフローを計画する",
    intro:
      "問題を一文で書いてください。プランナーがアトラスのブロックで組み立て、各部分のコストを論文から見積もり、安くできる箇所を提案します。どの数値にも、出典と数値の種類を示します。",
    inputLabel: "解きたい問題",
    inputPlaceholder: "例：2048 ビットの RSA 法を素因数分解したい",
    examples: "例を試す",
    readingAs: "次の問題として読み取りました",
    pickProblem: "問題の種類を選んでください",
    becauseOf: "根拠となった語句",
    pickedByYou: "あなたが選びました。",
    noRecognition: "この文からは、プランナーが扱える問題を見つけられませんでした。種類を選ぶか、課題について少し書き足してください。",
    paramsHeading: "コストを左右する数値",
    fromText: (words: string) => `入力文から：「${words}」`,
    assumed: "仮定：",
    notSet: "未設定です。これを必要とする行は空欄になります。",
    readerSet: "あなたが設定しました。",
    workflowHeading: "ワークフロー",
    workflowIntro:
      "各ブロックは、一つのステップを担うアトラスの手法です。同じステップを担う別のブロックに入れ替えられ、コストは選んだブロックに合わせて変わります。",
    compileHeading: "ハードウェアで動かす",
    compileNisq: "この手法は誤り訂正なしで動くように作られているので、現行のハードウェアから始めます。",
    compileFt: "上のコストは Toffoli と T ゲートで数えているので、誤り訂正付きのハードウェアから始めます。",
    choice: {
      reader: "あなたの選択",
      published: "手法の出典どおり",
      preferred: "プランナーの選択",
      first: "アトラスで最初に載っている手法です。比較してみてください",
      none: "",
    },
    swapLabel: "ブロック",
    costAsStated: "コスト（出典の記述のまま）",
    noCostStated: "このブロックのコストは記録されていません。",
    openInAtlas: "アトラスで開く",
    repeats: "実行回数",
    stopCycle: "このステップは上ですでに現れているため、再度は展開しません。",
    stopDepth: "この中にもステップがあります。アトラスでこのブロックを開くとたどれます。",
    costHeading: "コスト",
    costColumns: ["項目", "値", "式", "種類", "出典"],
    needs: (names: string) => `${names} が必要です`,
    classicalHeading: "古典的な方法との比較",
    publishedHeading: "公表されている機械全体の見積もり",
    logicalHeading: "論理レベルのコスト",
    logicalIntro:
      "機械を選ぶ前に、アルゴリズムが必要とするものです。物理量子ビットと実行時間はハードウェアにも依存します。論文がこのサイズで示している場合は、上に載せています。",
    logicalQubits: "論理量子ビット",
    toffolis: "Toffoli ゲート",
    tGates: "T ゲート",
    queries: "問い合わせ・繰り返し",
    suggestionsHeading: "安くする方法",
    trySwap: "このブロックに入れ替える",
    smallHeading: "まず小さな例で試す",
    smallIntro: "Studio の例題が、同じアルゴリズムをブラウザでシミュレートできる大きさで組み立てます。",
    blocksLine: "ブロック：",
    openInStudio: "Studio で開く",
    openingSignIn: "サインインを開いています…",
    askNala: "Nala に組み立ててもらう",
    noSmall: "この問題の小さな例題はまだありません。Nala が計画から組み立てられます。",
    kinds: {
      exact: "厳密",
      "upper-bound": "上界",
      "leading-order": "主要項",
      "numerical-estimate": "論文の数値的見積もり",
      published: "公表値",
      derived: "導出",
      supplied: "入力値から",
      scaling: "スケーリングのみ",
    } satisfies Record<CostKind, string>,
    kindsHelp:
      "厳密：回数そのもの。上界：多くてもこの値。主要項：小さな項を除いた論文の式。導出：示された式からの計算で、説明は注記にあります。",
    nalaPrompt: (problem: string, method: string, stages: string) =>
      `このワークフローの小さく実行可能な例を作り、検証してください。問題：${problem}。手法：${method}。ブロック：${stages}。`,
  },
} as const;

type Copy = (typeof COPY)[keyof typeof COPY];

function t(text: Bilingual, locale: PublicLocale): string {
  return locale === "ja" ? text.ja : text.en;
}

function shortAuthors(authors: string, locale: PublicLocale): string {
  const names = authors.split(",").map((name) => name.trim()).filter(Boolean);
  const surname = (name: string) => name.split(/\s+/).pop() ?? name;
  if (names.length === 0) return "";
  if (names.length === 1) return surname(names[0]);
  if (names.length === 2) return locale === "ja" ? `${surname(names[0])}・${surname(names[1])}` : `${surname(names[0])} and ${surname(names[1])}`;
  return locale === "ja" ? `${surname(names[0])} ら` : `${surname(names[0])} et al.`;
}

function SourceCite({ source, papers, locale }: { source: SourceKey | null; papers: ReadonlyMap<string, PlannerPaper>; locale: PublicLocale }) {
  if (!source) return <span className="mj-plan-muted">—</span>;
  const entry = PLANNER_SOURCES[source];
  const paper = papers.get(entry.paperId);
  if (!paper) return <span>{entry.paperId}</span>;
  return (
    <span className="mj-plan-cite">
      <a href={paper.url} rel="noreferrer" target="_blank" title={`${paper.title}: “${entry.quote}”`}>
        {shortAuthors(paper.authors, locale)} {paper.year}
      </a>
      , {locale === "ja" ? entry.locatorJa : entry.locator}
    </span>
  );
}

function formatValue(line: CostLine): string {
  if (line.value === null) return "—";
  if (line.unit.en === "probability") {
    const percent = line.value * 100;
    // Two decimals round 99.9999…% up to "100.00%", which reads as certainty the formula does not give.
    if (percent < 100 && percent >= 99.995) return "> 99.99%";
    return `${percent.toFixed(2)}%`;
  }
  return `${line.qualifier ? `${line.qualifier} ` : ""}${formatPlain(line.value)}`;
}

function CostRows({
  lines,
  locale,
  copy,
  papers,
  paramName,
}: {
  lines: readonly CostLine[];
  locale: PublicLocale;
  copy: Copy;
  papers: ReadonlyMap<string, PlannerPaper>;
  paramName: (key: ParamKey) => string;
}) {
  return (
    <>
      {lines.map((line) => (
        <tr key={line.id}>
          <th scope="row">
            {t(line.label, locale)}
            {line.note ? <span className="mj-plan-note">{t(line.note, locale)}</span> : null}
          </th>
          <td className="mj-plan-value">
            {line.missing?.length ? (
              <span className="mj-plan-muted">{copy.needs(line.missing.map(paramName).join(", "))}</span>
            ) : (
              <>
                {formatValue(line)} {line.unit.en === "probability" ? "" : t(line.unit, locale)}
              </>
            )}
          </td>
          <td>
            <code>{line.formula}</code>
          </td>
          <td>
            <span className={`mj-plan-kind mj-plan-kind-${line.kind}`}>{copy.kinds[line.kind]}</span>
          </td>
          <td>
            <SourceCite source={line.source} papers={papers} locale={locale} />
          </td>
        </tr>
      ))}
    </>
  );
}

function StageCard({
  stage,
  locale,
  copy,
  onSwap,
}: {
  stage: Stage;
  locale: PublicLocale;
  copy: Copy;
  onSwap: (path: string, methodId: string) => void;
}) {
  const method = stage.method;
  return (
    <li className="mj-plan-stage">
      <div className="mj-plan-stage-card">
        <div className="mj-plan-stage-head">
          <span className="mj-plan-capability">{stage.capability.label}</span>
          {stage.repeat ? (
            <span className="mj-plan-repeat" title={stage.repeat.count}>
              {copy.repeats} {stage.repeat.mark}
            </span>
          ) : null}
        </div>
        {method ? (
          <>
            <h3>{method.label}</h3>
            {stage.choice !== "none" ? (
              <p className={`mj-plan-choice mj-plan-choice-${stage.choice}`}>
                {copy.choice[stage.choice]}
                {stage.reason ? `: ${t(stage.reason, locale)}` : ""}
              </p>
            ) : null}
            <p className="mj-plan-summary">
              <MathText source={method.summary} />
            </p>
            {stage.alternatives.length > 1 ? (
              <label className="mj-plan-swap">
                <span>{copy.swapLabel}</span>
                <select value={method.id} onChange={(event) => onSwap(stage.path, event.target.value)}>
                  {stage.alternatives.map((alternative) => (
                    <option key={alternative.id} value={alternative.id}>
                      {alternative.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <details className="mj-plan-cost">
              <summary>{copy.costAsStated}</summary>
              {method.cost ? (
                <p>
                  <MathText source={method.cost} />
                </p>
              ) : (
                <p className="mj-plan-muted">{copy.noCostStated}</p>
              )}
            </details>
            <a className="mj-plan-atlas-link" href={`/repository/layers/${method.id}`}>
              {copy.openInAtlas}
            </a>
            {stage.stop === "depth" ? <p className="mj-plan-muted">{copy.stopDepth}</p> : null}
          </>
        ) : stage.stop === "cycle" ? (
          <p className="mj-plan-muted">{copy.stopCycle}</p>
        ) : null}
      </div>
      {stage.children.length > 0 ? (
        <ol className="mj-plan-stages mj-plan-substages">
          {stage.children.map((child) => (
            <StageCard key={child.path} stage={child} locale={locale} copy={copy} onSwap={onSwap} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function ParamRow({
  spec,
  value,
  typed,
  locale,
  copy,
  onType,
}: {
  spec: ProblemClass["params"][number];
  value: ParamValue | undefined;
  typed: string | undefined;
  locale: PublicLocale;
  copy: Copy;
  onType: (key: ParamKey, raw: string) => void;
}) {
  const shown = typed ?? (value?.value !== null && value?.value !== undefined ? formatInput(value.value) : "");
  let origin: string = copy.notSet;
  if (value?.origin === "text" && value.evidence) origin = copy.fromText(value.evidence);
  else if (value?.origin === "assumed" && value.assumedReason) origin = `${copy.assumed} ${t(value.assumedReason, locale)}`;
  else if (value?.origin === "reader") origin = copy.readerSet;
  return (
    <label className={`mj-plan-param mj-plan-param-${value?.origin ?? "unset"}`}>
      <span>
        {t(spec.label, locale)}
        {spec.unit ? ` (${t(spec.unit, locale)})` : ""}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        onChange={(event) => onType(spec.key, event.target.value)}
        aria-describedby={`plan-param-${spec.key}-origin`}
      />
      <span id={`plan-param-${spec.key}-origin`} className="mj-plan-origin">
        {origin}
      </span>
      <span className="mj-plan-hint">{t(spec.hint, locale)}</span>
    </label>
  );
}

/** A value back into the input box: plain digits for integers, the planner's own format otherwise. */
function formatInput(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  if (Math.abs(value) >= 1e-3 && Math.abs(value) < 1e7) return String(Number(value.toPrecision(6)));
  return value.toExponential().replace("e+", "e");
}

function readHashQuery(): string | null {
  try {
    const hash = window.location.hash.replace(/^#/, "");
    const q = new URLSearchParams(hash).get("q");
    return q && q.trim() ? q.slice(0, 2000) : null;
  } catch {
    return null;
  }
}

function stageNames(stage: Stage | null): string[] {
  if (!stage) return [];
  const own = stage.method ? [stage.method.shortLabel ?? stage.method.label] : [];
  return [...own, ...stage.children.flatMap(stageNames)];
}

export function AtlasWorkflowPlanner({
  locale,
  graph,
  papers,
  examples,
}: {
  locale: PublicLocale;
  graph: PlannerGraph;
  papers: readonly PlannerPaper[];
  examples: Readonly<Record<string, PlannerExample>>;
}) {
  const copy = COPY[locale];
  const router = useRouter();
  const index = useMemo(() => indexPlannerGraph(graph), [graph]);
  const paperMap = useMemo(() => new Map(papers.map((paper) => [paper.id, paper])), [papers]);

  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ProblemId | null>(null);
  const [typed, setTyped] = useState<Partial<Record<ParamKey, string>>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});

  // Read on load AND on `hashchange`: following a `#q=` link while already on
  // this page changes only the fragment, so the browser keeps the document and
  // a load-only read would leave the old sentence on screen.
  useEffect(() => {
    const apply = () => {
      const fromHash = readHashQuery();
      if (fromHash) {
        setPicked(null);
        setText(fromHash);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  // Same client-side session read as the method finder, for the same reason:
  // a server read would make this prerendered page per-visitor.
  const [session, setSession] = useState<{ signedIn: boolean; signInHref: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { signedIn: boolean; signInHref: string | null } | null) => {
        if (!cancelled && data) setSession(data);
      })
      .catch(() => {
        // Left signed-out, which is what the server rendered.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const isSignedIn = session?.signedIn ?? false;

  const readerParams = useMemo(() => {
    const out: Partial<Record<ParamKey, number | null>> = {};
    for (const [key, raw] of Object.entries(typed) as [ParamKey, string | undefined][]) {
      if (raw === undefined) continue;
      out[key] = raw.trim() === "" ? null : parseNumber(raw);
    }
    return out;
  }, [typed]);

  const plan = useMemo(
    () => planWorkflow(index, text, { problem: picked, params: readerParams, choices }),
    [index, text, picked, readerParams, choices],
  );
  const problemId = plan.problem?.id ?? null;

  // A reader's typed values and swapped blocks belong to one problem; carry
  // them into another and a "κ" typed for a linear solve would silently price
  // a search. Cleared whenever the problem changes.
  useEffect(() => {
    setTyped({});
    setChoices({});
  }, [problemId]);

  function chooseExample(problem: ProblemClass) {
    setPicked(null);
    setText(t(problem.example, locale));
  }

  function swap(path: string, methodId: string) {
    setChoices((current) => ({ ...current, [path]: methodId }));
  }

  function applySuggestion(suggestion: Suggestion) {
    if (!suggestion.swapTo) return;
    const stages: Stage[] = [];
    const walk = (stage: Stage | null) => {
      if (!stage) return;
      stages.push(stage);
      stage.children.forEach(walk);
    };
    walk(plan.root);
    walk(plan.compile);
    const target = stages.find((stage) => stage.capability.id === suggestion.swapTo?.capability);
    if (target) swap(target.path, suggestion.swapTo.method);
    else router.push(`/repository/layers/${suggestion.swapTo.method}`);
  }

  function askNala() {
    if (!plan.problem || !plan.root?.method) return;
    const prompt = copy.nalaPrompt(
      t(plan.problem.label, locale),
      plan.root.method.label,
      stageNames(plan.root).join(" → "),
    );
    writeLandingPromptHandoff(`${text.trim() ? `${text.trim()}\n\n` : ""}${prompt}`);
    router.push("/run");
  }

  const paramName = (key: ParamKey): string => {
    const spec = plan.problem?.params.find((p) => p.key === key);
    return spec ? t(spec.label, locale) : key;
  };

  const costs: CostReport | null = plan.costs;
  const example = plan.problem?.workedExample ? examples[plan.problem.workedExample] ?? null : null;
  const recognition = plan.recognitions[0];
  const logical = costs?.logical;
  const logicalTiles: { label: string; line: CostLine }[] = [];
  if (logical) {
    const candidates: [string, CostLine | null][] = [
      [copy.logicalQubits, logical.logicalQubits],
      [copy.toffolis, logical.toffolis],
      [copy.tGates, logical.tGates],
      [copy.queries, logical.queries],
    ];
    for (const [label, line] of candidates) {
      if (line && line.value !== null) logicalTiles.push({ label, line });
    }
  }

  return (
    <section className="mj-plan" aria-labelledby="plan-heading">
      <h1 id="plan-heading">{copy.heading}</h1>
      <p>{copy.intro}</p>

      <form className="mj-plan-input" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="plan-text">{copy.inputLabel}</label>
        <textarea
          id="plan-text"
          rows={3}
          value={text}
          placeholder={copy.inputPlaceholder}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="mj-plan-examples" role="group" aria-label={copy.examples}>
          <span>{copy.examples}</span>
          {PROBLEMS.map((problem) => (
            <button key={problem.id} type="button" className="mj-plan-chip" onClick={() => chooseExample(problem)}>
              {t(problem.label, locale)}
            </button>
          ))}
        </div>
      </form>

      {text.trim() || picked ? (
        <div className="mj-plan-reading" aria-live="polite">
          <label>
            <span>{plan.problem ? copy.readingAs : copy.pickProblem}</span>
            <select value={problemId ?? ""} onChange={(event) => setPicked((event.target.value || null) as ProblemId | null)}>
              {!plan.problem ? <option value="">—</option> : null}
              {PROBLEMS.map((problem) => (
                <option key={problem.id} value={problem.id}>
                  {t(problem.label, locale)}
                </option>
              ))}
            </select>
          </label>
          {plan.problemPicked ? (
            <p className="mj-plan-muted">{copy.pickedByYou}</p>
          ) : recognition && plan.problem ? (
            <p className="mj-plan-muted">
              {copy.becauseOf}: {recognition.evidence.map((words) => `“${words}”`).join(", ")}
            </p>
          ) : (
            <p>{copy.noRecognition}</p>
          )}
        </div>
      ) : null}

      {plan.problem ? (
        <>
          {plan.problem.params.length > 0 ? (
            <fieldset className="mj-plan-params">
              <legend>{copy.paramsHeading}</legend>
              {plan.problem.params.map((spec) => (
                <ParamRow
                  key={spec.key}
                  spec={spec}
                  value={plan.params[spec.key]}
                  typed={typed[spec.key]}
                  locale={locale}
                  copy={copy}
                  onType={(key, raw) => setTyped((current) => ({ ...current, [key]: raw }))}
                />
              ))}
            </fieldset>
          ) : null}

          <section className="mj-plan-section" aria-labelledby="plan-workflow-heading">
            <h2 id="plan-workflow-heading">{copy.workflowHeading}</h2>
            <p className="mj-plan-muted">{copy.workflowIntro}</p>
            {plan.root ? (
              <ol className="mj-plan-stages">
                <StageCard stage={plan.root} locale={locale} copy={copy} onSwap={swap} />
              </ol>
            ) : null}
            {plan.compile ? (
              <>
                <h3 className="mj-plan-subheading">{copy.compileHeading}</h3>
                <p className="mj-plan-muted">
                  {plan.compile.method?.id === "nisq-transpilation" ? copy.compileNisq : copy.compileFt}
                </p>
                <ol className="mj-plan-stages">
                  <StageCard stage={plan.compile} locale={locale} copy={copy} onSwap={swap} />
                </ol>
              </>
            ) : null}
          </section>

          {costs ? (
            <section className="mj-plan-section" aria-labelledby="plan-cost-heading">
              <h2 id="plan-cost-heading">{copy.costHeading}</h2>
              {costs.notes.map((note, i) => (
                <p key={i} className="mj-plan-callout">
                  {t(note, locale)}
                </p>
              ))}
              {costs.lines.length + costs.classical.length + costs.published.length > 0 ? (
                <div className="mj-plan-table-wrap">
                  <table className="mj-plan-table">
                    <thead>
                      <tr>
                        {copy.costColumns.map((column) => (
                          <th key={column} scope="col">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <CostRows lines={costs.lines} locale={locale} copy={copy} papers={paperMap} paramName={paramName} />
                    </tbody>
                    {costs.classical.length > 0 ? (
                      <tbody>
                        <tr className="mj-plan-group">
                          <th colSpan={5} scope="rowgroup">
                            {copy.classicalHeading}
                          </th>
                        </tr>
                        <CostRows lines={costs.classical} locale={locale} copy={copy} papers={paperMap} paramName={paramName} />
                      </tbody>
                    ) : null}
                    {costs.published.length > 0 ? (
                      <tbody>
                        <tr className="mj-plan-group">
                          <th colSpan={5} scope="rowgroup">
                            {copy.publishedHeading}
                          </th>
                        </tr>
                        <CostRows lines={costs.published} locale={locale} copy={copy} papers={paperMap} paramName={paramName} />
                      </tbody>
                    ) : null}
                  </table>
                </div>
              ) : null}
              <p className="mj-plan-muted mj-plan-kinds-help">{copy.kindsHelp}</p>

              {logicalTiles.length > 0 ? (
                <div className="mj-plan-logical">
                  <h3 className="mj-plan-subheading">{copy.logicalHeading}</h3>
                  <p className="mj-plan-muted">{copy.logicalIntro}</p>
                  <dl className="mj-plan-tiles">
                    {logicalTiles.map(({ label, line }) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{formatValue(line)}</dd>
                        <dd className="mj-plan-muted">{copy.kinds[line.kind]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </section>
          ) : null}

          {costs && costs.suggestions.length > 0 ? (
            <section className="mj-plan-section" aria-labelledby="plan-suggest-heading">
              <h2 id="plan-suggest-heading">{copy.suggestionsHeading}</h2>
              <ul className="mj-plan-suggestions">
                {costs.suggestions.map((suggestion) => (
                  <li key={suggestion.id} className="mj-plan-suggestion">
                    <h3>{t(suggestion.title, locale)}</h3>
                    <p>{t(suggestion.body, locale)}</p>
                    <p className="mj-plan-muted">
                      <SourceCite source={suggestion.source} papers={paperMap} locale={locale} />
                    </p>
                    {suggestion.swapTo ? (
                      <button type="button" className="mj-primary-button" onClick={() => applySuggestion(suggestion)}>
                        {copy.trySwap}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mj-plan-section" aria-labelledby="plan-small-heading">
            <h2 id="plan-small-heading">{copy.smallHeading}</h2>
            {example ? (
              <div className="mj-plan-small">
                <p className="mj-plan-muted">{copy.smallIntro}</p>
                <h3>{example.title}</h3>
                <p>{example.instance}</p>
                {example.blocks.length > 0 ? (
                  <p className="mj-plan-muted">
                    {copy.blocksLine} {example.blocks.join(" → ")}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mj-plan-muted">{copy.noSmall}</p>
            )}
            <div className="mj-repo-card-links">
              {example ? (
                isSignedIn ? (
                  <a className="mj-primary-button" href={workedExampleStudioHref(example.id)}>
                    {copy.openInStudio}
                  </a>
                ) : (
                  <SignInLink className="mj-primary-button" href={workedExampleSignInHref(example.id)} pendingLabel={copy.openingSignIn}>
                    {copy.openInStudio}
                  </SignInLink>
                )
              ) : null}
              <button type="button" className="mj-primary-button" onClick={askNala}>
                {copy.askNala}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
