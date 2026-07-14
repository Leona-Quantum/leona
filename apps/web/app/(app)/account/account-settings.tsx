"use client";

import type { components } from "@majorana/contracts-gen";
import { type FormEvent, useEffect, useState } from "react";

type WorkspaceOverview = components["schemas"]["WorkspaceOverview"];

type Me = {
  user_id: string;
  email: string;
  display_name: string | null;
  workspace_id: string;
  workspace_name: string;
  role: components["schemas"]["Role"];
};

export function AccountSettings({ initialEmail }: { initialEmail: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceOverview | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/me", { cache: "no-store" }).then(parseJson<Me>),
      fetch("/api/workspace", { cache: "no-store" }).then(parseJson<WorkspaceOverview>),
    ])
      .then(([identity, overview]) => {
        if (!active) return;
        setMe(identity);
        setDisplayName(identity.display_name ?? "");
        setWorkspace(overview);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setMessage(cause instanceof Error ? cause.message : "Workspace data unavailable");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      });
      const payload = (await response.json()) as Me | { title?: string; error?: string };
      if (!response.ok || !("user_id" in payload)) {
        throw new Error(errorDetail(payload, "Profile could not be saved"));
      }
      setMe(payload);
      setDisplayName(payload.display_name ?? "");
      setMessage("Profile saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Profile could not be saved");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="mj-page-lede">Loading workspace data…</p>;
  if (!workspace || !me) return <p className="mj-page-lede" role="alert">{message ?? `Signed in as ${initialEmail}. Workspace data is unavailable.`}</p>;

  return (
    <div className="mj-artifact-grid">
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>Identity</h2><span className="mj-mono-muted">{me.role}</span></div>
        <dl className="mj-resource-list">
          <div><dt>Email</dt><dd>{me.email}</dd></div>
          <div><dt>Workspace</dt><dd>{me.workspace_name}</dd></div>
        </dl>
        <form className="mj-account-profile-form" onSubmit={saveProfile}>
          <label>
            <span>Display name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} placeholder="Your name" />
          </label>
          <button className="mj-primary-button" disabled={saving} type="submit">{saving ? "Saving…" : "Save name"}</button>
        </form>
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>Personal workspace</h2><span className="mj-mono-muted">{workspace.workspace.plan}</span></div>
        <p className="mj-artifact-copy">This workspace belongs only to you. Collaboration and shared workspaces are planned, but not enabled yet.</p>
        <dl className="mj-resource-list">
          <div><dt>Artifacts</dt><dd>{workspace.artifact_count}</dd></div>
          <div><dt>Runs</dt><dd>{workspace.run_count}</dd></div>
          <div><dt>Access</dt><dd>Private</dd></div>
        </dl>
      </section>
      <section className="mj-artifact-panel mj-artifact-panel--wide">
        <div className="mj-panel-heading"><h2>Workspace boundaries</h2><span className="mj-mono-muted">v1</span></div>
        <div className="mj-account-boundary-grid">
          <div><strong>Library</strong><p>Saved runs and public references stay in your personal Library.</p></div>
          <div><strong>Repository export</strong><p>Sign in to copy a public entry into this workspace and open it in Studio.</p></div>
          <div><strong>Collaboration</strong><p>Deferred until shared access, invitations, and permissions are productized.</p></div>
        </div>
        {message ? <p className="mj-page-lede" role="status">{message}</p> : null}
      </section>
    </div>
  );
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(errorDetail(payload, "Request failed"));
  }
  return payload as T;
}

function errorDetail(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  if ("title" in payload && typeof payload.title === "string") return payload.title;
  if ("error" in payload && typeof payload.error === "string") return payload.error;
  return fallback;
}
