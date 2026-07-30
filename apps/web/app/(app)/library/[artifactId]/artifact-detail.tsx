"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SyntaxHighlightedCode, VerificationSummaryPanel } from "@majorana/ui";
import { CopyIcon, MoreIcon, StarIcon } from "../../../../components/icons";
import { archiveArtifact, artifactFromResource, deleteArtifact, frameworkVariantsFromRemote, getLibraryArtifact, loadStarredLibraryArtifactIds, statusFromVerificationSummary, toggleLibraryArtifactStar, type LibraryArtifact } from "../../../../lib/library-data";
import { verificationFromMetadata, verificationFromResource } from "../../../../lib/verification-record";
import { measuredResultFromMetadata, type MeasuredResult } from "../../../../lib/measured-result";
import { formatShare, simulationChartData } from "../../../../lib/simulation-visual";
import type { PublicLocale } from "../../../../lib/public-locale";
import { circuitFramework } from "../../../../lib/circuit-frameworks";
import { parseCircuitSource, reconstructInterchangeCircuit } from "../../../../lib/circuit-conversion";
import {
  frameworkCodeOptions as sharedFrameworkCodeOptions,
  type FrameworkCodeOption,
} from "../../../../lib/framework-code-options";
import { MAX_VIEWABLE_QUBITS, MAX_VIEWABLE_STEPS } from "../../../../lib/studio-parse";
import { CircuitDiagram } from "../../../../components/circuit-diagram";
import { artifactExportFilename, artifactExportManifest, artifactExportSource, fileExtension } from "../../../../lib/artifact-export";

type DetailTab = "overview" | "code" | "runs" | "verification" | "notes";

