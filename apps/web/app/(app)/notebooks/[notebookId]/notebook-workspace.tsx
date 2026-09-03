"use client";

import type { components } from "@majorana/contracts-gen";
import { StageRail, type RailStage } from "@majorana/ui";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ChatMarkdown } from "../../../../components/chat-markdown";
import { NotebookEditor } from "../../../../components/notebook-editor";
import { NotebookView, type NotebookCellActionKind } from "../../../../components/notebook-view";
import { refusalSentence } from "../../../../lib/api-error";
import {
  applyCellEdit,
  cellsAreDirty,
  deleteCell,
  insertCellAfter,
  moveCell,
  specWithCells,
  type CellEdit,
} from "../../../../lib/notebook-editing";
import { notebookExportFilename } from "../../../../lib/notebook-export";
import { notebookCellViews, notebookStatusPill } from "../../../../lib/notebook-view";
import {
  notebookProgressFromEvents,
  type NotebookProgressEvent,
  type NotebookProgressStage,
} from "../../../../lib/notebook-progress";
import type { PublicLocale } from "../../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../../lib/workspace-locale";

type Notebook = components["schemas"]["Notebook"];
type NotebookVersion = components["schemas"]["NotebookVersion"];
type NotebookVersionSummary = components["schemas"]["NotebookVersionSummary"];
type NotebookTurn = components["schemas"]["NotebookTurn"];
type Cell = components["schemas"]["Cell"];

/** The one shape this page reads off the run-events SSE stream. Anything else
 * that stream carries (Run's own rich event vocabulary) is irrelevant here —
 * see lib/notebook-progress.ts for why this stays generic rather than naming
 * the pipeline's own stage ids. */
type WireEvent = {
  type: string;
  stage?: string | null;
  status?: string;
  duration_ms?: number;
};

