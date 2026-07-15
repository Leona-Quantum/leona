"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CopyIcon, MoreIcon } from "../../../../components/icons";
import { archiveArtifact, deleteArtifact, frameworkVariantsFromRemote, getLibraryArtifact, type LibraryArtifact } from "../../../../lib/library-data";
import type { PublicLocale } from "../../../../lib/public-locale";

type DetailTab = "overview" | "code" | "runs" | "verification" | "notes";

const DETAIL_COPY: Record<PublicLocale, {
  back: string; reference: string; verified: string; options: string; openStudio: string; openRun: string; askInRun: string; archive: string; delete: string; cancel: string; deleteConfirmTitle: string; deleteWarning: (title: string) => string; framework: string; type: string; artifact: string; updated: string; source: string; runSource: string; publicSource: string; curatedSource: string; tabs: Record<DetailTab, string>; overview: string; verificationSummary: string; resources: string; currentVersion: string; evidence: string; savedRecord: string; verificationReport: string; available: string; runProvenance: string; linked: string; example: string; exportStatus: string; openQasm: string; frameworkOnly: string; sourceCode: string; exportHeading: string; classified: string; copied: string; copyCode: string; noCode: string; lossless: string; noNative: string; runRecords: string; publicReference: string; verifiedRun: string; referenceRun: string; publicRunBody: string; runBody: string; verificationEvidence: string; auditSurface: string; whatChecked: string; publicChecked: string; verifiedChecked: string; notes: string; workspace: string; demoNote: string; publicNote: string; runNote: string; loading: string; unknown: string;
}> = {
  en: {
    back: "← Library", reference: "Reference", verified: "Verified", options: "Artifact options", openStudio: "Open in Studio", openRun: "Open in Run", askInRun: "Ask in Run", archive: "Archive", delete: "Delete", cancel: "Cancel", deleteConfirmTitle: "Are you sure?", deleteWarning: (title) => `“${title}” will be removed from your workspace and not saved.`, framework: "Framework", type: "Type", artifact: "artifact", updated: "Updated", source: "Source", runSource: "Leona Run", publicSource: "Public repository", curatedSource: "Curated example", tabs: { overview: "Overview", code: "Code & Export", runs: "Runs", verification: "Verification", notes: "Notes" }, overview: "Overview", verificationSummary: "Verification summary", resources: "Resources", currentVersion: "current version", evidence: "Evidence", savedRecord: "saved record", verificationReport: "Verification report", available: "available", runProvenance: "Run provenance", linked: "linked", example: "example", exportStatus: "Export status", openQasm: "OpenQASM 3", frameworkOnly: "framework only", sourceCode: "Source code", exportHeading: "Export", classified: "classified", copied: "Copied", copyCode: "Copy code", noCode: "Code will appear after the artifact is loaded from the control plane.", lossless: "Lossless", noNative: "No native OpenQASM export was saved for this artifact.", runRecords: "Run records", publicReference: "Public reference", verifiedRun: "Verified Leona Run", referenceRun: "Reference run", publicRunBody: "Public source context and export metadata are retained. Run this copy before treating it as new workspace evidence.", runBody: "Simulation evidence, verification parameters, and export status are retained with this artifact.", verificationEvidence: "Verification evidence", auditSurface: "audit surface", whatChecked: "What was checked", publicChecked: "The public record's stated method, result, source, and export boundary were preserved. Execute this private copy to create workspace-specific evidence.", verifiedChecked: "Method output, generated code, simulation result, and artifact export status were recorded by the pipeline. Raw run-record JSON remains available when the control plane is connected.", notes: "Notes", workspace: "workspace", demoNote: "This is a curated replayable example.", publicNote: "This entry was imported from the public research database; source and license context are retained in the saved version.", runNote: "This entry was saved from a live workspace run.", loading: "Loading artifact…", unknown: "Unknown",
  },
  ja: {
    back: "← Library", reference: "リファレンス", verified: "検証済み", options: "アーティファクトの設定", openStudio: "Studioで開く", openRun: "実行で開く", askInRun: "実行で質問", archive: "アーカイブ", delete: "削除", cancel: "キャンセル", deleteConfirmTitle: "削除してもよいですか？", deleteWarning: (title) => `「${title}」はワークスペースから削除され、保存されません。`, framework: "フレームワーク", type: "種類", artifact: "アーティファクト", updated: "更新日", source: "ソース", runSource: "Leona実行", publicSource: "公開リポジトリ", curatedSource: "キュレーション例", tabs: { overview: "概要", code: "コードとエクスポート", runs: "実行", verification: "検証", notes: "メモ" }, overview: "概要", verificationSummary: "検証サマリー", resources: "リソース", currentVersion: "現在のバージョン", evidence: "根拠", savedRecord: "保存済み記録", verificationReport: "検証レポート", available: "利用可能", runProvenance: "実行プロベナンス", linked: "リンク済み", example: "例", exportStatus: "エクスポート状態", openQasm: "OpenQASM 3", frameworkOnly: "frameworkのみ", sourceCode: "ソースコード", exportHeading: "エクスポート", classified: "分類済み", copied: "コピー済み", copyCode: "コードをコピー", noCode: "制御プレーンからアーティファクトを読み込むとコードが表示されます。", lossless: "ロスレス", noNative: "このアーティファクトにはネイティブOpenQASMエクスポートが保存されていません。", runRecords: "実行記録", publicReference: "公開リファレンス", verifiedRun: "検証済みLeona実行", referenceRun: "リファレンス実行", publicRunBody: "公開ソースのコンテキストとエクスポート情報を保持しています。新しいワークスペースの根拠とする前に、このコピーを実行してください。", runBody: "シミュレーションの根拠、検証パラメータ、エクスポート状態をこのアーティファクトに保持しています。", verificationEvidence: "検証の根拠", auditSurface: "監査表示", whatChecked: "確認した内容", publicChecked: "公開記録の方法、結果、ソース、エクスポート範囲を保持しています。ワークスペース固有の根拠を作るには、この非公開コピーを実行してください。", verifiedChecked: "メソッドの出力、生成コード、シミュレーション結果、アーティファクトのエクスポート状態をパイプラインが記録しました。制御プレーン接続時は生の実行JSONも利用できます。", notes: "メモ", workspace: "ワークスペース", demoNote: "キュレーションされた再生可能な例です。", publicNote: "公開研究データベースから取り込んだエントリです。ソースとライセンスの情報は保存版に保持されます。", runNote: "このエントリはライブワークスペースの実行から保存されました。", loading: "アーティファクトを読み込んでいます…", unknown: "不明",
  },
};
type ArtifactCopy = (typeof DETAIL_COPY)[PublicLocale];

