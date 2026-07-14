"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getLibraryArtifact,
  loadLibraryArtifacts,
  type LibraryArtifact,
  type LibraryStatus,
} from "../../../lib/library-data";
import { LibraryIcon, MoreIcon, SearchIcon } from "../../../components/icons";
import type { PublicLocale } from "../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";

export function LibraryStudio({ demoMode = false, locale = "en" }: { demoMode?: boolean; locale?: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].library;
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
  const statusOptions: Array<{ value: "all" | LibraryStatus; label: string }> = [
    { value: "all", label: copy.all },
    { value: "verified", label: copy.verified },
    { value: "verified_caveats", label: copy.caveats },
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
            <span className="mj-library-meta-note">{copy.connected}</span>
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
              {filtered.length ? filtered.map((artifact) => <ArtifactRow artifact={artifact} demoMode={demoMode} locale={locale} key={artifact.id} />) : (
                <div className="mj-library-empty" role="row">
                  <strong>{copy.noMatch}</strong>
                  <span>{copy.noMatchBody}</span>
                  <a className="mj-secondary-button" href={runHref}>{copy.startRun}</a>
                </div>
              )}
            </div>
          </section>

          <p className="mj-library-footer-note">{demoMode ? copy.previewFooter : copy.workspaceFooter}</p>
        </div>
      </div>
    </div>
  );
}

function ArtifactRow({ artifact, demoMode, locale }: { artifact: LibraryArtifact; demoMode: boolean; locale: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].library;
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
      <span role="cell"><StatusLabel status={artifact.status} locale={locale} /></span>
      <span role="cell" className="mj-library-date">{formatDate(artifact.updatedAt, locale, copy.unknown)}</span>
      <span className="mj-library-open" aria-hidden="true">→</span>
    </a>
  );
}

function StatusLabel({ status, locale }: { status: LibraryStatus; locale: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].library;
  const label = status === "verified" ? copy.verified : status === "verified_caveats" ? copy.caveats : copy.failed;
  return <span className={`mj-library-status mj-library-status--${status}`}><span aria-hidden="true">{status === "failed" ? "×" : status === "verified" ? "✓" : "–"}</span>{label}</span>;
}

function formatDate(value: string, locale: PublicLocale, unknown: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return unknown;
  return date.toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toLibraryArtifact(value: unknown): LibraryArtifact[] {
  if (!value || typeof value !== "object") return [];
  const artifact = value as Record<string, unknown>;
  if (typeof artifact.id !== "string" || typeof artifact.title !== "string") return [];
  const existing = getLibraryArtifact(artifact.id);
  const slug = typeof artifact.slug === "string" ? artifact.slug : artifact.id;
  const isPublicReference = slug.startsWith("public-");
  return [{
    id: artifact.id,
    slug,
    title: artifact.title,
    family: typeof artifact.family === "string" ? artifact.family : "Simulation",
    framework: typeof artifact.framework === "string" ? artifact.framework : "Qiskit",
    status: existing?.status ?? (isPublicReference ? "verified_caveats" : "verified"),
    updatedAt: typeof artifact.updated_at === "string" ? artifact.updated_at : new Date().toISOString(),
    description: existing?.description ?? "Saved artifact in the workspace repository.",
    tags: existing?.tags ?? [typeof artifact.family === "string" ? artifact.family.toLowerCase() : "artifact"],
    verification: existing?.verification ?? "Verification record available in artifact detail.",
    code: existing?.code ?? "",
    qasm: existing?.qasm ?? null,
    currentVersionId: typeof artifact.current_version_id === "string" ? artifact.current_version_id : existing?.currentVersionId,
    resourceRows: existing?.resourceRows ?? [],
    runId: existing?.runId,
    source: existing?.source ?? (isPublicReference ? "public" : "run"),
  }];
}
