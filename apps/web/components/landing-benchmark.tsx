import type { HomeBenchmarkCopy } from "../lib/public-copy";
import { Reveal } from "./reveal";

/**
 * The benchmark section as grouped bars, one group per benchmark. Every number
 * comes from `HOME_COPY.benchmark`; nothing here is computed from a measurement
 * of its own. In each group LeonaQ's bar is filled in the accent and the models
 * the sources report follow in plum, longest first, each with its value at the
 * end. The list markup carries model and value as text, so a screen reader
 * hears every figure once and the bars are decoration over it. Simplified from
 * a dot plot with a separate table on owner direction (2026-09-12).
 */
export function LandingBenchmark({ copy }: { copy: HomeBenchmarkCopy }) {
  const format = (score: number) => `${score.toFixed(1)}%`;
  return (
    <section className="mj-company-section lq-bench" aria-labelledby="benchmark-heading">
      <Reveal>
        <div className="lq-site-section-heading">
          <p className="mj-section-label">{copy.label}</p>
          <h2 id="benchmark-heading">{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
      </Reveal>
      <Reveal delay={90}>
        <p className="lq-bench-legend">
          <span><i className="is-leona" aria-hidden="true" />{copy.leonaLabel}</span>
          <span><i aria-hidden="true" />{copy.reportedLabel}</span>
        </p>
        <div className="lq-bench-groups">
          {copy.rows.map((row) => {
            // LeonaQ first, then the reported models from the highest down.
            const scores = [...row.scores].sort(
              (a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || b.score - a.score,
            );
            return (
              <figure className="lq-bench-group" key={row.name}>
                <figcaption>
                  <strong>{row.name}</strong>
                  {row.detail ? <span>{row.detail}</span> : null}
                </figcaption>
                <ul>
                  {scores.map((score) => (
                    <li key={score.model} data-featured={score.featured ? "" : undefined}>
                      <span className="lq-bench-model" title={score.detail ? `${score.model} · ${score.detail}` : score.model}>{score.model}</span>
                      <span className="lq-bench-bar" aria-hidden="true"><i style={{ width: `${score.score}%` }} /></span>
                      <span className="lq-bench-value">{format(score.score)}</span>
                    </li>
                  ))}
                </ul>
              </figure>
            );
          })}
        </div>
        <p className="lq-bench-note">{copy.note}</p>
        <p className="lq-bench-sources">
          <span>{copy.sourcesLabel}</span>
          {copy.sources.map((source) => (
            <a href={source.href} key={source.href} rel="noreferrer" target="_blank">{source.label} ↗</a>
          ))}
        </p>
      </Reveal>
    </section>
  );
}
