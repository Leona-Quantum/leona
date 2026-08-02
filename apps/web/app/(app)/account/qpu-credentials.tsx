"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { ACCOUNT_COPY } from "../../../lib/workspace-locale";

/**
 * Connect your own IBM Quantum key.
 *
 * **There is no OAuth flow, and this panel must not imply one.** IBM publishes
 * no way for a third-party application to obtain an API key on a user's behalf,
 * so there is nothing to redirect to and no consent screen to send anybody
 * through. What exists is a key the user creates on IBM's own dashboard and
 * pastes here, and the honest surface for that is instructions, one field, and
 * a status. A "Connect with IBM" button would look like the thing every other
 * integration does and would be a lie about who holds the authorization.
 *
 * Why it is worth anyone's trouble: today one operator-owned token serves every
 * Leona user, which means IBM's free Open Plan allowance — roughly 10 minutes
 * of QPU time per rolling 28 days — is one pool shared by all of them. A key
 * connected here moves that allowance onto the user's own IBM account, where
 * nobody else's week can spend it.
 *
 * The key itself: a password field with autocomplete off, sent in a request
 * body, never echoed by the API, never put in a URL, never logged by the BFF,
 * and cleared from this component the moment it is accepted. The inputs carry
 * no `name` attribute on purpose — a form with named fields and no `action`
 * submits as a GET to the current URL if the submit handler ever fails to run,
 * which would write the key into the address bar, the history and the referrer.
 */

type CredentialStatus = {
  connected: boolean;
  label: string | null;
  instance: string | null;
  createdAt: string | null;
  lastVerifiedAt: string | null;
  lastUsedAt: string | null;
  storageAvailable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNullableString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The status document, or null for anything that is not one.
 *
 * `connected` and `storage_available` are required because both drive what the
 * panel offers: a missing `storage_available` read as `false` would hide a
 * working form, and read as `true` would invite somebody to type a secret into
 * a deployment that cannot keep it. Neither guess is acceptable, so an
 * unreadable payload renders as "could not check" instead.
 */
export function parseCredentialStatus(payload: unknown): CredentialStatus | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.connected !== "boolean") return null;
  if (typeof payload.storage_available !== "boolean") return null;
  return {
    connected: payload.connected,
    label: readNullableString(payload, "label"),
    instance: readNullableString(payload, "instance"),
    createdAt: readNullableString(payload, "created_at"),
    lastVerifiedAt: readNullableString(payload, "last_verified_at"),
    lastUsedAt: readNullableString(payload, "last_used_at"),
    storageAvailable: payload.storage_available,
  };
}

/** The API's discriminator, when it sent one. */
function refusalReason(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.detail)) return null;
  return typeof payload.detail.reason === "string" ? payload.detail.reason : null;
}

/** The provider's own sentence about why the key was refused. */
function providerSentence(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.detail)) return null;
  const { error } = payload.detail;
  return typeof error === "string" && error.length > 0 ? error : null;
}

/**
 * A date, no clock. "Last used 14 Aug" is what somebody checks this for; the
 * minute it happened answers a question nobody asked and makes two adjacent
 * rows harder to compare.
 */
