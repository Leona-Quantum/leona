"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { ResultVisualizations } from "./result-visualization";
import {
  INITIAL_HARDWARE_CARD_STATE,
  canSubmit,
  defaultDeviceId,
  fetchHardwareSpend,
  hardwareCardReducer,
  hardwareCatalog,
  latestRunOfRequest,
  notebookHardwareFingerprint,
  qasmDigest,
  recentQpuRuns,
  refusalText,
  type HardwareCatalog,
  type HardwareRequest,
} from "../lib/notebook-hardware";
import type { NotebookCellView } from "../lib/notebook-view";
import type { PublicLocale } from "../lib/public-locale";
import {
  QPU_RUN_POLL_MS,
  backendNameOf,
  fetchLatestQpuRunFor,
  fetchQpuEstimate,
  fetchQpuQueueStatus,
  fetchQpuRun,
  formatUsd,
  isPricedOnly,
  queueStatusLine,
  submitQpuRun,
  type QpuQueueStatus,
} from "../lib/qpu";
import { distributionFromResult } from "../lib/result-visualization";
import type { HardwareSpend } from "../lib/usage-summary";
import { NOTEBOOK_HARDWARE_COPY, WORKSPACE_COPY } from "../lib/workspace-locale";

/** Where a reader is sent to connect their IBM key — the account page's IBM pane. */
export const IBM_KEY_HREF = "/account#qpu";

export type NotebookHardwareContext = { notebookId: string; seq: number; locale: PublicLocale };

/**
 * One card per `leona_submit` call a cell made, under the cell's own simulator output.
 *
 * Renders nothing without `context`, which is how the read-only share page
 * (`app/shared/notebooks/`) stays a page that can never submit anything: it renders
 * the same `NotebookView` and simply does not pass one. Renders nothing for a cell
 * that did not finish cleanly either — a request recorded by a cell that then raised
 * is a circuit the notebook itself did not get to use.
 */
export function NotebookHardwareRequests({ cell, context }: { cell: NotebookCellView; context?: NotebookHardwareContext }) {
  if (!context || cell.kind !== "code" || cell.status !== "ok" || cell.hardwareRequests.length === 0) return null;
  return (
    <div className="mj-notebook-hardware">
      {cell.hardwareRequests.map((request, index) => (
        <NotebookHardwareCard
          // Requests are positional within a cell and never reorder within one report.
          key={index}
          request={request}
          cellId={cell.id}
          notebookId={context.notebookId}
          seq={context.seq}
          locale={context.locale}
        />
      ))}
    </div>
  );
}

