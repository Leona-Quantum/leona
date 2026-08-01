"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";

type CandidateSummary = {
  local_id: string;
  candidate_type: string;
  field_count: number;
  unknown_count: number;
  conflict_count: number;
};

type EnvelopeSummary = {
  id: string;
  envelope_sha256: string;
  input_bundle_sha256: string;
  provider: string;
  requested_model: string;
  served_model: string;
  machine_validation_state: string;
  human_review_state: "unreviewed";
  publication_eligible: false;
  materialization_eligible: false;
  candidates: CandidateSummary[];
  created_at: string | null;
};

type EvidenceItem = {
  evidence_id: string;
  kind: string;
  path: string;
  source_sha256: string;
  locator: string;
  declared_value: unknown;
  untrusted_text: string | null;
};

type CandidateField = {
  field: string;
  value: unknown;
  evidence_ids: string[];
};

type CandidateUnknown = {
  topic: string;
  reason: string;
  evidence_ids: string[];
};

type CandidateConflict = {
  topic: string;
  description: string;
  evidence_ids: string[];
};

type ReviewRecord = {
  id: string;
  disposition: "accepted" | "rejected" | "needs_resolution";
  reviewer_user_id: string;
  review_kind: "workspace_human_review";
  independence_state: "not_asserted";
  review_sha256: string;
  created_at: string | null;
};

type ReviewView = {
  envelope_id: string;
  envelope_sha256: string;
  candidate: {
    local_id: string;
    candidate_type: string;
    fields: CandidateField[];
    unknowns: CandidateUnknown[];
    conflicts: CandidateConflict[];
  };
  candidate_sha256: string;
  source_snapshot_sha256: string;
  evidence_bundle_sha256: string;
  evidence: EvidenceItem[];
  latest_review: ReviewRecord | null;
};

type LocalDecision = {
  decision: "" | "accept" | "reject" | "edit" | "acknowledge";
  editedJson: string;
  rationale: string;
};

type QueueItem = {
  envelope: EnvelopeSummary;
  candidate: CandidateSummary;
};

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    const code = (detail as { code?: unknown }).code;
    if (typeof message === "string" && typeof code === "string") {
      return `${message} (${code})`;
    }
  }
  return fallback;
}

