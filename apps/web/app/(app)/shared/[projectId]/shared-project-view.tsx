"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ShareRefused,
  ShareVersionConflict,
  canContribute,
  contributeSharedArtifact,
  copySharedArtifact,
  hasMoved,
  leaveSharedProject,
  loadSharedProject,
  loadSharedProjectArtifacts,
  saveSharedVersion,
  type SharedProject,
} from "../../../../lib/project-shares";
import type { PublicLocale } from "../../../../lib/public-locale";
import { PROJECT_SHARE_COPY } from "../../../../lib/workspace-locale";

/** How often the header's revision is re-read while the page is open. */
const POLL_MS = 30_000;

interface SharedCircuit {
  id: string;
  title: string;
  currentVersionId: string | null;
  codeLang: string;
}

function toCircuit(value: unknown): SharedCircuit | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  return {
    id: row.id,
    title: row.title,
    currentVersionId: typeof row.current_version_id === "string" ? row.current_version_id : null,
    codeLang: typeof row.framework === "string" ? row.framework : "python",
  };
}

export function SharedProjectView({
  projectId,
  locale,
}: {
  projectId: string;
  locale: PublicLocale;
}) {
  const copy = PROJECT_SHARE_COPY[locale];
  const [project, setProject] = useState<SharedProject | null>(null);
  const [circuits, setCircuits] = useState<SharedCircuit[]>([]);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ShareVersionConflict | null>(null);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCode, setNewCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Two-step, because leaving is not undoable by the person doing it: only the
  // owner can grant the access back.
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // What the page was rendered from. Compared against the polled revision, and
  // held in a ref so the poller does not re-subscribe on every change.
  const seenRevision = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [header, rows] = await Promise.all([
        loadSharedProject(projectId),
        loadSharedProjectArtifacts(projectId),
      ]);
      setProject(header);
      seenRevision.current = header.revision;
      setChanged(false);
      setCircuits(rows.map(toCircuit).filter((row): row is SharedCircuit => row !== null));
      setFailed(false);
    } catch {
      // A revoked or expired grant answers 404 here, and that is not an error
      // state to retry — it is the share being over.
      setFailed(true);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (failed) return undefined;
    // Polling, not a socket. The signal is one timestamp and a stale one costs
    // a person half a minute of not knowing; a live channel for that is a
    // transport to run, monitor and pay for.
    const timer = setInterval(() => {
      void loadSharedProject(projectId)
        .then((header) => {
          if (hasMoved(seenRevision.current, header.revision)) setChanged(true);
        })
        .catch(() => {
          // A grant withdrawn while the page is open. Say so on the next
          // interaction rather than yanking the screen away mid-read.
          setFailed(true);
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [projectId, failed]);

  async function openCircuit(circuit: SharedCircuit) {
    setError(null);
    setNotice(null);
    setConflict(null);
    if (open === circuit.id) {
      setOpen(null);
      return;
    }
    if (!circuit.currentVersionId) {
      setOpen(circuit.id);
      setDraft("");
      setBaseVersionId(null);
      return;
    }
    try {
      const response = await fetch(
        `/api/shared/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(circuit.id)}/versions/${encodeURIComponent(circuit.currentVersionId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("unavailable");
      const version = (await response.json()) as { code?: unknown; id?: unknown };
      setDraft(typeof version.code === "string" ? version.code : "");
      setBaseVersionId(typeof version.id === "string" ? version.id : null);
      setOpen(circuit.id);
    } catch {
      setError(copy.loadFailed);
    }
  }

  async function save(circuit: SharedCircuit) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setConflict(null);
    try {
      await saveSharedVersion(projectId, circuit.id, {
        expectedCurrentVersionId: baseVersionId,
        code: draft,
        codeLang: circuit.codeLang,
      });
      setNotice(copy.saved);
      await load();
      // Cleared, not re-pointed. The obvious version of this reads the new
      // current id out of `circuits` — but `load()` calls `setCircuits`, and
      // `circuits` in this closure is still the array this render was built
      // from, so that reads the id from BEFORE the save and writes a stale
      // base back. The editor closes here and `openCircuit` re-reads the
      // current version when it is opened again, so there is nothing to carry
      // across; null is the honest value for "not editing anything".
      setBaseVersionId(null);
      setOpen(null);
    } catch (caught) {
      if (caught instanceof ShareVersionConflict) {
        // The draft is deliberately left in the textarea. The person typed it;
        // losing it to a refusal would be a second lost update caused by the
        // machinery that exists to prevent the first.
        setConflict(caught);
      } else if (caught instanceof ShareRefused) {
        setError(caught.message);
      } else {
        setError(copy.saveFailed);
      }
    } finally {
      setBusy(false);
    }
  }

  /** Load what the other person saved, so the next save is on top of it. */
  async function openTheirs(circuit: SharedCircuit) {
    if (!conflict?.currentVersionId) return;
    try {
      const response = await fetch(
        `/api/shared/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(circuit.id)}/versions/${encodeURIComponent(conflict.currentVersionId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("unavailable");
      const version = (await response.json()) as { code?: unknown };
      setDraft(typeof version.code === "string" ? version.code : "");
      setBaseVersionId(conflict.currentVersionId);
      setConflict(null);
      setNotice(null);
    } catch {
      setError(copy.loadFailed);
    }
  }

  async function addCircuit() {
    if (submitting || !project) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const title = newTitle.trim();
      await contributeSharedArtifact(projectId, {
        title,
        code: newCode,
        // The project's own framework is not a thing — an artifact carries one
        // and a project holds many. Python/Qiskit is the default everywhere else
        // a circuit is created here, so it is the default that surprises least.
        framework: "qiskit",
      });
      setNotice(copy.added(title));
      setAdding(false);
      setNewTitle("");
      setNewCode("");
      // Re-read rather than push the new row onto `circuits`: the header's count
      // and limit have both moved, and the Add button is derived from them.
      await load();
    } catch (caught) {
      setError(caught instanceof ShareRefused ? caught.message : copy.addFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function copyHere(circuit: SharedCircuit) {
    setCopying(circuit.id);
    setError(null);
    setNotice(null);
    try {
      await copySharedArtifact(projectId, circuit.id);
      setNotice(copy.copied(circuit.title));
    } catch (caught) {
      setError(caught instanceof ShareRefused ? caught.message : copy.copyFailed);
    } finally {
      setCopying(null);
    }
  }

  async function leave() {
    setLeaving(true);
    setError(null);
    try {
      await leaveSharedProject(projectId);
      // A full reload rather than a router push: this page is no longer
      // readable by this account, and the sidebar's own list of shared
      // projects is loaded once on mount in `shell.tsx`.
      window.location.assign("/studio");
    } catch {
      setError(copy.leaveFailed);
      setLeaving(false);
      setConfirmingLeave(false);
    }
  }

  if (failed) {
    return (
      <main className="mj-shared-project">
        <p className="mj-share-error">{copy.loadFailed}</p>
        <p className="mj-shared-project-actions">
          <a className="mj-secondary-button" href="/studio">
            {copy.backToStudio}
          </a>
        </p>
      </main>
    );
  }

  // Reserves the header's own height rather than collapsing to nothing, so the
  // page does not jump the moment the grant resolves. It used to render an
  // empty <main>, which is why arriving here flashed a blank column and then
  // pushed everything down.
  if (!project) {
    return (
      <main className="mj-shared-project" aria-busy="true">
        <span className="sr-only" role="status">{copy.sharedWithMe}</span>
        <div className="mj-shared-project-header">
          <span className="mj-skeleton mj-skeleton--eyebrow" />
          <span className="mj-skeleton mj-skeleton--title" />
          <span className="mj-skeleton mj-skeleton--copy" />
        </div>
        <div className="mj-shared-circuit-list">
          <span className="mj-skeleton mj-skeleton--panel" />
        </div>
      </main>
    );
  }

  return (
    <main className="mj-shared-project">
      {/* The way out sits at the top, where a back link belongs, instead of at
          the bottom of the page as a full-width bar. */}
      <p className="mj-shared-project-back">
        <a href="/studio">← {copy.backToStudio}</a>
      </p>

      <header className="mj-shared-project-header">
        <div className="mj-shared-project-identity">
          <div>
            <p className="mj-eyebrow">{copy.sharedWithMe}</p>
            <h1>{project.name}</h1>
          </div>
          {/* Leaving is a header action, not a bar across the content column:
              `.mj-shared-project` is a stretch column, so every direct-child
              button in it grew to the full 880px. */}
          {confirmingLeave ? null : (
            <button
              type="button"
              className="mj-secondary-button mj-shared-project-leave-open"
              onClick={() => setConfirmingLeave(true)}
            >
              {copy.leave}
            </button>
          )}
        </div>
        {/* Discrete facts rather than one dot-joined sentence that wrapped
            mid-clause. The bare circuit count is gone: `roomLeft` already reads
            "3 of 12 circuits", so on an editor grant the same number was
            printed twice in the same line. It stays as the whole fact for a
            viewer grant, which has no limit to state. */}
        <ul className="mj-shared-project-meta">
          <li>{copy.fromWorkspace(project.ownerWorkspaceName)}</li>
          {project.sharedByEmail ? (
            <li>{copy.sharedBy(project.sharedByDisplayName || project.sharedByEmail)}</li>
          ) : null}
          <li>
            {project.role === "editor" && project.artifactLimit > 0
              ? copy.roomLeft(project.artifactCount, project.artifactLimit)
              : copy.circuits(project.artifactCount)}
          </li>
          <li>
            <span className="mj-shared-project-role" data-role={project.role}>
              {project.role === "editor" ? copy.canEditTag : copy.readOnlyTag}
            </span>
          </li>
        </ul>
        {project.role === "editor" && !canContribute(project) && project.artifactLimit > 0 ? (
          <p className="mj-share-empty">{copy.projectFull}</p>
        ) : null}
        {confirmingLeave ? (
          <div className="mj-shared-project-leave" role="group" aria-label={copy.leaveConfirm}>
            <p>{copy.leaveConfirm}</p>
            <p className="mj-share-empty">{copy.leaveHelp}</p>
            <div className="mj-shared-project-leave-actions">
              <button
                type="button"
                className="mj-secondary-button"
                disabled={leaving}
                onClick={() => void leave()}
              >
                {leaving ? copy.leaving : copy.leave}
              </button>
              <button
                type="button"
                className="mj-secondary-button"
                disabled={leaving}
                onClick={() => setConfirmingLeave(false)}
              >
                {copy.leaveCancel}
              </button>
            </div>
          </div>
        ) : null}
      </header>

      {changed ? (
        <div className="mj-shared-project-changed" role="status">
          <span>{copy.changedElsewhere}</span>
          <button type="button" className="mj-secondary-button" onClick={() => void load()}>
            {copy.refresh}
          </button>
        </div>
      ) : null}

      {error ? <p className="mj-share-error">{error}</p> : null}
      {notice ? <p className="mj-share-notice">{notice}</p> : null}

      {canContribute(project) ? (
        adding ? (
          <div className="mj-shared-circuit-editor">
            <label htmlFor="mj-new-circuit-title">{copy.addCircuitTitleLabel}</label>
            <input
              id="mj-new-circuit-title"
              value={newTitle}
              placeholder={copy.addCircuitTitlePlaceholder}
              onChange={(event) => setNewTitle(event.target.value)}
            />
            <label htmlFor="mj-new-circuit-code">{copy.addCircuitCodeLabel}</label>
            <textarea
              id="mj-new-circuit-code"
              value={newCode}
              spellCheck={false}
              rows={12}
              onChange={(event) => setNewCode(event.target.value)}
            />
            <div className="mj-shared-circuit-actions">
              <button
                type="button"
                className="mj-primary-button"
                disabled={submitting || !newTitle.trim() || !newCode.trim()}
                onClick={() => void addCircuit()}
              >
                {submitting ? copy.addCircuitSubmitting : copy.addCircuitSubmit}
              </button>
              <button
                type="button"
                className="mj-secondary-button"
                disabled={submitting}
                onClick={() => setAdding(false)}
              >
                {copy.addCircuitCancel}
              </button>
            </div>
          </div>
        ) : (
          <p className="mj-shared-project-actions">
            <button type="button" className="mj-secondary-button" onClick={() => setAdding(true)}>
              {copy.addCircuit}
            </button>
          </p>
        )
      ) : null}

      {circuits.length === 0 ? (
        <p className="mj-share-empty">{copy.noCircuits}</p>
      ) : (
        <ul className="mj-shared-circuit-list">
          {circuits.map((circuit) => (
            <li key={circuit.id} className="mj-shared-circuit">
              <div className="mj-shared-circuit-row">
                <strong>{circuit.title}</strong>
                {/* Grouped so the two controls stay one aligned column down the
                    list instead of each finding its own edge — on a narrow
                    viewport the second one used to drop under the title while
                    the first stayed beside it. */}
                <span className="mj-shared-circuit-controls">
                  <button
                    type="button"
                    className="mj-secondary-button"
                    aria-expanded={open === circuit.id}
                    onClick={() => void openCircuit(circuit)}
                  >
                    {copy.open}
                  </button>
                  <button
                    type="button"
                    className="mj-secondary-button"
                    disabled={copying === circuit.id}
                    onClick={() => void copyHere(circuit)}
                  >
                    {copying === circuit.id ? copy.copying : copy.copyHere}
                  </button>
                </span>
              </div>

              {open === circuit.id ? (
                <div className="mj-shared-circuit-editor">
                  <textarea
                    value={draft}
                    spellCheck={false}
                    rows={16}
                    readOnly={project.role !== "editor"}
                    aria-label={circuit.title}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  {project.role === "editor" ? (
                    <div className="mj-shared-circuit-actions">
                      <button
                        type="button"
                        className="mj-primary-button"
                        disabled={busy}
                        onClick={() => void save(circuit)}
                      >
                        {busy ? copy.saving : copy.save}
                      </button>
                    </div>
                  ) : null}
                  {conflict ? (
                    <div className="mj-shared-circuit-conflict" role="alert">
                      <strong>{copy.conflictTitle}</strong>
                      <p>{copy.conflictBody}</p>
                      <button
                        type="button"
                        className="mj-secondary-button"
                        onClick={() => void openTheirs(circuit)}
                      >
                        {copy.reloadTheirs}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
