"use client";

import type { components } from "@majorana/contracts-gen";
import { useCallback, useEffect, useState } from "react";
import type { PublicLocale } from "../lib/public-locale";
import { INVITE_COPY, SHARING_COPY } from "../lib/workspace-locale";

type WorkspaceInvitation = components["schemas"]["WorkspaceInvitation"];

/**
 * "Rui added you to Ion trap group as a Member."
 *
 * Until this existed, an invite was silent: the control plane attached the
 * account, answered 201 to the *inviter*, and the invited person's next page
 * load looked like every other one. Somebody had to tell them out of band.
 *
 * Three things it is deliberately not:
 *
 * 1. **Not a request to accept.** The membership already grants access by the
 *    time this renders, so the copy says what is true — you can open it — rather
 *    than offering a decision that was made elsewhere.
 * 2. **Not server-rendered.** It is empty for almost every account on almost
 *    every page load, and putting it in the layout's render would spend a round
 *    trip on the critical path of every authenticated page to say nothing.
 * 3. **Not dismissible only.** "Not now" silences it; Leave gives up the access.
 *    Without the second, a notice about a workspace you did not want is a fact
 *    you can only be told to live with — the way out was to ask the person who
 *    put you there to remove you.
 *
 * Opening reloads the page rather than navigating. The browser's local mirror of
 * chats and saved artifacts is keyed by workspace, and that key is read during the
 * authenticated layout's render.
 */
export function InviteNotice({ locale }: { locale: PublicLocale }) {
  const copy = INVITE_COPY[locale];
  const roles = SHARING_COPY[locale];
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/workspaces/invitations", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as unknown;
        if (active && Array.isArray(payload)) setInvitations(payload as WorkspaceInvitation[]);
      } catch {
        // An announcement, not a gate: an unreachable control plane shows no
        // notice rather than an error nobody can act on.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const forget = useCallback((workspaceId: string) => {
    setInvitations((current) => current.filter((row) => row.workspace_id !== workspaceId));
  }, []);

  async function post(path: string, workspaceId: string): Promise<boolean> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    return response.ok;
  }

  async function open(invitation: WorkspaceInvitation) {
    if (pending) return;
    setPending(invitation.workspace_id);
    setError(null);
    try {
      // Switching acknowledges upstream — entering a workspace is knowing about
      // it — so there is no second call to make here.
      if (!(await post("/api/workspaces/active", invitation.workspace_id))) {
        setError(copy.failed);
        setPending(null);
        return;
      }
      window.location.reload();
    } catch {
      setError(copy.failed);
      setPending(null);
    }
  }

  async function act(path: string, invitation: WorkspaceInvitation) {
    if (pending) return;
    setPending(invitation.workspace_id);
    setError(null);
    try {
      if (await post(path, invitation.workspace_id)) forget(invitation.workspace_id);
      else setError(copy.failed);
    } catch {
      setError(copy.failed);
    } finally {
      setPending(null);
      setConfirming(null);
    }
  }

  if (!invitations.length) return null;

  return (
    <div className="mj-invite-notices">
      {invitations.map((invitation) => {
        const inviter = invitation.invited_by_name || invitation.invited_by_email;
        const roleLabel =
          invitation.role === "viewer"
            ? roles.roleViewer
            : invitation.role === "admin"
              ? roles.roleAdmin
              : roles.roleMember;
        const busy = pending === invitation.workspace_id;
        return (
          <aside className="mj-invite-notice" role="status" key={invitation.workspace_id}>
            <div className="mj-invite-notice-body">
              <span className="mj-invite-notice-tag">{copy.title}</span>
              <p className="mj-invite-notice-headline">
                {inviter
                  ? copy.addedBy(inviter, invitation.workspace_name, roleLabel)
                  : copy.added(invitation.workspace_name, roleLabel)}
              </p>
              <p className="mj-invite-notice-detail">
                {confirming === invitation.workspace_id
                  ? copy.declineWarning(invitation.workspace_name)
                  : invitation.role === "viewer"
                    ? copy.viewerAccess
                    : copy.memberAccess}
              </p>
            </div>
            <div className="mj-invite-notice-actions">
              {confirming === invitation.workspace_id ? (
                <>
                  <button
                    className="mj-secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void act("/api/workspaces/leave", invitation)}
                  >
                    {busy ? copy.declining : copy.declineConfirm}
                  </button>
                  <button
                    className="mj-primary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(null)}
                  >
                    {copy.cancel}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="mj-primary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void open(invitation)}
                  >
                    {busy ? copy.opening : copy.open}
                  </button>
                  <button
                    className="mj-secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void act("/api/workspaces/acknowledge", invitation)}
                  >
                    {copy.dismiss}
                  </button>
                  {/* Leaving asks twice. It is the one action here that cannot
                      be undone without the workspace's admin. */}
                  <button
                    className="mj-invite-notice-decline"
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(invitation.workspace_id)}
                  >
                    {copy.decline}
                  </button>
                </>
              )}
            </div>
            {error ? <p className="mj-invite-notice-error">{error}</p> : null}
          </aside>
        );
      })}
    </div>
  );
}
