import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { Reveal } from "../../../components/reveal";
import { BENCHMARKS_COPY, BENCHMARKS_HARNESS_URL } from "../../../lib/benchmarks-copy";
import {
  QISKIT_HUMANEVAL_CEILING,
  QISKIT_HUMANEVAL_CONTROLS,
  QISKIT_HUMANEVAL_RUNS,
} from "../../../lib/benchmarks/qiskit-humaneval";
import {
  completedRunFacts,
  firstAndLatestCompletedFacts,
  formatTemplate,
  formatWallTimeHours,
  isRunPendingForDisplay,
  latestCompletedRun,
} from "../../../lib/benchmarks/qiskit-humaneval-view";
import { parsePublicLocale, PUBLIC_LOCALES } from "../../../lib/public-locale";
import { canonicalMetadata } from "../../../lib/public-metadata";
import { benchmarksMetadataCopy } from "../../../lib/public-page-metadata";

// Served from the CDN, same as `/about` and `/pricing` — see those pages'
// own comments for why this trio of exports is what makes that true.
export const revalidate = 300;
export const dynamicParams = false;

export function generateStaticParams() {
  return PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = parsePublicLocale((await params).locale);
  return { ...benchmarksMetadataCopy(locale), ...canonicalMetadata("/benchmarks") };
}

/**
 * ai-ops 372. Every number rendered on this page is read from
 * `lib/benchmarks/qiskit-humaneval.ts` (the data file, sourced from the
 * run's own report JSON) through `lib/benchmarks/qiskit-humaneval-view.ts`
 * (pure arithmetic, no invented figures) — never typed directly into this
 * component or into `lib/benchmarks-copy.ts`'s prose. Both runs are complete
 * as of the 2026-09-25 re-run; a future run added with `pending: true` and
 * every number field `null` renders as "Re-run in progress" instead of a
 * number — `latestCompletedRun`/`completedRunFacts`/`isRunPendingForDisplay`
 * refuse to produce a figure for it, so this page cannot invent one either.
 */
