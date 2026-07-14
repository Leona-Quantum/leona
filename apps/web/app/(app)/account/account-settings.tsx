"use client";

import type { components } from "@majorana/contracts-gen";
import { type FormEvent, useEffect, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { ACCOUNT_COPY } from "../../../lib/workspace-locale";

type WorkspaceOverview = components["schemas"]["WorkspaceOverview"];
type WorkspaceMember = components["schemas"]["WorkspaceMember"];

type Me = {
  user_id: string;
  email: string;
  display_name: string | null;
  workspace_id: string;
  workspace_name: string;
  role: components["schemas"]["Role"];
};

export function AccountSettings({ initialEmail, locale }: { initialEmail: string; locale: PublicLocale }) {
  const copy = ACCOUNT_COPY[locale];
  const [me, setMe] = useState<Me | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceOverview | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "viewer">("member");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/me", { cache: "no-store" }).then((response) => parseJson<Me>(response, copy.requestFailed)),
      fetch("/api/workspace", { cache: "no-store" }).then((response) => parseJson<WorkspaceOverview>(response, copy.requestFailed)),
    ])
      .then(([identity, overview]) => {
        if (!active) return;
        setMe(identity);
        setWorkspace(overview);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setMessage(cause instanceof Error ? cause.message : copy.unavailable);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/workspace/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const payload = (await response.json()) as WorkspaceMember | { title?: string; error?: string };
      if (!response.ok || !("user_id" in payload)) {
        throw new Error(errorDetail(payload, copy.memberAddFailed));
      }
      setWorkspace((current) => current ? {
        ...current,
        members: [...current.members.filter((member) => member.user_id !== payload.user_id), payload],
      } : current);
      setEmail("");
      setMessage(copy.memberAdded(payload.email));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : copy.memberAddFailed);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="mj-page-lede">{copy.loading}</p>;
  if (!workspace || !me) return <p className="mj-page-lede" role="alert">{message ?? `${initialEmail}: ${copy.unavailable}`}</p>;

  const canManage = me.role === "owner" || me.role === "admin";
  return (
    <div className="mj-artifact-grid">
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>{copy.identity}</h2><span className="mj-mono-muted">{me.role}</span></div>
        <dl className="mj-resource-list">
          <div><dt>{copy.email}</dt><dd>{me.email}</dd></div>
          <div><dt>{copy.name}</dt><dd>{me.display_name ?? copy.notSet}</dd></div>
          <div><dt>{copy.workspace}</dt><dd>{me.workspace_name}</dd></div>
        </dl>
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>{copy.workspaceData}</h2><span className="mj-mono-muted">{workspace.workspace.plan}</span></div>
        <dl className="mj-resource-list">
          <div><dt>{copy.artifacts}</dt><dd>{workspace.artifact_count}</dd></div>
          <div><dt>{copy.runs}</dt><dd>{workspace.run_count}</dd></div>
          <div><dt>{copy.members}</dt><dd>{workspace.members.length}</dd></div>
        </dl>
      </section>
      <section className="mj-artifact-panel mj-artifact-panel--wide">
        <div className="mj-panel-heading"><h2>{copy.workspaceMembers}</h2><span className="mj-mono-muted">{copy.sharedAccess}</span></div>
        <div className="mj-resource-list">
          {workspace.members.map((member) => (
            <div key={member.user_id}>
              <dt>{member.display_name ?? member.email}</dt>
              <dd>{member.display_name ? `${member.email} · ${member.role}` : member.role}</dd>
            </div>
          ))}
        </div>
        {canManage ? (
          <form className="mj-library-toolbar" onSubmit={addMember}>
            <label className="mj-library-search">
              <span className="sr-only">{copy.collaboratorEmail}</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder={copy.collaboratorEmail} type="email" />
            </label>
            <label className="mj-filter-select">
              <span className="sr-only">{copy.collaboratorRole}</span>
              <select value={role} onChange={(event) => setRole(event.target.value as "member" | "viewer")}>
                <option value="member">{copy.member}</option>
                <option value="viewer">{copy.viewer}</option>
              </select>
            </label>
            <button className="mj-primary-button" disabled={saving || !email.trim()} type="submit">{saving ? copy.adding : copy.addMember}</button>
          </form>
        ) : null}
        {message ? <p className="mj-page-lede" role="status">{message}</p> : null}
      </section>
    </div>
  );
}

async function parseJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(errorDetail(payload, fallback));
  }
  return payload as T;
}

function errorDetail(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  if ("title" in payload && typeof payload.title === "string") return payload.title;
  if ("error" in payload && typeof payload.error === "string") return payload.error;
  return fallback;
}