export function NotebookHardwareCard({
  request,
  cellId,
  notebookId,
  seq,
  locale,
}: {
  request: HardwareRequest;
  cellId: string;
  notebookId: string;
  seq: number;
  locale: PublicLocale;
}) {
  const copy = NOTEBOOK_HARDWARE_COPY[locale];
  const studio = WORKSPACE_COPY[locale].studio;
  const [state, dispatch] = useReducer(hardwareCardReducer, INITIAL_HARDWARE_CARD_STATE);
  const [catalog, setCatalog] = useState<HardwareCatalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [queue, setQueue] = useState<QpuQueueStatus | null>(null);
  const [spend, setSpend] = useState<HardwareSpend | null>(null);
  // The second of two locks against a double submission (the reducer is the first):
  // two clicks can land before React re-renders the button disabled, and the POST is
  // started from the handler, not from the state, so the handler needs its own.
  const submitLock = useRef(false);

  const fingerprint = digest ? notebookHardwareFingerprint({ notebookId, seq, cellId, digest }) : null;
  const backend = catalog?.backends.find((item) => item.device_id === state.deviceId) ?? null;
  const pricedOnly = backend !== null && isPricedOnly(backend);
  const blockedReason = catalog?.gate.submission_available ? null : catalog?.gate.blocked_reason ?? null;
  const credentialMissing =
    blockedReason === "credentials_unconfigured" || state.error?.reason === "credentials_unconfigured";

  useEffect(() => {
    let cancelled = false;
    qasmDigest(request.qasm)
      .then((value) => {
        if (!cancelled) setDigest(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [request.qasm]);

  useEffect(() => {
    let cancelled = false;
    hardwareCatalog()
      .then((value) => {
        if (cancelled) return;
        setCatalog(value);
        const first = defaultDeviceId(value.backends);
        if (first) dispatch({ type: "chooseDevice", deviceId: first });
      })
      .catch(() => {
        if (!cancelled) setCatalogError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Bring back this request's latest run, so a finished job survives a reload. The
  // exact fingerprint first — server-filtered and indexed, so it finds a run however
  // old — then the newest page of history for the same circuit in an EARLIER version
  // of this cell (see `latestRunOfRequest` for why that half is client-side). A lookup
  // that fails changes nothing: an unreadable history says nothing about whether a
  // run exists, and the reducer ignores a restore once the reader has started one.
  useEffect(() => {
    if (!digest || !fingerprint) return;
    let cancelled = false;
    (async () => {
      const exact = await fetchLatestQpuRunFor(fingerprint);
      if (cancelled) return;
      if (exact && exact.source_fingerprint === fingerprint) {
        dispatch({ type: "restored", run: exact, fromSeq: null });
        return;
      }
      const earlier = latestRunOfRequest(await recentQpuRuns(), { notebookId, cellId, digest });
      if (!cancelled && earlier) {
        dispatch({ type: "restored", run: earlier.run, fromSeq: earlier.seq === seq ? null : earlier.seq });
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [digest, fingerprint, notebookId, cellId, seq]);

  // The price, for exactly the shots the cell asked for, on the device chosen.
  useEffect(() => {
    if (state.phase !== "estimating" || !state.deviceId) return;
    const deviceId = state.deviceId;
    fetchQpuEstimate(deviceId, request.shots)
      .then((estimate) => dispatch({ type: "estimated", deviceId, estimate }))
      .catch(() => dispatch({ type: "estimateFailed", deviceId, message: studio.hardwareEstimateFailed }));
    // No cancellation flag: the reducer drops an answer for a device or a phase the
    // card has left, which is the same guarantee without a second copy of the rule.
  }, [state.phase, state.deviceId, request.shots, studio.hardwareEstimateFailed]);

  // What the reader needs beside the price before confirming: how busy the device is
  // and what they have already spent. Read when the confirm step opens, not before.
  useEffect(() => {
    if (state.phase !== "confirm" || !state.deviceId) return;
    let cancelled = false;
    setQueue(null);
    if (backend && !isPricedOnly(backend)) {
      fetchQpuQueueStatus(state.deviceId)
        .then((value) => {
          if (!cancelled) setQueue(value);
        })
        .catch(() => undefined);
    }
    fetchHardwareSpend()
      .then((value) => {
        if (!cancelled) setSpend(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state.phase, state.deviceId, backend]);

  // A submitted job settles on the provider's schedule: re-read the durable record at
  // Studio's rate until it is terminal. The reducer ignores an answer for any other run.
  const polledId = state.phase === "queued" || state.phase === "running" ? state.run?.id ?? null : null;
  useEffect(() => {
    if (!polledId) return;
    const timer = window.setInterval(() => {
      fetchQpuRun(polledId)
        .then((run) => dispatch({ type: "polled", run }))
        .catch(() => undefined);
    }, QPU_RUN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [polledId]);

  const submitAllowed = canSubmit(state, {
    credentialMissing,
    submittable: backend !== null && !pricedOnly && blockedReason === null,
    digestReady: fingerprint !== null,
  });

  function confirm() {
    if (submitLock.current || !submitAllowed || !state.deviceId || !fingerprint) return;
    submitLock.current = true;
    dispatch({ type: "submit" });
    submitQpuRun({
      device_id: state.deviceId,
      shots: request.shots,
      qasm: request.qasm,
      source_fingerprint: fingerprint,
    })
      .then((run) => dispatch({ type: "submitted", run }))
      .catch((cause: unknown) => dispatch({ type: "submitFailed", ...refusalText(cause, studio) }))
      .finally(() => {
        submitLock.current = false;
      });
  }

  const picking = state.phase === "idle" || state.phase === "estimating" || state.phase === "confirm" || state.phase === "done" || state.phase === "error";
  const estimate = state.estimate;
  const priced = estimate !== null && estimate.basis === "vendor_rate_card" && estimate.total_usd !== null;
  const distribution = state.run?.raw_counts ? distributionFromResult({ counts: state.run.raw_counts }, locale) : null;
  const machine = state.run ? backendNameOf(state.run) : null;

  return (
    <section className="mj-qpu-lane mj-notebook-hardware-card" data-phase={state.phase} aria-label={copy.title}>
      <span className="mj-qpu-lane-title">{copy.title}</span>
      <p className="mj-mono-muted">{copy.summary(request.num_qubits, request.shots, request.label ?? null)}</p>
      {catalogError ? <p role="alert">{studio.hardwareCatalogUnavailable}</p> : null}
      {!catalog && !catalogError ? <p>{studio.hardwareCatalogLoading}</p> : null}
      {catalog && catalog.backends.length > 0 ? (
        <div className="mj-qpu-flow">
          {picking ? (
            <label className="mj-studio-field">
              <span>{studio.hardwareDevice}</span>
              <select
                value={state.deviceId ?? ""}
                onChange={(event) => dispatch({ type: "chooseDevice", deviceId: event.target.value })}
              >
                {catalog.backends.map((item) => (
                  <option value={item.device_id} key={item.device_id}>{item.display_name}</option>
                ))}
              </select>
            </label>
          ) : null}
          {pricedOnly && picking ? <p className="mj-qpu-note">{studio.hardwarePricedOnly}</p> : null}
          {credentialMissing ? (
            <p className="mj-qpu-note" role="note">
              {copy.credentialMissing} <a href={IBM_KEY_HREF}>{copy.credentialLink}</a>
            </p>
          ) : blockedReason ? (
            <p className="mj-qpu-note">{studio.hardwareBlockedReason(blockedReason)}</p>
          ) : null}

          {state.phase === "idle" ? (
            <>
              <p className="mj-qpu-note">{copy.nothingSent}</p>
              <div className="mj-notebook-hardware-actions">
                <button type="button" className="mj-secondary-button" disabled={!state.deviceId} onClick={() => dispatch({ type: "estimate" })}>
                  {copy.seePrice}
                </button>
              </div>
            </>
          ) : null}
          {state.phase === "estimating" ? <p role="status">{studio.hardwareEstimating}</p> : null}

          {state.phase === "confirm" && estimate ? (
            <div className="mj-qpu-estimate">
              {priced ? (
                <>
                  <p className="mj-notebook-hardware-price">{copy.confirmPriced(formatUsd(estimate.total_usd ?? 0))}</p>
                  <dl className="mj-studio-contract">
                    <div><dt>{studio.hardwareTaskFee}</dt><dd>{estimate.task_fee_usd !== null ? formatUsd(estimate.task_fee_usd) : "—"}</dd></div>
                    <div><dt>{studio.hardwareShotFees((estimate.total_shots ?? estimate.shots).toLocaleString("en-US"))}</dt><dd>{estimate.shot_fees_usd !== null ? formatUsd(estimate.shot_fees_usd) : "—"}</dd></div>
                    <div><dt>{studio.hardwareEstimatedTotal}</dt><dd><strong>{formatUsd(estimate.total_usd ?? 0)}</strong></dd></div>
                  </dl>
                  <p className="mj-qpu-disclaimer">{estimate.disclaimer}</p>
                </>
              ) : (
                <>
                  <p className="mj-notebook-hardware-price">{copy.confirmFree}</p>
                  {estimate.allowance_note ? <p className="mj-qpu-disclaimer">{estimate.allowance_note}</p> : null}
                </>
              )}
              {spend ? (
                <p className="mj-qpu-note">
                  {spend.limitUsd === null
                    ? copy.allowanceAuthorized(formatUsd(spend.usedUsd), spend.windowDays)
                    : copy.allowanceUsed(formatUsd(spend.usedUsd), formatUsd(spend.limitUsd), spend.windowDays)}
                </p>
              ) : null}
              {backend && !pricedOnly ? (
                <div className="mj-qpu-queue" role="status">
                  <span className="mj-qpu-queue-title">{studio.hardwareQueueTitle}</span>
                  {queue ? (
                    queueStatusLine(queue, { jobsAhead: studio.hardwareQueueJobsAhead, noneAhead: studio.hardwareQueueNoneAhead }) ? (
                      <p className="mj-qpu-queue-line">
                        {queueStatusLine(queue, { jobsAhead: studio.hardwareQueueJobsAhead, noneAhead: studio.hardwareQueueNoneAhead })}
                        {queue.backend_name ? <span className="mj-mono-muted"> {studio.hardwareQueueMachine(queue.backend_name)}</span> : null}
                      </p>
                    ) : queue.unavailable_reason ? (
                      <p className="mj-qpu-note">{studio.hardwareBlockedReason(queue.unavailable_reason)}</p>
                    ) : null
                  ) : (
                    <p className="mj-mono-muted">{studio.hardwareQueueChecking}</p>
                  )}
                </div>
              ) : null}
              {backend ? (
                <p className="mj-qpu-source"><a href={backend.rate_source} target="_blank" rel="noreferrer">{studio.hardwareRateSource} ↗</a></p>
              ) : null}
              <div className="mj-notebook-hardware-actions">
                <button type="button" className="mj-secondary-button" onClick={() => dispatch({ type: "cancel" })}>
                  {copy.cancel}
                </button>
                <button type="button" className="mj-primary-button" disabled={!submitAllowed} onClick={confirm}>
                  {priced ? copy.submitPriced(formatUsd(estimate.total_usd ?? 0)) : copy.submitFree}
                </button>
              </div>
            </div>
          ) : null}

          {state.phase === "submitting" ? <p role="status">{copy.submitting}</p> : null}
          {state.phase === "queued" ? <p role="status">{copy.queued}</p> : null}
          {state.phase === "running" ? <p role="status">{copy.running}</p> : null}
          {state.phase === "error" && state.error?.message ? (
            <p className="mj-qpu-note" role="alert">{state.error.message}</p>
          ) : null}

          {state.run ? (
            <div className="mj-qpu-record">
              {state.restoredFromSeq !== null ? <p className="mj-qpu-note">{copy.earlierVersion(state.restoredFromSeq)}</p> : null}
              <dl className="mj-studio-contract">
                <div><dt>{studio.hardwareJobStatus}</dt><dd>{state.run.status}</dd></div>
                {state.run.provider_job_id ? <div><dt>{studio.hardwareJobId}</dt><dd>{state.run.provider_job_id}</dd></div> : null}
                {machine ? <div><dt>{studio.hardwareMachine}</dt><dd><code>{machine}</code></dd></div> : null}
                {state.run.error ? <div><dt>{studio.hardwareJobError}</dt><dd>{state.run.error}</dd></div> : null}
              </dl>
              {state.phase === "done" ? (
                <>
                  <p className="mj-qpu-note">{machine ? copy.measuredOn(machine) : copy.done} {copy.simulatorAbove}</p>
                  {distribution ? <ResultVisualizations distribution={distribution} traces={[]} charts={[]} values={[]} locale={locale} /> : null}
                </>
              ) : null}
            </div>
          ) : null}

          {state.phase === "done" || (state.phase === "error" && state.run) ? (
            <div className="mj-notebook-hardware-actions">
              <button type="button" className="mj-secondary-button" onClick={() => dispatch({ type: "again" })}>
                {copy.runAgain}
              </button>
            </div>
          ) : state.phase === "error" ? (
            <div className="mj-notebook-hardware-actions">
              <button type="button" className="mj-secondary-button" disabled={!state.deviceId} onClick={() => dispatch({ type: "estimate" })}>
                {copy.tryAgain}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
