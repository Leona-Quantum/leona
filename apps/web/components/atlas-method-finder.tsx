"use client";

/**
 * Proposal 2 (owner-approved 2026-09-20): "Atlas as the way in — from a
 * problem to candidate methods". Everything here runs over the `FinderRecord`
 * list the server component already fetched — no network call this component
 * makes ever recomputes a cost or a regime; it only reads what
 * `lib/repository/finder.ts` already derived from fields the record states.
 *
 * Sign-in state is resolved client-side, the same move `RepositoryBrowser`
 * and `AtlasWorkedExample` already make, and for the same reason: a server
 * read of it would call `getMajoranaAuth()`, a Dynamic API that would make
 * this whole page uncacheable (and, on this locale-rewritten path, throw —
 * see the page's own header).
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicLocale } from "../lib/public-locale";
import {
  DEFAULT_FINDER_LIMITS,
  findMethods,
  statedCost,
  statedRegime,
  type FinderCriterion,
  type FinderLimits,
  type FinderMatch,
  type FinderProblemOption,
  type FinderRecord,
  type HardwareEraFilter,
} from "../lib/repository/finder.ts";
import { workedExampleSignInHref, workedExampleStudioHref } from "../lib/atlas-worked-example-steps";
import { writeLandingPromptHandoff } from "../lib/landing-prompt-handoff";
import { SignInLink } from "./sign-in-link";

const COPY = {
  en: {
    heading: "Find a method for your problem",
    intro:
      "Pick a problem area and set your limits. You'll see the methods whose records meet them, and why. When a record doesn't state something, the result says so instead of guessing.",
    problemLabel: "Problem area",
    anyProblem: "Any problem area",
    queryLabel: "Search text (optional)",
    queryPlaceholder: "e.g. Grover, VQE, factoring",
    maxQubitsLabel: "Max qubits",
    maxDepthLabel: "Max depth (gates)",
    hardwareLabel: "Target hardware",
    hardwareAny: "No preference",
    hardwareNisq: "NISQ-era (today's noisy hardware)",
    hardwareFt: "Fault-tolerant (error-corrected)",
    resultsCount: (n: number) => (n === 1 ? "1 method matches." : `${n} methods match.`),
    whyItMatches: "Why it matches",
    costLabel: "Cost, as recorded",
    regimeLabel: "Speedup, as the sources state it",
    estimateLabel: "Fault-tolerant estimate",
    estimateValue: (qubits: string) => `${qubits} physical qubits`,
    estimateNone: "No estimate for this method yet.",
    notStated: "Not stated in the source.",
    sourceLabel: "Source",
    openRecord: "Open the record",
    openInStudio: "Open in Studio",
    openingSignIn: "Opening sign in…",
    askInRun: "Ask in Run",
    emptyHeading: "No methods match every limit you set.",
    emptyRelax: (label: string, n: number) =>
      `Relaxing "${label}" alone would bring back ${n === 1 ? "1 method" : `${n} methods`}.`,
    emptyGeneric: "Try relaxing one of your limits, or clearing the problem area.",
    reset: "Clear all limits",
  },
  ja: {
    heading: "問題に合う手法を探す",
    intro:
      "問題領域を選び、制約を入力してください。記録がその条件を満たす手法と、その理由を表示します。記録に記載のない項目は、推測せずに「記載なし」と表示します。",
    problemLabel: "問題領域",
    anyProblem: "指定なし",
    queryLabel: "検索語（任意）",
    queryPlaceholder: "例: Grover、VQE、素因数分解",
    maxQubitsLabel: "量子ビット数の上限",
    maxDepthLabel: "深さの上限（ゲート数）",
    hardwareLabel: "対象ハードウェア",
    hardwareAny: "指定なし",
    hardwareNisq: "NISQ世代（現行のノイズあり実機）",
    hardwareFt: "フォールトトレラント（誤り訂正あり）",
    resultsCount: (n: number) => `${n} 件の手法が一致しました。`,
    whyItMatches: "一致した理由",
    costLabel: "記載されたコスト",
    regimeLabel: "速度向上（出典の記載どおり）",
    estimateLabel: "フォールトトレラント見積もり",
    estimateValue: (qubits: string) => `物理量子ビット ${qubits} 個`,
    estimateNone: "この手法の見積もりはまだありません。",
    notStated: "出典に記載なし。",
    sourceLabel: "出典",
    openRecord: "記録を開く",
    openInStudio: "Studioで開く",
    openingSignIn: "サインインを開いています…",
    askInRun: "Runで質問する",
    emptyHeading: "設定したすべての制約を満たす手法はありません。",
    emptyRelax: (label: string, n: number) => `「${label}」だけを緩めると ${n} 件の手法が戻ります。`,
    emptyGeneric: "制約を一つ緩めるか、問題領域の指定を外してみてください。",
    reset: "制約をすべてクリア",
  },
} as const;

const CRITERION_LABEL: Record<FinderCriterion["key"], { en: string; ja: string }> = {
  problem: { en: "Problem area", ja: "問題領域" },
  query: { en: "Search text", ja: "検索語" },
  qubits: { en: "Qubits", ja: "量子ビット数" },
  depth: { en: "Depth", ja: "深さ" },
  dataSize: { en: "Problem size", ja: "問題サイズ" },
  hardwareEra: { en: "Target hardware", ja: "対象ハードウェア" },
};

const VERDICT_MARK: Record<FinderCriterion["verdict"], string> = {
  satisfied: "✓",
  "not-stated": "–",
  violated: "✕",
};

function parseOptionalInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** One criterion line — locale text is a data field on `FinderCriterion`, not JSX. */
function CriterionRow({ criterion, locale }: { criterion: FinderCriterion; locale: PublicLocale }) {
  const label = locale === "ja" ? CRITERION_LABEL[criterion.key].ja : CRITERION_LABEL[criterion.key].en;
  const detail = locale === "ja" ? criterion.detailJa : criterion.detail;
  return (
    <li className={`mj-finder-criterion mj-finder-criterion-${criterion.verdict}`}>
      <span aria-hidden="true" className="mj-finder-criterion-mark">{VERDICT_MARK[criterion.verdict]}</span>
      <span>
        <strong>{label}:</strong> {detail}
      </span>
    </li>
  );
}

