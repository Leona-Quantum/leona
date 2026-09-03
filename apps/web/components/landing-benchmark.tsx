import type { CSSProperties } from "react";
import type { HomeBenchmarkCopy } from "../lib/public-copy";
import { Reveal } from "./reveal";

const CHART_MAX = 60;
const CROSS_FRAMEWORK_CHART_MAX = 80;

export function LandingBenchmark({ copy }: { copy: HomeBenchmarkCopy }) {
  const featured = copy.models.find((model) => model.featured) ?? copy.models[0];
  const crossFramework = copy.crossFramework;

  return (
    <section className="mj-company-section mj-company-benchmark" aria-labelledby="benchmark-heading">
      <Reveal>
        <div className="mj-company-benchmark-heading">
          <div>
            <p className="mj-section-label">{copy.label}</p>
            <h2 id="benchmark-heading">{copy.title}</h2>
          </div>
          <p>{copy.body}</p>
        </div>
      </Reveal>

      <Reveal delay={90}>
        <figure className="mj-company-benchmark-figure" aria-labelledby="benchmark-heading">
          <div className="mj-company-benchmark-panel">
            <div className="mj-company-benchmark-score">
              <div className="mj-company-benchmark-score-head">
                <span>{copy.internalLabel}</span>
                <span>LEONAQ / 01</span>
              </div>
              <strong>
                {featured.score.toFixed(1)}
                <span>%</span>
              </strong>
              <p>{copy.scoreLabel}</p>
              <div className="mj-company-benchmark-signal" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>

            <div className="mj-company-benchmark-chart" role="group" aria-label={copy.chartAria}>
              <div className="mj-company-benchmark-chart-head">
                <span>{copy.chartLabel}</span>
                <span>PASS@1 / %</span>
              </div>

              <div className="mj-company-benchmark-rows" role="list">
                {copy.models.map((model) => {
                  const position = Math.min(100, (model.score / CHART_MAX) * 100);
                  return (
                    <div
                      className={`mj-company-benchmark-row${model.featured ? " is-featured" : ""}`}
                      key={model.name}
                      role="listitem"
                    >
                      <div className="mj-company-benchmark-model">
                        <strong>{model.name}</strong>
                        <span>{model.detail}</span>
                      </div>
                      <span className="mj-company-benchmark-badge">{model.badge}</span>
                      <strong className="mj-company-benchmark-value">{model.score.toFixed(1)}%</strong>
                      <div
                        aria-label={`${model.name}: ${model.score.toFixed(1)}%`}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={model.score}
                        className="mj-company-benchmark-track"
                        role="meter"
                      >
                        <span
                          style={{ "--mj-benchmark-score": `${position}%` } as CSSProperties}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mj-company-benchmark-axis" aria-hidden="true">
                <span>0</span>
                <span>20</span>
                <span>40</span>
                <span>60</span>
              </div>
            </div>
          </div>

          <figcaption className="mj-company-benchmark-caption">
            <p>{copy.note}</p>
            <div>
              <span>{copy.sourcesLabel}</span>
              <ul>
                {copy.sources.map((source, index) => (
                  <li key={source.href}>
                    <a href={source.href} rel="noreferrer" target="_blank">
                      {String(index + 1).padStart(2, "0")} / {source.label} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </figcaption>
        </figure>
      </Reveal>

      <Reveal delay={140}>
        <div className="mj-company-cross-benchmark">
          <div className="mj-company-benchmark-heading mj-company-cross-benchmark-heading">
            <div>
              <p className="mj-section-label">{crossFramework.label}</p>
              <h3 id="cross-framework-heading">{crossFramework.title}</h3>
            </div>
            <p>{crossFramework.body}</p>
          </div>

          <figure
            className="mj-company-benchmark-figure"
            aria-labelledby="cross-framework-heading"
          >
            <div
              className="mj-company-cross-benchmark-cards"
              role="list"
              aria-label={crossFramework.chartAria}
            >
              {crossFramework.frameworks.map((framework, index) => {
                const leader =
                  framework.scores.find((score) => score.featured) ?? framework.scores[0];
                const comparisons = framework.scores.filter((score) => !score.featured);

                return (
                  <article
                    className="mj-company-cross-benchmark-card"
                    key={framework.name}
                    role="listitem"
                  >
                    <div className="mj-company-cross-benchmark-card-head">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <h4>{framework.name}</h4>
                      <span>PASS@1</span>
                    </div>

                    {/* Deliberately NOT `role="meter"`. This block draws no
                        track — it is a bordered text card (`globals.css`,
                        `.mj-company-cross-benchmark-leader`) — and `meter` is one
                        of the roles ARIA gives presentational children, so a
                        conforming screen reader would discard the subtree and
                        announce only the role's own name. That subtree is where
                        `internalLabel` lives, and it is the ONLY per-card marker
                        separating Leona's self-reported number from the three
                        cited comparators beside it. The two real gauges in this
                        file keep the role, on an empty track, with their text as
                        siblings. */}
                    <div className="mj-company-cross-benchmark-leader">
                      <div>
                        <strong>{leader.model}</strong>
                        <span>{crossFramework.internalLabel}</span>
                      </div>
                      <strong>
                        {leader.score.toFixed(1)}
                        <span>%</span>
                      </strong>
                    </div>

                    <div className="mj-company-cross-benchmark-comparison-head">
                      <span>{crossFramework.comparisonLabel}</span>
                      <span>%</span>
                    </div>
                    <ul className="mj-company-cross-benchmark-comparisons">
                      {comparisons.map((score) => {
                        const position = Math.min(
                          100,
                          (score.score / CROSS_FRAMEWORK_CHART_MAX) * 100,
                        );
                        return (
                          <li key={score.model}>
                            <div>
                              <span>{score.model}</span>
                              <strong>{score.score.toFixed(1)}</strong>
                            </div>
                            <div
                              className="mj-company-cross-benchmark-track"
                              role="meter"
                              aria-label={`${score.model} · ${framework.name}: ${score.score.toFixed(1)}%`}
                              aria-valuemax={100}
                              aria-valuemin={0}
                              aria-valuenow={score.score}
                            >
                              <span
                                style={{ "--mj-cross-score": `${position}%` } as CSSProperties}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </article>
                );
              })}
            </div>

            <figcaption className="mj-company-benchmark-caption">
              <p>{crossFramework.note}</p>
              <div>
                <span>{crossFramework.sourcesLabel}</span>
                <ul>
                  {crossFramework.sources.map((source, index) => (
                    <li key={source.href}>
                      <a href={source.href} rel="noreferrer" target="_blank">
                        {String(index + 1).padStart(2, "0")} / {source.label} ↗
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </figcaption>
          </figure>
        </div>
      </Reveal>
    </section>
  );
}