export const DETAIL_COPY: Record<PublicLocale, {
  back: string; reference: string; verified: string; structural: string; options: string; openStudio: string; openRun: string; askInRun: string; archive: string; delete: string; cancel: string; deleteConfirmTitle: string; deleteWarning: (title: string) => string; star: string; unstar: string; framework: string; type: string; artifact: string; updated: string; source: string; runSource: string; publicSource: string; curatedSource: string; tabs: Record<DetailTab, string>; overview: string; verificationSummary: string; resources: string; currentVersion: string; evidence: string; savedRecord: string; verificationReport: string; available: string; runProvenance: string; linked: string; example: string; recorded: string; exportStatus: string; openQasm: string; frameworkOnly: string; sourceCode: string; exportHeading: string; classified: string; copied: string; copyCode: string; noCode: string; lossless: string; noNative: string; runRecords: string; publicReference: string; verifiedRun: string; referenceRun: string; publicRunBody: string; runBody: string; verificationEvidence: string; auditSurface: string; whatChecked: string; publicChecked: string; verifiedChecked: string; notes: string; workspace: string; demoNote: string; publicNote: string; runNote: string; loading: string; unknown: string; circuitHeading: string; diagramReadOnly: string; diagramTooLarge: (qubits: number, steps: number) => string; diagramUnavailable: string; downloadSource: (extension: string) => string; downloadManifest: string; measuredResult: string; shotsLabel: (shots: number) => string; countsLabel: (shots: number) => string; truncatedNote: (shown: number, total: number) => string;
}> = {
  en: {
    back: "← Vault", reference: "Reference", verified: "Verified", structural: "Structurally verified", options: "Artifact options", openStudio: "Open in Studio", openRun: "Open in Run", askInRun: "Ask in Run", archive: "Archive", delete: "Delete", cancel: "Cancel", deleteConfirmTitle: "Are you sure?", deleteWarning: (title) => `“${title}” will be removed from your workspace and not saved.`, star: "Star artifact", unstar: "Remove artifact star", framework: "Framework", type: "Type", artifact: "artifact", updated: "Updated", source: "Source", runSource: "Leona Run", publicSource: "Public Atlas", curatedSource: "Curated example", tabs: { overview: "Overview", code: "Code & Export", runs: "Runs", verification: "Verification", notes: "Notes" }, overview: "Overview", verificationSummary: "Verification summary", resources: "Resources", currentVersion: "current version", evidence: "Evidence", savedRecord: "saved record", verificationReport: "Verification report", available: "available", runProvenance: "Run provenance", linked: "linked", example: "example", recorded: "recorded with the run", exportStatus: "Export status", openQasm: "OpenQASM 3", frameworkOnly: "framework only", sourceCode: "Source code", exportHeading: "Export", classified: "classified", copied: "Copied", copyCode: "Copy code", noCode: "Code will appear after the artifact is loaded from the control plane.", lossless: "Lossless", noNative: "No native OpenQASM export was saved for this artifact.", runRecords: "Run records", publicReference: "Public reference", verifiedRun: "Verified Leona Run", referenceRun: "Reference run", publicRunBody: "Public source context and export metadata are retained. Run this copy before treating it as new workspace evidence.", runBody: "Simulation evidence, verification parameters, and export status are retained with this artifact.", verificationEvidence: "Verification evidence", auditSurface: "audit surface", whatChecked: "What was checked", publicChecked: "The public record's stated method, result, source, and export boundary were preserved. Execute this private copy to create workspace-specific evidence.", verifiedChecked: "No machine-readable check record was saved with this version — it predates the stored check list.", notes: "Notes", workspace: "workspace", demoNote: "This is a curated replayable example.", publicNote: "This entry was imported from the public research database; source and license context are retained in the saved version.", runNote: "This entry was saved from a live workspace run.", loading: "Loading artifact…", unknown: "Unknown", circuitHeading: "Circuit", diagramReadOnly: "read-only", diagramTooLarge: (qubits, steps) => `This circuit is too large to draw (${qubits} qubits, ${steps} operations). Read it as code below.`, diagramUnavailable: "No stored OpenQASM 3 export to draw from. Rerun Verify & save to mint one.", downloadSource: (extension) => `Download .${extension}`, downloadManifest: "Download with verification metadata", measuredResult: "Measured result", shotsLabel: (shots) => `${shots.toLocaleString("en-US")} shots`, countsLabel: (shots) => `Measured counts from ${shots.toLocaleString("en-US")} shots`, truncatedNote: (shown, total) => `Showing the ${shown} heaviest of ${total.toLocaleString("en-US")} measured outcomes.`,
  },
  ja: {
    back: "← Vault",
    reference: "参照資料",
    verified: "検証済み",
    structural: "構造のみ検証",
    options: "回路の操作",
    openStudio: "Studioで開く",
    openRun: "Runで開く",
    askInRun: "Runで質問する",
    archive: "アーカイブ",
    delete: "削除",
    cancel: "キャンセル",
    deleteConfirmTitle: "この回路を削除しますか？",
    deleteWarning: (title) => `「${title}」をワークスペースから完全に削除します。この操作は取り消せません。`,
    star: "この回路にスターを付ける",
    unstar: "この回路のスターを外す",
    framework: "フレームワーク",
    type: "種類",
    artifact: "回路",
    updated: "更新日",
    source: "作成元",
    runSource: "Leona Run",
    publicSource: "Atlas",
    curatedSource: "サンプル",
    tabs: { overview: "概要", code: "コードと書き出し", runs: "実行記録", verification: "検証結果", notes: "メモ" },
    overview: "概要",
    verificationSummary: "検証結果",
    resources: "回路情報",
    currentVersion: "現在のバージョン",
    evidence: "検証結果",
    savedRecord: "保存済み",
    verificationReport: "検証レポート",
    available: "確認可能",
    runProvenance: "実行元と条件",
    linked: "関連付け済み",
    example: "サンプル",
    recorded: "実行時に記録",
    exportStatus: "書き出し状況",
    openQasm: "OpenQASM 3",
    frameworkOnly: "元のフレームワークのみ",
    sourceCode: "ソースコード",
    exportHeading: "書き出し",
    classified: "判定済み",
    copied: "コピーしました",
    copyCode: "コードをコピー",
    noCode: "サーバーから回路を読み込むとコードが表示されます。",
    lossless: "情報を保持",
    noNative: "この回路にはOpenQASM形式の書き出しデータが保存されていません。",
    runRecords: "実行記録",
    publicReference: "Atlasの参照資料",
    verifiedRun: "検証済みのLeona Run",
    referenceRun: "参照用の実行",
    publicRunBody: "公開元、出典、書き出し可能な範囲を保持しています。自分の検証結果として使う前に、このコピーを実行してください。",
    runBody: "シミュレーション結果、検証条件、書き出し状況をこの回路と一緒に保存しています。",
    verificationEvidence: "検証結果",
    auditSurface: "確認記録",
    whatChecked: "確認した内容",
    publicChecked: "公開資料に記載された方法、結果、出典、書き出し範囲を保持しています。このワークスペースで実行すると、独自の検証記録を作成できます。",
    verifiedChecked: "このバージョンには詳細な検証項目が保存されていません。検証項目の保存機能が追加される前に作成された回路です。",
    notes: "メモ",
    workspace: "ワークスペース",
    demoNote: "実行して確かめられるサンプルです。",
    publicNote: "Atlasから追加した公開資料です。出典とライセンス情報は保存したバージョンに保持されます。",
    runNote: "この回路はワークスペースでの実行結果から保存されました。",
    loading: "回路を読み込んでいます…",
    unknown: "不明",
    circuitHeading: "回路",
    diagramReadOnly: "読み取り専用",
    diagramTooLarge: (qubits, steps) => `回路が大きいため描画できません（${qubits}量子ビット、${steps}操作）。下のコードで確認してください。`,
    diagramUnavailable: "回路図の生成に必要なOpenQASM 3データがありません。「検証して保存」をもう一度実行してください。",
    downloadSource: (extension) => `.${extension}形式でダウンロード`,
    downloadManifest: "検証情報と一緒にダウンロード",
    measuredResult: "測定結果",
    shotsLabel: (shots) => `${shots.toLocaleString("ja-JP")}ショット`,
    countsLabel: (shots) => `${shots.toLocaleString("ja-JP")}ショットの測定結果`,
    truncatedNote: (shown, total) => `${total.toLocaleString("ja-JP")}通りの測定結果のうち、件数が多い上位${shown}件を表示しています。`,
  },
};
type ArtifactCopy = (typeof DETAIL_COPY)[PublicLocale];

