"use client";

import { useState } from "react";
import type { PublicLocale } from "../../lib/public-locale";

const COPY: Record<PublicLocale, {
  adding: string;
  addPrivate: string;
  add: string;
  close: string;
  library: string;
  title: string;
  body: string;
  signIn: string;
  unavailable: string;
  contact: string;
  error: string;
}> = {
  en: {
    adding: "Adding…",
    addPrivate: "Add to my Library",
    add: "Add to Library",
    close: "Close",
    library: "Personal Library",
    title: "Sign in to unlock your workspace.",
    body: "can be copied into your private Library, where you can open the code in Studio or continue it in a verified Run. Each account has its own workspace.",
    signIn: "Sign in to continue",
    unavailable: "Authentication is not configured in this environment yet. Contact us to request access.",
    contact: "Contact LeonaQ ↗",
    error: "The entry could not be added to your Library.",
  },
  ja: {
    adding: "追加中…",
    addPrivate: "自分のLibraryに追加",
    add: "Libraryに追加",
    close: "閉じる",
    library: "個人Library",
    title: "サインインしてワークスペースを開きます。",
    body: "を非公開Libraryへコピーすると、Studioでコードを開いたり、検証済みの実行で続けたりできます。アカウントごとに専用ワークスペースがあります。",
    signIn: "サインインして続ける",
    unavailable: "この環境では認証がまだ設定されていません。アクセスを申請するにはお問い合わせください。",
    contact: "LeonaQに連絡 ↗",
    error: "エントリをLibraryに追加できませんでした。",
  },
};

type RepositoryExportActionProps = {
  slug: string;
  title: string;
  isSignedIn: boolean;
  signInHref: string | null;
  locale?: PublicLocale;
};

export function RepositoryExportAction({
  slug,
  title,
  isSignedIn,
  signInHref,
  locale = "en",
}: RepositoryExportActionProps) {
  const copy = COPY[locale];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function exportToLibrary() {
    if (!isSignedIn) {
      setDialogOpen(true);
      return;
    }
    if (exporting) return;
    setExporting(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/repository/${encodeURIComponent(slug)}/export`, {
        method: "POST",
        cache: "no-store",
      });
      const payload = (await response.json()) as { id?: string; title?: string; error?: string };
      if (!response.ok || typeof payload.id !== "string") {
        throw new Error(payload.error ?? copy.error);
      }
      window.location.assign(`/library/${encodeURIComponent(payload.id)}`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : copy.error);
      setExporting(false);
    }
  }

  return (
    <>
      <button className="mj-repository-export-button" type="button" onClick={exportToLibrary} disabled={exporting}>
        {exporting ? copy.adding : isSignedIn ? copy.addPrivate : copy.add}
      </button>
      {status ? <p className="mj-repository-export-status" role="status">{status}</p> : null}
      {dialogOpen ? (
        <div className="mj-repository-dialog-backdrop" role="presentation" onClick={() => setDialogOpen(false)}>
          <section
            className="mj-repository-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="repository-export-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="mj-icon-button mj-repository-dialog-close" type="button" aria-label={copy.close} title={copy.close} onClick={() => setDialogOpen(false)}>×</button>
            <p className="mj-section-label">{copy.library}</p>
            <h2 id="repository-export-dialog-title">{copy.title}</h2>
            <p>
              {title} {copy.body}
            </p>
            {signInHref ? (
              <a className="mj-primary-button" href={signInHref}>{copy.signIn}</a>
            ) : (
              <p className="mj-repository-dialog-note">{copy.unavailable}</p>
            )}
            <a className="mj-text-link" href="/contact">{copy.contact}</a>
          </section>
        </div>
      ) : null}
    </>
  );
}
