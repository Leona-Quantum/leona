"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type AccessTokenRecord,
  daysUntilExpiry,
  featureIsAbsent,
  formatTokenTail,
  sortTokens,
  tokenState,
} from "../../../lib/access-tokens";
import type { PublicLocale } from "../../../lib/public-locale";
import { ACCOUNT_COPY } from "../../../lib/workspace-locale";

/**
 * Personal access tokens, in account settings. Proposal 7 Phase B, owner ruling
 * ai-ops 362 option 1.
 *
 * ## The secret is held in React state and nowhere else
 *
 * A minted token comes back once. It is put in component state so the person can copy
 * it, and it is deliberately NOT written to `localStorage`, `sessionStorage` or the
 * URL: every one of those outlives the moment, and two of them are readable by
 * anything else running on the page. Navigating away loses it, which is the correct
 * behaviour and is what the warning beside it says.
 *
 * ## The pane hides itself when the deployment has no tokens
 *
 * `GET /api/tokens` answers 404 while the feature is switched off, and this renders
 * nothing at all rather than a section whose every button fails. Any OTHER failure is
 * shown, because a pane that vanished on a timeout would read as "your tokens are
 * gone" — see `featureIsAbsent`.
 */
export function AccessTokens({ locale }: { locale: PublicLocale }) {
  const copy = ACCOUNT_COPY[locale];
  const [tokens, setTokens] = useState<AccessTokenRecord[] | null>(null);
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [canRun, setCanRun] = useState(false);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tokens", { cache: "no-store" });
      if (featureIsAbsent(response.status)) {
        setAbsent(true);
        return;
      }
      if (!response.ok) {
        setError(copy.tokensLoadError);
        return;
      }
      const body = (await response.json()) as { tokens?: AccessTokenRecord[] };
      setTokens(body.tokens ?? []);
      setError(null);
    } catch {
      setError(copy.tokensLoadError);
    }
  }, [copy.tokensLoadError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (absent) return null;

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          expires_in_days: days,
          scopes: canRun ? ["read", "run"] : ["read"],
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { detail?: { error?: string } }
          | null;
        setError(body?.detail?.error ?? copy.tokensCreateError);
        return;
      }
      const body = (await response.json()) as { token: string };
      setMinted(body.token);
      setName("");
      await load();
    } catch {
      setError(copy.tokensCreateError);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) setError(copy.tokensRevokeError);
      await load();
    } catch {
      setError(copy.tokensRevokeError);
    } finally {
      setBusy(false);
    }
  };

  const now = new Date();
  const rows = tokens ? sortTokens(tokens, now) : [];

  return (
    <section className="mj-artifact-panel" id="tokens" aria-labelledby="tokens-heading">
      <div className="mj-panel-heading">
        <h2 id="tokens-heading">{copy.tokensTitle}</h2>
      </div>
      <p className="mj-panel-help">{copy.tokensHelp}</p>

      {minted ? (
        <div className="mj-panel-notice" role="status">
          <p>
            <strong>{copy.tokensShownOnce}</strong>
          </p>
          <code className="mj-mono-muted">{minted}</code>
          <p className="mj-panel-help">{copy.tokensShownOnceHelp}</p>
          <button className="mj-secondary-button" type="button" onClick={() => setMinted(null)}>
            {copy.tokensDismiss}
          </button>
        </div>
      ) : null}

      <form className="leona-workspace-actions" onSubmit={create}>
        <label>
          {copy.tokensName}
          <input
            type="text"
            value={name}
            maxLength={80}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {copy.tokensExpiry}
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={canRun}
            onChange={(event) => setCanRun(event.target.checked)}
          />
          {copy.tokensAllowRuns}
        </label>
        <button className="mj-primary-button" type="submit" disabled={busy || !name.trim()}>
          {copy.tokensCreate}
        </button>
      </form>

      {error ? (
        <p className="mj-panel-help" role="alert">
          {error}
        </p>
      ) : null}

      {tokens === null ? null : rows.length === 0 ? (
        <p className="mj-panel-help">{copy.tokensEmpty}</p>
      ) : (
        <dl className="mj-usage-list">
          {rows.map((row) => {
            const state = tokenState(row, now);
            const left = daysUntilExpiry(row, now);
            return (
              <div key={row.id}>
                <dt>
                  {row.name} <span className="mj-mono-muted">{formatTokenTail(row.tail)}</span>
                </dt>
                <dd>
                  {state === "active"
                    ? copy.tokensExpiresIn(left)
                    : state === "revoked"
                      ? copy.tokensRevoked
                      : copy.tokensExpired}
                  {row.scopes.includes("run") ? ` · ${copy.tokensCanRun}` : ""}
                  {row.last_used_at ? "" : ` · ${copy.tokensNeverUsed}`}
                  {state === "active" ? (
                    <button
                      className="mj-secondary-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void revoke(row.id)}
                    >
                      {copy.tokensRevoke}
                    </button>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