export function ArtifactDetail({ artifactId, locale = "en" }: { artifactId: string; locale?: PublicLocale }) {
  const copy = DETAIL_COPY[locale];
  const router = useRouter();
  const [artifact, setArtifact] = useState<LibraryArtifact | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [copied, setCopied] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  function handleArchive() {
    if (!artifact) return;
    archiveArtifact(artifact.id, artifact);
    router.push("/library");
  }

  function handleDelete() {
    if (!artifact) return;
    deleteArtifact(artifact.id);
    router.push("/library");
  }

  if (!artifact) {
    return <div className="mj-library-detail-loading">{copy.loading}</div>;
  }

  return (
    <div className="mj-library-page">
      <div className="mj-library-scroll">
        <div className="mj-workspace-content">
          <a className="mj-back-link" href="/library">{copy.back}</a>
          <header className="mj-artifact-header">
            <div>
              <div className="mj-artifact-title-row">
                <span className="mj-artifact-star" aria-hidden="true">☆</span>
                <h1 className="mj-page-title">{artifact.title}</h1>
                <span className={`mj-library-status mj-library-status--${artifact.status}`}><span aria-hidden="true">{artifact.source === "public" ? "–" : "✓"}</span>{artifact.source === "public" ? copy.reference : copy.verified}</span>
              </div>
              <p className="mj-page-lede">{artifact.description}</p>
            </div>
            <div className="mj-artifact-actions">
              <button className="mj-icon-button" type="button" aria-label={copy.options} title={copy.options}><MoreIcon size={16} /></button>
              <a className="mj-secondary-button" href={`/studio?artifact=${encodeURIComponent(artifact.id)}`}>{copy.openStudio}</a>
              <a className="mj-secondary-button" href={`/run?artifact=${encodeURIComponent(artifact.id)}`}>{copy.askInRun}</a>
              <button className="mj-secondary-button" type="button" onClick={handleArchive}>{copy.archive}</button>
              <button className="mj-danger-button" type="button" onClick={() => setDeleteOpen(true)}>{copy.delete}</button>
            </div>
          </header>

          <div className="mj-artifact-meta-grid">
            <Meta label={copy.framework} value={artifact.framework} />
            <Meta label={copy.type} value={`${artifact.family} ${copy.artifact}`} />
            <Meta label={copy.updated} value={formatDate(artifact.updatedAt, locale)} />
            <Meta label={copy.source} value={artifact.source === "run" ? copy.runSource : artifact.source === "public" ? copy.publicSource : copy.curatedSource} />
          </div>

          <nav className="mj-artifact-tabs" aria-label={copy.options}>
            {(["overview", "code", "runs", "verification", "notes"] as DetailTab[]).map((item) => (
              <button className={tab === item ? "is-active" : ""} type="button" key={item} onClick={() => setTab(item)}>
                {copy.tabs[item]}
              </button>
            ))}
          </nav>

          {tab === "overview" ? <Overview artifact={artifact} copy={copy} /> : null}
          {tab === "code" ? <CodeAndExport artifact={artifact} copied={copied} onCopy={copyCode} copy={copy} /> : null}
          {tab === "runs" ? <Runs artifact={artifact} copy={copy} /> : null}
          {tab === "verification" ? <Verification artifact={artifact} copy={copy} /> : null}
          {tab === "notes" ? <Notes artifact={artifact} copy={copy} /> : null}
        </div>
      </div>
      {deleteOpen ? (
        <div className="mj-delete-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteOpen(false); }}>
          <section className="mj-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="mj-artifact-delete-title">
            <p className="mj-eyebrow">{copy.type}</p>
            <h2 id="mj-artifact-delete-title">{copy.deleteConfirmTitle}</h2>
            <p>{copy.deleteWarning(artifact.title)}</p>
            <div className="mj-delete-dialog-actions">
              <button className="mj-secondary-button" type="button" onClick={() => setDeleteOpen(false)}>{copy.cancel}</button>
              <button className="mj-danger-button" type="button" onClick={handleDelete}>{copy.delete}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Overview({ artifact, copy }: { artifact: LibraryArtifact; copy: ArtifactCopy }) {
  return (
    <div className="mj-artifact-grid">
      <section className="mj-artifact-panel mj-artifact-panel--wide">
        <div className="mj-panel-heading"><h2>{copy.overview}</h2><span className="mj-mono-muted">{artifact.slug}</span></div>
        <p className="mj-artifact-copy">{artifact.description}</p>
        <div className="mj-tag-list">{artifact.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <h3>{copy.verificationSummary}</h3>
        <div className={`mj-verification-summary${artifact.source === "public" ? " mj-verification-summary--reference" : ""}`}><span aria-hidden="true">{artifact.source === "public" ? "–" : "✓"}</span><div><strong>{artifact.source === "public" ? copy.publicReference : copy.verified}</strong><p>{artifact.source === "public" ? `${artifact.verification} ${copy.publicRunBody}` : artifact.verification}</p></div></div>
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>{copy.resources}</h2><span className="mj-mono-muted">{copy.currentVersion}</span></div>
        <dl className="mj-resource-list">{artifact.resourceRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>{copy.evidence}</h2><span className="mj-mono-muted">{copy.savedRecord}</span></div>
        <ul className="mj-evidence-links">
          <li><span>{copy.verificationReport}</span><span className="mj-mono-muted">{copy.available}</span></li>
          <li><span>{copy.runProvenance}</span><span className="mj-mono-muted">{artifact.runId ? copy.linked : copy.example}</span></li>
          <li><span>{copy.exportStatus}</span><span className="mj-mono-muted">{artifact.qasm ? copy.openQasm : copy.frameworkOnly}</span></li>
        </ul>
      </section>
    </div>
  );
}

function CodeAndExport({ artifact, copied, onCopy, copy }: { artifact: LibraryArtifact; copied: boolean; onCopy: (code?: string) => void; copy: ArtifactCopy }) {
  const options = frameworkCodeOptions(artifact);
  const [selected, setSelected] = useState(options[0]?.key ?? "qiskit");
  const selectedCode = options.find((option) => option.key === selected)?.code ?? artifact.code;
  return (
    <div className="mj-artifact-grid mj-artifact-grid--code">
      <section className="mj-artifact-panel mj-artifact-panel--wide">
        <div className="mj-panel-heading"><h2>{copy.sourceCode}</h2><div className="mj-artifact-code-actions">{options.length > 1 ? <label><span className="sr-only">{copy.framework}</span><select value={selected} onChange={(event) => setSelected(event.target.value)}>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label> : null}<button className="mj-secondary-button" type="button" onClick={() => onCopy(selectedCode)} title={copied ? copy.copied : copy.copyCode}><CopyIcon size={14} />{copied ? copy.copied : copy.copyCode}</button></div></div>
        <pre className="mj-artifact-code" tabIndex={0} role="region" aria-label={`${artifact.title} ${selected} ${copy.sourceCode}`}><code>{selectedCode || copy.noCode}</code></pre>
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>{copy.exportHeading}</h2><span className="mj-mono-muted">{copy.classified}</span></div>
        <div className="mj-export-state"><span className="mj-library-status mj-library-status--verified"><span aria-hidden="true">✓</span>{artifact.qasm ? copy.lossless : copy.frameworkOnly}</span><p>{artifact.qasm ?? copy.noNative}</p></div>
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

function Runs({ artifact, copy }: { artifact: LibraryArtifact; copy: ArtifactCopy }) {
  const isPublicReference = artifact.source === "public";
  return <section className="mj-artifact-panel"><div className="mj-panel-heading"><h2>{copy.runRecords}</h2><span className="mj-mono-muted">{artifact.runId ?? (isPublicReference ? copy.publicReference : copy.example)}</span></div><div className="mj-run-record"><span className="mj-chat-status mj-chat-status--verified">{isPublicReference ? "–" : "✓"}</span><div><strong>{artifact.source === "run" ? copy.verifiedRun : isPublicReference ? copy.publicReference : copy.referenceRun}</strong><p>{isPublicReference ? copy.publicRunBody : copy.runBody}</p></div><span className={`mj-library-status mj-library-status--${artifact.status}`}><span aria-hidden="true">{isPublicReference ? "–" : "✓"}</span>{isPublicReference ? copy.reference : copy.verified}</span></div></section>;
}

function Verification({ artifact, copy }: { artifact: LibraryArtifact; copy: ArtifactCopy }) {
  const isPublicReference = artifact.source === "public";
  return <section className="mj-artifact-panel"><div className="mj-panel-heading"><h2>{copy.verificationEvidence}</h2><span className="mj-mono-muted">{copy.auditSurface}</span></div><div className="mj-verification-detail"><div className={`mj-verification-summary${isPublicReference ? " mj-verification-summary--reference" : ""}`}><span aria-hidden="true">{isPublicReference ? "–" : "✓"}</span><div><strong>{isPublicReference ? copy.publicReference : copy.verified}</strong><p>{artifact.verification}</p></div></div><details><summary>{copy.whatChecked}</summary><p>{isPublicReference ? copy.publicChecked : copy.verifiedChecked}</p></details></div></section>;
}

function Notes({ artifact, copy }: { artifact: LibraryArtifact; copy: ArtifactCopy }) {
  return <section className="mj-artifact-panel"><div className="mj-panel-heading"><h2>{copy.notes}</h2><span className="mj-mono-muted">{copy.workspace}</span></div><p className="mj-artifact-copy">{artifact.source === "demo" ? copy.demoNote : artifact.source === "public" ? copy.publicNote : copy.runNote}</p></section>;
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

function formatDate(value: string, locale: PublicLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return DETAIL_COPY[locale].unknown;
  return date.toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US", { month: "short", day: "numeric", year: "numeric" });
}
