"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ShareRefused,
  ShareVersionConflict,
  canContribute,
  contributeSharedArtifact,
  copySharedArtifact,
  hasMoved,
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

  if (failed) {
    return (
      <main className="mj-shared-project">
        <p className="mj-share-error">{copy.loadFailed}</p>
        <a className="mj-secondary-button" href="/studio">
          {copy.backToStudio}
        </a>
      </main>
    );
  }

  if (!project) return <main className="mj-shared-project" aria-busy="true" />;

  return (
    <main className="mj-shared-project">
      <header className="mj-shared-project-header">
        <p className="mj-eyebrow">{copy.sharedWithMe}</p>
        <h1>{project.name}</h1>
        <p className="mj-shared-project-meta">
          {copy.fromWorkspace(project.ownerWorkspaceName)}
          {project.sharedByEmail
            ? ` · ${copy.sharedBy(project.sharedByDisplayName || project.sharedByEmail)}`
            : ""}
          {` · ${copy.circuits(project.artifactCount)}`}
          {project.role === "editor" && project.artifactLimit > 0
            ? ` · ${copy.roomLeft(project.artifactCount, project.artifactLimit)}`
            : ""}
        </p>
        <p className="mj-shared-project-role">
          {project.role === "editor" ? copy.canEditTag : copy.readOnlyTag}
        </p>
        {project.role === "editor" && !canContribute(project) && project.artifactLimit > 0 ? (
          <p className="mj-share-empty">{copy.projectFull}</p>
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
          <button type="button" className="mj-secondary-button" onClick={() => setAdding(true)}>
            {copy.addCircuit}
          </button>
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

      <a className="mj-secondary-button" href="/studio">
        {copy.backToStudio}
      </a>
    </main>
  );
}
