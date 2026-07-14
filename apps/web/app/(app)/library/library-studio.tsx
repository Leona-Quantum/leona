"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getLibraryArtifact,
  loadLibraryArtifacts,
  type LibraryArtifact,
  type LibraryStatus,
} from "../../../lib/library-data";
import { LibraryIcon, MoreIcon, SearchIcon } from "../../../components/icons";

const STATUS_OPTIONS: Array<{ value: "all" | LibraryStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "verified_caveats", label: "Caveats" },
  { value: "failed", label: "Failed" },
];

export function LibraryStudio({ demoMode = false }: { demoMode?: boolean }) {
  const [artifacts, setArtifacts] = useState<LibraryArtifact[]>([]);
  const [query, setQuery] = useState("");
  const [framework, setFramework] = useState("all");
  const [status, setStatus] = useState<"all" | LibraryStatus>("all");

  useEffect(() => {
    let active = true;
    setArtifacts(loadLibraryArtifacts({ includeDemo: demoMode }));
    if (demoMode) return;
    void fetch("/api/artifacts", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Artifact API unavailable");
        return (await response.json()) as unknown;
      })
      .then((payload) => {
        if (!active || !Array.isArray(payload) || payload.length === 0) return;
        const remote = payload.flatMap(toLibraryArtifact);
        const local = loadLibraryArtifacts();
        const byId = new Map([...local, ...remote].map((artifact) => [artifact.id, artifact]));
        setArtifacts([...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      })
      .catch(() => {
        // The demo remains useful when the API is not configured on a preview deploy.
      });
    return () => {
      active = false;
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

  return (
    <div className="mj-library-page">
      <div className="mj-library-scroll">
        <div className="mj-workspace-content">
          <header className="mj-page-header">
            <div>
              <div className="mj-library-title-row">
                <LibraryIcon size={20} />
                <h1 className="mj-page-title">Library</h1>
              </div>
              <p className="mj-page-lede">Saved circuits, versions, and verification evidence. Open an artifact in Studio to edit or simulate it.</p>
            </div>
            <div className="mj-artifact-actions">
              <a className="mj-secondary-button" href={demoMode ? "/demo?view=library" : "/studio"}>Open Studio</a>
              <a className="mj-primary-button" href={runHref}>New run</a>
            </div>
          </header>

          <section className="mj-library-toolbar" aria-label="Filter artifacts">
            <label className="mj-library-search">
              <SearchIcon size={16} />
              <span className="sr-only">Search artifacts</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search artifacts…" />
            </label>
            <label className="mj-filter-select">
              <span className="sr-only">Framework</span>
              <select value={framework} onChange={(event) => setFramework(event.target.value)}>
                {frameworks.map((option) => <option key={option} value={option}>{option === "all" ? "Framework" : option}</option>)}
              </select>
            </label>
            <label className="mj-filter-select">
              <span className="sr-only">Verification</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as "all" | LibraryStatus)}>
                {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === "all" ? "Verification" : option.label}</option>)}
              </select>
            </label>
            <button className="mj-icon-button" type="button" aria-label="More filters">
              <MoreIcon size={16} />
            </button>
          </section>

          <div className="mj-library-meta">
            <span>{filtered.length} artifacts</span>
            <span className="mj-library-meta-note">Connected to the workspace repository</span>
          </div>

          <section className="mj-library-table-wrap" aria-labelledby="artifact-list-title">
            <h2 className="sr-only" id="artifact-list-title">Saved artifacts</h2>
            <div className="mj-library-table" role="table">
              <div className="mj-library-row mj-library-row--header" role="row">
                <span role="columnheader">Name</span>
                <span role="columnheader">Framework</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Updated</span>
                <span aria-hidden="true" />
              </div>
              {filtered.length ? filtered.map((artifact) => <ArtifactRow artifact={artifact} demoMode={demoMode} key={artifact.id} />) : (
                <div className="mj-library-empty" role="row">
                  <strong>No artifacts match these filters.</strong>
                  <span>Clear a filter or start a new verified run.</span>
                  <a className="mj-secondary-button" href={runHref}>Start a run</a>
                </div>
              )}
            </div>
          </section>

          <p className="mj-library-footer-note">{demoMode ? "Reference artifacts are shown in the public preview." : "Verified runs saved from this workspace appear here automatically."}</p>
        </div>
      </div>
    </div>
  );
}

function ArtifactRow({ artifact, demoMode }: { artifact: LibraryArtifact; demoMode: boolean }) {
  return (
    <a className="mj-library-row mj-library-row--artifact" href={demoMode ? "/demo?view=library" : `/library/${artifact.id}`} role="row">
      <span className="mj-library-name-cell" role="cell">
        <span className="mj-library-star" aria-hidden="true">☆</span>
        <span>
          <strong>{artifact.title}</strong>
          <small>{artifact.family} · {artifact.tags.slice(0, 2).join(" · ")}</small>
        </span>
      </span>
      <span role="cell" className="mj-library-mono">{artifact.framework}</span>
      <span role="cell"><StatusLabel status={artifact.status} /></span>
      <span role="cell" className="mj-library-date">{formatDate(artifact.updatedAt)}</span>
      <span className="mj-library-open" aria-hidden="true">→</span>
    </a>
  );
}

function StatusLabel({ status }: { status: LibraryStatus }) {
  const label = status === "verified" ? "Verified" : status === "verified_caveats" ? "Caveats" : "Failed";
  return <span className={`mj-library-status mj-library-status--${status}`}><span aria-hidden="true">{status === "failed" ? "×" : status === "verified" ? "✓" : "–"}</span>{label}</span>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function toLibraryArtifact(value: unknown): LibraryArtifact[] {
  if (!value || typeof value !== "object") return [];
  const artifact = value as Record<string, unknown>;
  if (typeof artifact.id !== "string" || typeof artifact.title !== "string") return [];
  const existing = getLibraryArtifact(artifact.id);
  return [{
    id: artifact.id,
    slug: typeof artifact.slug === "string" ? artifact.slug : artifact.id,
    title: artifact.title,
    family: typeof artifact.family === "string" ? artifact.family : "Simulation",
    framework: typeof artifact.framework === "string" ? artifact.framework : "Qiskit",
    status: existing?.status ?? "verified",
    updatedAt: typeof artifact.updated_at === "string" ? artifact.updated_at : new Date().toISOString(),
    description: existing?.description ?? "Saved artifact in the workspace repository.",
    tags: existing?.tags ?? [typeof artifact.family === "string" ? artifact.family.toLowerCase() : "artifact"],
    verification: existing?.verification ?? "Verification record available in artifact detail.",
    code: existing?.code ?? "",
    qasm: existing?.qasm ?? null,
    currentVersionId: typeof artifact.current_version_id === "string" ? artifact.current_version_id : existing?.currentVersionId,
    resourceRows: existing?.resourceRows ?? [],
    runId: existing?.runId,
    source: existing?.source ?? "run",
  }];
}
