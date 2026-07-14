"use client";

import { useEffect, useState } from "react";
import { CopyIcon, MoreIcon } from "../../../../components/icons";
import { frameworkVariantsFromRemote, getLibraryArtifact, type LibraryArtifact } from "../../../../lib/library-data";

type DetailTab = "overview" | "code" | "runs" | "verification" | "notes";

export function ArtifactDetail({ artifactId }: { artifactId: string }) {
  const [artifact, setArtifact] = useState<LibraryArtifact | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const local = getLibraryArtifact(artifactId);
    if (local) setArtifact(local);
    void fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Artifact detail unavailable");
        return (await response.json()) as Record<string, unknown>;
      })
      .then((remote) => {
        const remoteId = remote.id;
        const remoteTitle = remote.title;
        if (!active || typeof remoteId !== "string" || typeof remoteTitle !== "string") return;
        const remoteSlug = typeof remote.slug === "string" ? remote.slug : artifactId;
        const isPublicReference = remoteSlug.startsWith("public-");
        setArtifact((current) => ({
          ...(current ?? fallbackArtifact(artifactId)),
          id: remoteId,
          slug: remoteSlug,
          title: remoteTitle,
          family: typeof remote.family === "string" ? remote.family : current?.family ?? "Simulation",
          framework: typeof remote.framework === "string" ? remote.framework : current?.framework ?? "Qiskit",
          updatedAt: typeof remote.updated_at === "string" ? remote.updated_at : current?.updatedAt ?? new Date().toISOString(),
          currentVersionId: typeof remote.current_version_id === "string" ? remote.current_version_id : current?.currentVersionId,
          status: current?.status ?? (isPublicReference ? "verified_caveats" : "verified"),
          source: current?.source ?? (isPublicReference ? "public" : "run"),
        }));
        if (typeof remote.current_version_id !== "string") return;
        return fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/versions/current`, { cache: "no-store" })
          .then(async (versionResponse) => {
            if (!versionResponse.ok) throw new Error("Artifact version unavailable");
            return (await versionResponse.json()) as Record<string, unknown>;
          })
          .then((version) => {
            if (!active) return;
            const publicMetadata = metadataFromIr(version.ir);
            setArtifact((current) => ({
              ...(current ?? fallbackArtifact(artifactId)),
              description: publicMetadata.introduction ?? current?.description ?? "Saved artifact in the workspace repository.",
              verification: publicMetadata.verification ?? current?.verification ?? "Verification record available in the control plane.",
              code: typeof version.code === "string" ? version.code : current?.code ?? "",
              frameworkVariants: frameworkVariantsFromRemote(version.framework_variants) ?? current?.frameworkVariants,
              qasm: typeof version.qasm === "string" ? version.qasm : current?.qasm ?? null,
              resourceRows: current?.resourceRows?.length ? current.resourceRows : resourceRowsFromRemote(version.resource_estimates),
            }));
          });
      })
      .catch(() => {
        if (active && !local) setArtifact(fallbackArtifact(artifactId));
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  async function copyCode(value = artifact?.code) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (!artifact) {
    return <div className="mj-library-detail-loading">Loading artifact…</div>;
  }

  return (
    <div className="mj-library-page">
      <div className="mj-library-scroll">
        <div className="mj-workspace-content">
          <a className="mj-back-link" href="/library">← Library</a>
          <header className="mj-artifact-header">
            <div>
              <div className="mj-artifact-title-row">
                <span className="mj-artifact-star" aria-hidden="true">☆</span>
                <h1 className="mj-page-title">{artifact.title}</h1>
                <span className={`mj-library-status mj-library-status--${artifact.status}`}><span aria-hidden="true">{artifact.source === "public" ? "–" : "✓"}</span>{artifact.source === "public" ? "Reference" : "Verified"}</span>
              </div>
              <p className="mj-page-lede">{artifact.description}</p>
            </div>
            <div className="mj-artifact-actions">
              <button className="mj-icon-button" type="button" aria-label="Artifact options"><MoreIcon size={16} /></button>
              <a className="mj-secondary-button" href={`/studio?artifact=${encodeURIComponent(artifact.id)}`}>Open in Studio</a>
              <a className="mj-secondary-button" href={`/run?artifact=${encodeURIComponent(artifact.id)}`}>Open in Run</a>
            </div>
          </header>

          <div className="mj-artifact-meta-grid">
            <Meta label="Framework" value={artifact.framework} />
            <Meta label="Type" value={`${artifact.family} artifact`} />
            <Meta label="Updated" value={formatDate(artifact.updatedAt)} />
            <Meta label="Source" value={artifact.source === "run" ? "Nameko Run" : artifact.source === "public" ? "Public repository" : "Curated example"} />
          </div>

          <nav className="mj-artifact-tabs" aria-label="Artifact detail tabs">
            {(["overview", "code", "runs", "verification", "notes"] as DetailTab[]).map((item) => (
              <button className={tab === item ? "is-active" : ""} type="button" key={item} onClick={() => setTab(item)}>
                {item === "code" ? "Code & Export" : item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </nav>

          {tab === "overview" ? <Overview artifact={artifact} /> : null}
          {tab === "code" ? <CodeAndExport artifact={artifact} copied={copied} onCopy={copyCode} /> : null}
          {tab === "runs" ? <Runs artifact={artifact} /> : null}
          {tab === "verification" ? <Verification artifact={artifact} /> : null}
          {tab === "notes" ? <Notes artifact={artifact} /> : null}
        </div>
      </div>
    </div>
  );
}

function Overview({ artifact }: { artifact: LibraryArtifact }) {
  return (
    <div className="mj-artifact-grid">
      <section className="mj-artifact-panel mj-artifact-panel--wide">
        <div className="mj-panel-heading"><h2>Overview</h2><span className="mj-mono-muted">{artifact.slug}</span></div>
        <p className="mj-artifact-copy">{artifact.description}</p>
        <div className="mj-tag-list">{artifact.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <h3>Verification summary</h3>
        <div className={`mj-verification-summary${artifact.source === "public" ? " mj-verification-summary--reference" : ""}`}><span aria-hidden="true">{artifact.source === "public" ? "–" : "✓"}</span><div><strong>{artifact.source === "public" ? "Public reference" : "Verified"}</strong><p>{artifact.source === "public" ? `${artifact.verification} This is retained public evidence, not a new workspace verification.` : artifact.verification}</p></div></div>
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>Resources</h2><span className="mj-mono-muted">current version</span></div>
        <dl className="mj-resource-list">{artifact.resourceRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>Evidence</h2><span className="mj-mono-muted">saved record</span></div>
        <ul className="mj-evidence-links">
          <li><span>Verification report</span><span className="mj-mono-muted">available</span></li>
          <li><span>Run provenance</span><span className="mj-mono-muted">{artifact.runId ? "linked" : "example"}</span></li>
          <li><span>Export status</span><span className="mj-mono-muted">{artifact.qasm ? "OpenQASM 3" : "framework only"}</span></li>
        </ul>
      </section>
    </div>
  );
}

function CodeAndExport({ artifact, copied, onCopy }: { artifact: LibraryArtifact; copied: boolean; onCopy: (code?: string) => void }) {
  const options = frameworkCodeOptions(artifact);
  const [selected, setSelected] = useState(options[0]?.key ?? "qiskit");
  const selectedCode = options.find((option) => option.key === selected)?.code ?? artifact.code;
  return (
    <div className="mj-artifact-grid mj-artifact-grid--code">
      <section className="mj-artifact-panel mj-artifact-panel--wide">
        <div className="mj-panel-heading"><h2>Source code</h2><div className="mj-artifact-code-actions">{options.length > 1 ? <label><span className="sr-only">Framework</span><select value={selected} onChange={(event) => setSelected(event.target.value)}>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label> : null}<button className="mj-secondary-button" type="button" onClick={() => onCopy(selectedCode)}><CopyIcon size={14} />{copied ? "Copied" : "Copy code"}</button></div></div>
        <pre className="mj-artifact-code" tabIndex={0} role="region" aria-label={`${artifact.title} ${selected} source code`}><code>{selectedCode || "Code will appear after the artifact is loaded from the control plane."}</code></pre>
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>Export</h2><span className="mj-mono-muted">classified</span></div>
        <div className="mj-export-state"><span className="mj-library-status mj-library-status--verified"><span aria-hidden="true">✓</span>{artifact.qasm ? "Lossless" : "Framework only"}</span><p>{artifact.qasm ?? "No native OpenQASM export was saved for this artifact."}</p></div>
      </section>
    </div>
  );
}

function frameworkCodeOptions(artifact: LibraryArtifact): Array<{ key: string; label: string; code: string }> {
  const options = new Map<string, { key: string; label: string; code: string }>();
  const primary = normalizeFramework(artifact.framework);
  options.set(primary, { key: primary, label: frameworkLabel(primary), code: artifact.code });
  for (const [framework, code] of Object.entries(artifact.frameworkVariants ?? {})) {
    options.set(normalizeFramework(framework), { key: normalizeFramework(framework), label: frameworkLabel(framework), code });
  }
  return [...options.values()];
}

function normalizeFramework(value: string): string {
  const normalized = value.toLowerCase();
  return normalized === "pennylane" ? "pennylane" : normalized === "cirq" ? "cirq" : "qiskit";
}

function frameworkLabel(value: string): string {
  const normalized = normalizeFramework(value);
  return normalized === "pennylane" ? "PennyLane" : normalized === "cirq" ? "Cirq" : "Qiskit";
}

function Runs({ artifact }: { artifact: LibraryArtifact }) {
  const isPublicReference = artifact.source === "public";
  return <section className="mj-artifact-panel"><div className="mj-panel-heading"><h2>Run records</h2><span className="mj-mono-muted">{artifact.runId ?? (isPublicReference ? "public reference" : "curated example")}</span></div><div className="mj-run-record"><span className="mj-chat-status mj-chat-status--verified">{isPublicReference ? "–" : "✓"}</span><div><strong>{artifact.source === "run" ? "Verified Nameko run" : isPublicReference ? "Public reference snapshot" : "Reference run"}</strong><p>{isPublicReference ? "Public source context and export metadata are retained. Run this copy before treating it as new workspace evidence." : "Simulation evidence, verification parameters, and export status are retained with this artifact."}</p></div><span className={`mj-library-status mj-library-status--${artifact.status}`}><span aria-hidden="true">{isPublicReference ? "–" : "✓"}</span>{isPublicReference ? "Reference" : "Verified"}</span></div></section>;
}

function Verification({ artifact }: { artifact: LibraryArtifact }) {
  const isPublicReference = artifact.source === "public";
  return <section className="mj-artifact-panel"><div className="mj-panel-heading"><h2>Verification evidence</h2><span className="mj-mono-muted">audit surface</span></div><div className="mj-verification-detail"><div className={`mj-verification-summary${isPublicReference ? " mj-verification-summary--reference" : ""}`}><span aria-hidden="true">{isPublicReference ? "–" : "✓"}</span><div><strong>{isPublicReference ? "Public reference" : "Verified"}</strong><p>{isPublicReference ? `${artifact.verification} This imported copy has not been re-executed.` : artifact.verification}</p></div></div><details><summary>What was checked</summary><p>{isPublicReference ? "The public record's stated method, result, source, and export boundary were preserved. Execute this private copy to create workspace-specific evidence." : "Method output, generated code, simulation result, and artifact export status were recorded by the pipeline. Raw run-record JSON remains available when the control plane is connected."}</p></details></div></section>;
}

function Notes({ artifact }: { artifact: LibraryArtifact }) {
  return <section className="mj-artifact-panel"><div className="mj-panel-heading"><h2>Notes</h2><span className="mj-mono-muted">workspace</span></div><p className="mj-artifact-copy">This artifact is ready to open in Nameko Run for a follow-up or explanation. {artifact.source === "demo" ? "This is a curated replayable example." : artifact.source === "public" ? "This entry was imported from the public research database; source and license context are retained in the saved version." : "This entry was saved from a live workspace run."}</p></section>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="mj-artifact-meta"><span>{label}</span><strong>{value}</strong></div>;
}

function fallbackArtifact(id: string): LibraryArtifact {
  return { id, slug: id, title: "Artifact", family: "Simulation", framework: "Qiskit", status: "verified_caveats", updatedAt: new Date().toISOString(), description: "Saved artifact in the workspace repository.", tags: ["artifact"], verification: "Verification record available in the control plane.", code: "", qasm: null, resourceRows: [], source: "run" };
}

function metadataFromIr(value: unknown): { introduction?: string; verification?: string } {
  if (!value || typeof value !== "object") return {};
  const metadata = (value as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return {};
  const record = metadata as Record<string, unknown>;
  return {
    introduction: typeof record.introduction === "string" ? record.introduction : undefined,
    verification: typeof record.verification === "string" ? record.verification : undefined,
  };
}

function resourceRowsFromRemote(value: unknown): Array<{ label: string; value: string }> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([label, raw]) => {
    if (typeof raw !== "string" && typeof raw !== "number") return [];
    return [{ label: label.replaceAll("_", " "), value: String(raw) }];
  });
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
