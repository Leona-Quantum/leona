"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SyntaxHighlightedCode, VerificationSummaryPanel } from "@majorana/ui";
import { CopyIcon, MoreIcon, StarIcon } from "../../../../components/icons";
import { archiveArtifact, artifactFromResource, deleteArtifact, frameworkVariantsFromRemote, getLibraryArtifact, loadStarredLibraryArtifactIds, statusFromVerificationSummary, toggleLibraryArtifactStar, type LibraryArtifact } from "../../../../lib/library-data";
import { verificationFromMetadata, verificationFromResource } from "../../../../lib/verification-record";
import type { PublicLocale } from "../../../../lib/public-locale";
import { CIRCUIT_FRAMEWORKS, circuitFramework, circuitFrameworkOrNull } from "../../../../lib/circuit-frameworks";
import { convertCircuitSource, looksLikeOpenQasm3, parseCircuitSource, reconstructInterchangeCircuit } from "../../../../lib/circuit-conversion";
import { CircuitDiagram } from "../../../../components/circuit-diagram";
import { artifactExportManifest } from "../../../../lib/artifact-export";

type DetailTab = "overview" | "code" | "runs" | "verification" | "notes";

const DETAIL_COPY: Record<PublicLocale, {
  back: string; reference: string; verified: string; structural: string; options: string; openStudio: string; openRun: string; askInRun: string; archive: string; delete: string; cancel: string; deleteConfirmTitle: string; deleteWarning: (title: string) => string; star: string; unstar: string; framework: string; type: string; artifact: string; updated: string; source: string; runSource: string; publicSource: string; curatedSource: string; tabs: Record<DetailTab, string>; overview: string; verificationSummary: string; resources: string; currentVersion: string; evidence: string; savedRecord: string; verificationReport: string; available: string; runProvenance: string; linked: string; example: string; recorded: string; exportStatus: string; openQasm: string; frameworkOnly: string; sourceCode: string; exportHeading: string; classified: string; copied: string; copyCode: string; noCode: string; lossless: string; noNative: string; runRecords: string; publicReference: string; verifiedRun: string; referenceRun: string; publicRunBody: string; runBody: string; verificationEvidence: string; auditSurface: string; whatChecked: string; publicChecked: string; verifiedChecked: string; notes: string; workspace: string; demoNote: string; publicNote: string; runNote: string; loading: string; unknown: string; circuitHeading: string; diagramReadOnly: string; diagramTooLarge: (qubits: number, steps: number) => string; diagramUnavailable: string;
}> = {
  en: {
    back: "← Vault", reference: "Reference", verified: "Verified", structural: "Structurally verified", options: "Artifact options", openStudio: "Open in Studio", openRun: "Open in Run", askInRun: "Ask in Run", archive: "Archive", delete: "Delete", cancel: "Cancel", deleteConfirmTitle: "Are you sure?", deleteWarning: (title) => `“${title}” will be removed from your workspace and not saved.`, star: "Star artifact", unstar: "Remove artifact star", framework: "Framework", type: "Type", artifact: "artifact", updated: "Updated", source: "Source", runSource: "Leona Run", publicSource: "Public Atlas", curatedSource: "Curated example", tabs: { overview: "Overview", code: "Code & Export", runs: "Runs", verification: "Verification", notes: "Notes" }, overview: "Overview", verificationSummary: "Verification summary", resources: "Resources", currentVersion: "current version", evidence: "Evidence", savedRecord: "saved record", verificationReport: "Verification report", available: "available", runProvenance: "Run provenance", linked: "linked", example: "example", recorded: "recorded with the run", exportStatus: "Export status", openQasm: "OpenQASM 3", frameworkOnly: "framework only", sourceCode: "Source code", exportHeading: "Export", classified: "classified", copied: "Copied", copyCode: "Copy code", noCode: "Code will appear after the artifact is loaded from the control plane.", lossless: "Lossless", noNative: "No native OpenQASM export was saved for this artifact.", runRecords: "Run records", publicReference: "Public reference", verifiedRun: "Verified Leona Run", referenceRun: "Reference run", publicRunBody: "Public source context and export metadata are retained. Run this copy before treating it as new workspace evidence.", runBody: "Simulation evidence, verification parameters, and export status are retained with this artifact.", verificationEvidence: "Verification evidence", auditSurface: "audit surface", whatChecked: "What was checked", publicChecked: "The public record's stated method, result, source, and export boundary were preserved. Execute this private copy to create workspace-specific evidence.", verifiedChecked: "No machine-readable check record was saved with this version — it predates the stored check list.", notes: "Notes", workspace: "workspace", demoNote: "This is a curated replayable example.", publicNote: "This entry was imported from the public research database; source and license context are retained in the saved version.", runNote: "This entry was saved from a live workspace run.", loading: "Loading artifact…", unknown: "Unknown", circuitHeading: "Circuit", diagramReadOnly: "read-only", diagramTooLarge: (qubits, steps) => `This circuit is too large to draw (${qubits} qubits, ${steps} operations). Read it as code below.`, diagramUnavailable: "No stored OpenQASM 3 export to draw from. Rerun Verify & save to mint one.",
  },
  ja: {
    back: "← ボールト", reference: "リファレンス", verified: "検証済み", structural: "構造のみ検証", options: "アーティファクトの設定", openStudio: "Studioで開く", openRun: "実行で開く", askInRun: "実行で質問", archive: "アーカイブ", delete: "削除", cancel: "キャンセル", deleteConfirmTitle: "削除してもよいですか？", deleteWarning: (title) => `「${title}」はワークスペースから削除され、保存されません。`, star: "アーティファクトにスターを付ける", unstar: "アーティファクトのスターを外す", framework: "フレームワーク", type: "種類", artifact: "アーティファクト", updated: "更新日", source: "ソース", runSource: "Leona実行", publicSource: "公開Atlas", curatedSource: "キュレーション例", tabs: { overview: "概要", code: "コードとエクスポート", runs: "実行", verification: "検証", notes: "メモ" }, overview: "概要", verificationSummary: "検証サマリー", resources: "リソース", currentVersion: "現在のバージョン", evidence: "根拠", savedRecord: "保存済み記録", verificationReport: "検証レポート", available: "利用可能", runProvenance: "実行プロベナンス", linked: "リンク済み", example: "例", recorded: "実行時に記録済み", exportStatus: "エクスポート状態", openQasm: "OpenQASM 3", frameworkOnly: "frameworkのみ", sourceCode: "ソースコード", exportHeading: "エクスポート", classified: "分類済み", copied: "コピー済み", copyCode: "コードをコピー", noCode: "制御プレーンからアーティファクトを読み込むとコードが表示されます。", lossless: "ロスレス", noNative: "このアーティファクトにはネイティブOpenQASMエクスポートが保存されていません。", runRecords: "実行記録", publicReference: "公開リファレンス", verifiedRun: "検証済みLeona実行", referenceRun: "リファレンス実行", publicRunBody: "公開ソースのコンテキストとエクスポート情報を保持しています。新しいワークスペースの根拠とする前に、このコピーを実行してください。", runBody: "シミュレーションの根拠、検証パラメータ、エクスポート状態をこのアーティファクトに保持しています。", verificationEvidence: "検証の根拠", auditSurface: "監査表示", whatChecked: "確認した内容", publicChecked: "公開記録の方法、結果、ソース、エクスポート範囲を保持しています。ワークスペース固有の根拠を作るには、この非公開コピーを実行してください。", verifiedChecked: "このバージョンには機械可読な検証記録が保存されていません。検証項目の保存より前に作成されたアーティファクトです。", notes: "メモ", workspace: "ワークスペース", demoNote: "キュレーションされた再生可能な例です。", publicNote: "公開研究データベースから取り込んだエントリです。ソースとライセンスの情報は保存版に保持されます。", runNote: "このエントリはライブワークスペースの実行から保存されました。", loading: "アーティファクトを読み込んでいます…", unknown: "不明", circuitHeading: "回路", diagramReadOnly: "読み取り専用", diagramTooLarge: (qubits, steps) => `この回路は大きすぎて描画できません（${qubits}量子ビット、${steps}操作）。下のコードで確認してください。`, diagramUnavailable: "描画元となるOpenQASM 3エクスポートが保存されていません。「検証して保存」を再実行すると生成されます。",
  },
};
type ArtifactCopy = (typeof DETAIL_COPY)[PublicLocale];

