"use client";

import { useEffect, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import type { VqeFramework } from "../../../lib/vqe-proof";
import { resolveInitialWorkflowId } from "../../../lib/vqe-workflow-launch";

type Workflow = {
  artifact_version_id: string;
  semantic_key: string;
  machine_validation_state: string;
  review_state: string;
};

function parseWorkflows(value: unknown): Workflow[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as { components?: unknown }).components;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (
      typeof item.artifact_version_id !== "string"
      || typeof item.semantic_key !== "string"
      || typeof item.machine_validation_state !== "string"
      || typeof item.review_state !== "string"
    ) return [];
    return [{
      artifact_version_id: item.artifact_version_id,
      semantic_key: item.semantic_key,
      machine_validation_state: item.machine_validation_state,
      review_state: item.review_state,
    }];
  });
}

export function VqeExperimentLauncher({
  initialFramework,
  initialWorkflowId,
  initialWorkflowKey,
  locale,
}: {
  initialFramework: VqeFramework;
  initialWorkflowId?: string;
  initialWorkflowKey?: string;
  locale: PublicLocale;
}) {
  const ja = locale === "ja";
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowId, setWorkflowId] = useState(initialWorkflowId ?? "");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void fetch("/api/atlas/workflows?limit=50", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`workflow registry unavailable (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        const parsed = parseWorkflows(payload);
        setWorkflows(parsed);
        const resolvedId = resolveInitialWorkflowId(parsed, {
          artifactVersionId: initialWorkflowId,
          semanticKey: initialWorkflowKey,
        });
        setWorkflowId(resolvedId ?? "");
        if ((initialWorkflowId || initialWorkflowKey) && !resolvedId) {
          setMessage(
            ja
              ? "指定されたWorkflowはRegistryで解決できません。"
              : "The requested workflow could not be resolved in the Registry.",
          );
        }
        setState("ready");
      })
      .catch((cause) => {
        setState("error");
        setMessage(cause instanceof Error ? cause.message : "workflow registry unavailable");
      });
  }, [initialWorkflowId, initialWorkflowKey, ja]);

  async function createExperiment() {
    if (!workflowId) return;
    setCreating(true);
    setMessage(null);
    try {
      const response = await fetch("/api/vqe/experiments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ workflow_artifact_version_id: workflowId }),
      });
      const payload = await response.json() as { id?: string; detail?: unknown; error?: string };
      if (!response.ok || !payload.id) {
        const detail = typeof payload.detail === "string"
          ? payload.detail
          : payload.error ?? JSON.stringify(payload.detail);
        throw new Error(detail || `experiment creation failed (${response.status})`);
      }
      window.location.assign(
        `/studio?vqeExperiment=${encodeURIComponent(
          payload.id,
        )}&vqeFramework=${encodeURIComponent(initialFramework)}`,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "experiment creation failed");
      setCreating(false);
    }
  }

  const selected = workflows.find((item) => item.artifact_version_id === workflowId);
  return (
    <main className="mj-studio-page">
      <section className="mj-studio-main">
        <div className="mj-studio-main-head">
          <div className="mj-studio-title-block">
            <span className="mj-section-label">Atlas VQE · workflow launcher</span>
            <h1>{ja ? "再現可能なVQE実験を作成" : "Create a reproducible VQE experiment"}</h1>
          </div>
          <a className="mj-secondary-button" href="/repository">
            {ja ? "Atlasへ戻る" : "Back to Atlas"}
          </a>
        </div>
        <div className="mj-studio-empty" role="note">
          <strong>{ja ? "実行前に科学仕様を固定します" : "Scientific identity is frozen before execution"}</strong>
          <p>
            {ja
              ? "Workflowのportable仕様とRegistry解決を保存してから、QiskitまたはPennyLaneの実行を別々に作成します。"
              : "The portable workflow specification and registry resolution are persisted before separate Qiskit or PennyLane executions are created."}
          </p>
        </div>
        {state === "loading" ? <p role="status">{ja ? "Workflowを読み込み中…" : "Loading workflows…"}</p> : null}
        {state === "error" ? <p role="alert">{message}</p> : null}
        {state === "ready" && workflows.length === 0 ? (
          <p className="mj-studio-empty">{ja ? "利用可能なWorkflowはありません。" : "No workflows are available."}</p>
        ) : null}
        {workflows.length > 0 ? (
          <label className="mj-studio-field">
            <span>Workflow</span>
            <select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>
              {workflows.map((workflow) => (
                <option key={workflow.artifact_version_id} value={workflow.artifact_version_id}>
                  {workflow.semantic_key}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selected ? (
          <dl className="mj-studio-contract">
            <div><dt>machine validation</dt><dd>{selected.machine_validation_state}</dd></div>
            <div><dt>human review</dt><dd>{selected.review_state}</dd></div>
            <div><dt>Registry UUID</dt><dd className="mj-mono-muted">{selected.artifact_version_id}</dd></div>
          </dl>
        ) : null}
        <div className="mj-studio-actions">
          <button
            className="mj-primary-button"
            type="button"
            disabled={!workflowId || creating}
            onClick={() => void createExperiment()}
          >
            {creating
              ? (ja ? "作成中…" : "Creating…")
              : (ja ? "実験を作成" : "Create experiment")}
          </button>
        </div>
        {message && state !== "error" ? <p role="alert">{message}</p> : null}
      </section>
    </main>
  );
}