function parseSseBlock(block: string): { id: string | null; data: string } | null {
  const lines = block.split("\n");
  if (lines.some((line) => line.startsWith(":"))) return null;
  const idLine = lines.find((line) => line.startsWith("id:"));
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return null;
  return { id: idLine ? idLine.slice("id:".length).trim() : null, data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toRailStage(stage: NotebookProgressStage, errorSummary: string): RailStage {
  if (stage.state === "fail") {
    return { id: stage.id, name: stage.id, elapsed: stage.elapsed, state: "fail", errorSummary };
  }
  return { id: stage.id, name: stage.id, elapsed: stage.elapsed, state: stage.state };
}

function download(content: Blob, filename: string) {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const RUNNING_STATUSES = new Set(["queued", "running"]);

export function NotebookWorkspace({ notebookId, locale = "en" }: { notebookId: string; locale?: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].notebooks;

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [notebookError, setNotebookError] = useState<string | null>(null);
  const [versions, setVersions] = useState<NotebookVersionSummary[]>([]);
  // `null` means "follow the notebook's current version" — the ordinary state,
  // including right after a chat-driven revision lands a new one. Picking a
  // version from the dropdown pins it here so browsing history does not get
  // silently yanked forward the next time this component reloads the notebook.
  const [pinnedSeq, setPinnedSeq] = useState<number | null>(null);
  const [version, setVersion] = useState<NotebookVersion | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [turns, setTurns] = useState<NotebookTurn[]>([]);
  const [turnsError, setTurnsError] = useState<string | null>(null);

  const [followedRunId, setFollowedRunId] = useState<string | null>(null);
  const [progressEvents, setProgressEvents] = useState<WireEvent[]>([]);

  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [downloading, setDownloading] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  // The editor's draft. `null` means "not editing" — distinct from an empty array,
  // which is a notebook the reader has deleted every cell from and is about to save.
  const [draftCells, setDraftCells] = useState<Cell[] | null>(null);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The version an in-flight save is writing. Pinned once its run finishes, rather
  // than immediately: a queued version has no spec to render, and if the run FAILS the
  // notebook's `current_version_id` never moves — so following "current" would show
  // the reader their previous version and hide the failure they need to see.
  const authoredSeq = useRef<number | null>(null);

  const reloadSeq = useRef(0);

  function loadNotebook() {
    const seq = ++reloadSeq.current;
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || typeof payload.id !== "string") {
          throw new Error(refusalSentence(payload) ?? copy.loadFailed);
        }
        return payload as unknown as Notebook;
      })
      .then((loaded) => {
        if (seq !== reloadSeq.current) return;
        setNotebook(loaded);
        setNotebookError(null);
        setTitleDraft((current) => (editingTitle ? current : loaded.title));
        if (RUNNING_STATUSES.has(loaded.latest_status) && loaded.latest_run_id) {
          setFollowedRunId(loaded.latest_run_id);
        }
      })
      .catch((cause) => {
        if (seq !== reloadSeq.current) return;
        setNotebookError(cause instanceof Error ? cause.message : copy.loadFailed);
      });
  }

  function loadVersions() {
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/versions`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (response.ok && isRecord(payload) && Array.isArray(payload.items)) {
          setVersions(payload.items as NotebookVersionSummary[]);
        }
      })
      .catch(() => {});
  }

  function loadTurns() {
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/turns`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || !Array.isArray(payload.items)) {
          throw new Error(refusalSentence(payload) ?? copy.chatLoadFailed);
        }
        setTurns(payload.items as NotebookTurn[]);
        setTurnsError(null);
      })
      .catch((cause) => {
        setTurnsError(cause instanceof Error ? cause.message : copy.chatLoadFailed);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- notebookId change is a hard reset; copy.* are stable strings for the active locale
  useEffect(() => {
    setNotebook(null);
    setVersion(null);
    setVersions([]);
    setPinnedSeq(null);
    setTurns([]);
    setFollowedRunId(null);
    setProgressEvents([]);
    setDraftCells(null);
    setFocusedCellId(null);
    loadNotebook();
    loadVersions();
    loadTurns();
  }, [notebookId]);

  // Follow the notebook's current version unless the reader pinned one from the picker.
  const selectedSeq = pinnedSeq ?? notebook?.current_version_seq ?? null;

  useEffect(() => {
    if (selectedSeq === null) {
      setVersion(null);
      return;
    }
    let active = true;
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/versions/${selectedSeq}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || typeof payload.seq !== "number") {
          throw new Error(refusalSentence(payload) ?? copy.loadFailed);
        }
        return payload as unknown as NotebookVersion;
      })
      .then((loaded) => {
        if (active) {
          setVersion(loaded);
          setVersionError(null);
        }
      })
      .catch((cause) => {
        if (active) setVersionError(cause instanceof Error ? cause.message : copy.loadFailed);
      });
    return () => {
      active = false;
    };
  }, [notebookId, selectedSeq, copy.loadFailed]);

  // Follow the active run's SSE stream (copied from live-run.tsx's reader —
  // see that file for the reconnect/backoff reasoning this intentionally
  // keeps simple for a secondary surface).
  useEffect(() => {
    if (!followedRunId) return;
    const controller = new AbortController();
    setProgressEvents([]);

    async function consume() {
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(followedRunId as string)}/events/stream`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let terminal = false;
        while (!terminal) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            const parsed = parseSseBlock(block);
            if (!parsed) continue;
            const event = JSON.parse(parsed.data) as WireEvent;
            setProgressEvents((current) => [...current, event]);
            if (event.type === "run.finished" || event.type === "run.error") {
              terminal = true;
              loadNotebook();
              loadVersions();
              loadTurns();
              if (authoredSeq.current !== null) {
                setPinnedSeq(authoredSeq.current);
                authoredSeq.current = null;
              }
            }
          }
        }
      } catch {
        // A dropped connection here just stops the live activity list from
        // updating; the notebook itself is unaffected, and the next poll of
        // this page (or a manual refresh) picks up the finished state.
      }
    }

    void consume();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadNotebook/loadVersions/loadTurns close over notebookId only
  }, [followedRunId]);

  async function sendTurn(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRecord(payload) || !isRecord(payload.turn) || !isRecord(payload.version)) {
        throw new Error(refusalSentence(payload) ?? copy.chatSendFailed);
      }
      const runId = typeof payload.run_id === "string" ? payload.run_id : null;
      loadTurns();
      loadVersions();
      // The turn response carries no `notebook` field (`CreateNotebookTurnResponse`
      // is `{ turn, version, run_id }`) — reload it too so the header's status
      // pill flips to "generating" as soon as the revise run is queued.
      loadNotebook();
      if (runId) setFollowedRunId(runId);
      setMessage("");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : copy.chatSendFailed);
    } finally {
      setSending(false);
    }
  }

  // ------------------------------------------------------------------ editing

  const editing = draftCells !== null;
  const originalCells = (version?.spec?.cells ?? []) as Cell[];
  const dirty = editing && cellsAreDirty(originalCells, draftCells ?? []);

  function startEditing() {
    setDraftCells(originalCells.map((cell) => ({ ...cell })));
    setFocusedCellId(null);
    setActionError(null);
  }

  function stopEditing() {
    setDraftCells(null);
    setFocusedCellId(null);
  }

  function discardEdits() {
    if (dirty && !window.confirm(copy.discardConfirm)) return;
    stopEditing();
  }

  function editCell(cellId: string, edit: CellEdit) {
    setDraftCells((current) => (current === null ? current : applyCellEdit(current, cellId, edit)));
  }

  function insertCell(afterId: string | null, kind: Cell["kind"]) {
    setDraftCells((current) => {
      if (current === null) return current;
      const { cells: next, id } = insertCellAfter(current, afterId, kind);
      setFocusedCellId(id);
      return next;
    });
  }

  function removeCell(cellId: string) {
    setDraftCells((current) => (current === null ? current : deleteCell(current, cellId)));
    setFocusedCellId((current) => (current === cellId ? null : current));
  }

  function shiftCell(cellId: string, direction: "up" | "down") {
    setDraftCells((current) => (current === null ? current : moveCell(current, cellId, direction)));
  }

  /** Save the draft as a new user-authored version. `runUntil` is "Run to here". */
  async function saveDraft({ execute, runUntil }: { execute: boolean; runUntil?: string | null }) {
    const spec = version?.spec;
    if (!spec || draftCells === null || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: specWithCells(spec, draftCells),
          message: "",
          execute,
          run_until: runUntil ?? null,
        }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRecord(payload) || !isRecord(payload.version)) {
        // `title` is what the API's problem+json puts the sentence in — the parse
        // error from a source edit, or the reason two inputs were refused.
        throw new Error(refusalSentence(payload) ?? copy.saveFailed);
      }
      const created = payload.version as unknown as NotebookVersionSummary;
      const runId = typeof payload.run_id === "string" ? payload.run_id : null;
      stopEditing();
      loadNotebook();
      loadVersions();
      loadTurns();
      if (runId) {
        authoredSeq.current = created.seq;
        setFollowedRunId(runId);
      } else {
        // No run to wait for: the version is already `ready`, so show it now.
        setPinnedSeq(created.seq);
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : copy.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  // The browser's own guard. It fires only on a real unload (tab close, reload,
  // external link) — an in-app route change does not reach it, which is why
  // `discardEdits` asks separately rather than relying on this.
  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendTurn(message);
  }

  function cellAction(cellId: string, action: NotebookCellActionKind) {
    const templates: Record<NotebookCellActionKind, string> = {
      explain: `Explain cell ${cellId} in simpler terms.`,
      simplify: `Simplify cell ${cellId}.`,
      figure: `Add a figure after cell ${cellId}.`,
      exercise: `Turn cell ${cellId} into an exercise.`,
    };
    void sendTurn(templates[action]);
  }

  async function saveTitle() {
    if (!notebook || savingTitle) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === notebook.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRecord(payload) || typeof payload.id !== "string") {
        throw new Error(refusalSentence(payload) ?? copy.titleEditFailed);
      }
      setNotebook(payload as unknown as Notebook);
      setEditingTitle(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : copy.titleEditFailed);
    } finally {
      setSavingTitle(false);
    }
  }

  async function downloadVersion() {
    if (!notebook || !version || downloading) return;
    setDownloading(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/notebooks/${encodeURIComponent(notebookId)}/versions/${version.seq}/export`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(copy.downloadFailed);
      const blob = await response.blob();
      download(blob, notebookExportFilename(notebook.slug, version.seq));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : copy.downloadFailed);
    } finally {
      setDownloading(false);
    }
  }

  async function runAgain() {
    if (rerunning) return;
    setRerunning(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/run`, { method: "POST" });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRecord(payload)) {
        throw new Error(refusalSentence(payload) ?? copy.runAgainFailed);
      }
      const runId = typeof payload.run_id === "string" ? payload.run_id : null;
      loadNotebook();
      loadVersions();
      if (runId) setFollowedRunId(runId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : copy.runAgainFailed);
    } finally {
      setRerunning(false);
    }
  }

  if (notebookError && !notebook) {
    return <div className="mj-notebook-workspace-empty mj-library-empty" role="alert"><strong>{notebookError}</strong></div>;
  }
  if (!notebook) {
    return <div className="mj-notebook-workspace-empty mj-library-empty" role="status"><strong>{copy.loading}</strong></div>;
  }

  const pill = notebookStatusPill(notebook.latest_status);
  const isGenerating = RUNNING_STATUSES.has(notebook.latest_status);
  const cells = notebookCellViews(version?.spec?.cells, version?.report);
  const stages = notebookProgressFromEvents(progressEvents as NotebookProgressEvent[]);
  // Editing is offered only on the newest version, and only when nothing is running:
  // an edit is saved as the NEXT version, so branching from an older one would
  // silently discard everything after it, and `_assert_not_in_flight` would refuse a
  // save made while a run is going anyway — better not to offer the button.
  const latestSeq = versions.length > 0 ? versions[versions.length - 1].seq : null;
  const canEdit =
    !isGenerating &&
    version !== null &&
    version.status === "ready" &&
    version.spec !== null &&
    latestSeq !== null &&
    version.seq === latestSeq;

  return (
    <main className="mj-notebook-workspace">
      <header className="mj-notebook-workspace-header">
        <div className="mj-notebook-workspace-title">
          {editingTitle ? (
            <form className="mj-notebook-title-edit-form" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
              <input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                disabled={savingTitle}
                autoFocus
              />
              <button className="mj-secondary-button" type="submit" disabled={savingTitle}>
                {savingTitle ? copy.creating : copy.saveTitle}
              </button>
            </form>
          ) : (
            <h1>
              <button
                type="button"
                className="mj-notebook-title-edit"
                onClick={() => { setTitleDraft(notebook.title); setEditingTitle(true); }}
              >
                {notebook.title}
              </button>
            </h1>
          )}
          <div className="mj-notebook-workspace-meta">
            <span className="mj-notebook-kind-badge">{copy.kindOption[notebook.kind]}</span>
            <span className={`mj-notebook-status-pill mj-notebook-status-pill--${pill}`}>{copy.statusPill[pill]}</span>
          </div>
        </div>
        <div className="mj-notebook-workspace-actions">
          {versions.length > 0 ? (
            <label className="mj-notebook-version-picker mj-filter-select">
              <span className="sr-only">{copy.versionPickerLabel}</span>
              <select
                value={selectedSeq ?? ""}
                onChange={(event) => setPinnedSeq(Number(event.target.value))}
              >
                {versions.map((item) => (
                  <option key={item.id} value={item.seq}>{copy.versionLabel(item.seq)}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            className="mj-secondary-button"
            type="button"
            disabled={!version?.ipynb || downloading}
            onClick={() => void downloadVersion()}
          >
            {downloading ? copy.creating : copy.download}
          </button>
          <button
            className="mj-secondary-button"
            type="button"
            disabled={rerunning || isGenerating}
            onClick={() => void runAgain()}
          >
            {rerunning || isGenerating ? copy.running : copy.runAgain}
          </button>
          {canEdit || editing ? (
            <button
              className="mj-secondary-button"
              type="button"
              disabled={saving}
              onClick={() => (editing ? discardEdits() : startEditing())}
            >
              {editing ? copy.editExit : copy.edit}
            </button>
          ) : null}
        </div>
      </header>

      {notebookError ? <p role="alert" className="mj-notebook-workspace-error">{notebookError}</p> : null}
      {actionError ? <p role="alert" className="mj-notebook-workspace-error">{actionError}</p> : null}

      {isGenerating && stages.length > 0 ? (
        <section className="mj-notebook-progress" aria-label={copy.progressLabel}>
          <StageRail stages={stages.map((stage) => toRailStage(stage, copy.runAgainFailed))} />
        </section>
      ) : null}

      <div className="mj-notebook-workspace-body">
        <section className="mj-notebook-workspace-notebook">
          {version?.status === "failed" ? (
            <div className="mj-notebook-version-failed" role="alert">
              <p><strong>{copy.versionFailedHeadline}</strong></p>
              {version.error ? <p>{version.error}</p> : null}
              <p>{copy.versionFailedHint}</p>
            </div>
          ) : null}
          {versionError ? <p role="alert" className="mj-notebook-workspace-error">{versionError}</p> : null}
          {editing && draftCells !== null ? (
            <>
              <NotebookEditor
                cells={draftCells}
                locale={locale}
                focusedCellId={focusedCellId}
                busy={saving}
                onEdit={editCell}
                onInsert={insertCell}
                onDelete={removeCell}
                onMove={shiftCell}
                onFocusCell={setFocusedCellId}
                onRunToHere={(cellId) => void saveDraft({ execute: true, runUntil: cellId })}
              />
              <div className="mj-notebook-edit-bar" role="group" aria-label={copy.edit}>
                <button
                  className="mj-primary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void saveDraft({ execute: true })}
                >
                  {saving ? copy.saving : copy.saveAndRun}
                </button>
                <button
                  className="mj-secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void saveDraft({ execute: false })}
                >
                  {copy.saveWithoutRunning}
                </button>
                <button
                  className="mj-secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => discardEdits()}
                >
                  {copy.discard}
                </button>
              </div>
            </>
          ) : version ? (
            <NotebookView
              cells={cells}
              locale={locale}
              framework={notebook.framework?.name ?? "qiskit"}
              onCellAction={cellAction}
            />
          ) : !isGenerating ? (
            <p className="mj-notebook-workspace-empty-notebook">{copy.loadFailed}</p>
          ) : null}
          {!editing && version?.warnings && version.warnings.length > 0 ? (
            <section className="mj-notebook-structure-notes" aria-label={copy.structureNotesLabel}>
              <h2>{copy.structureNotesLabel}</h2>
              <p className="mj-notebook-structure-notes-hint">{copy.structureNotesHint}</p>
              <ul>
                {version.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {version?.review ? (
            <section className="mj-notebook-review">
              <h2>{copy.reviewLabel} — {copy.reviewVerdict[version.review.verdict]}</h2>
              {version.review.findings && version.review.findings.length > 0 ? (
                <div>
                  <h3>{copy.reviewFindingsLabel}</h3>
                  <ul>
                    {version.review.findings.map((finding, index) => (
                      <li key={index}>
                        <strong>{copy.reviewSeverity[finding.severity]}</strong>
                        {finding.cell_id ? ` (${finding.cell_id})` : ""}: {finding.finding}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {version.review.what_this_notebook_does_not_establish && version.review.what_this_notebook_does_not_establish.length > 0 ? (
                <div>
                  <h3>{copy.reviewNotEstablishedLabel}</h3>
                  <ul>
                    {version.review.what_this_notebook_does_not_establish.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}
        </section>

        <aside className="mj-notebook-workspace-chat" aria-label={copy.chatLabel}>
          <h2>{copy.chatLabel}</h2>
          {turnsError ? <p role="alert">{turnsError}</p> : null}
          {turns.length === 0 ? <p className="mj-notebook-chat-empty">{copy.chatEmpty}</p> : null}
          <div className="mj-chat-thread mj-notebook-chat-thread">
            {turns.map((turn) => (
              <div key={turn.id} className="mj-chat-turn">
                <div className={`mj-chat-message ${turn.role === "user" ? "mj-chat-message--user" : "mj-chat-message--assistant"}`}>
                  {turn.role === "nala" ? <ChatMarkdown source={turn.content} /> : <p>{turn.content}</p>}
                </div>
              </div>
            ))}
          </div>
          {isGenerating ? <p className="mj-notebook-chat-progress" role="status">{copy.progressLabel}</p> : null}
          <form className="mj-notebook-chat-composer" onSubmit={submitMessage}>
            <label>
              <span className="sr-only">{copy.chatLabel}</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={copy.chatPlaceholder}
                rows={2}
              />
            </label>
            <button className="mj-primary-button" type="submit" disabled={sending || !message.trim()}>
              {sending ? copy.chatSending : copy.chatSend}
            </button>
          </form>
        </aside>
      </div>
    </main>
  );
}
