"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import type { VqeFramework } from "../../../lib/vqe-proof";
import {
  buildControlledComparisonRequest,
  parseComparisonExperiment,
  parseControlledComparison,
  succeededExecution,
  type ControlledComparison,
} from "../../../lib/vqe-controlled-comparison";

function errorDetail(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as Record<string, unknown>;
  if (typeof value.detail === "string") return value.detail;
  if (typeof value.error === "string") return value.error;
  return fallback;
}

function optimizerLabel(algorithm: string): string {
  if (algorithm === "scipy_slsqp") return "SLSQP";
  if (algorithm === "scipy_cobyla") return "COBYLA";
  return algorithm;
}

function energy(value: number): string {
  return value.toFixed(12);
}

function errorHa(value: number): string {
  return value.toExponential(3);
}

export function VqeControlledComparisonPanel({
  baselineExperimentId,
  candidateExperimentId,
  comparisonId,
  framework,
  locale,
}: {
  baselineExperimentId?: string;
  candidateExperimentId?: string;
  comparisonId?: string;
  framework: VqeFramework;
  locale: PublicLocale;
}) {
  const ja = locale === "ja";
  const [comparison, setComparison] = useState<ControlledComparison | null>(null);
  const [state, setState] = useState<"ready" | "loading" | "error">(
    comparisonId ? "loading" : "ready",
  );
  const [message, setMessage] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  const reopen = useCallback(async (id: string): Promise<boolean> => {
    setState("loading");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/vqe/controlled-comparisons/${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(payload, `comparison reopen failed (${response.status})`));
      }
      setComparison(parseControlledComparison(payload));
      setState("ready");
      return true;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "comparison reopen failed");
      setState("error");
      return false;
    }
  }, []);

  useEffect(() => {
    if (comparisonId) void reopen(comparisonId);
  }, [comparisonId, reopen]);

  async function createAndFinalize() {
    if (!baselineExperimentId || !candidateExperimentId) return;
    setState("loading");
    setMessage(null);
    try {
      const [baselineExperimentResponse, candidateExperimentResponse, baselineExecutionsResponse, candidateExecutionsResponse] = await Promise.all([
        fetch(`/api/vqe/experiments/${encodeURIComponent(baselineExperimentId)}`, { cache: "no-store" }),
        fetch(`/api/vqe/experiments/${encodeURIComponent(candidateExperimentId)}`, { cache: "no-store" }),
        fetch(`/api/vqe/experiments/${encodeURIComponent(baselineExperimentId)}/executions`, { cache: "no-store" }),
        fetch(`/api/vqe/experiments/${encodeURIComponent(candidateExperimentId)}/executions`, { cache: "no-store" }),
      ]);
      const responses = [
        baselineExperimentResponse,
        candidateExperimentResponse,
        baselineExecutionsResponse,
        candidateExecutionsResponse,
      ];
      if (responses.some((response) => !response.ok)) {
        throw new Error("Both private experiments and their execution evidence must be readable");
      }
      const [baselineExperimentPayload, candidateExperimentPayload, baselineExecutionsPayload, candidateExecutionsPayload] = await Promise.all(
        responses.map((response) => response.json()),
      );
      const request = buildControlledComparisonRequest(
        parseComparisonExperiment(baselineExperimentPayload),
        parseComparisonExperiment(candidateExperimentPayload),
      );
      const baselineExecution = succeededExecution(baselineExecutionsPayload, framework);
      const candidateExecution = succeededExecution(candidateExecutionsPayload, framework);
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
      const createResponse = await fetch("/api/vqe/controlled-comparisons", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify(request),
      });
      const createPayload = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(errorDetail(
          createPayload,
          `comparison creation failed (${createResponse.status})`,
        ));
      }
      const created = parseControlledComparison(createPayload);
      const runResponse = await fetch(
        `/api/vqe/controlled-comparisons/${encodeURIComponent(created.id)}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseline_execution_id: baselineExecution.id,
            candidate_execution_id: candidateExecution.id,
          }),
        },
      );
      const runPayload = await runResponse.json();
      if (!runResponse.ok) {
        throw new Error(errorDetail(runPayload, `comparison finalization failed (${runResponse.status})`));
      }
      const reopened = await reopen(created.id);
      if (!reopened) return;
      window.history.replaceState(
        null,
        "",
        `/studio?vqeComparison=${encodeURIComponent(created.id)}&vqeFramework=${encodeURIComponent(framework)}`,
      );
      setMessage(
        ja
          ? "private統制比較を保存し、サーバー再計算済み証拠を再表示しました。"
          : "The private controlled comparison was saved and reopened from server-recomputed evidence.",
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "controlled comparison failed");
      setState("error");
    }
  }

  const latestRun = comparison?.runs.at(-1) ?? null;
  const failedInvariants = latestRun
    ? Object.entries(latestRun.invariant_audit).filter(([, passed]) => !passed)
    : [];
  const comparableMetrics = latestRun?.status === "comparable"
    && failedInvariants.length === 0
    ? latestRun.metric_observations
    : null;

  return (
    <main className="mj-studio-page">
      <section className="mj-studio-main">
        <div className="mj-studio-main-head">
          <div className="mj-studio-title-block">
            <span className="mj-section-label">Atlas VQE · controlled comparison</span>
            <h1>{ja ? "SLSQP → COBYLA 一部品交換" : "SLSQP → COBYLA one-component swap"}</h1>
          </div>
          <a className="mj-secondary-button" href="/repository">
            {ja ? "Atlasへ戻る" : "Back to Atlas"}
          </a>
        </div>

        <div className="mj-studio-empty" role="note">
          <strong>{ja ? "private技術証拠 — 公開・優位性主張は禁止" : "Private technical evidence — publication and superiority claims blocked"}</strong>
          <p>
            {ja
              ? "サーバーが固定component、入力、seed、runtime、canonical circuitを再計算します。一つでも不一致なら比較可能とは表示しません。"
              : "The server recomputes fixed components, inputs, seed, runtime, and canonical circuit. Any mismatch prevents a comparable result."}
          </p>
        </div>

        <dl className="mj-studio-contract">
          <div><dt>changed component</dt><dd>parameter_optimizer</dd></div>
          <div><dt>framework</dt><dd>{framework}</dd></div>
          <div><dt>visibility</dt><dd>{comparison?.visibility ?? "private"}</dd></div>
          <div><dt>publication</dt><dd>{comparison?.publication ?? "blocked"}</dd></div>
          {comparison ? <div><dt>comparison UUID</dt><dd className="mj-mono-muted">{comparison.id}</dd></div> : null}
          {latestRun ? <div><dt>comparability</dt><dd>{latestRun.status}</dd></div> : null}
        </dl>

        {latestRun ? (
          <div className="mj-studio-inspector-card">
            <span className="mj-section-label">Server-recomputed invariant audit</span>
            <dl className="mj-studio-contract">
              {Object.entries(latestRun.invariant_audit).map(([name, passed]) => (
                <div key={name}><dt>{name}</dt><dd>{passed ? "pass" : "FAIL"}</dd></div>
              ))}
            </dl>
            {failedInvariants.length > 0 ? (
              <p role="alert">
                {ja
                  ? "比較可能性が失われました。結果値を性能比較に使用しないでください。"
                  : "Comparability failed. Do not use the result values for a performance comparison."}
              </p>
            ) : null}
          </div>
        ) : null}

        {comparableMetrics && comparison ? (
          <div className="mj-studio-inspector-card">
            <span className="mj-section-label">
              {ja ? "同一条件の最適化観測値" : "Controlled optimization observations"}
            </span>
            <div
              className="mj-repo-table-scroll"
              role="region"
              aria-label={ja ? "SLSQPとCOBYLAの比較値" : "SLSQP and COBYLA observations"}
              tabIndex={0}
            >
              <table className="mj-repo-comparison-table">
                <thead>
                  <tr>
                    <th scope="col">metric</th>
                    <th scope="col">{optimizerLabel(comparison.baseline_algorithm)}</th>
                    <th scope="col">{optimizerLabel(comparison.candidate_algorithm)}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Energy (Ha)</th>
                    <td>{energy(comparableMetrics.baseline.optimization.best_energy_ha)}</td>
                    <td>{energy(comparableMetrics.candidate.optimization.best_energy_ha)}</td>
                  </tr>
                  <tr>
                    <th scope="row">|error| (Ha)</th>
                    <td>{errorHa(comparableMetrics.baseline.optimization.absolute_error_ha)}</td>
                    <td>{errorHa(comparableMetrics.candidate.optimization.absolute_error_ha)}</td>
                  </tr>
                  <tr>
                    <th scope="row">converged</th>
                    <td>{String(comparableMetrics.baseline.optimization.converged)}</td>
                    <td>{String(comparableMetrics.candidate.optimization.converged)}</td>
                  </tr>
                  <tr>
                    <th scope="row">iterations</th>
                    <td>{comparableMetrics.baseline.optimization.iterations}</td>
                    <td>{comparableMetrics.candidate.optimization.iterations}</td>
                  </tr>
                  <tr>
                    <th scope="row">energy evaluations</th>
                    <td>
                      {comparableMetrics.baseline.optimization.optimizer_work.energy_evaluations}
                    </td>
                    <td>
                      {comparableMetrics.candidate.optimization.optimizer_work.energy_evaluations}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">gradient evaluations</th>
                    <td>
                      {comparableMetrics.baseline.optimization.optimizer_work.gradient_evaluations}
                    </td>
                    <td>
                      {comparableMetrics.candidate.optimization.optimizer_work.gradient_evaluations}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">final-state fidelity</th>
                    <td>{comparableMetrics.baseline.optimization.final_state_fidelity.toFixed(12)}</td>
                    <td>{comparableMetrics.candidate.optimization.final_state_fidelity.toFixed(12)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <dl className="mj-studio-contract">
              <div>
                <dt>baseline execution UUID</dt>
                <dd className="mj-mono-muted">{comparableMetrics.baseline.execution_id}</dd>
              </div>
              <div>
                <dt>candidate execution UUID</dt>
                <dd className="mj-mono-muted">{comparableMetrics.candidate.execution_id}</dd>
              </div>
            </dl>
            <p className="mj-mono-muted">
              {ja
                ? "wall timeは補助証拠であり、この統制比較の性能判定には使用しません。"
                : "Wall time is supplementary evidence and is not used to judge this controlled comparison."}
            </p>
          </div>
        ) : null}

        {state === "loading" ? <p role="status">{ja ? "検証中…" : "Verifying…"}</p> : null}
        {state === "error" && message ? <p role="alert">{message}</p> : null}
        <div className="mj-studio-actions">
          {!comparisonId && baselineExperimentId && candidateExperimentId ? (
            <button
              className="mj-primary-button"
              type="button"
              disabled={state === "loading"}
              onClick={() => void createAndFinalize()}
            >
              {ja ? "比較を検証してprivate保存" : "Verify and save private comparison"}
            </button>
          ) : null}
          {comparison ? (
            <button
              className="mj-secondary-button"
              type="button"
              disabled={state === "loading"}
              onClick={() => void reopen(comparison.id)}
            >
              {ja ? "保存済み比較を再表示" : "Reopen saved comparison"}
            </button>
          ) : null}
        </div>
        {message && state !== "error" ? (
          <footer className="mj-studio-footer" aria-live="polite"><span>{message}</span></footer>
        ) : null}
      </section>
    </main>
  );
}
