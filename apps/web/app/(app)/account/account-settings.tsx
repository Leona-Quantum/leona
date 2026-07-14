"use client";

import type { components } from "@majorana/contracts-gen";
import { type FormEvent, useEffect, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { ACCOUNT_COPY } from "../../../lib/workspace-locale";

type WorkspaceOverview = components["schemas"]["WorkspaceOverview"];

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
  const [displayName, setDisplayName] = useState("");
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
        setDisplayName(identity.display_name ?? "");
        setWorkspace(overview);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setMessage(cause instanceof AccountRequestError ? cause.message : copy.unavailable);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [copy]);

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
      let payload: Me | { title?: string; error?: string };
      try {
        payload = (await response.json()) as Me | { title?: string; error?: string };
      } catch {
        throw new AccountRequestError(copy.profileSaveFailed);
      }
      if (!response.ok || !("user_id" in payload)) {
        throw new AccountRequestError(errorDetail(payload, copy.profileSaveFailed));
      }
      setMe(payload);
      setDisplayName(payload.display_name ?? "");
      setMessage(copy.profileSaved);
    } catch (cause) {
      setMessage(cause instanceof AccountRequestError ? cause.message : copy.profileSaveFailed);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="mj-page-lede">{copy.loading}</p>;
  if (!workspace || !me) return <p className="mj-page-lede" role="alert">{message ?? `${initialEmail}: ${copy.unavailable}`}</p>;

  return (
    <div className="mj-artifact-grid">
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>{copy.identity}</h2><span className="mj-mono-muted">{me.role}</span></div>
        <dl className="mj-resource-list">
          <div><dt>{copy.email}</dt><dd>{me.email}</dd></div>
          <div><dt>{copy.workspace}</dt><dd>{me.workspace_name}</dd></div>
        </dl>
        <form className="mj-account-profile-form" onSubmit={saveProfile}>
          <label>
            <span>{copy.displayName}</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} placeholder={copy.yourName} />
          </label>
          <button className="mj-primary-button" disabled={saving} type="submit">{saving ? copy.saving : copy.saveName}</button>
        </form>
      </section>
      <section className="mj-artifact-panel">
        <div className="mj-panel-heading"><h2>{copy.personalWorkspace}</h2><span className="mj-mono-muted">{workspace.workspace.plan}</span></div>
        <p className="mj-artifact-copy">{copy.personalWorkspaceHelp}</p>
        <dl className="mj-resource-list">
          <div><dt>{copy.artifacts}</dt><dd>{workspace.artifact_count}</dd></div>
          <div><dt>{copy.runs}</dt><dd>{workspace.run_count}</dd></div>
          <div><dt>{copy.access}</dt><dd>{copy.privateAccess}</dd></div>
        </dl>
      </section>
      <section className="mj-artifact-panel mj-artifact-panel--wide">
        <div className="mj-panel-heading"><h2>{copy.workspaceBoundaries}</h2><span className="mj-mono-muted">v1</span></div>
        <div className="mj-account-boundary-grid">
          <div><strong>{copy.library}</strong><p>{copy.libraryHelp}</p></div>
          <div><strong>{copy.repositoryExport}</strong><p>{copy.repositoryExportHelp}</p></div>
          <div><strong>{copy.collaboration}</strong><p>{copy.collaborationHelp}</p></div>
        </div>
        {message ? <p className="mj-page-lede" role="status">{message}</p> : null}
      </section>
    </div>
  );
}

async function parseJson<T>(response: Response, fallback: string): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AccountRequestError(fallback);
  }
  if (!response.ok) {
    throw new AccountRequestError(errorDetail(payload, fallback));
  }
  return payload as T;
}

class AccountRequestError extends Error {}

function errorDetail(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  if ("title" in payload && typeof payload.title === "string") return payload.title;
  if ("error" in payload && typeof payload.error === "string") return payload.error;
  return fallback;
}
