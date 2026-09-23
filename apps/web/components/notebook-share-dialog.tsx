"use client";

import type { components } from "@majorana/contracts-gen";
import { useRef, useState } from "react";
import { notebookShareCopy } from "../lib/notebook-share-copy";
import type { PublicLocale } from "../lib/public-locale";

type NotebookShareLink = components["schemas"]["NotebookShareLink"];

/**
 * The notebook creator's share-link manager: mint, list, revoke. Opened from
 * a "Share" button in `notebook-workspace.tsx`, shown only to the notebook's
 * owner — the control plane enforces that independently
 * (`repos/notebook_share_links.py::_owned_notebook`), so a stray render here
 * for a non-owner would 403 rather than leak anything, but the button is
 * hidden for them anyway on the same reasoning `notebook-download.ts` already
 * applies to the solutions-download button.
 *
 * A native `<dialog>` rather than a hand-rolled overlay: focus trapping,
 * Escape-to-close and a backdrop come from the platform, so there is nothing
 * bespoke here to get wrong.
 *
 * ## The secret is held in component state and nowhere else
 *
 * A minted link's token comes back once. It lives in `minted` state so the
 * creator can copy it, and it is never written to `localStorage`,
 * `sessionStorage` or a URL — same discipline `access-tokens.tsx` follows for
 * personal access tokens, for the same reason: closing the dialog loses it,
 * which is correct, and the copy beside it says so.
 */
export function NotebookShareDialog({
  notebookId,
  locale,
}: {
  notebookId: string;
  locale: PublicLocale;
}) {
  const copy = notebookShareCopy(locale).dialog;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [links, setLinks] = useState<NotebookShareLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [expiryDays, setExpiryDays] = useState<"" | "7" | "30" | "90">("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const response = await fetch(
        `/api/notebooks/${encodeURIComponent(notebookId)}/share-links`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setError(copy.createFailed);
        return;
      }
      const body = (await response.json()) as { items?: NotebookShareLink[] };
      setLinks(body.items ?? []);
      setError(null);
    } catch {
      setError(copy.createFailed);
    }
  }

  function open() {
    setMinted(null);
    setCopied(false);
    void load();
    dialogRef.current?.showModal();
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/notebooks/${encodeURIComponent(notebookId)}/share-links`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            expiryDays ? { expires_in_days: Number(expiryDays) } : {},
          ),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { detail?: { error?: string } }
          | null;
        setError(body?.detail?.error ?? copy.createFailed);
        return;
      }
      const body = (await response.json()) as { token: string };
      setMinted(body.token);
      setCopied(false);
      await load();
    } catch {
      setError(copy.createFailed);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    let failed = false;
    try {
      const response = await fetch(
        `/api/notebooks/${encodeURIComponent(notebookId)}/share-links/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      failed = !response.ok && response.status !== 204;
      await load();
    } catch {
      failed = true;
    } finally {
      if (failed) setError(copy.revokeFailed);
      setBusy(false);
    }
  }

  const shareUrl = (token: string) =>
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/shared/notebooks#${token}`;

  return (
    <>
      <button className="mj-secondary-button" type="button" onClick={open}>
        {copy.title}
      </button>
      <dialog ref={dialogRef} className="mj-notebook-share-dialog">
        <h2>{copy.title}</h2>
        <p className="mj-panel-help">{copy.description}</p>

        {minted ? (
          <div className="mj-panel-notice" role="status">
            <p>
              <strong>{copy.linkCreatedTitle}</strong>
            </p>
            <p className="mj-panel-help">{copy.linkCreatedBody}</p>
            <code className="mj-mono-muted">{shareUrl(minted)}</code>
            <button
              className="mj-secondary-button"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(shareUrl(minted));
                setCopied(true);
              }}
            >
              {copied ? copy.copied : copy.copy}
            </button>
          </div>
        ) : (
          <div className="mj-notebook-share-create">
            <label>
              {copy.expiryLabel}
              <select
                value={expiryDays}
                onChange={(event) => setExpiryDays(event.target.value as typeof expiryDays)}
              >
                <option value="">{copy.expiryNever}</option>
                <option value="7">{copy.expiry7}</option>
                <option value="30">{copy.expiry30}</option>
                <option value="90">{copy.expiry90}</option>
              </select>
            </label>
            <button
              className="mj-primary-button"
              type="button"
              disabled={busy}
              onClick={() => void create()}
            >
              {busy ? copy.creating : copy.createButton}
            </button>
          </div>
        )}

        {error ? (
          <p className="mj-panel-help" role="alert">
            {error}
          </p>
        ) : null}

        {links === null ? null : links.length === 0 ? (
          <p className="mj-panel-help">{copy.noLinks}</p>
        ) : (
          <dl className="mj-usage-list">
            {links.map((link) => {
              const live = link.revoked_at === null;
              return (
                <div key={link.id}>
                  <dt>
                    <span className="mj-mono-muted">…{link.tail}</span>
                  </dt>
                  <dd>
                    {copy.createdAt(new Date(link.created_at).toLocaleDateString(locale))}
                    {" · "}
                    {link.expires_at
                      ? copy.expiresAt(new Date(link.expires_at).toLocaleDateString(locale))
                      : copy.neverExpires}
                    {" · "}
                    {link.last_viewed_at
                      ? copy.lastViewed(new Date(link.last_viewed_at).toLocaleDateString(locale))
                      : copy.neverViewed}
                    {live ? (
                      <button
                        className="mj-secondary-button"
                        type="button"
                        disabled={busy}
                        onClick={() => void revoke(link.id)}
                      >
                        {busy ? copy.revoking : copy.revoke}
                      </button>
                    ) : (
                      ` · ${copy.revoked}`
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}

        <button
          className="mj-secondary-button"
          type="button"
          onClick={() => dialogRef.current?.close()}
        >
          {copy.close}
        </button>
      </dialog>
    </>
  );
}