/** The word this artifact has earned, and the glyph that goes with it.
 *
 * Four places on this page printed the literal "Verified" off `copy.verified`,
 * independent of the artifact's status, so an artifact whose only evidence was a
 * return-contract check read exactly like one checked against the physics. See
 * plans/evidence-strength-labelling.md. */
function verdictChip(artifact: LibraryArtifact, copy: ArtifactCopy): { label: string; glyph: string } {
  if (artifact.source === "public") return { label: copy.reference, glyph: "–" };
  if (artifact.status === "structural") return { label: copy.structural, glyph: "–" };
  if (artifact.status === "verified") return { label: copy.verified, glyph: "✓" };
  if (artifact.status === "failed") return { label: "Failed", glyph: "×" };
  if (artifact.status === "inconclusive") return { label: "Verification unavailable", glyph: "–" };
  if (artifact.status === "stale") return { label: "Verification stale", glyph: "–" };
  return { label: "Legacy evidence unknown", glyph: "–" };
}

export function ArtifactDetail({ artifactId, locale = "en" }: { artifactId: string; locale?: PublicLocale }) {
  const copy = DETAIL_COPY[locale];
  const router = useRouter();
  const [artifact, setArtifact] = useState<LibraryArtifact | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [copied, setCopied] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [starred, setStarred] = useState(false);

  useEffect(() => {
    setStarred(loadStarredLibraryArtifactIds().has(artifactId));
  }, [artifactId]);

  useEffect(() => {
    let active = true;
    const local = getLibraryArtifact(artifactId);
    if (local) setArtifact({ ...local, status: "legacy_unknown", verificationSummary: null });
    void fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Artifact detail unavailable");
        return (await response.json()) as Record<string, unknown>;
      })
      .then((remote) => {
        const remoteId = remote.id;
        const remoteTitle = remote.title;
        if (!active || typeof remoteId !== "string" || typeof remoteTitle !== "string") return;
        const mapped = artifactFromResource(remote)[0];
        if (!mapped) return;
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
          status: mapped.status,
          verificationSummary: mapped.verificationSummary,
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
            const recorded = verificationFromMetadata(version.metadata);
            const versionSummary = verificationFromResource(version);
            setArtifact((current) => ({
              ...(current ?? fallbackArtifact(artifactId)),
              checks: recorded.checks ?? current?.checks,
              criticSummary: recorded.criticSummary ?? current?.criticSummary,
              status: statusFromVerificationSummary(versionSummary ?? current?.verificationSummary ?? null),
              verificationSummary: versionSummary ?? current?.verificationSummary ?? null,
              description: publicMetadata.introduction ?? current?.description ?? "Saved artifact in the workspace vault.",
              verification: publicMetadata.verification ?? current?.verification ?? "Verification record available in the control plane.",
              code: typeof version.code === "string" ? version.code : current?.code ?? "",
              frameworkVariants: frameworkVariantsFromRemote(version.framework_variants) ?? current?.frameworkVariants,
              qasm: typeof version.qasm === "string" ? version.qasm : current?.qasm ?? null,
              resourceRows: current?.resourceRows?.length ? current.resourceRows : resourceRowsFromRemote(version.resource_estimates),
            }));
          });
      })
      .catch(() => {
        // Previously this substituted a generic placeholder artifact, so a real
        // 404 (or a 401) rendered as a plausible-looking empty record titled
        // "Artifact". Surface the failure instead of inventing data.
        if (active && !local) setLoadError(true);
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

  async function handleDelete() {
    if (!artifact || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Only navigate away once the server confirms the delete. Navigating
      // first would show the user a Library that "lost" an artifact still
      // sitting in the database.
      await deleteArtifact(artifact.id);
      router.push("/library");
    } catch {
      setDeleteError(
        locale === "ja"
          ? "削除できませんでした。もう一度お試しください。"
          : "Could not delete this artifact. Please try again.",
      );
      setDeleting(false);
    }
  }

  function handleStar() {
    if (!artifact) return;
    setStarred(toggleLibraryArtifactStar(artifact.id));
  }

  if (!artifact) {
    if (loadError) {
      return (
        <div className="mj-library-detail-loading" role="alert">
          {locale === "ja"
            ? "このアーティファクトを読み込めませんでした。"
            : "Could not load this artifact. It may have been deleted, or you may not have access to it."}
        </div>
      );
    }
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
                <button className={`mj-star-toggle mj-star-toggle--icon${starred ? " is-starred" : ""}`} type="button" aria-label={starred ? copy.unstar : copy.star} aria-pressed={starred} title={starred ? copy.unstar : copy.star} onClick={handleStar}>
                  <StarIcon size={18} filled={starred} />
                </button>
                <h1 className="mj-page-title">{artifact.title}</h1>
                <span className={`mj-library-status mj-library-status--${artifact.status}`}><span aria-hidden="true">{verdictChip(artifact, copy).glyph}</span>{verdictChip(artifact, copy).label}</span>
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
            {deleteError ? <p role="alert" className="mj-delete-dialog-error">{deleteError}</p> : null}
            <div className="mj-delete-dialog-actions">
              <button className="mj-secondary-button" type="button" disabled={deleting} onClick={() => { setDeleteOpen(false); setDeleteError(null); }}>{copy.cancel}</button>
              <button className="mj-danger-button" type="button" disabled={deleting} onClick={() => void handleDelete()}>{copy.delete}</button>
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
        <VerificationSummaryPanel summary={artifact.verificationSummary ?? null} />
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>{copy.resources}</h2><span className="mj-mono-muted">{copy.currentVersion}</span></div>
        <dl className="mj-resource-list">{artifact.resourceRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>{copy.evidence}</h2><span className="mj-mono-muted">{copy.savedRecord}</span></div>
        <ul className="mj-evidence-links">
          <li><span>{copy.verificationReport}</span><span className="mj-mono-muted">{copy.available}</span></li>
          <li><span>{copy.runProvenance}</span><span className="mj-mono-muted">{artifact.runId ? copy.linked : artifact.source === "run" ? copy.recorded : copy.example}</span></li>
          <li><span>{copy.exportStatus}</span><span className="mj-mono-muted">{artifact.qasm ? copy.openQasm : copy.frameworkOnly}</span></li>
        </ul>
      </section>
    </div>
  );
}

function CodeAndExport({ artifact, copied, onCopy, copy }: { artifact: LibraryArtifact; copied: boolean; onCopy: (code?: string) => void; copy: ArtifactCopy }) {
  const options = frameworkCodeOptions(artifact);
  const [selected, setSelected] = useState(options[0]?.key ?? "qiskit");
  const selectedOption = options.find((option) => option.key === selected);
  const selectedCode = selectedOption?.code ?? artifact.code;
  function downloadExport() {
    const body = JSON.stringify(artifactExportManifest(artifact, { framework: selected, code: selectedCode }), null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${artifact.slug || artifact.id}.majorana.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="mj-artifact-grid mj-artifact-grid--code">
      <CircuitDiagramPanel artifact={artifact} copy={copy} />
      <section className="mj-artifact-panel mj-artifact-panel--wide">
        <div className="mj-panel-heading"><h2>{copy.sourceCode}</h2><div className="mj-artifact-code-actions">{options.length > 1 ? <label><span className="sr-only">{copy.framework}</span><select value={selected} onChange={(event) => setSelected(event.target.value)}>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label> : null}<button className="mj-secondary-button" type="button" onClick={() => onCopy(selectedCode)} title={copied ? copy.copied : copy.copyCode}><CopyIcon size={14} />{copied ? copy.copied : copy.copyCode}</button></div></div>
        <pre className="mj-artifact-code" tabIndex={0} role="region" aria-label={`${artifact.title} ${selected} ${copy.sourceCode}`}>{selectedCode ? <SyntaxHighlightedCode code={selectedCode} language={selected} /> : <code>{copy.noCode}</code>}</pre>
        {selectedOption?.note ? <p className="mj-artifact-copy">{selectedOption.note}</p> : null}
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>{copy.exportHeading}</h2><button className="mj-secondary-button" type="button" onClick={downloadExport}>Download with verification metadata</button></div>
        <div className="mj-export-state"><span className="mj-library-status mj-library-status--verified"><span aria-hidden="true">✓</span>{artifact.qasm ? copy.lossless : copy.frameworkOnly}</span><p>{artifact.qasm ?? copy.noNative}</p></div>
      </section>
    </div>
  );
}

/** The saved circuit, drawn.
 *
 * Until now this page was code + metadata only: the Vault could tell you a
 * circuit existed and show you its source, but never showed you the circuit.
 * The reconstruction machinery (#150/#151) and the renderer already existed —
 * the renderer was just trapped inside Studio's builder, so it has been lifted
 * into `components/circuit-diagram` and is reused verbatim here.
 *
 * Every branch of the reconstruction is given an honest surface. `too_large`
 * says so and names the numbers rather than drawing an empty canvas, matching
 * what Studio does; `unparsable` (which is what a pre-#148 artifact with no
 * stored QASM looks like) says the export is missing and how to mint one. The
 * one thing this must never do is render a blank frame that reads as "this
 * circuit has no gates". */
function CircuitDiagramPanel({ artifact, copy }: { artifact: LibraryArtifact; copy: ArtifactCopy }) {
  const reconstruction = useMemo(
    () => (artifact.qasm ? reconstructInterchangeCircuit(artifact.qasm) : null),
    [artifact.qasm],
  );

  const body = !reconstruction || reconstruction.kind === "unparsable"
    ? <p className="mj-artifact-copy">{copy.diagramUnavailable}</p>
    : reconstruction.kind === "too_large"
      ? <p className="mj-artifact-copy">{copy.diagramTooLarge(reconstruction.qubitCount, reconstruction.stepCount)}</p>
      : (
        <CircuitDiagram
          qubitCount={reconstruction.circuit.qubitCount}
          steps={reconstruction.circuit.steps}
          customGates={[]}
          ariaLabel={`${artifact.title} circuit diagram`}
        />
      );

  return (
    <section className="mj-artifact-panel mj-artifact-panel--wide">
      <div className="mj-panel-heading">
        <h2>{copy.circuitHeading}</h2>
        <span className="mj-mono-muted">{copy.diagramReadOnly}</span>
      </div>
      {body}
    </section>
  );
}

function frameworkCodeOptions(artifact: LibraryArtifact): Array<{ key: string; label: string; code: string; note?: string }> {
  const provided = new Map<string, string>();
  for (const [framework, code] of Object.entries(artifact.frameworkVariants ?? {})) {
    const normalized = normalizeFramework(framework);
    if (normalized && code) provided.set(normalized, code);
  }
  const primary = normalizeFramework(artifact.framework);
  if (primary && artifact.code) provided.set(primary, artifact.code);
  if (artifact.qasm && looksLikeOpenQasm3(artifact.qasm)) provided.set("openqasm3", artifact.qasm);

  const qasm = artifact.qasm && looksLikeOpenQasm3(artifact.qasm) ? artifact.qasm : null;
  const candidates = [...provided.entries()]
    .map(([framework, code]) => ({ framework, code }))
  const source = candidates.find((candidate) => Boolean(parseCircuitSource(candidate.code, candidate.framework)))
    ?? (qasm ? { framework: "openqasm3", code: qasm } : undefined);

  return CIRCUIT_FRAMEWORKS.flatMap(({ key, label }) => {
    const existing = provided.get(key);
    if (existing) return [{ key, label, code: existing }];
    if (!source) return [];
    const conversion = convertCircuitSource(source.code, source.framework, key, qasm);
    return conversion ? [{
      key,
      label,
      code: conversion.code,
      ...(conversion.fidelity === "standard_gate_decomposition" ? { note: conversion.note } : {}),
    }] : [];
  });
}

function normalizeFramework(value: string): string | null {
  return circuitFrameworkOrNull(value)?.key ?? null;
}

function Runs({ artifact, copy }: { artifact: LibraryArtifact; copy: ArtifactCopy }) {
  const isPublicReference = artifact.source === "public";
  return <section className="mj-artifact-panel"><div className="mj-panel-heading"><h2>{copy.runRecords}</h2><span className="mj-mono-muted">{artifact.runId ?? (isPublicReference ? copy.publicReference : copy.example)}</span></div><div className="mj-run-record"><span className="mj-chat-status">{isPublicReference ? "–" : verdictChip(artifact, copy).glyph}</span><div><strong>{isPublicReference ? copy.publicReference : verdictChip(artifact, copy).label}</strong><p>{isPublicReference ? copy.publicRunBody : copy.runBody}</p></div><span className={`mj-library-status mj-library-status--${artifact.status}`}><span aria-hidden="true">{verdictChip(artifact, copy).glyph}</span>{verdictChip(artifact, copy).label}</span></div></section>;
}

function Verification({ artifact, copy }: { artifact: LibraryArtifact; copy: ArtifactCopy }) {
  const isPublicReference = artifact.source === "public";
  const checks = artifact.checks ?? [];
  return <section className="mj-artifact-panel"><div className="mj-panel-heading"><h2>{copy.verificationEvidence}</h2><span className="mj-mono-muted">{copy.auditSurface}</span></div><div className="mj-verification-detail"><VerificationSummaryPanel summary={artifact.verificationSummary ?? null} />{!artifact.verificationSummary ? <details><summary>{copy.whatChecked}</summary>{checks.length ? <ul className="mj-verification-checks">{checks.map((check) => <li key={check.method}><span className={`mj-verification-check mj-verification-check--${check.result === "pass" ? "pass" : "fail"}`} aria-hidden="true">{check.result === "pass" ? "✓" : "✕"}</span><code>{check.method}</code><span className="mj-mono-muted">{check.result}</span></li>)}</ul> : <p>{isPublicReference ? copy.publicChecked : copy.verifiedChecked}</p>}</details> : null}</div></section>;
}

function Notes({ artifact, copy }: { artifact: LibraryArtifact; copy: ArtifactCopy }) {
  return <section className="mj-artifact-panel"><div className="mj-panel-heading"><h2>{copy.notes}</h2><span className="mj-mono-muted">{copy.workspace}</span></div><p className="mj-artifact-copy">{artifact.source === "demo" ? copy.demoNote : artifact.source === "public" ? copy.publicNote : copy.runNote}</p></section>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="mj-artifact-meta"><span>{label}</span><strong>{value}</strong></div>;
}

function fallbackArtifact(id: string): LibraryArtifact {
  return { id, slug: id, title: "Artifact", family: "Simulation", framework: "Qiskit", status: "legacy_unknown", updatedAt: new Date().toISOString(), description: "Saved artifact in the workspace vault.", tags: ["artifact"], verification: "Verification evidence has not been loaded.", code: "", qasm: null, resourceRows: [], verificationSummary: null, source: "run" };
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