function ResultCard({
  match,
  locale,
  isSignedIn,
  signInHref,
  estimatesAvailable,
}: {
  match: FinderMatch;
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
  estimatesAvailable: boolean;
}) {
  const copy = COPY[locale];
  const record = match.record;
  const title = locale === "ja" && record.titleJa ? record.titleJa : record.title;
  const description = locale === "ja" && record.descriptionJa ? record.descriptionJa : record.description;
  const categoryLabel = locale === "ja" ? record.categoryLabelJa : record.categoryLabel;
  const cost = statedCost(record);
  const regime = statedRegime(record);
  const estimate = estimateDisplay(record, copy, estimatesAvailable);
  const router = useRouter();

  function askInRun() {
    const question =
      locale === "ja"
        ? `「${title}」について教えてください。${description}`
        : `Tell me about "${title}" — ${description}`;
    writeLandingPromptHandoff(question);
    router.push("/run");
  }

  return (
    <li className="mj-repo-card mj-finder-card">
      <div className="mj-repo-card-top">
        <span className="mj-facet-chip">{categoryLabel}</span>
        <h3>
          <a href={`/repository/${record.slug}`}>{title}</a>
        </h3>
      </div>
      <p>{description}</p>

      {match.criteria.length > 0 ? (
        <ul className="mj-finder-criteria" aria-label={copy.whyItMatches}>
          {match.criteria.map((criterion) => (
            <CriterionRow key={criterion.key} criterion={criterion} locale={locale} />
          ))}
        </ul>
      ) : null}

      <dl className="mj-finder-facts">
        <div>
          <dt>{copy.costLabel}</dt>
          <dd>{cost.stated ? cost.value : copy.notStated}</dd>
        </div>
        <div>
          <dt>{copy.regimeLabel}</dt>
          <dd>{regime.stated ? regime.value : copy.notStated}</dd>
        </div>
        {estimate !== null ? (
          <div>
            <dt>{copy.estimateLabel}</dt>
            <dd>{estimate}</dd>
          </div>
        ) : null}
        <div>
          <dt>{copy.sourceLabel}</dt>
          <dd>{record.provenance || copy.notStated}</dd>
        </div>
      </dl>

      <div className="mj-repo-card-links">
        <a className="mj-primary-button" href={`/repository/${record.slug}`}>
          {copy.openRecord}
        </a>
        {record.studioExampleId !== null ? (
          isSignedIn ? (
            <a className="mj-primary-button" href={workedExampleStudioHref(record.studioExampleId)}>
              {copy.openInStudio}
            </a>
          ) : signInHref ? (
            <SignInLink
              className="mj-primary-button"
              href={workedExampleSignInHref(record.studioExampleId)}
              pendingLabel={copy.openingSignIn}
            >
              {copy.openInStudio}
            </SignInLink>
          ) : null
        ) : null}
        <button type="button" className="mj-primary-button" onClick={askInRun}>
          {copy.askInRun}
        </button>
      </div>
    </li>
  );
}

/**
 * The resource estimator's physical-qubit count, kept apart from the speedup
 * line above it: a cost estimate is not a statement about advantage. Null
 * (row hidden) when this deployment has no estimates at all, so a reader never
 * sees a sentence about how the site is wired.
 */
function estimateDisplay(
  record: FinderRecord,
  copy: (typeof COPY)["en"] | (typeof COPY)["ja"],
  estimatesAvailable: boolean,
): string | null {
  if (record.estimate && record.estimate.totalPhysicalQubits !== null) {
    return copy.estimateValue(record.estimate.totalPhysicalQubits.toLocaleString());
  }
  return estimatesAvailable ? copy.estimateNone : null;
}

