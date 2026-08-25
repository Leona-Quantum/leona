"use client";

import type { components } from "@majorana/contracts-gen";
import Link from "next/link";
import { useEffect, useState } from "react";
import { QappRuntime } from "../../../../components/qapp-runtime";

type Qapp = components["schemas"]["Qapp"];
type QappVersion = components["schemas"]["QappVersion"];
type Detail = { qapp: Qapp; version: QappVersion };

export function QappWorkspace({ qappId }: { qappId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/qapps/${encodeURIComponent(qappId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Qapp could not be loaded.");
        return response.json() as Promise<Detail>;
      })
      .then((value) => { if (active) setDetail(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Qapp could not be loaded."); });
    return () => { active = false; };
  }, [qappId]);

  async function toggleVisibility() {
    if (!detail || saving) return;
    setSaving(true);
    setError(null);
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
        throw new Error("title" in payload && payload.title ? payload.title : "Visibility could not be changed.");
      }
      const qapp = payload;
      setDetail((current) => current ? { ...current, qapp } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Visibility could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  if (error && !detail) return <div className="qapp-private-empty" role="alert">{error}</div>;
  if (!detail) return <div className="qapp-private-empty" role="status">Loading Qapp…</div>;
  const isPublic = detail.qapp.visibility === "public";
  return (
    <main className="qapp-private-page">
      <header className="qapp-private-header">
        <div>
          <p className="qapp-kicker">Qapp · {detail.version.framework} · private workspace</p>
          <h1>{detail.qapp.title}</h1>
          <p>{detail.qapp.description}</p>
        </div>
        <div className="qapp-private-actions">
          {isPublic ? <Link className="mj-secondary-button" href={`/q/${encodeURIComponent(detail.qapp.slug)}`}>Open public page ↗</Link> : null}
          <button className="mj-primary-button" type="button" disabled={saving} onClick={() => void toggleVisibility()}>
            {saving ? "Saving…" : isPublic ? "Make private" : "Publish worldwide"}
          </button>
        </div>
      </header>
      {error ? <p role="alert" className="qapp-private-error">{error}</p> : null}
      <QappRuntime slug={detail.qapp.slug} uiDocument={detail.version.ui_document} canExecute />
    </main>
  );
}
