"use client";

import type { components } from "@majorana/contracts-gen";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { QappRuntime } from "../../../../components/qapp-runtime";
import { qappCopy } from "../../../../lib/qapp-copy";
import { qappEmbedSnippet } from "../../../../lib/qapp-embed-snippet.ts";
import type { PublicLocale } from "../../../../lib/public-locale";
import { rangeSmokeNotice } from "../../../../lib/qapp-range-smoke.ts";

type Qapp = components["schemas"]["Qapp"];
type QappVersion = components["schemas"]["QappVersion"];
type Detail = { qapp: Qapp; version: QappVersion };

export function QappWorkspace({ qappId, locale = "en" }: { qappId: string; locale?: PublicLocale }) {
  const copy = qappCopy(locale).workspace;
  const embedCopy = qappCopy(locale).embed;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [visibilityNotice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setError(null);
    setDetail(null);
    setNotice(null);
    fetch(`/api/qapps/${encodeURIComponent(qappId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(copy.loadFailed);
        return response.json() as Promise<Detail>;
      })
      .then((value) => { if (active) setDetail(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : copy.loadFailed); });
    return () => { active = false; controller.abort(); };
  }, [qappId, reload, copy]);

  async function toggleVisibility() {
    if (!detail || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const visibility = detail.qapp.visibility === "public" ? "private" : "public";
    try {
      const response = await fetch(`/api/qapps/${encodeURIComponent(qappId)}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility }),
      });
      // The control plane speaks RFC 9457 problem+json, so the human-readable
      // reason is `title`. FastAPI's `detail` is never on the wire here; reading
      // it swallows the server's reason and shows the generic fallback instead.
      const payload = await response.json() as Qapp | { title?: string };
      if (!response.ok || !("id" in payload)) {
        throw new Error("title" in payload && payload.title ? payload.title : copy.visibilityFailed);
      }
      const qapp = payload;
      setDetail((current) => current ? { ...current, qapp } : current);
      setNotice(visibility === "public" ? copy.published : copy.madePrivate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.visibilityFailed);
    } finally {
      setSaving(false);
    }
  }

  async function copyPublicLink() {
    if (!detail) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/q/${encodeURIComponent(detail.qapp.slug)}`);
      setNotice(copy.linkCopied);
    } catch {
      setNotice(copy.linkCopyFailed);
    }
  }

  // ai-ops 355, item 5: a small, optional affordance next to "Copy public
  // link" — the snippet itself is `lib/qapp-embed-snippet.ts`, tested there,
  // so this button is just wiring, the same shape as `copyPublicLink` above.
  async function copyEmbedCode() {
    if (!detail) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(qappEmbedSnippet(window.location.origin, detail.qapp.slug));
      setNotice(embedCopy.embedCopied);
    } catch {
      setNotice(embedCopy.embedCopyFailed);
    }
  }

  async function deleteQapp() {
    if (!detail || deleting) return;
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/qapps/${encodeURIComponent(qappId)}`, { method: "DELETE" });
      if (!response.ok) {
        // problem+json again: `title` carries the reason (creator-only, read-only role).
        const payload = await response.json().catch(() => null) as { title?: string } | null;
        throw new Error(payload?.title || copy.deleteFailed);
      }
      router.push("/qapps");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.deleteFailed);
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  if (error && !detail) return <div className="qapp-private-empty leona-workspace-state" role="alert"><p>{error}</p><button className="mj-secondary-button" type="button" onClick={() => setReload((value) => value + 1)}>{copy.tryAgain}</button><Link href="/qapps">{copy.all}</Link></div>;
  if (!detail || detail.qapp.id !== qappId) return <div className="qapp-private-empty" role="status">{copy.loading}</div>;
  const isPublic = detail.qapp.visibility === "public";
  const notice = rangeSmokeNotice(detail.version.range_smoke, locale);
  return (
    <section className="qapp-private-page">
      <Link className="leona-workspace-back" href="/qapps">{copy.all}</Link>
      <header className="qapp-private-header">
        <div>
          <p className="qapp-kicker">{copy.kicker(detail.version.framework)}</p>
          <h1>{detail.qapp.title}</h1>
          <p>{detail.qapp.description}</p>
        </div>
        <div className="qapp-private-actions">
          {isPublic ? <Link className="mj-secondary-button" href={`/q/${encodeURIComponent(detail.qapp.slug)}`}>{copy.openPublic}</Link> : null}
          {isPublic ? <button className="mj-secondary-button" type="button" onClick={() => void copyPublicLink()}>{copy.copyLink}</button> : null}
          {isPublic ? <button className="mj-secondary-button" type="button" onClick={() => void copyEmbedCode()}>{embedCopy.copyEmbed}</button> : null}
          <Link className="mj-secondary-button" href={`/qapps/${encodeURIComponent(qappId)}/versions`}>{copy.versionsHeading}</Link>
          <Link className="mj-secondary-button" href={`/qapps/${encodeURIComponent(qappId)}/usage`}>{copy.usageHeading}</Link>
          <button className="mj-primary-button" type="button" disabled={saving || deleting} onClick={() => void toggleVisibility()}>
            {saving ? copy.saving : isPublic ? copy.makePrivate : copy.publish}
          </button>
          {confirmingDelete ? (
            <>
              <button className="mj-workspace-leave" type="button" disabled={deleting} onClick={() => void deleteQapp()}>
                {deleting ? copy.deleting : copy.deleteConfirm}
              </button>
              <button className="mj-secondary-button" type="button" disabled={deleting} onClick={() => setConfirmingDelete(false)}>
                {copy.deleteCancel}
              </button>
            </>
          ) : (
            <button className="mj-workspace-leave" type="button" disabled={saving} onClick={() => setConfirmingDelete(true)}>
              {copy.deleteQapp}
            </button>
          )}
        </div>
      </header>
      {confirmingDelete ? <p className="mj-artifact-copy" role="status">{copy.deleteWarning}</p> : null}
      {error ? <p role="alert" className="qapp-private-error">{error}</p> : null}
      {visibilityNotice ? <p className="leona-workspace-feedback" role="status">{visibilityNotice}</p> : null}
      {notice ? (
        <p
          className={`qapp-range-smoke qapp-range-smoke-${notice.tone}`}
          role={notice.tone === "warn" ? "alert" : "status"}
        >
          <strong>{notice.tone === "warn" ? copy.smokeWarnHeading : copy.smokeOkHeading}</strong>
          {" "}
          {notice.text}
        </p>
      ) : null}
      <QappRuntime slug={detail.qapp.slug} uiDocument={detail.version.ui_document} canExecute locale={locale} />
    </section>
  );
}