export default async function BenchmarksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parsePublicLocale((await params).locale);
  const copy = BENCHMARKS_COPY[locale];
  const ceiling = QISKIT_HUMANEVAL_CEILING;
  const headlineRun = latestCompletedRun(QISKIT_HUMANEVAL_RUNS);
  const headline = headlineRun ? completedRunFacts(headlineRun) : null;
  const comparison = firstAndLatestCompletedFacts(QISKIT_HUMANEVAL_RUNS);
  const ceilingVars = {
    totalTasks: ceiling.totalTasks,
    gradableTasks: ceiling.gradableTasks,
    blockedTasks: ceiling.blockedTasks,
    blockedNeedsIbmCloud: ceiling.blockedNeedsIbmCloud,
    blockedNeedsFileWrite: ceiling.blockedNeedsFileWrite,
  };

  return (
    <PublicSite activePath="/benchmarks" className="mj-benchmarks-site" locale={locale} chrome="static">
      <section className="mj-public-page-hero" aria-labelledby="benchmarks-hero-heading">
        <p className="mj-section-label">{copy.hero.label}</p>
        <h1 id="benchmarks-hero-heading">{copy.hero.title}</h1>
        <p>{copy.hero.body}</p>
      </section>

      <Reveal>
        <section className="mj-benchmarks-headline" aria-labelledby="benchmarks-headline-heading">
          {headline && headlineRun ? (
            <>
              <h2 id="benchmarks-headline-heading">
                {formatTemplate(copy.headline.scoreTemplate, {
                  passed: headline.passed,
                  total: headline.total,
                  pct: headline.passRatePct,
                })}
              </h2>
              <p>
                {formatTemplate(copy.headline.gradableTemplate, {
                  passedOfGradable: headline.passedOfGradable,
                  gradable: headline.gradable,
                  pct: headline.gradableRatePct,
                })}
              </p>
            </>
          ) : (
            <>
              <h2 id="benchmarks-headline-heading">{copy.headline.pendingTitle}</h2>
              <p>{copy.headline.pendingBodyTemplate}</p>
            </>
          )}
        </section>
      </Reveal>

      <Reveal>
        <section className="mj-benchmarks-section" aria-labelledby="benchmarks-what-heading">
          <div className="lq-site-section-heading">
            <h2 id="benchmarks-what-heading">{copy.what.title}</h2>
          </div>
          <p>{copy.what.body}</p>
        </section>
      </Reveal>

      <Reveal>
        <section className="mj-benchmarks-section" aria-labelledby="benchmarks-how-heading">
          <div className="lq-site-section-heading">
            <h2 id="benchmarks-how-heading">{copy.how.title}</h2>
          </div>
          <p>{copy.how.body}</p>
        </section>
      </Reveal>

      <Reveal>
        <section className="mj-benchmarks-section" aria-labelledby="benchmarks-ceiling-heading">
          <div className="lq-site-section-heading">
            <h2 id="benchmarks-ceiling-heading">{formatTemplate(copy.ceiling.titleTemplate, ceilingVars)}</h2>
          </div>
          <p>{formatTemplate(copy.ceiling.bodyTemplate, ceilingVars)}</p>
        </section>
      </Reveal>

      <Reveal>
        <section className="mj-benchmarks-section" aria-labelledby="benchmarks-controls-heading">
          <div className="lq-site-section-heading">
            <h2 id="benchmarks-controls-heading">{copy.controls.title}</h2>
          </div>
          <p>
            {formatTemplate(copy.controls.bodyTemplate, {
              ...ceilingVars,
              stubCanonicalPassed: QISKIT_HUMANEVAL_CONTROLS.stubCanonical.passed,
              stubCanonicalTotal: QISKIT_HUMANEVAL_CONTROLS.stubCanonical.total,
              stubGarbagePassed: QISKIT_HUMANEVAL_CONTROLS.stubGarbage.passed,
            })}
          </p>
        </section>
      </Reveal>

      <Reveal>
        <section className="mj-benchmarks-section mj-benchmarks-history" aria-labelledby="benchmarks-history-heading">
          <div className="lq-site-section-heading">
            <h2 id="benchmarks-history-heading">{copy.history.title}</h2>
            <p>{copy.history.body}</p>
          </div>
          <div className="mj-benchmarks-history-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{copy.history.columns.run}</th>
                  <th scope="col">{copy.history.columns.date}</th>
                  <th scope="col">{copy.history.columns.model}</th>
                  <th scope="col">{copy.history.columns.passed}</th>
                  <th scope="col">{formatTemplate(copy.history.columns.ofGradableTemplate, ceilingVars)}</th>
                  <th scope="col">{copy.history.columns.spend}</th>
                  <th scope="col">{copy.history.columns.wallTime}</th>
                </tr>
              </thead>
              <tbody>
                {QISKIT_HUMANEVAL_RUNS.map((run) => {
                  const facts = completedRunFacts(run);
                  return (
                    <tr key={`${run.date}-${run.label}`}>
                      <th scope="row">{run.label}</th>
                      <td>{run.date}</td>
                      <td>{run.model ?? copy.history.notAvailable}</td>
                      {isRunPendingForDisplay(run) || !facts ? (
                        <td colSpan={2}>{copy.history.pendingStatus}</td>
                      ) : (
                        <>
                          <td>
                            {facts.passed} / {facts.total}
                          </td>
                          <td>
                            {facts.passedOfGradable} / {facts.gradable}
                          </td>
                        </>
                      )}
                      <td>{run.spendUsd === null ? copy.history.notAvailable : `$${run.spendUsd.toFixed(2)}`}</td>
                      <td>{run.wallTimeHours === null ? copy.history.notAvailable : `${formatWallTimeHours(run.wallTimeHours)}h`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {comparison ? (
            <p className="mj-benchmarks-history-change">
              <strong>{copy.history.columns.changed}: </strong>
              {formatTemplate(copy.history.changeTemplate, {
                ...ceilingVars,
                firstPassed: comparison.first.passed,
                firstTotal: comparison.first.total,
                firstPct: comparison.first.passRatePct,
                firstOfGradable: comparison.first.passedOfGradable,
                latestPassed: comparison.latest.passed,
                latestTotal: comparison.latest.total,
                latestPct: comparison.latest.passRatePct,
                latestOfGradable: comparison.latest.passedOfGradable,
              })}
            </p>
          ) : null}
          <div className="mj-benchmarks-history-notes">
            <h3>{copy.history.notesTitle}</h3>
            <ul>
              {QISKIT_HUMANEVAL_RUNS.map((run) => (
                <li key={`notes-${run.date}-${run.label}`}>
                  <strong>{run.label}:</strong> {run.notes}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="mj-benchmarks-section" aria-labelledby="benchmarks-limits-heading">
          <div className="lq-site-section-heading">
            <h2 id="benchmarks-limits-heading">{copy.limits.title}</h2>
          </div>
          <ul className="mj-benchmarks-limits-list">
            {copy.limits.items.map((item) => (
              <li key={item}>{formatTemplate(item, ceilingVars)}</li>
            ))}
          </ul>
        </section>
      </Reveal>

      <Reveal>
        <section className="mj-benchmarks-section" aria-labelledby="benchmarks-source-heading">
          <div className="lq-site-section-heading">
            <h2 id="benchmarks-source-heading">{copy.source.title}</h2>
          </div>
          <p>{copy.source.body}</p>
          <a className="mj-secondary-button" href={BENCHMARKS_HARNESS_URL} target="_blank" rel="noreferrer">
            {copy.source.linkLabel}
          </a>
        </section>
      </Reveal>
    </PublicSite>
  );
}