function jsonDisplay(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

function initialDecisions(view: ReviewView): Record<string, LocalDecision> {
  const result: Record<string, LocalDecision> = {};
  for (const field of view.candidate.fields) {
    result[`field:${field.field}`] = {
      decision: "",
      editedJson: jsonDisplay(field.value),
      rationale: "",
    };
  }
  view.candidate.unknowns.forEach((_item, index) => {
    result[`unknown:${index}`] = { decision: "", editedJson: "", rationale: "" };
  });
  view.candidate.conflicts.forEach((_item, index) => {
    result[`conflict:${index}`] = { decision: "", editedJson: "", rationale: "" };
  });
  return result;
}

export function VqeResearchReview({ locale }: { locale: PublicLocale }) {
  const ja = locale === "ja";
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [view, setView] = useState<ReviewView | null>(null);
  const [decisions, setDecisions] = useState<Record<string, LocalDecision>>({});
  const [disposition, setDisposition] = useState<
    "accepted" | "rejected" | "needs_resolution"
  >("needs_resolution");
  const [overallRationale, setOverallRationale] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const response = await fetch("/api/vqe/research-candidates?limit=100", {
        cache: "no-store",
      });
      const payload = await response.json() as { envelopes?: EnvelopeSummary[] };
      if (!response.ok || !Array.isArray(payload.envelopes)) {
        throw new Error(errorMessage(payload, `review queue unavailable (${response.status})`));
      }
      const items = payload.envelopes.flatMap((envelope) =>
        envelope.candidates.map((candidate) => ({ envelope, candidate })),
      );
      setQueue(items);
      setSelectedKey((current) =>
        items.some((item) => `${item.envelope.id}/${item.candidate.local_id}` === current)
          ? current
          : items[0]
            ? `${items[0].envelope.id}/${items[0].candidate.local_id}`
            : "",
      );
      setState("ready");
    } catch (cause) {
      setState("error");
      setMessage(cause instanceof Error ? cause.message : "review queue unavailable");
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (!selectedKey) {
      setView(null);
      return;
    }
    let cancelled = false;
    const [envelopeId, candidateId] = selectedKey.split("/", 2);
    setView(null);
    setMessage(null);
    void fetch(
      `/api/vqe/research-candidates/${encodeURIComponent(envelopeId)}/${encodeURIComponent(candidateId)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = await response.json() as ReviewView;
        if (!response.ok) {
          throw new Error(errorMessage(payload, `candidate evidence unavailable (${response.status})`));
        }
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setView(payload);
        setDecisions(initialDecisions(payload));
        setDisposition(
          payload.candidate.unknowns.length || payload.candidate.conflicts.length
            ? "needs_resolution"
            : "accepted",
        );
        setOverallRationale("");
      })
      .catch((cause) => {
        if (!cancelled) {
          setMessage(cause instanceof Error ? cause.message : "candidate evidence unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  const evidenceById = useMemo(
    () => new Map(view?.evidence.map((item) => [item.evidence_id, item]) ?? []),
    [view],
  );
  const hasOpenIssues = Boolean(
    view && (view.candidate.unknowns.length || view.candidate.conflicts.length),
  );
  const subjects = useMemo(() => {
    if (!view) return [];
    return [
      ...view.candidate.fields.map((item) => ({
        id: `field:${item.field}`,
        kind: "field" as const,
        title: item.field,
        value: item.value,
        description: null,
        evidenceIds: item.evidence_ids,
      })),
      ...view.candidate.unknowns.map((item, index) => ({
        id: `unknown:${index}`,
        kind: "unknown" as const,
        title: item.topic,
        value: null,
        description: item.reason,
        evidenceIds: item.evidence_ids,
      })),
      ...view.candidate.conflicts.map((item, index) => ({
        id: `conflict:${index}`,
        kind: "conflict" as const,
        title: item.topic,
        value: null,
        description: item.description,
        evidenceIds: item.evidence_ids,
      })),
    ];
  }, [view]);

  function updateDecision(subjectId: string, patch: Partial<LocalDecision>) {
    setDecisions((current) => ({
      ...current,
      [subjectId]: { ...current[subjectId], ...patch },
    }));
  }

  async function saveReview() {
    if (!view) return;
    setBusy(true);
    setMessage(null);
    try {
      const serialized = subjects.map((subject) => {
        const local = decisions[subject.id];
        if (!local?.decision || !local.rationale.trim()) {
          throw new Error(
            ja
              ? `「${subject.title}」の判定と根拠を入力してください。`
              : `Choose a decision and rationale for “${subject.title}”.`,
          );
        }
        let editedValue: unknown = null;
        if (local.decision === "edit") {
          try {
            editedValue = JSON.parse(local.editedJson);
          } catch {
            throw new Error(
              ja
                ? `「${subject.title}」の編集値は有効なJSONではありません。`
                : `The edited value for “${subject.title}” is not valid JSON.`,
            );
          }
        }
        return {
          subject_id: subject.id,
          decision: local.decision,
          edited_value: editedValue,
          rationale: local.rationale.trim(),
        };
      });
      if (!overallRationale.trim()) {
        throw new Error(ja ? "レビュー全体の根拠を入力してください。" : "Enter an overall review rationale.");
      }
      const response = await fetch(
        `/api/vqe/research-candidates/${encodeURIComponent(view.envelope_id)}/reviews`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            candidate_local_id: view.candidate.local_id,
            expected_envelope_sha256: view.envelope_sha256,
            expected_candidate_sha256: view.candidate_sha256,
            expected_evidence_bundle_sha256: view.evidence_bundle_sha256,
            disposition,
            decisions: serialized,
            rationale: overallRationale.trim(),
          }),
        },
      );
      const payload = await response.json() as { review?: ReviewRecord };
      if (!response.ok || !payload.review) {
        throw new Error(errorMessage(payload, `review save failed (${response.status})`));
      }
      setView((current) => current ? { ...current, latest_review: payload.review ?? null } : current);
      setMessage(
        ja
          ? `非公開レビューを追記しました: ${payload.review.review_sha256}`
          : `Appended private review: ${payload.review.review_sha256}`,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "review save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mj-studio-page">
      <section className="mj-studio-main">
        <div className="mj-studio-main-head">
          <div className="mj-studio-title-block">
            <span className="mj-section-label">Atlas VQE · private human review</span>
            <h1>{ja ? "研究候補を証拠と照合" : "Review research candidates against evidence"}</h1>
          </div>
          <a className="mj-secondary-button" href="/studio?vqe=1">
            {ja ? "Workflowへ戻る" : "Back to workflows"}
          </a>
        </div>

        <div className="mj-studio-empty" role="note">
          <strong>{ja ? "workspace内レビュー — 独立レビューではありません" : "Workspace review — not an independent review"}</strong>
          <p>
            {ja
              ? "固定GitHub snapshotから再構築した証拠だけを使います。保存は追記型・非公開で、公開、materialize、性能主張は許可しません。"
              : "Only evidence reconstructed from the pinned GitHub snapshot is used. Saves are append-only and private; publication, materialization, and performance claims remain blocked."}
          </p>
        </div>

        {state === "loading" ? <p role="status">{ja ? "候補を読み込み中…" : "Loading candidates…"}</p> : null}
        {state === "error" ? <p role="alert">{message}</p> : null}
        {state === "ready" && queue.length === 0 ? (
          <p className="mj-studio-empty">{ja ? "レビュー可能な非公開候補はありません。" : "No private candidates are available for review."}</p>
        ) : null}

        {queue.length ? (
          <label className="mj-studio-field">
            <span>{ja ? "候補" : "Candidate"}</span>
            <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
              {queue.map((item) => {
                const key = `${item.envelope.id}/${item.candidate.local_id}`;
                return (
                  <option key={key} value={key}>
                    {item.candidate.local_id} · {item.candidate.candidate_type} · {item.envelope.provider}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}

        {view ? (
          <>
            <dl className="mj-studio-contract">
              <div><dt>candidate</dt><dd>{view.candidate.local_id}</dd></div>
              <div><dt>source snapshot</dt><dd>{view.source_snapshot_sha256}</dd></div>
              <div><dt>evidence bundle</dt><dd>{view.evidence_bundle_sha256}</dd></div>
              <div><dt>latest review</dt><dd>{view.latest_review?.disposition ?? "none"}</dd></div>
              <div><dt>independence</dt><dd>{view.latest_review?.independence_state ?? "not_asserted"}</dd></div>
              <div><dt>publication</dt><dd>blocked</dd></div>
            </dl>

            <div className="mj-vqe-review-list">
              {subjects.map((subject) => {
                const local = decisions[subject.id];
                return (
                  <article className="mj-vqe-review-card" key={subject.id}>
                    <div>
                      <span className="mj-section-label">{subject.kind}</span>
                      <h2>{subject.title}</h2>
                      {subject.kind === "field" ? <pre>{jsonDisplay(subject.value)}</pre> : <p>{subject.description}</p>}
                    </div>
                    <div className="mj-vqe-review-evidence">
                      <strong>{ja ? "引用された固定証拠" : "Cited immutable evidence"}</strong>
                      {subject.evidenceIds.length ? subject.evidenceIds.map((evidenceId) => {
                        const evidence = evidenceById.get(evidenceId);
                        return evidence ? (
                          <dl key={evidenceId}>
                            <div><dt>ID</dt><dd>{evidence.evidence_id}</dd></div>
                            <div><dt>path</dt><dd>{evidence.path}</dd></div>
                            <div><dt>locator</dt><dd>{evidence.locator}</dd></div>
                            <div><dt>source SHA</dt><dd>{evidence.source_sha256}</dd></div>
                            <div><dt>declared</dt><dd><pre>{jsonDisplay(evidence.declared_value)}</pre></dd></div>
                          </dl>
                        ) : <p role="alert" key={evidenceId}>{evidenceId} · unresolved</p>;
                      }) : <p>{ja ? "引用証拠なし（unknownとして記録）" : "No cited evidence (recorded as unknown)"}</p>}
                    </div>
                    <label className="mj-studio-field">
                      <span>{ja ? "判定" : "Decision"}</span>
                      <select
                        value={local?.decision ?? ""}
                        onChange={(event) => updateDecision(subject.id, {
                          decision: event.target.value as LocalDecision["decision"],
                        })}
                      >
                        <option value="">{ja ? "選択してください" : "Choose…"}</option>
                        {subject.kind === "field" ? (
                          <>
                            <option value="accept">accept</option>
                            <option value="reject">reject</option>
                            <option value="edit">edit</option>
                          </>
                        ) : <option value="acknowledge">acknowledge</option>}
                      </select>
                    </label>
                    {local?.decision === "edit" ? (
                      <label className="mj-studio-field">
                        <span>{ja ? "編集値（JSON）" : "Edited value (JSON)"}</span>
                        <textarea
                          rows={5}
                          value={local.editedJson}
                          onChange={(event) => updateDecision(subject.id, { editedJson: event.target.value })}
                        />
                      </label>
                    ) : null}
                    <label className="mj-studio-field">
                      <span>{ja ? "この判定の根拠" : "Rationale for this decision"}</span>
                      <textarea
                        rows={3}
                        maxLength={1000}
                        value={local?.rationale ?? ""}
                        onChange={(event) => updateDecision(subject.id, { rationale: event.target.value })}
                      />
                    </label>
                  </article>
                );
              })}
            </div>

            <div className="mj-vqe-review-submit">
              <label className="mj-studio-field">
                <span>{ja ? "全体判定" : "Overall disposition"}</span>
                <select
                  value={disposition}
                  onChange={(event) => setDisposition(event.target.value as typeof disposition)}
                >
                  <option value="accepted" disabled={hasOpenIssues}>accepted</option>
                  <option value="rejected">rejected</option>
                  <option value="needs_resolution">needs_resolution</option>
                </select>
              </label>
              {hasOpenIssues ? (
                <p className="mj-studio-empty" role="note">
                  {ja
                    ? "unknownまたはconflictが残るため、acceptedはfail-closedで禁止されています。"
                    : "Accepted is fail-closed while unknowns or conflicts remain."}
                </p>
              ) : null}
              <label className="mj-studio-field">
                <span>{ja ? "レビュー全体の根拠" : "Overall review rationale"}</span>
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={overallRationale}
                  onChange={(event) => setOverallRationale(event.target.value)}
                />
              </label>
              <div className="mj-studio-actions">
                <button className="mj-primary-button" type="button" disabled={busy} onClick={() => void saveReview()}>
                  {busy ? (ja ? "保存中…" : "Saving…") : (ja ? "非公開レビューを追記" : "Append private review")}
                </button>
                <button className="mj-secondary-button" type="button" disabled={busy} onClick={() => void loadQueue()}>
                  {ja ? "候補一覧を更新" : "Refresh queue"}
                </button>
              </div>
            </div>
          </>
        ) : state === "ready" && selectedKey ? <p role="status">{ja ? "証拠を再構築中…" : "Reconstructing evidence…"}</p> : null}

        {message && state !== "error" ? (
          <footer className="mj-studio-footer" aria-live="polite"><span>{message}</span></footer>
        ) : null}
      </section>
    </main>
  );
}
