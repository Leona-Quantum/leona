"use client";

import { useState } from "react";
import { SignInLink } from "../../components/sign-in-link";
import type { PublicLocale } from "../../lib/public-locale";
import { WORKSPACE_COPY } from "../../lib/workspace-locale";

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
  starBoundary: string;
  openingSignIn: string;
}> = {
  en: {
    adding: "Adding…",
    addPrivate: "Add to my Studio",
    add: "Add to Studio",
    close: "Close",
    library: "Personal workspace",
    title: "Sign in to unlock your workspace.",
    body: "can be copied into your private workspace, where you can open the code in Studio or continue it in a verified Run. Each account has its own.",
    signIn: "Sign in to continue",
    unavailable: "Authentication is not configured in this environment yet. Contact us to request access.",
    contact: "Contact Leona Quantum ↗",
    error: "The entry could not be added to your workspace.",
    starBoundary: "This public Atlas star is not copied with the entry; the private copy starts unstarred.",
    openingSignIn: "Opening sign in…",
  },
  ja: {
    adding: "追加中…",
    addPrivate: "自分のStudioに追加",
    add: "Studioに追加",
    close: "閉じる",
    library: "個人ワークスペース",
    title: "サインインすると、研究を自分の環境で試せます。",
    body: "を個人のワークスペースに追加すると、Studioでコードを確認・編集し、Leona Runで実行・検証できます。",
    signIn: "サインインして続ける",
    unavailable: "この環境では認証がまだ設定されていません。アクセスを申請するにはお問い合わせください。",
    contact: "Leona Quantumに問い合わせる ↗",
    error: "この資料をワークスペースに追加できませんでした。",
    starBoundary: "Atlasで付けたスターは、追加したコピーには引き継がれません。",
    openingSignIn: "サインインを開いています…",
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
      window.location.assign(`/studio?artifact=${encodeURIComponent(payload.id)}`);
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
            <p className="mj-repository-dialog-note">{copy.starBoundary}</p>
            {signInHref ? (
              <SignInLink className="mj-primary-button" href={signInHref} pendingLabel={copy.openingSignIn}>
                {copy.signIn}
              </SignInLink>
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

/**
 * Sibling to `RepositoryExportAction`: opens `/notebooks` seeded from this
 * Atlas record. A plain link, not a dialog — unlike "Add to Studio", a
 * signed-out visitor following it lands on `/notebooks`, which sits under
 * `app/(app)/` and is auth-gated by that layout the ordinary way, so there is
 * nothing bespoke to build here for the signed-out case.
 */
export function RepositoryNotebookAction({ slug, locale = "en" }: { slug: string; locale?: PublicLocale }) {
  const label = WORKSPACE_COPY[locale].notebooks.teachMeInNotebook;
  return (
    <a className="mj-text-link" href={`/notebooks?seed=${encodeURIComponent(`atlas-record:${slug}`)}`}>
      {label}
    </a>
  );
}
