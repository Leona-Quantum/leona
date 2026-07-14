"use client";

import { useState } from "react";

type RepositoryExportActionProps = {
  slug: string;
  title: string;
  isSignedIn: boolean;
  signInHref: string | null;
};

export function RepositoryExportAction({
  slug,
  title,
  isSignedIn,
  signInHref,
}: RepositoryExportActionProps) {
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
        throw new Error(payload.error ?? "The entry could not be added to your Library.");
      }
      window.location.assign(`/library/${encodeURIComponent(payload.id)}`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "The entry could not be added to your Library.");
      setExporting(false);
    }
  }

  return (
    <>
      <button className="mj-repository-export-button" type="button" onClick={exportToLibrary} disabled={exporting}>
        {exporting ? "Adding…" : isSignedIn ? "Add to my Library" : "Add to Library"}
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
            <button className="mj-icon-button mj-repository-dialog-close" type="button" aria-label="Close" onClick={() => setDialogOpen(false)}>×</button>
            <p className="mj-section-label">Personal Library</p>
            <h2 id="repository-export-dialog-title">Sign in to unlock your workspace.</h2>
            <p>
              {title} can be copied into your private Library, where you can open the code in
              Studio or continue it in a verified Run. Each account has its own workspace.
            </p>
            {signInHref ? (
              <a className="mj-primary-button" href={signInHref}>Sign in to continue</a>
            ) : (
              <p className="mj-repository-dialog-note">Authentication is not configured in this environment yet. Contact us to request access.</p>
            )}
            <a className="mj-text-link" href="/contact">Contact Majorana ↗</a>
          </section>
        </div>
      ) : null}
    </>
  );
}
