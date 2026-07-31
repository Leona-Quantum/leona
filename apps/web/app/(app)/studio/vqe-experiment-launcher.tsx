"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import type { VqeFramework } from "../../../lib/vqe-proof";
import { resolveInitialWorkflowId } from "../../../lib/vqe-workflow-launch";

type Workflow = {
  artifact_version_id: string;
  semantic_key: string;
  machine_validation_state: string;
  review_state: string;
  execution_status?: string;
};

type Component = {
  artifact_version_id: string;
  component_type: string;
  semantic_key: string;
  normalized_spec_sha256: string;
};

type SavedSwap = {
  workflow_artifact_version_id: string;
  workflow_semantic_key: string;
  replayed: boolean;
  execution_status:
    | "blocked_until_runtime_qualified"
    | "private_qualification_candidate";
  visibility: "private";
};

const PRIVATE_EXECUTABLE_OPTIMIZERS = new Map([
  ["optimizer.slsqp.v1", "SLSQP"],
  ["optimizer.cobyla.v1", "COBYLA"],
]);
const H2_UCCSD_MIGRATION = "h2_fixed_excitation_slsqp_to_uccsd_slsqp";
const H2_HARDWARE_EFFICIENT_MIGRATION =
  "h2_uccsd_slsqp_to_hardware_efficient_slsqp";

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
    const spec = item.spec_json;
    const executionStatus =
      spec && typeof spec === "object"
        && typeof (spec as Record<string, unknown>).execution_status === "string"
        ? (spec as Record<string, string>).execution_status
        : undefined;
    return [{
      artifact_version_id: item.artifact_version_id,
      semantic_key: item.semantic_key,
      machine_validation_state: item.machine_validation_state,
      review_state: item.review_state,
      execution_status: executionStatus,
    }];
  });
}

function parseComponents(value: unknown): Component[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as { components?: unknown }).components;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (
      typeof item.artifact_version_id !== "string"
      || typeof item.component_type !== "string"
      || typeof item.semantic_key !== "string"
      || typeof item.normalized_spec_sha256 !== "string"
    ) return [];
    return [{
      artifact_version_id: item.artifact_version_id,
      component_type: item.component_type,
      semantic_key: item.semantic_key,
      normalized_spec_sha256: item.normalized_spec_sha256,
    }];
  });
}