/** The word this artifact has earned, and the glyph that goes with it.
 *
 * Four places on this page printed the literal "Verified" off `copy.verified`,
 * independent of the artifact's status, so an artifact whose only evidence was a
 * return-contract check read exactly like one checked against the physics. See
 * plans/evidence-strength-labelling.md. */
function verdictChip(artifact: LibraryArtifact, copy: ArtifactCopy, locale: PublicLocale): { label: string; glyph: string } {
  if (artifact.source === "public") return { label: copy.reference, glyph: "–" };
  if (artifact.status === "structural") return { label: copy.structural, glyph: "–" };
  if (artifact.status === "verified") return { label: copy.verified, glyph: "✓" };
  if (artifact.status === "failed") return { label: locale === "ja" ? "検証失敗" : "Failed", glyph: "×" };
  if (
    artifact.status === "inconclusive"
    && artifact.verificationSummary?.reason_code === "ai_review_aligned"
  ) {
    return { label: locale === "ja" ? "実行済み" : "Executed", glyph: "–" };
  }
  if (artifact.status === "inconclusive") {
    return { label: locale === "ja" ? "検証結果なし" : "Verification unavailable", glyph: "–" };
  }
  if (artifact.status === "stale") return { label: locale === "ja" ? "要再検証" : "Verification stale", glyph: "–" };
  return { label: locale === "ja" ? "旧形式・検証記録なし" : "Legacy evidence unknown", glyph: "–" };
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
              measuredResult: measuredResultFromMetadata(version.metadata) ?? current?.measuredResult ?? null,
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
            ? "この回路を読み込めませんでした。削除されたか、アクセス権がない可能性があります。"
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
                <span className={`mj-library-status mj-library-status--${artifact.status}`}><span aria-hidden="true">{verdictChip(artifact, copy, locale).glyph}</span>{verdictChip(artifact, copy, locale).label}</span>
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

          {tab === "overview" ? <Overview artifact={artifact} copy={copy} locale={locale} /> : null}
          {tab === "code" ? <CodeAndExport artifact={artifact} copied={copied} onCopy={copyCode} copy={copy} /> : null}
          {tab === "runs" ? <Runs artifact={artifact} copy={copy} locale={locale} /> : null}
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

function Overview({ artifact, copy, locale }: { artifact: LibraryArtifact; copy: ArtifactCopy; locale: PublicLocale }) {
  return (
    <div className="mj-artifact-grid">
      <section className="mj-artifact-panel mj-artifact-panel--wide">
        <div className="mj-panel-heading"><h2>{copy.overview}</h2><span className="mj-mono-muted">{artifact.slug}</span></div>
        <p className="mj-artifact-copy">{artifact.description}</p>
        <div className="mj-tag-list">{artifact.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <h3>{copy.verificationSummary}</h3>
        <VerificationSummaryPanel summary={artifact.verificationSummary ?? null} />
      </section>
      <MeasuredResultPanel measured={artifact.measuredResult ?? null} copy={copy} locale={locale} />
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

/** What the program measured — the thing a verdict is a verdict *about*.
 *
 * Deliberately absent rather than empty when the artifact carries no measurement:
 * everything saved before 2026-07-26 predates the stored field, and an empty chart
 * would read as "this run measured nothing" instead of "this artifact does not
 * carry it". Reuses the Run surface's bar markup so one experiment does not get two
 * different-looking histograms depending on which page it is read from. */
export function MeasuredResultPanel({ measured, copy, locale = "en" }: { measured: MeasuredResult | null; copy: ArtifactCopy; locale?: PublicLocale }) {
  const numberLocale = locale === "ja" ? "ja-JP" : "en-US";
  if (!measured) return null;
  // Same chart math as the Run surface, so one experiment does not get a 12-bar
  // histogram on the page that produced it and a 64-bar wall in the Vault. The
  // first draft rendered every stored outcome and buried the Overview tab.
  const data = measured.counts ? simulationChartData(measured.counts, measured.shots) : null;
  // One honest sentence covering both ways outcomes can be missing: capped for
  // display here, and capped for storage by the worker on a wide distribution.
  const shown = data?.bars.length ?? 0;
  const omitted = measured.outcomeCount > shown;
  return (
    <section className="mj-artifact-panel">
      <div className="mj-panel-heading">
        <h2>{copy.measuredResult}</h2>
        <span className="mj-mono-muted">
          {measured.shots ? copy.shotsLabel(measured.shots) : copy.savedRecord}
        </span>
      </div>
      {measured.values.length ? (
        <dl className="mj-resource-list">
          {measured.values.map((value) => (
            <div key={value.label}><dt>{value.label}</dt><dd>{value.value.toLocaleString(numberLocale)}</dd></div>
          ))}
        </dl>
      ) : null}
      {data ? (
        <div className="mj-run-live-chart" role="group" aria-label={copy.countsLabel(measured.shots)}>
          {data.bars.map((bar) => (
            <div className="mj-run-live-bar" key={bar.bitstring}>
              <code>{bar.bitstring}</code>
              <span className="mj-run-live-bar-track" aria-hidden="true">
                <span style={{ width: `${(bar.count / data.peak.count) * 100}%` }} />
              </span>
              <span>
                {bar.count.toLocaleString(numberLocale)}
                <small>{formatShare(bar.share, numberLocale)}</small>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {omitted ? (
        <p className="mj-artifact-copy mj-mono-muted">
          {copy.truncatedNote(shown, measured.outcomeCount)}
        </p>
      ) : null}
    </section>
  );
}

function CodeAndExport({ artifact, copied, onCopy, copy }: { artifact: LibraryArtifact; copied: boolean; onCopy: (code?: string) => void; copy: ArtifactCopy }) {
  const options = frameworkCodeOptions(artifact);
  const [selected, setSelected] = useState(options[0]?.key ?? "qiskit");
  const selectedOption = options.find((option) => option.key === selected);
  const selectedCode = selectedOption?.code ?? artifact.code;
  function download(body: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  function downloadExport() {
    download(
      JSON.stringify(artifactExportManifest(artifact, { framework: selected, code: selectedCode }), null, 2),
      `${artifact.slug || artifact.id}.majorana.json`,
      "application/json",
    );
  }
  // The manifest is for re-importing into Leona; a researcher who wants to run
  // this circuit in their own notebook needs the actual file, not a JSON
  // envelope they have to unwrap by hand first.
  function downloadSource() {
    download(
      artifactExportSource(artifact, { framework: selected, code: selectedCode }),
      artifactExportFilename(artifact, selected),
      "text/plain",
    );
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
        <div className="mj-panel-heading"><h2>{copy.exportHeading}</h2><div className="mj-artifact-code-actions"><button className="mj-secondary-button" type="button" onClick={downloadSource} disabled={!selectedCode} title={artifactExportFilename(artifact, selected)}>{copy.downloadSource(fileExtension(artifactExportFilename(artifact, selected)))}</button><button className="mj-secondary-button" type="button" onClick={downloadExport}>{copy.downloadManifest}</button></div></div>
        <div className="mj-export-state"><span className="mj-library-status mj-library-status--verified"><span aria-hidden="true">✓</span>{artifact.qasm ? copy.lossless : copy.frameworkOnly}</span><p>{artifact.qasm ?? copy.noNative}</p></div>
      </section>
    </div>
  );
}

/** The saved circuit, drawn.
 *
 * Until now this page was code + metadata only: the Vault could tell you a
 * circuit existed and show you its source, but never showed you the circuit.
 * The reconstruction machinery (PRs 150/151) and the renderer already existed —
 * the renderer was just trapped inside Studio's builder, so it has been lifted
 * into `components/circuit-diagram` and is reused verbatim here.
 *
 * Every branch of the reconstruction is given an honest surface. `too_large`
 * says so and names the numbers rather than drawing an empty canvas, matching
 * what Studio does; `unparsable` (which is what a pre-PR-148 artifact with no
 * stored QASM looks like) says the export is missing and how to mint one. The
 * one thing this must never do is render a blank frame that reads as "this
 * circuit has no gates".
 *
 * (Issue refs are spelled "PR 148" rather than with a leading hash on purpose —
 * the repo's raw-hex lint gate reads a hash followed by three digits as a CSS
 * color literal.) */
function CircuitDiagramPanel({ artifact, copy }: { artifact: LibraryArtifact; copy: ArtifactCopy }) {
  const reconstruction = useMemo(
    () => {
      if (artifact.qasm) return reconstructInterchangeCircuit(artifact.qasm);
      // No stored QASM is the *common* case for anything saved before PR 148,
      // not an edge case, and those are exactly the artifacts someone is most
      // likely to open. Their framework source is sitting right here, so try
      // it rather than going straight to "re-verify to mint one".
      //
      // This recovers a subset, not everything, and that was measured rather
      // than assumed: `parseCircuitSource` accepts only the canonical builder
      // shape (`QuantumCircuit(n)` + `measure_all()`), so freely-written
      // model output using `QuantumCircuit(n, n)` or explicit `qc.measure(...)`
      // still returns null and correctly falls through to the honest
      // "no export to draw from" note. Worth having anyway — it costs one
      // parse attempt and strictly increases how many artifacts draw.
      //
      // The viewing ceiling is passed explicitly because this parser defaults
      // to the six-wire *editable* bound, which is not the bound that applies
      // to a read-only drawing: a canonical 10q circuit parses with the
      // ceiling passed and returns null without it.
      const parsed = artifact.code
        ? parseCircuitSource(artifact.code, artifact.framework, MAX_VIEWABLE_QUBITS)
        : null;
      if (!parsed) return null;
      if (parsed.steps.length > MAX_VIEWABLE_STEPS) {
        return { kind: "too_large" as const, qubitCount: parsed.qubitCount, stepCount: parsed.steps.length };
      }
      return { kind: "ok" as const, circuit: parsed };
    },
    [artifact.qasm, artifact.code, artifact.framework],
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

// Shared with the Run surface's Final Output — see lib/framework-code-options.
// Keeping one implementation is the only way "conversions show up wherever code
// does" stays true as frameworks are added.
function frameworkCodeOptions(artifact: LibraryArtifact): FrameworkCodeOption[] {
  return sharedFrameworkCodeOptions({
    framework: artifact.framework,
    code: artifact.code,
    qasm: artifact.qasm,
    frameworkVariants: artifact.frameworkVariants,
  });
}

function Runs({ artifact, copy, locale }: { artifact: LibraryArtifact; copy: ArtifactCopy; locale: PublicLocale }) {
  const isPublicReference = artifact.source === "public";
  return <section className="mj-artifact-panel"><div className="mj-panel-heading"><h2>{copy.runRecords}</h2><span className="mj-mono-muted">{artifact.runId ?? (isPublicReference ? copy.publicReference : copy.example)}</span></div><div className="mj-run-record"><span className="mj-chat-status">{isPublicReference ? "–" : verdictChip(artifact, copy, locale).glyph}</span><div><strong>{isPublicReference ? copy.publicReference : verdictChip(artifact, copy, locale).label}</strong><p>{isPublicReference ? copy.publicRunBody : copy.runBody}</p></div><span className={`mj-library-status mj-library-status--${artifact.status}`}><span aria-hidden="true">{verdictChip(artifact, copy, locale).glyph}</span>{verdictChip(artifact, copy, locale).label}</span></div></section>;
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