export function AtlasMethodFinder({
  locale,
  records,
  problemOptions,
  estimatesAvailable,
}: {
  locale: PublicLocale;
  records: readonly FinderRecord[];
  problemOptions: readonly FinderProblemOption[];
  estimatesAvailable: boolean;
}) {
  const copy = COPY[locale];

  const [problem, setProblem] = useState<FinderLimits["problem"]>(DEFAULT_FINDER_LIMITS.problem);
  const [query, setQuery] = useState(DEFAULT_FINDER_LIMITS.query);
  const [maxQubitsInput, setMaxQubitsInput] = useState("");
  const [maxDepthInput, setMaxDepthInput] = useState("");
  const [hardwareEra, setHardwareEra] = useState<HardwareEraFilter>(DEFAULT_FINDER_LIMITS.hardwareEra);

  // Same move `RepositoryBrowser` makes — see that file's own comment. Starts
  // signed-out (what the server already rendered) and corrects itself once
  // mounted, so hydration reconciles nothing.
  const [session, setSession] = useState<{ signedIn: boolean; signInHref: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { signedIn: boolean; signInHref: string | null } | null) => {
        if (!cancelled && data) setSession(data);
      })
      .catch(() => {
        // Left signed-out — the same state the server already rendered.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const isSignedIn = session?.signedIn ?? false;
  const signInHref = session?.signInHref ?? "/auth/sign-in";

  const limits: FinderLimits = useMemo(
    () => ({
      problem,
      query,
      maxQubits: parseOptionalInt(maxQubitsInput),
      maxDepth: parseOptionalInt(maxDepthInput),
      // No record states a comparable problem size yet (0 of 284 on
      // 2026-09-20), so there is no input for it; the matcher still takes
      // the limit, for when records carry the field.
      dataSizeN: null,
      hardwareEra,
    }),
    [problem, query, maxQubitsInput, maxDepthInput, hardwareEra],
  );

  const outcome = useMemo(
    () => findMethods(records, limits, estimatesAvailable),
    [records, limits, estimatesAvailable],
  );

  const isDefaultLimits =
    limits.problem === "" &&
    limits.query.trim() === "" &&
    limits.maxQubits === null &&
    limits.maxDepth === null &&
    limits.dataSizeN === null &&
    limits.hardwareEra === "any";

  function reset() {
    setProblem(DEFAULT_FINDER_LIMITS.problem);
    setQuery("");
    setMaxQubitsInput("");
    setMaxDepthInput("");
    setHardwareEra(DEFAULT_FINDER_LIMITS.hardwareEra);
  }

  const relaxable = (["problem", "query", "qubits", "depth", "hardwareEra"] as const)
    .map((key) => ({ key, count: outcome.excludedByOnly[key] }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <section className="mj-finder" aria-labelledby="finder-heading">
      <h1 id="finder-heading">{copy.heading}</h1>
      <p>{copy.intro}</p>

      <form className="mj-repository-controls mj-finder-form" onSubmit={(event) => event.preventDefault()}>
        <label>
          {copy.problemLabel}
          <select value={problem} onChange={(event) => setProblem(event.target.value as FinderLimits["problem"])}>
            <option value="">{copy.anyProblem}</option>
            {problemOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {(locale === "ja" ? option.labelJa : option.label)} ({option.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          {copy.queryLabel}
          <input
            type="text"
            value={query}
            placeholder={copy.queryPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <label>
          {copy.maxQubitsLabel}
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={maxQubitsInput}
            onChange={(event) => setMaxQubitsInput(event.target.value)}
          />
        </label>

        <label>
          {copy.maxDepthLabel}
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={maxDepthInput}
            onChange={(event) => setMaxDepthInput(event.target.value)}
          />
        </label>

        <fieldset>
          <legend>{copy.hardwareLabel}</legend>
          {(
            [
              ["any", copy.hardwareAny],
              ["nisq", copy.hardwareNisq],
              ["fault-tolerant", copy.hardwareFt],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="mj-finder-radio">
              <input
                type="radio"
                name="hardware-era"
                value={value}
                checked={hardwareEra === value}
                onChange={() => setHardwareEra(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        {!isDefaultLimits ? (
          <button type="button" className="mj-primary-button" onClick={reset}>
            {copy.reset}
          </button>
        ) : null}
      </form>

      <p className="mj-repository-search-status" role="status">
        {copy.resultsCount(outcome.matches.length)}
      </p>

      {outcome.matches.length === 0 ? (
        <div className="mj-finder-empty">
          <p>{copy.emptyHeading}</p>
          {relaxable.length > 0 ? (
            <ul>
              {relaxable.map((entry) => (
                <li key={entry.key}>
                  {copy.emptyRelax(
                    locale === "ja" ? CRITERION_LABEL[entry.key].ja : CRITERION_LABEL[entry.key].en,
                    entry.count,
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>{copy.emptyGeneric}</p>
          )}
        </div>
      ) : (
        <ul className="mj-finder-results">
          {outcome.matches.map((match) => (
            <ResultCard
              key={match.record.slug}
              match={match}
              locale={locale}
              isSignedIn={isSignedIn}
              signInHref={signInHref}
              estimatesAvailable={estimatesAvailable}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