function formatDay(iso: string, locale: PublicLocale): string | null {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The four failures the contract names, kept as a value rather than recovered
 * later by comparing rendered sentences. Two of them read identically to a
 * reader in one respect and behave differently here — `storage` disables the
 * form — and matching on the copy string to find out which is which would break
 * the day either sentence is reworded.
 */
type Failure = "rejected" | "verification" | "storage" | "unknown";

type Outcome = { kind: "ok" | "error"; text: string; detail?: string; failure?: Failure };

export function QpuCredentials({ locale }: { locale: PublicLocale }) {
  const copy = ACCOUNT_COPY[locale];
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [instance, setInstance] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/qpu/credentials", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const parsed = parseCredentialStatus(await response.json());
        if (cancelled) return;
        if (!parsed) throw new Error("unreadable");
        setStatus(parsed);
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Four failures, four sentences.
   *
   * They are not degrees of the same problem: one means the key is wrong, one
   * means the network was, one means this deployment cannot accept a key at all
   * and no amount of retrying will change that, and the fourth is everything
   * else. Reading the reason first and the status second is deliberate — the
   * reason is the contract, and the status is what survives a proxy that
   * replaced the body.
   */
  function describeFailure(response: Response, payload: unknown): Outcome {
    const reason = refusalReason(payload);
    if (reason === "credential_rejected" || (reason === null && response.status === 400)) {
      return {
        kind: "error",
        failure: "rejected",
        text: copy.qpuErrorRejected,
        detail: providerSentence(payload) ?? undefined,
      };
    }
    if (reason === "credential_verification_unavailable" || (reason === null && response.status === 502)) {
      return { kind: "error", failure: "verification", text: copy.qpuErrorVerificationUnavailable };
    }
    if (reason === "credential_storage_unavailable" || (reason === null && response.status === 503)) {
      return { kind: "error", failure: "storage", text: copy.qpuErrorStorageUnavailable };
    }
    return { kind: "error", failure: "unknown", text: copy.qpuErrorGeneric };
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !apiKey.trim()) return;
    setSaving(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/qpu/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "ibm",
          api_key: apiKey.trim(),
          instance: instance.trim() || null,
          label: label.trim() || null,
        }),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const failure = describeFailure(response, payload);
        // The one refusal that is about the deployment rather than the key.
        // Holding the pasted value would invite a retry that cannot succeed.
        if (failure.failure === "storage") {
          setApiKey("");
          setStatus((current) => (current ? { ...current, storageAvailable: false } : current));
        }
        setOutcome(failure);
        return;
      }
      const parsed = parseCredentialStatus(payload);
      if (!parsed) {
        setOutcome({ kind: "error", text: copy.qpuErrorGeneric });
        return;
      }
      setStatus(parsed);
      // Gone from this component the moment it is stored. Nothing renders it
      // back and nothing here keeps a second copy of it.
      setApiKey("");
      setOutcome({ kind: "ok", text: copy.qpuConnectedMessage });
    } catch {
      setOutcome({ kind: "error", text: copy.qpuErrorVerificationUnavailable });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/qpu/credentials?provider=ibm", { method: "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
      setStatus((current) =>
        current
          ? {
              ...current,
              connected: false,
              label: null,
              instance: null,
              createdAt: null,
              lastVerifiedAt: null,
              lastUsedAt: null,
            }
          : current,
      );
      setConfirmingDisconnect(false);
      setOutcome({ kind: "ok", text: copy.qpuDisconnected });
    } catch {
      setOutcome({ kind: "error", text: copy.qpuErrorDisconnect });
    } finally {
      setDisconnecting(false);
    }
  }

  const storageUnavailable = status !== null && !status.storageAvailable;
  const trimmedKey = apiKey.trim();
  const lengthHint =
    trimmedKey.length > 0 && trimmedKey.length !== 44
      ? copy.qpuKeyLengthHint(trimmedKey.length)
      : null;

  return (
    <section className="mj-artifact-panel mj-qpu-credentials" id="qpu-credentials" aria-labelledby="qpu-credentials-heading">
      <div className="mj-panel-heading">
        <h2 id="qpu-credentials-heading">{copy.qpuTitle}</h2>
        {status?.connected ? <span className="mj-mono-muted">{copy.qpuConnectedTitle}</span> : null}
      </div>
      <p className="mj-panel-help">{copy.qpuHelp}</p>

      {loading ? (
        <p className="mj-panel-help" role="status">{copy.qpuLoading}</p>
      ) : loadFailed ? (
        <p className="mj-qpu-message mj-qpu-message--error" role="alert">{copy.qpuLoadFailed}</p>
      ) : status?.connected ? (
        <Connected
          status={status}
          locale={locale}
          confirming={confirmingDisconnect}
          disconnecting={disconnecting}
          onAsk={() => setConfirmingDisconnect(true)}
          onCancel={() => setConfirmingDisconnect(false)}
          onConfirm={() => void disconnect()}
        />
      ) : (
        <>
          <p className="mj-qpu-open-plan">{copy.qpuOpenPlan}</p>
          <ol className="mj-qpu-steps">
            <li>
              {copy.qpuStepAccount}{" "}
              <a href="https://quantum.cloud.ibm.com/" target="_blank" rel="noreferrer">
                {copy.qpuDashboardLink}
              </a>
            </li>
            <li>{copy.qpuStepKey}</li>
            <li>{copy.qpuStepPaste}</li>
          </ol>
          {storageUnavailable ? (
            // Disabled rather than merely warned about: the field would take a
            // secret and the request would refuse it, so the honest control is
            // one that cannot be typed into.
            <p className="mj-qpu-message mj-qpu-message--error" role="alert">
              {copy.qpuErrorStorageUnavailable}
            </p>
          ) : (
            <p className="mj-qpu-not-connected">{copy.qpuNotConnected}</p>
          )}
          <form className="mj-account-profile-form mj-qpu-form" onSubmit={connect}>
            <label>
              <span>{copy.qpuKeyLabel}</span>
              {/* No `name`: see the note at the top of this file. */}
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={copy.qpuKeyPlaceholder}
                disabled={storageUnavailable || saving}
              />
              {lengthHint ? <small>{lengthHint}</small> : null}
            </label>
            <label>
              <span>{copy.qpuInstanceLabel}</span>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={instance}
                onChange={(event) => setInstance(event.target.value)}
                disabled={storageUnavailable || saving}
              />
              <small>{copy.qpuInstanceHelp}</small>
            </label>
            <label>
              <span>{copy.qpuLabelLabel}</span>
              <input
                type="text"
                autoComplete="off"
                maxLength={120}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                disabled={storageUnavailable || saving}
              />
              <small>{copy.qpuLabelHelp}</small>
            </label>
            <button
              className="mj-primary-button"
              type="submit"
              disabled={storageUnavailable || saving || trimmedKey.length === 0}
            >
              {saving ? copy.qpuConnecting : copy.qpuConnect}
            </button>
          </form>
          <p className="mj-panel-help">{copy.qpuStorageNote}</p>
        </>
      )}

      {outcome ? (
        <p
          className={`mj-qpu-message ${outcome.kind === "ok" ? "mj-qpu-message--ok" : "mj-qpu-message--error"}`}
          role={outcome.kind === "ok" ? "status" : "alert"}
        >
          {outcome.text}
          {/* The provider's own words, kept separate from ours so it is clear
              which sentence came from IBM and which one is Leona's advice. */}
          {outcome.detail ? <small>{copy.qpuProviderDetail(outcome.detail)}</small> : null}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Status only, once a key is stored.
 *
 * There is nothing to edit here and no field to re-show: the key is write-only
 * from this panel's point of view, and replacing it means pasting a new one
 * after disconnecting. What a person actually comes back for is whether it
 * still works — hence "last verified" and "last used", which are the two dates
 * that distinguish a live connection from one the provider revoked weeks ago.
 *
 * Disconnect asks first. It stops queued hardware runs from submitting, which
 * is a consequence nobody would predict from the word "disconnect", so the
 * warning appears with the confirmation rather than after it.
 */
function Connected({
  status,
  locale,
  confirming,
  disconnecting,
  onAsk,
  onCancel,
  onConfirm,
}: {
  status: CredentialStatus;
  locale: PublicLocale;
  confirming: boolean;
  disconnecting: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = ACCOUNT_COPY[locale];
  const day = (iso: string | null, fallback: string) =>
    (iso ? formatDay(iso, locale) : null) ?? fallback;

  return (
    <>
      <dl className="mj-usage-list">
        <div>
          <dt>{copy.qpuStatusLabel}</dt>
          <dd>{status.label ?? copy.qpuStatusNone}</dd>
        </div>
        <div>
          <dt>{copy.qpuStatusInstance}</dt>
          {/* The CRN as IBM writes it. Long, and it wraps rather than clipping:
              a truncated CRN cannot be compared against IBM's own console. */}
          <dd className="mj-qpu-crn">{status.instance ?? copy.qpuStatusNone}</dd>
        </div>
        <div>
          <dt>{copy.qpuStatusConnectedAt}</dt>
          <dd>{day(status.createdAt, copy.qpuStatusNone)}</dd>
        </div>
        <div>
          <dt>{copy.qpuStatusVerified}</dt>
          <dd>{day(status.lastVerifiedAt, copy.qpuStatusNone)}</dd>
        </div>
        <div>
          <dt>{copy.qpuStatusUsed}</dt>
          <dd>{day(status.lastUsedAt, copy.qpuNeverUsed)}</dd>
        </div>
      </dl>
      <p className="mj-panel-help">{copy.qpuStorageNote}</p>
      <div className="mj-qpu-actions">
        {confirming ? (
          <>
            <button
              className="mj-workspace-leave"
              type="button"
              disabled={disconnecting}
              onClick={onConfirm}
            >
              {disconnecting ? copy.qpuDisconnecting : copy.qpuDisconnectConfirm}
            </button>
            <button
              className="mj-secondary-button"
              type="button"
              disabled={disconnecting}
              onClick={onCancel}
            >
              {copy.qpuDisconnectCancel}
            </button>
          </>
        ) : (
          <button className="mj-workspace-leave" type="button" onClick={onAsk}>
            {copy.qpuDisconnect}
          </button>
        )}
      </div>
      {confirming ? <p className="mj-qpu-warning">{copy.qpuDisconnectWarning}</p> : null}
    </>
  );
}
