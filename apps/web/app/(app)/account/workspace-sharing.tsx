"use client";

import type { components } from "@majorana/contracts-gen";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { SHARING_COPY } from "../../../lib/workspace-locale";

type WorkspaceSummary = components["schemas"]["WorkspaceSummary"];
type WorkspaceMember = components["schemas"]["WorkspaceMember"];
type Role = components["schemas"]["Role"];

const ADMIN_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);

/**
 * Workspaces and members, on the Settings page.
 *
 * Two panels rather than one because they answer different questions — "where
 * am I" and "who else is here" — and the second is about the workspace the
 * first says you are in.
 *
 * Switching reloads the page instead of re-rendering. The browser's local
 * mirror of chats and Vault entries is keyed by workspace, and that key is read
 * during the authenticated layout's render; a soft navigation would leave the
 * previous workspace's sidebar on screen next to the new workspace's data.
 */
export function WorkspaceSharing({
  locale,
  members,
  viewerUserId,
  viewerRole,
  onMembersChanged,
}: {
  locale: PublicLocale;
  members: WorkspaceMember[];
  viewerUserId: string;
  viewerRole: Role;
  onMembersChanged: (members: WorkspaceMember[]) => void;
}) {
  const copy = SHARING_COPY[locale];
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "viewer">("member");
  const [inviting, setInviting] = useState(false);
  const [pendingMember, setPendingMember] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canAdminister = ADMIN_ROLES.has(viewerRole);

  const loadWorkspaces = useCallback(async () => {
    try {
      const response = await fetch("/api/workspaces", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as unknown;
      if (Array.isArray(payload)) setWorkspaces(payload as WorkspaceSummary[]);
    } catch {
      // The panel simply does not list; the rest of Settings still works.
    }
  }, []);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (creating || !name) return;
    setCreating(true);
    setMessage(null);
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await readJson(response)) as WorkspaceSummary | ErrorPayload;
      if (!response.ok || !("id" in payload)) {
        setMessage(errorDetail(payload, copy.createFailed));
        return;
      }
      setNewName("");
      setMessage(copy.created(payload.name));
      await loadWorkspaces();
    } catch {
      setMessage(copy.createFailed);
    } finally {
      setCreating(false);
    }
  }

  async function switchTo(workspace: WorkspaceSummary) {
    if (switchingTo) return;
    setSwitchingTo(workspace.id);
    setMessage(null);
    try {
      const response = await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspace.id }),
      });
      if (!response.ok) {
        setMessage(errorDetail(await readJson(response), copy.switchFailed));
        setSwitchingTo(null);
        return;
      }
      // A full load, not router.refresh(): see the note at the top of the file.
      window.location.assign("/account");
    } catch {
      setMessage(copy.switchFailed);
      setSwitchingTo(null);
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (inviting || !email) return;
    setInviting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/workspace/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const payload = (await readJson(response)) as WorkspaceMember | ErrorPayload;
      if (!response.ok || !("user_id" in payload)) {
        // 404 here means the address has no account on this deployment, which
        // is a thing the person can fix — so it does not read as a failure.
        setMessage(response.status === 404 ? copy.inviteUnknownAccount : errorDetail(payload, copy.inviteFailed));
        return;
      }
      setInviteEmail("");
      setMessage(copy.invited(payload.email));
      onMembersChanged(upsertMember(members, payload));
    } catch {
      setMessage(copy.inviteFailed);
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(member: WorkspaceMember, role: string) {
    if (pendingMember) return;
    setPendingMember(member.user_id);
    setMessage(null);
    try {
      const response = await fetch(`/api/workspace/members/${encodeURIComponent(member.user_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const payload = (await readJson(response)) as WorkspaceMember | ErrorPayload;
      if (!response.ok || !("user_id" in payload)) {
        setMessage(errorDetail(payload, copy.roleChangeFailed));
        return;
      }
      onMembersChanged(upsertMember(members, payload));
      setMessage(copy.roleChanged(memberLabel(member, viewerUserId, copy.you)));
    } catch {
      setMessage(copy.roleChangeFailed);
    } finally {
      setPendingMember(null);
    }
  }

  async function removeMember(member: WorkspaceMember) {
    if (pendingMember) return;
    setPendingMember(member.user_id);
    setMessage(null);
    const label = memberLabel(member, viewerUserId, copy.you);
    try {
      const response = await fetch(`/api/workspace/members/${encodeURIComponent(member.user_id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setMessage(errorDetail(await readJson(response), copy.removeFailed));
        return;
      }
      onMembersChanged(members.filter((row) => row.user_id !== member.user_id));
      setMessage(copy.removed(label));
    } catch {
      setMessage(copy.removeFailed);
    } finally {
      setPendingMember(null);
    }
  }

  const roleLabels: Record<string, string> = {
    owner: copy.roleOwner,
    admin: copy.roleAdmin,
    member: copy.roleMember,
    viewer: copy.roleViewer,
  };

  return (
    <>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading">
          <h2>{copy.workspacesTitle}</h2>
          <span className="mj-mono-muted">{workspaces ? workspaces.length : "—"}</span>
        </div>
        <p className="mj-artifact-copy">{copy.workspacesHelp}</p>
        <ul className="mj-workspace-list">
          {(workspaces ?? []).map((workspace) => (
            <li key={workspace.id} data-active={workspace.is_active || undefined}>
              <span className="mj-workspace-list-name">
                <strong>{workspace.name}</strong>
                <small>
                  {roleLabels[workspace.role] ?? workspace.role}
                  {workspace.is_personal ? ` · ${copy.personalTag}` : ""}
                </small>
              </span>
              {workspace.is_active ? (
                <span className="mj-mono-muted">{copy.activeTag}</span>
              ) : (
                <button
                  className="mj-secondary-button"
                  type="button"
                  disabled={switchingTo !== null}
                  onClick={() => void switchTo(workspace)}
                >
                  {switchingTo === workspace.id ? copy.opening : copy.open}
                </button>
              )}
            </li>
          ))}
        </ul>
        <form className="mj-account-profile-form" onSubmit={createWorkspace}>
          <label>
            <span>{copy.createTitle}</span>
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={120}
              placeholder={copy.createPlaceholder}
            />
          </label>
          <button className="mj-primary-button" type="submit" disabled={creating || !newName.trim()}>
            {creating ? copy.creating : copy.create}
          </button>
        </form>
      </section>

      <section className="mj-artifact-panel">
        <div className="mj-panel-heading">
          <h2>{copy.membersTitle}</h2>
          <span className="mj-mono-muted">{members.length}</span>
        </div>
        <p className="mj-artifact-copy">{copy.membersHelp}</p>
        <p className="mj-artifact-copy">{copy.membersShareWarning}</p>
        <ul className="mj-workspace-list">
          {members.map((member) => {
            const isOwner = member.role === "owner";
            return (
              <li key={member.user_id}>
                <span className="mj-workspace-list-name">
                  <strong>{memberLabel(member, viewerUserId, copy.you)}</strong>
                  <small>{member.email}</small>
                </span>
                {canAdminister && !isOwner ? (
                  <>
                    <select
                      aria-label={copy.membersTitle}
                      value={member.role}
                      disabled={pendingMember !== null}
                      onChange={(event) => void changeRole(member, event.target.value)}
                    >
                      <option value="admin">{copy.roleAdmin}</option>
                      <option value="member">{copy.roleMember}</option>
                      <option value="viewer">{copy.roleViewer}</option>
                    </select>
                    <button
                      className="mj-secondary-button"
                      type="button"
                      disabled={pendingMember !== null}
                      onClick={() => void removeMember(member)}
                    >
                      {pendingMember === member.user_id ? copy.removing : copy.remove}
                    </button>
                  </>
                ) : (
                  <span className="mj-mono-muted">{roleLabels[member.role] ?? member.role}</span>
                )}
              </li>
            );
          })}
        </ul>
        {members.length <= 1 ? <p className="mj-artifact-copy">{copy.noMembers}</p> : null}
        {canAdminister ? (
          <form className="mj-account-profile-form" onSubmit={invite}>
            <label>
              <span>{copy.invite}</span>
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                maxLength={320}
                placeholder={copy.invitePlaceholder}
              />
            </label>
            {/* The help text sits under the control rather than in the label:
                it describes what the CHOICE means and changes with it, so as a
                label it read like a caption that kept rewriting itself. */}
            <label>
              <span>{copy.roleLabel}</span>
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value === "viewer" ? "viewer" : "member")}
              >
                <option value="member">{copy.roleMember}</option>
                <option value="viewer">{copy.roleViewer}</option>
              </select>
              <small>{inviteRole === "member" ? copy.roleMemberHelp : copy.roleViewerHelp}</small>
            </label>
            <button className="mj-primary-button" type="submit" disabled={inviting || !inviteEmail.trim()}>
              {inviting ? copy.inviting : copy.invite}
            </button>
          </form>
        ) : (
          <p className="mj-artifact-copy">{copy.adminOnly}</p>
        )}
        {message ? <p className="mj-page-lede" role="status">{message}</p> : null}
      </section>
    </>
  );
}

type ErrorPayload = { error?: string; title?: string; detail?: unknown };

/** A member's own row reads "You" — an email address you already know is noise. */
function memberLabel(member: WorkspaceMember, viewerUserId: string, you: string): string {
  if (member.user_id === viewerUserId) return you;
  return member.display_name || member.email;
}

function upsertMember(members: WorkspaceMember[], next: WorkspaceMember): WorkspaceMember[] {
  const without = members.filter((row) => row.user_id !== next.user_id);
  return [...without, next];
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * The server's own words when it has them.
 *
 * The control plane's refusals are typed objects under `detail` — the workspace
 * limit says which limit and how many are used, and repeating it beats a
 * generic "could not create that workspace".
 */
function errorDetail(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as ErrorPayload;
  if (typeof record.error === "string") return record.error;
  if (typeof record.title === "string") return record.title;
  if (record.detail && typeof record.detail === "object") {
    const detail = record.detail as { error?: unknown };
    if (typeof detail.error === "string") return detail.error;
  }
  if (typeof record.detail === "string") return record.detail;
  return fallback;
}
