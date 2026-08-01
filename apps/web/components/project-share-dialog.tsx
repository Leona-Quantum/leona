"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ShareRefused,
  expiresSoon,
  grantProjectShare,
  hasExpired,
  loadProjectArtifactLimit,
  loadProjectShares,
  revokeAllProjectShares,
  revokeProjectShare,
  setProjectArtifactLimit,
  type ProjectShare,
  type ShareRole,
} from "../lib/project-shares";
import type { PublicLocale } from "../lib/public-locale";
import { PROJECT_SHARE_COPY } from "../lib/workspace-locale";
import { TrashIcon } from "./icons";

/**
 * Who a project is shared with, and how to change that.
 *
 * Opened from a project row in the Studio sidebar. Everything it can do needs
 * the workspace ADMIN role, and the control plane is what enforces that — a 403
 * arriving here is rendered as a sentence rather than as an empty list, because
 * an empty list is what "shared with nobody" looks like and the two must not
 * read the same.
 *
 * The list is re-fetched after every mutation instead of being patched in
 * place. A share dialog is a security surface: what it shows has to be what the
 * server says, not what this component believes it just did, and two admins
 * with the dialog open are the ordinary case rather than the exotic one.
 */
export function ProjectShareDialog({
  projectId,
  projectName,
  locale,
  onClose,
  onCountChange,
}: {
  projectId: string;
  projectName: string;
  locale: PublicLocale;
  onClose: () => void;
  onCountChange?: (count: number) => void;
}) {
  const copy = PROJECT_SHARE_COPY[locale];
  const [shares, setShares] = useState<ProjectShare[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingStopAll, setConfirmingStopAll] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  // null until read, and null FOREVER against an API that predates contracts
  // 2.8.0 — the control stays hidden rather than rendering a guessed number that
  // saving would then make real.
  const [limit, setLimit] = useState<number | null>(null);
  const [limitDraft, setLimitDraft] = useState("");
  const emailRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await loadProjectShares(projectId);
      setShares(rows);
      onCountChange?.(rows.length);
      setForbidden(false);
    } catch {
      // Indistinguishable here from a refusal, so it is reported as the thing
      // that is true either way: this list could not be read.
      setShares([]);
      setForbidden(true);
    }
  }, [projectId, onCountChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // `role="dialog"` and `aria-modal` describe this as a modal; without moving
  // focus into it they are only a description. A keyboard user would otherwise
  // stay on the sidebar row underneath — tabbing through a rail they cannot see
  // past — and a screen reader would announce nothing at all. Focus lands on
  // the address field because that is the one thing this dialog is for, and it
  // returns to whatever opened it, which is the share button on that row.
  useEffect(() => {
    const opener = document.activeElement;
    emailRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);

  useEffect(() => {
    // `loadProjectArtifactLimit` resolves null on a non-OK response, but a
    // network-level fetch failure REJECTS — and an unhandled rejection here
    // would be an offline browser throwing past a dialog that is otherwise
    // still usable. `refresh` above catches for the same reason. Null keeps the
    // control hidden, which is the right answer when the number is unknown.
    void loadProjectArtifactLimit(projectId)
      .then((value) => {
        setLimit(value);
        if (value !== null) setLimitDraft(String(value));
      })
      .catch(() => setLimit(null));
  }, [projectId]);

  async function saveLimit() {
    const parsed = Number.parseInt(limitDraft, 10);
    if (!Number.isFinite(parsed)) {
      // Clearing the field used to leave it blank with no notice and no
      // restoration, so the input showed a value the project did not have.
      // Putting the committed number back is the honest state: nothing was
      // saved, and the field says so by showing what IS saved.
      setLimitDraft(limit !== null ? String(limit) : "");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await setProjectArtifactLimit(projectId, parsed);
      setLimit(saved);
      setLimitDraft(String(saved));
      setNotice(copy.limitSaved(saved));
    } catch (caught) {
      setError(caught instanceof ShareRefused ? caught.message : copy.limitFailed);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!address || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await grantProjectShare(projectId, {
        email: address,
        role,
        // A date input gives a local calendar day. Sent as the END of that day
        // in the browser's own zone, because "access ends on the 5th" means
        // through the 5th to the person who typed it — and midnight UTC would
        // cut it short by up to a day for most of the world.
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
      });
      setEmail("");
      setExpiresAt("");
      setNotice(copy.granted(address));
      await refresh();
    } catch (caught) {
      setError(caught instanceof ShareRefused ? caught.message : copy.grantFailed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(share: ProjectShare) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await revokeProjectShare(projectId, share.granteeUserId);
      setNotice(copy.removed(share.granteeEmail));
      await refresh();
    } catch {
      setError(copy.removeFailed);
    } finally {
      setBusy(false);
    }
  }

  async function stopAll() {
    setBusy(true);
    setError(null);
    setConfirmingStopAll(false);
    try {
      await revokeAllProjectShares(projectId);
      setNotice(copy.nobody);
      await refresh();
    } catch {
      setError(copy.removeFailed);
    } finally {
      setBusy(false);
    }
  }

  const now = new Date();

  return (
    <div className="mj-share-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
      <div
        className="mj-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={copy.title(projectName)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>{copy.title(projectName)}</h2>
        <p>{copy.help}</p>
        {/* Stated before the form, not after it. A warning under the button is
            read once the decision is already made. */}
        <p className="mj-share-warning">{copy.outsideWarning}</p>

        {forbidden ? (
          <p className="mj-share-error">{copy.adminOnly}</p>
        ) : (
          <>
            <form className="mj-share-form" onSubmit={submit}>
              <label className="mj-share-field">
                <span>{copy.emailLabel}</span>
                <input
                  ref={emailRef}
                  type="email"
                  autoComplete="off"
                  maxLength={320}
                  placeholder={copy.emailPlaceholder}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="mj-share-field">
                <span>{copy.roleLabel}</span>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as ShareRole)}
                  disabled={busy}
                >
                  <option value="viewer">{copy.roleViewer}</option>
                  <option value="editor">{copy.roleEditor}</option>
                </select>
              </label>
              <label className="mj-share-field">
                <span>{copy.expiryLabel}</span>
                <input
                  type="date"
                  value={expiresAt}
                  min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  disabled={busy}
                />
              </label>
              <button type="submit" className="mj-primary-button" disabled={busy || !email.trim()}>
                {busy ? copy.granting : copy.grant}
              </button>
            </form>
            <p className="mj-share-role-help">
              {role === "editor" ? copy.roleEditorHelp : copy.roleViewerHelp}
            </p>
          </>
        )}

        {error ? <p className="mj-share-error">{error}</p> : null}
        {notice ? <p className="mj-share-notice">{notice}</p> : null}

        {!forbidden ? (
          <>
            <h3 className="mj-share-subtitle">{copy.peopleWithAccess}</h3>
            {/* Three states, three renders. `null` is "not read yet" and MUST
                NOT look like the empty list: on a share dialog the difference
                between "still loading" and "shared with nobody" is the
                difference between waiting and believing you revoked something
                you did not. */}
            {shares === null ? (
              <p className="mj-share-empty" aria-busy="true">
                {copy.loading}
              </p>
            ) : shares.length === 0 ? (
              <p className="mj-share-empty">{copy.nobody}</p>
            ) : (
              <ul className="mj-share-list">
                {shares.map((share) => (
                  <li key={share.granteeUserId} className="mj-share-row">
                    <span className="mj-share-person">
                      <strong>{share.granteeDisplayName || share.granteeEmail}</strong>
                      {share.granteeDisplayName ? <small>{share.granteeEmail}</small> : null}
                    </span>
                    <span className="mj-share-role">
                      {share.role === "editor" ? copy.roleEditor : copy.roleViewer}
                    </span>
                    {share.expiresAt ? (
                      <span
                        className="mj-share-expiry"
                        data-state={
                          hasExpired(share, now)
                            ? "expired"
                            : expiresSoon(share, now)
                              ? "soon"
                              : "later"
                        }
                      >
                        {hasExpired(share, now)
                          ? copy.expired
                          : expiresSoon(share, now)
                            ? copy.expiringSoon(
                                new Date(share.expiresAt).toLocaleDateString(locale),
                              )
                            : copy.expiresOn(new Date(share.expiresAt).toLocaleDateString(locale))}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="mj-sidebar-chat-action mj-sidebar-chat-action--danger"
                      aria-label={`${copy.remove} — ${share.granteeEmail}`}
                      title={copy.remove}
                      disabled={busy}
                      onClick={() => void remove(share)}
                    >
                      <TrashIcon size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {limit !== null ? (
              <div className="mj-share-limit">
                <label className="mj-share-field">
                  <span>{copy.limitLabel}</span>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    inputMode="numeric"
                    value={limitDraft}
                    disabled={busy}
                    onChange={(event) => setLimitDraft(event.target.value)}
                    onBlur={() => {
                      if (limitDraft !== String(limit)) void saveLimit();
                    }}
                  />
                </label>
                <p className="mj-share-hint">
                  {limit === 0 ? copy.limitZeroHelp : copy.limitHelp}
                </p>
              </div>
            ) : null}

            {shares && shares.length > 1 ? (
              confirmingStopAll ? (
                <div className="mj-share-confirm">
                  <p>{copy.stopAllConfirm(shares.length)}</p>
                  <button type="button" className="mj-danger-button" onClick={() => void stopAll()}>
                    {copy.stopAll}
                  </button>
                  <button
                    type="button"
                    className="mj-secondary-button"
                    onClick={() => setConfirmingStopAll(false)}
                  >
                    {copy.stopAllCancel}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="mj-secondary-button mj-share-stop-all"
                  disabled={busy}
                  onClick={() => setConfirmingStopAll(true)}
                >
                  {copy.stopAll}
                </button>
              )
            ) : null}
          </>
        ) : null}

        <button type="button" className="mj-secondary-button mj-share-close" onClick={onClose}>
          {copy.close}
        </button>
      </div>
    </div>
  );
}