export function VqeExperimentLauncher({
  initialFramework,
  initialWorkflowId,
  initialWorkflowKey,
  initialMigration,
  initialSwapComponentKey,
  locale,
}: {
  initialFramework: VqeFramework;
  initialWorkflowId?: string;
  initialWorkflowKey?: string;
  initialMigration?: string;
  initialSwapComponentKey?: string;
  locale: PublicLocale;
}) {
  const ja = locale === "ja";
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowId, setWorkflowId] = useState(initialWorkflowId ?? "");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingSwap, setSavingSwap] = useState(false);
  const [savedSwap, setSavedSwap] = useState<SavedSwap | null>(null);
  const swapIdempotencyKey = useRef<string | null>(null);
  const uccsdMigrationIdempotencyKey = useRef<string | null>(null);
  const hardwareEfficientMigrationIdempotencyKey = useRef<string | null>(null);

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

  async function saveControlledSwap() {
    if (
      !workflowId
      || !initialSwapComponentKey
      || !PRIVATE_EXECUTABLE_OPTIMIZERS.has(initialSwapComponentKey)
    ) return;
    setSavingSwap(true);
    setMessage(null);
    try {
      const componentResponse = await fetch(
        "/api/atlas/components?component_type=parameter_optimizer&limit=200",
        { cache: "no-store" },
      );
      if (!componentResponse.ok) {
        throw new Error(`component registry unavailable (${componentResponse.status})`);
      }
      const components = parseComponents(await componentResponse.json());
      const candidate = components.find(
        (component) =>
          component.component_type === "parameter_optimizer"
          && component.semantic_key === initialSwapComponentKey,
      );
      if (!candidate) {
        throw new Error(
          ja
            ? "選択したoptimizer componentの固定版をRegistryで解決できません。"
            : "The pinned optimizer component could not be resolved in the Registry.",
        );
      }
      if (!swapIdempotencyKey.current) {
        swapIdempotencyKey.current = crypto.randomUUID();
      }
      const response = await fetch("/api/atlas/workflows/swaps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": swapIdempotencyKey.current,
        },
        body: JSON.stringify({
          baseline_workflow_artifact_version_id: workflowId,
          baseline_template_key: "workflow.h2.fixed_excitation.v1",
          changed_role: "parameter_optimizer",
          candidate_component_semantic_key: initialSwapComponentKey,
          candidate_component_spec_sha256: candidate.normalized_spec_sha256,
          configuration: {},
          evaluator_provider: initialFramework,
        }),
      });
      const payload = await response.json() as Partial<SavedSwap> & {
        detail?: unknown;
        error?: string;
      };
      if (
        !response.ok
        || typeof payload.workflow_artifact_version_id !== "string"
        || typeof payload.workflow_semantic_key !== "string"
        || (
          payload.execution_status !== "private_qualification_candidate"
          && payload.execution_status !== "blocked_until_runtime_qualified"
        )
        || payload.visibility !== "private"
      ) {
        const detail = typeof payload.detail === "string"
          ? payload.detail
          : payload.error ?? JSON.stringify(payload.detail);
        throw new Error(detail || `workflow swap save failed (${response.status})`);
      }
      const saved: SavedSwap = {
        workflow_artifact_version_id: payload.workflow_artifact_version_id,
        workflow_semantic_key: payload.workflow_semantic_key,
        replayed: payload.replayed === true,
        execution_status: payload.execution_status,
        visibility: payload.visibility,
      };
      setSavedSwap(saved);
      setWorkflows((current) => [
        ...current.filter(
          (workflow) =>
            workflow.artifact_version_id !== saved.workflow_artifact_version_id,
        ),
        {
          artifact_version_id: saved.workflow_artifact_version_id,
          semantic_key: saved.workflow_semantic_key,
          machine_validation_state:
            saved.execution_status === "private_qualification_candidate"
              ? "machine_validated"
              : "unvalidated",
          review_state: "unreviewed",
          execution_status: saved.execution_status,
        },
      ]);
      setWorkflowId(saved.workflow_artifact_version_id);
      setMessage(saved.execution_status === "private_qualification_candidate"
        ? (ja
          ? "privateな統制交換Workflowを保存しました。S12認定候補として実行できますが、公開と性能主張は停止中です。"
          : "The private controlled-swap workflow was saved. It may run as an S12 qualification candidate; publication and performance claims remain blocked.")
        : (ja
          ? "privateな構造化Workflowを保存しました。実行可能な設定への解決が未完了のため実行は停止中です。"
          : "The private structured workflow was saved. Execution remains blocked because no executable configuration has been resolved."));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "workflow swap save failed");
    } finally {
      setSavingSwap(false);
    }
  }

  async function saveAnsatzMigration() {
    if (
      !workflowId
      || ![H2_UCCSD_MIGRATION, H2_HARDWARE_EFFICIENT_MIGRATION].includes(
        initialMigration ?? "",
      )
    ) return;
    setSavingSwap(true);
    setMessage(null);
    try {
      const componentResponse = await fetch(
        "/api/atlas/components?component_type=parameter_optimizer&limit=200",
        { cache: "no-store" },
      );
      if (!componentResponse.ok) {
        throw new Error(`component registry unavailable (${componentResponse.status})`);
      }
      const components = parseComponents(await componentResponse.json());
      const slsqp = components.find(
        (component) =>
          component.component_type === "parameter_optimizer"
          && component.semantic_key === "optimizer.slsqp.v1",
      );
      if (!slsqp) {
        throw new Error(
          ja
            ? "UCCSD migrationに必要な固定SLSQP componentをRegistryで解決できません。"
            : "The pinned SLSQP component required by the UCCSD migration could not be resolved.",
        );
      }
      if (!swapIdempotencyKey.current) {
        swapIdempotencyKey.current = crypto.randomUUID();
      }
      const prerequisiteResponse = await fetch("/api/atlas/workflows/swaps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": swapIdempotencyKey.current,
        },
        body: JSON.stringify({
          baseline_workflow_artifact_version_id: workflowId,
          baseline_template_key: "workflow.h2.fixed_excitation.v1",
          changed_role: "parameter_optimizer",
          candidate_component_semantic_key: "optimizer.slsqp.v1",
          candidate_component_spec_sha256: slsqp.normalized_spec_sha256,
          configuration: {},
          evaluator_provider: initialFramework,
        }),
      });
      const prerequisite = await prerequisiteResponse.json() as Partial<SavedSwap> & {
        detail?: unknown;
        error?: string;
      };
      if (
        !prerequisiteResponse.ok
        || typeof prerequisite.workflow_artifact_version_id !== "string"
        || prerequisite.execution_status !== "private_qualification_candidate"
        || prerequisite.visibility !== "private"
      ) {
        const detail = typeof prerequisite.detail === "string"
          ? prerequisite.detail
          : prerequisite.error ?? JSON.stringify(prerequisite.detail);
        throw new Error(
          detail || `SLSQP migration prerequisite failed (${prerequisiteResponse.status})`,
        );
      }
      if (!uccsdMigrationIdempotencyKey.current) {
        uccsdMigrationIdempotencyKey.current = crypto.randomUUID();
      }
      const uccsdResponse = await fetch("/api/atlas/workflows/ansatz-migrations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": uccsdMigrationIdempotencyKey.current,
        },
        body: JSON.stringify({
          baseline_workflow_artifact_version_id:
            prerequisite.workflow_artifact_version_id,
          migration: H2_UCCSD_MIGRATION,
          evaluator_provider: initialFramework,
        }),
      });
      const uccsdPayload = await uccsdResponse.json() as Partial<SavedSwap> & {
        detail?: unknown;
        error?: string;
      };
      if (
        !uccsdResponse.ok
        || typeof uccsdPayload.workflow_artifact_version_id !== "string"
        || typeof uccsdPayload.workflow_semantic_key !== "string"
        || uccsdPayload.execution_status !== "private_qualification_candidate"
        || uccsdPayload.visibility !== "private"
      ) {
        const detail = typeof uccsdPayload.detail === "string"
          ? uccsdPayload.detail
          : uccsdPayload.error ?? JSON.stringify(uccsdPayload.detail);
        throw new Error(
          detail || `UCCSD ansatz migration save failed (${uccsdResponse.status})`,
        );
      }
      let payload = uccsdPayload;
      if (initialMigration === H2_HARDWARE_EFFICIENT_MIGRATION) {
        if (!hardwareEfficientMigrationIdempotencyKey.current) {
          hardwareEfficientMigrationIdempotencyKey.current = crypto.randomUUID();
        }
        const hardwareEfficientResponse = await fetch(
          "/api/atlas/workflows/ansatz-migrations",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": hardwareEfficientMigrationIdempotencyKey.current,
            },
            body: JSON.stringify({
              baseline_workflow_artifact_version_id:
                uccsdPayload.workflow_artifact_version_id,
              migration: H2_HARDWARE_EFFICIENT_MIGRATION,
              evaluator_provider: initialFramework,
            }),
          },
        );
        const hardwareEfficientPayload = await hardwareEfficientResponse.json() as
          Partial<SavedSwap> & { detail?: unknown; error?: string };
        if (
          !hardwareEfficientResponse.ok
          || typeof hardwareEfficientPayload.workflow_artifact_version_id !== "string"
          || typeof hardwareEfficientPayload.workflow_semantic_key !== "string"
          || hardwareEfficientPayload.execution_status
            !== "blocked_until_runtime_qualified"
          || hardwareEfficientPayload.visibility !== "private"
        ) {
          const detail = typeof hardwareEfficientPayload.detail === "string"
            ? hardwareEfficientPayload.detail
            : hardwareEfficientPayload.error
              ?? JSON.stringify(hardwareEfficientPayload.detail);
          throw new Error(
            detail
              || `hardware-efficient ansatz migration save failed (${hardwareEfficientResponse.status})`,
          );
        }
        payload = hardwareEfficientPayload;
      }
      if (
        typeof payload.workflow_artifact_version_id !== "string"
        || typeof payload.workflow_semantic_key !== "string"
        || (
          payload.execution_status !== "private_qualification_candidate"
          && payload.execution_status !== "blocked_until_runtime_qualified"
        )
        || payload.visibility !== "private"
      ) {
        throw new Error("ansatz migration response violated the workflow contract");
      }
      const saved: SavedSwap = {
        workflow_artifact_version_id: payload.workflow_artifact_version_id,
        workflow_semantic_key: payload.workflow_semantic_key,
        replayed: payload.replayed === true,
        execution_status: payload.execution_status,
        visibility: payload.visibility,
      };
      setSavedSwap(saved);
      setWorkflows((current) => [
        ...current.filter(
          (workflow) =>
            workflow.artifact_version_id !== saved.workflow_artifact_version_id,
        ),
        {
          artifact_version_id: saved.workflow_artifact_version_id,
          semantic_key: saved.workflow_semantic_key,
          machine_validation_state: "machine_validated",
          review_state: "unreviewed",
          execution_status: saved.execution_status,
        },
      ]);
      setWorkflowId(saved.workflow_artifact_version_id);
      setMessage(
        initialMigration === H2_HARDWARE_EFFICIENT_MIGRATION
          ? (ja
            ? "privateなHardware-Efficient capability migrationを保存しました。固定したRY–CX構造とSLSQP設定はadapterで検証済みですが、Linux/amd64 OCI runtimeは未認定です。保存と再表示のみ可能で、実行・公開・性能主張は停止中です。"
            : "The private hardware-efficient capability migration was saved. Its frozen RY–CX structure and SLSQP configuration are adapter-tested, but the Linux/amd64 OCI runtime is not yet qualified. Save and reopen are available; execution, publication, and performance claims remain blocked.")
          : (ja
            ? "privateなUCCSD capability migrationを保存しました。Ansatzと従属するcompilation protocolが変わり、adaptive専用roleはnot_applicableになります。これは一部品交換ではありません。公開と性能主張は停止中です。"
            : "The private UCCSD capability migration was saved. The ansatz and its dependent compilation protocol change, while adaptive-only roles become not applicable. This is not a one-component swap. Publication and performance claims remain blocked."),
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "ansatz migration save failed");
    } finally {
      setSavingSwap(false);
    }
  }

  const selected = workflows.find((item) => item.artifact_version_id === workflowId);
  const swapRequested =
    typeof initialSwapComponentKey === "string"
    && PRIVATE_EXECUTABLE_OPTIMIZERS.has(initialSwapComponentKey);
  const migrationRequested = [
    H2_UCCSD_MIGRATION,
    H2_HARDWARE_EFFICIENT_MIGRATION,
  ].includes(initialMigration ?? "");
  const hardwareEfficientMigrationRequested =
    initialMigration === H2_HARDWARE_EFFICIENT_MIGRATION;
  const swapOptimizerName = initialSwapComponentKey
    ? PRIVATE_EXECUTABLE_OPTIMIZERS.get(initialSwapComponentKey)
    : undefined;
  const executionBlocked =
    selected?.execution_status === "blocked_until_runtime_qualified";
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
            <div>
              <dt>execution</dt>
              <dd>{selected.execution_status ?? "registry qualified"}</dd>
            </div>
            <div><dt>Registry UUID</dt><dd className="mj-mono-muted">{selected.artifact_version_id}</dd></div>
          </dl>
        ) : null}
        <div className="mj-studio-actions">
          {(swapRequested || migrationRequested) && !savedSwap ? (
            <button
              className="mj-primary-button"
              type="button"
              disabled={!workflowId || savingSwap}
              onClick={() =>
                void (migrationRequested
                  ? saveAnsatzMigration()
                  : saveControlledSwap())}
            >
              {savingSwap
                ? (ja ? "保存中…" : "Saving…")
                : migrationRequested
                  ? (ja
                    ? `${hardwareEfficientMigrationRequested ? "Hardware-Efficient" : "UCCSD"} migrationをprivate保存`
                    : `Save private ${hardwareEfficientMigrationRequested ? "hardware-efficient" : "UCCSD"} migration`)
                  : (ja
                    ? `${swapOptimizerName ?? "optimizer"}交換をprivate保存`
                    : `Save private ${swapOptimizerName ?? "optimizer"} swap`)}
            </button>
          ) : (
            <button
              className="mj-primary-button"
              type="button"
              disabled={!workflowId || creating || executionBlocked}
              onClick={() => void createExperiment()}
            >
              {creating
                ? (ja ? "作成中…" : "Creating…")
                : (ja ? "実験を作成" : "Create experiment")}
            </button>
          )}
          {savedSwap ? (
            <a
              className="mj-secondary-button"
              href={`/studio?vqe=1&vqeWorkflow=${encodeURIComponent(
                savedSwap.workflow_artifact_version_id,
              )}&vqeProvider=${encodeURIComponent(initialFramework)}`}
            >
              {ja ? "保存したWorkflowを再表示" : "Reopen saved workflow"}
            </a>
          ) : null}
        </div>
        {message && state !== "error" ? <p role="alert">{message}</p> : null}
      </section>
    </main>
  );
}
