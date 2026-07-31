"use client";

import { useEffect, useMemo, useState } from "react";
import {
  archiveArtifact,
  artifactFromResource,
  deleteArtifact,
  getLibraryArtifact,
  loadLibraryArtifacts,
  loadStarredLibraryArtifactIds,
  toggleLibraryArtifactStar,
  type LibraryArtifact,
  type LibraryStatus,
} from "../../../lib/library-data";
import { LibraryIcon, MoreIcon, SearchIcon, StarIcon } from "../../../components/icons";
import type { PublicLocale } from "../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";

export function LibraryStudio({ demoMode = false, locale = "en" }: { demoMode?: boolean; locale?: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].library;
  const [artifacts, setArtifacts] = useState<LibraryArtifact[]>([]);
  const [query, setQuery] = useState("");
  const [framework, setFramework] = useState("all");
  const [status, setStatus] = useState<"all" | LibraryStatus>("all");
  const [deleteTarget, setDeleteTarget] = useState<LibraryArtifact | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  function refreshArtifacts() {
    setArtifacts(loadLibraryArtifacts({ includeDemo: demoMode }));
  }

  function handleArchive(artifact: LibraryArtifact) {
    archiveArtifact(artifact.id, artifact);
    refreshArtifacts();
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Awaited: the dialog stays open and the row stays visible unless the
      // server actually deleted it. Silently closing on failure is how the old
      // localStorage-only delete pretended to work.
      await deleteArtifact(deleteTarget.id);
      setDeleteTarget(null);
      refreshArtifacts();
    } catch {
      setDeleteError(
        locale === "ja"
          ? "削除できませんでした。もう一度お試しください。"
          : "Could not delete this artifact. Please try again.",
      );
    } finally {
      setDeleting(false);
    }
  }

  function handleStar(id: string) {
    const starred = toggleLibraryArtifactStar(id);
    setStarredIds((current) => {
      const next = new Set(current);
      if (starred) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  useEffect(() => {
    let active = true;
    setArtifacts(loadLibraryArtifacts({ includeDemo: demoMode }));
    setStarredIds(loadStarredLibraryArtifactIds());
    const handleLibraryChange = () => {
      if (!active) return;
      setStarredIds(loadStarredLibraryArtifactIds());
    };
    window.addEventListener("majorana:library", handleLibraryChange);
    if (demoMode) return () => {
      active = false;
      window.removeEventListener("majorana:library", handleLibraryChange);
    };
    void fetch("/api/artifacts", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Artifact API unavailable");
        return (await response.json()) as unknown;
      })
      .then((payload) => {
        if (!active || !Array.isArray(payload) || payload.length === 0) return;
        const remote = payload.flatMap(artifactFromResource);
        const local = loadLibraryArtifacts();
        const byId = new Map([...local, ...remote].map((artifact) => [artifact.id, artifact]));
        setArtifacts([...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      })
      .catch(() => {
        // The demo remains useful when the API is not configured on a preview deploy.
      });
    return () => {
      active = false;
      window.removeEventListener("majorana:library", handleLibraryChange);
    };
  }, [demoMode]);

  const frameworks = useMemo(
    () => ["all", ...new Set(artifacts.map((artifact) => artifact.framework))],
    [artifacts],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return artifacts.filter((artifact) => {
      const matchesQuery =
        !normalized ||
        [artifact.title, artifact.family, artifact.framework, artifact.description, ...artifact.tags]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return matchesQuery && (framework === "all" || artifact.framework === framework) && (status === "all" || artifact.status === status);
    });
  }, [artifacts, framework, query, status]);
  const runHref = demoMode ? "/demo?view=run" : "/run";
  const statusOptions: Array<{ value: "all" | LibraryStatus; label: string }> = [
    { value: "all", label: copy.all },
    { value: "verified", label: copy.verified },
    { value: "structural", label: copy.structural },
    { value: "verified_caveats", label: copy.caveats },
    { value: "inconclusive", label: copy.inconclusive },
    { value: "legacy_unknown", label: copy.legacyUnknown },
    { value: "stale", label: copy.stale },
    { value: "failed", label: copy.failed },
  ];

  return (
    <div className="mj-library-page">
      <div className="mj-library-scroll">
        <div className="mj-workspace-content">
          <header className="mj-page-header">
            <div>
              <div className="mj-library-title-row">
                <LibraryIcon size={20} />
                <h1 className="mj-page-title">{copy.title}</h1>
              </div>
              <p className="mj-page-lede">{copy.lede}</p>
            </div>
            <div className="mj-artifact-actions">
              <a className="mj-secondary-button" href={demoMode ? "/demo?view=library" : "/studio"}>{copy.openStudio}</a>
              <a className="mj-primary-button" href={runHref}>{copy.newRun}</a>
            </div>
          </header>

          <section className="mj-library-toolbar" aria-label={copy.filterArtifacts}>
            <label className="mj-library-search">
              <SearchIcon size={16} />
              <span className="sr-only">{copy.search}</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} />
            </label>
            <label className="mj-filter-select">
              <span className="sr-only">{copy.framework}</span>
              <select value={framework} onChange={(event) => setFramework(event.target.value)}>
                {frameworks.map((option) => <option key={option} value={option}>{option === "all" ? copy.framework : option}</option>)}
              </select>
            </label>
            <label className="mj-filter-select">
              <span className="sr-only">{copy.verification}</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as "all" | LibraryStatus)}>
                {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.value === "all" ? copy.verification : option.label}</option>)}
              </select>
            </label>
            <button className="mj-icon-button" type="button" aria-label={locale === "ja" ? "その他の絞り込み" : "More filters"} title={locale === "ja" ? "その他の絞り込み" : "More filters"}>
              <MoreIcon size={16} />
            </button>
          </section>

          <div className="mj-library-meta">
            <span>{filtered.length} {copy.artifacts}</span>
          </div>

          <section className="mj-library-table-wrap" aria-labelledby="artifact-list-title">
            <h2 className="sr-only" id="artifact-list-title">{copy.savedArtifacts}</h2>
            <div className="mj-library-table" role="table">
              <div className="mj-library-row mj-library-row--header" role="row">
                <span role="columnheader">{locale === "ja" ? "名前" : "Name"}</span>
                <span role="columnheader">{copy.framework}</span>
                <span role="columnheader">{locale === "ja" ? "状態" : "Status"}</span>
                <span role="columnheader">{locale === "ja" ? "更新" : "Updated"}</span>
                <span aria-hidden="true" />
              </div>
              {filtered.length ? filtered.map((artifact) => <ArtifactRow artifact={artifact} demoMode={demoMode} locale={locale} starred={starredIds.has(artifact.id)} onToggleStar={handleStar} onArchive={handleArchive} onDelete={setDeleteTarget} key={artifact.id} />) : (
                <div className="mj-library-empty" role="row">
                  <strong>{copy.noMatch}</strong>
                  <span>{copy.noMatchBody}</span>
                  <a className="mj-secondary-button" href={runHref}>{copy.startRun}</a>
                </div>
              )}
            </div>
          </section>

          {demoMode ? <p className="mj-library-footer-note">{copy.previewFooter}</p> : null}
        </div>
      </div>
      {deleteTarget ? (
        <div className="mj-delete-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}>
          <section className="mj-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="mj-library-delete-title">
            <p className="mj-eyebrow">{copy.title}</p>
            <h2 id="mj-library-delete-title">{copy.deleteConfirmTitle}</h2>
            <p>{copy.deleteWarning(deleteTarget.title)}</p>
            {deleteError ? <p role="alert" className="mj-delete-dialog-error">{deleteError}</p> : null}
            <div className="mj-delete-dialog-actions">
              <button className="mj-secondary-button" type="button" disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteError(null); }}>{locale === "ja" ? "キャンセル" : "Cancel"}</button>
              <button className="mj-danger-button" type="button" disabled={deleting} onClick={() => void handleDelete()}>{copy.delete}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactRow({ artifact, demoMode, locale, starred, onToggleStar, onArchive, onDelete }: { artifact: LibraryArtifact; demoMode: boolean; locale: PublicLocale; starred: boolean; onToggleStar: (id: string) => void; onArchive: (artifact: LibraryArtifact) => void; onDelete: (artifact: LibraryArtifact) => void }) {
  const copy = WORKSPACE_COPY[locale].library;
  return (
    <div className="mj-library-row mj-library-row--artifact" role="row">
      <div className="mj-library-name-cell" role="cell">
        <button className={`mj-star-toggle mj-star-toggle--icon${starred ? " is-starred" : ""}`} type="button" aria-label={starred ? copy.unstar : copy.star} aria-pressed={starred} title={starred ? copy.unstar : copy.star} onClick={() => onToggleStar(artifact.id)}>
          <StarIcon size={16} filled={starred} />
        </button>
        <a href={demoMode ? "/demo?view=library" : `/studio?artifact=${encodeURIComponent(artifact.id)}`}>
          <span>
          <strong>{artifact.title}</strong>
          <small>{artifact.family} · {artifact.tags.slice(0, 2).join(" · ")}</small>
          </span>
        </a>
      </div>
      <span role="cell" className="mj-library-mono">{artifact.framework}</span>
      <span role="cell"><StatusLabel status={artifact.status} locale={locale} /></span>
      <span role="cell" className="mj-library-date">{formatDate(artifact.updatedAt, locale, copy.unknown)}</span>
      <span role="cell" className="mj-library-row-actions">
        <a href={`/run?artifact=${encodeURIComponent(artifact.id)}`}>{copy.askInRun}</a>
        {!demoMode ? <>
          <button type="button" onClick={() => onArchive(artifact)}>{copy.archive}</button>
          <button className="is-danger" type="button" onClick={() => onDelete(artifact)}>{copy.delete}</button>
        </> : null}
      </span>
    </div>
  );
}

function StatusLabel({ status, locale }: { status: LibraryStatus; locale: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].library;
  const label =
    status === "verified"
      ? copy.verified
      : status === "structural"
        ? copy.structural
        : status === "verified_caveats"
          ? copy.caveats
          : status === "inconclusive"
            ? copy.inconclusive
            : status === "legacy_unknown"
              ? copy.legacyUnknown
              : status === "stale"
                ? copy.stale
                : copy.failed;
  return <span className={`mj-library-status mj-library-status--${status}`}><span aria-hidden="true">{status === "failed" ? "×" : status === "verified" ? "✓" : "–"}</span>{label}</span>;
}

function formatDate(value: string, locale: PublicLocale, unknown: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return unknown;
  return date.toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US", { month: "short", day: "numeric", year: "numeric" });
}
