"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import {
  capabilityFromExperiment,
  comparableResources,
  latestSuccess,
  parseVqeExecutions,
  type VqeCapability,
  type VqeExecution,
  type VqeFramework,
} from "../../../lib/vqe-proof";

const ACTIVE = new Set(["planned", "queued", "running"]);

export function VqeProofPanel({
  experimentId,
  initialFramework,
  locale,
}: {
  experimentId: string;
  initialFramework: VqeFramework;
  locale: PublicLocale;
}) {
  const ja = locale === "ja";
  const [framework, setFramework] = useState<VqeFramework>(initialFramework);
  const [capability, setCapability] = useState<VqeCapability | null>(null);
  const [executions, setExecutions] = useState<VqeExecution[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "cancel" | "materialize" | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [experimentResponse, executionResponse] = await Promise.all([
        fetch(`/api/vqe/experiments/${encodeURIComponent(experimentId)}`, {
          cache: "no-store",
        }),
        fetch(`/api/vqe/experiments/${encodeURIComponent(experimentId)}/executions`, {
          cache: "no-store",
        }),
      ]);
      if (!experimentResponse.ok) {
        throw new Error(`experiment identity unavailable (${experimentResponse.status})`);
      }
      if (!executionResponse.ok) {
        throw new Error(`execution evidence unavailable (${executionResponse.status})`);
      }
      setCapability(capabilityFromExperiment(await experimentResponse.json()));
      setExecutions(parseVqeExecutions(await executionResponse.json()));
      setState("ready");
    } catch (cause) {
      setState("error");
      setMessage(cause instanceof Error ? cause.message : "execution evidence unavailable");
    }
  }, [experimentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasActive = executions.some((item) => ACTIVE.has(item.status));
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [hasActive, refresh]);

  const selected = useMemo(
    () => [...executions].reverse().find((item) => item.framework === framework) ?? null,
    [executions, framework],
  );
  const success = selected ? latestSuccess(selected) : null;
  const resources = success ? comparableResources(success) : null;

  async function mutate(action: "start" | "cancel" | "materialize") {
    if (action === "start" && capability === null) return;
    setBusy(action);
    setMessage(null);
    const path = action === "start"
      ? `/api/vqe/experiments/${experimentId}/executions`
      : action === "materialize" && selected
        ? `/api/vqe/executions/${selected.id}/materialize`
        : `/api/vqe/experiments/${experimentId}/${action}`;
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(action === "start" ? { "Idempotency-Key": crypto.randomUUID() } : {}),
        },
        body: action === "start"
          ? JSON.stringify({
              requested_capability: capability,
              preferred_framework: framework,
            })
          : "{}",
      });
      const payload = await response.json() as { detail?: unknown; error?: string; artifact_version_id?: string };
      if (!response.ok) {
        const detail = typeof payload.detail === "string"
          ? payload.detail
          : payload.error ?? JSON.stringify(payload.detail);
        throw new Error(detail || `${action} failed (${response.status})`);
      }
      setMessage(action === "materialize"
        ? `${ja ? "非公開候補を保存しました" : "Private candidate saved"}: ${payload.artifact_version_id ?? ""}`
        : ja ? "要求を受け付けました" : "Request accepted");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `${action} failed`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mj-studio-page">
      <section className="mj-studio-main">
        <div className="mj-studio-main-head">
          <div className="mj-studio-title-block">
            <span className="mj-section-label">Atlas VQE · Private qualification</span>
            <h1>
              {capability === "h2_sto3g_uccsd_v1"
                ? "H₂ STO-3G UCCSD private qualification"
                : "H₂ STO-3G actual-VQE proof"}
            </h1>
            <p className="mj-mono-muted">{experimentId}</p>
          </div>
          <a className="mj-secondary-button" href="/studio">
            {ja ? "回路Studioへ戻る" : "Back to circuit Studio"}
          </a>
        </div>

        <div className="mj-studio-empty" role="note">
          <strong>{ja ? "研究候補 — 公開結果ではありません" : "Research candidate — not a public result"}</strong>
          <p>
            {ja
              ? "独立科学レビューはOwner判断で免除されています。runtime資格状態は実行ごとに表示し、公開実行・公開結果・性能主張は停止中です。保存物はprivate候補のままです。"
              : "Independent scientific review is owner-waived. Runtime qualification is shown per execution; public execution, public results, and performance claims remain blocked. Materialized evidence stays private."}
          </p>
        </div>

        <label className="mj-studio-field">
          <span>{ja ? "候補フレームワーク" : "Candidate framework"}</span>
          <select value={framework} onChange={(event) => setFramework(event.target.value as VqeFramework)}>
            <option value="qiskit">Qiskit 1.4.6</option>
            <option value="pennylane">PennyLane 0.45.1</option>
          </select>
        </label>

        {state === "loading" ? <p className="mj-studio-empty" role="status">{ja ? "証拠を読み込み中…" : "Loading evidence…"}</p> : null}
        {state === "error" ? <p className="mj-studio-empty" role="alert">{message}</p> : null}
        {selected ? (
          <div className="mj-studio-inspector-card">
            <span className="mj-section-label">{selected.framework} · {selected.status}</span>
            <dl className="mj-studio-contract">
              <div><dt>review</dt><dd>{selected.review_state}</dd></div>
              <div><dt>runtime</dt><dd>{selected.production_runtime_status}</dd></div>
              <div><dt>public</dt><dd>{selected.public_execution}</dd></div>
              {success ? (
                <>
                  <div><dt>Resource protocol</dt><dd>Canonical ansatz decomposition</dd></div>
                  <div><dt>Energy (Ha)</dt><dd>{success.best_energy_ha.toPrecision(13)}</dd></div>
                  <div><dt>|error| (Ha)</dt><dd>{success.absolute_error_ha.toExponential(3)}</dd></div>
                  <div><dt>Fidelity</dt><dd>{success.final_state_fidelity.toPrecision(13)}</dd></div>
                  <div><dt>CNOT</dt><dd>{resources?.two_qubit_gate_count ?? "—"}</dd></div>
                  <div><dt>Depth</dt><dd>{resources?.depth ?? "—"}</dd></div>
                  <div><dt>Parameters</dt><dd>{resources?.parameter_count ?? "—"}</dd></div>
                </>
              ) : null}
            </dl>
            {resources ? (
              <p className="mj-mono-muted">
                {ja
                  ? "CNOT/Depthはansatzのみの共通分解protocol値です。参照状態・測定・hardware最適化・routingを含みません。"
                  : "CNOT/Depth are common-protocol ansatz-only decomposition metrics. They exclude reference-state preparation, measurement, hardware optimization, and routing."}
              </p>
            ) : null}
            <p className="mj-mono-muted">{selected.runtime_image_digest}</p>
            {selected.observations.filter((item) => item.status === "failed").map((item) => (
              <p role="alert" key={item.id}>{item.failure_code ?? "runtime_failure"} · attempt {item.attempt}</p>
            ))}
          </div>
        ) : state === "ready" ? <p className="mj-studio-empty">{ja ? "このフレームワークの実行はまだありません。" : "No execution exists for this framework."}</p> : null}

        <div className="mj-studio-actions">
          <button className="mj-primary-button" type="button" disabled={busy !== null || Boolean(selected) || capability === null} onClick={() => void mutate("start")}>
            {busy === "start"
              ? (ja ? "開始中…" : "Starting…")
              : capability === "h2_sto3g_uccsd_v1"
                ? (ja ? "private認定候補を実行" : "Run private qualification candidate")
                : (ja ? "ローカル候補を実行" : "Run local candidate")}
          </button>
          <button className="mj-secondary-button" type="button" disabled={busy !== null || !hasActive} onClick={() => void mutate("cancel")}>
            {ja ? "実行を中止" : "Cancel"}
          </button>
          <button className="mj-secondary-button" type="button" disabled={busy !== null || selected?.status !== "succeeded"} onClick={() => void mutate("materialize")}>
            {ja ? "private候補として保存" : "Save private candidate"}
          </button>
          <button className="mj-secondary-button" type="button" disabled={busy !== null} onClick={() => void refresh()}>
            {ja ? "更新" : "Refresh"}
          </button>
        </div>
        {message && state !== "error" ? <footer className="mj-studio-footer" aria-live="polite"><span>{message}</span></footer> : null}
      </section>
    </main>
  );
}
