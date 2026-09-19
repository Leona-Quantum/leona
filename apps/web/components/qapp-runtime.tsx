"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { qappCopy } from "../lib/qapp-copy";
import { executionErrorSentence } from "../lib/qapp-execution-copy";
import type { PublicLocale } from "../lib/public-locale";
import { isQappExecuteMessage, qappFrameDocument } from "../lib/qapp-frame";

type Execution = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result?: Record<string, unknown> | null;
  error_code?: string | null;
};
type PendingExecution = { execution: Execution; requestId: string };
const MAX_STATUS_CHECKS = 150;

export function QappRuntime({
  slug,
  uiDocument,
  canExecute,
  signInPath,
  locale = "en",
}: {
  slug: string;
  uiDocument: string;
  canExecute: boolean;
  signInPath?: string;
  locale?: PublicLocale;
}) {
  const copy = qappCopy(locale).runtime;
  const frame = useRef<HTMLIFrameElement>(null);
  const reactId = useId();
  const channel = `leona-qapp-${reactId.replace(/[^a-z0-9-]/gi, "")}`;
  const frameDocument = useMemo(() => qappFrameDocument(uiDocument, channel), [uiDocument, channel]);
  const runningRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingExecution | null>(null);
  const [monitorError, setMonitorError] = useState(false);
  const [monitorAttempt, setMonitorAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    runningRef.current = false;
    setPending(null);
    setMonitorError(false);
    setNotice(null);
    async function execute(requestId: string, inputs: Record<string, unknown>) {
      if (runningRef.current) {
        frame.current?.contentWindow?.postMessage({ channel, type: "qapp.response", requestId, ok: false, error: copy.busy }, "*");
        return;
      }
      if (!canExecute) {
        setNotice(copy.signInToRun);
        frame.current?.contentWindow?.postMessage({ channel, type: "qapp.response", requestId, ok: false, error: copy.signInToExecute }, "*");
        return;
      }
      runningRef.current = true;
      setNotice(copy.submitting);
      try {
        const submitted = await fetch(`/api/qapps/${encodeURIComponent(slug)}/executions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inputs }),
          signal: controller.signal,
        });
        const initial = await submitted.json() as Execution | { title?: string };
        if (!submitted.ok || !("id" in initial)) throw new Error("title" in initial && initial.title ? initial.title : copy.submitFailed);
        if (!disposed) setPending({ execution: initial, requestId });
      } catch (error) {
        if (disposed) return;
        runningRef.current = false;
        const message = error instanceof Error ? error.message : copy.submitFailed;
        frame.current?.contentWindow?.postMessage({ channel, type: "qapp.response", requestId, ok: false, error: message }, "*");
        setNotice(message);
      }
    }
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      if (!isQappExecuteMessage(event.data, channel)) return;
      void execute(event.data.requestId, event.data.inputs);
    }
    window.addEventListener("message", receive);
    return () => {
      disposed = true;
      controller.abort();
      window.removeEventListener("message", receive);
    };
  }, [canExecute, channel, slug, copy]);

  useEffect(() => {
    if (!pending) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checks = 0;
    const controller = new AbortController();
    setMonitorError(false);
    const { requestId } = pending;
    function observe(execution: Execution) {
      if (disposed) return;
      if (execution.status === "succeeded" || execution.status === "failed") {
        const ok = execution.status === "succeeded";
        // The machine code stays on the execution row; what reaches the
        // generated interface and the status line is a sentence. A visitor was
        // shown "qapp_program_failed" beside the button they had just pressed.
        const failure = ok ? null : executionErrorSentence(execution.error_code, locale);
        frame.current?.contentWindow?.postMessage({ channel, type: "qapp.response", requestId, ok, ...(ok ? { result: execution.result ?? {} } : { error: failure }) }, "*");
        setNotice(ok ? copy.complete : failure);
        runningRef.current = false;
        setPending(null);
        return;
      }
      if (checks >= MAX_STATUS_CHECKS) {
        // A polling limit is not an execution result. Keep its identity and
        // submission lock so the next attempt only resumes status checks.
        setNotice(copy.paused);
        setMonitorError(true);
        return;
      }
      setNotice(execution.status === "queued" ? copy.queued : checks >= 48 ? copy.stillRunning : copy.running);
      timer = setTimeout(() => { void check(); }, checks < 30 ? 1000 : 2500);
    }
    async function check() {
      try {
        const response = await fetch(`/api/qapps/executions/${encodeURIComponent(pending!.execution.id)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Status unavailable");
        const execution = await response.json() as Execution;
        checks += 1;
        observe(execution);
      } catch {
        if (disposed) return;
        // A failed status request says nothing about the job outcome. Keep its
        // identity and the submission lock so Retry never starts a second run.
        setNotice(copy.interrupted);
        setMonitorError(true);
      }
    }
    if (monitorAttempt > 0) void check();
    else observe(pending.execution);
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [pending, monitorAttempt, channel, copy, locale]);

  return (
    <section className="qapp-runtime">
      <iframe ref={frame} title={copy.frameTitle} srcDoc={frameDocument} sandbox="allow-scripts" referrerPolicy="no-referrer" className="qapp-runtime-frame" />
      <footer className="qapp-runtime-status" aria-live="polite">
        <span>{notice ?? (canExecute ? copy.chooseInputs : copy.signInToRun)}</span>
        {monitorError ? <button className="mj-secondary-button" type="button" onClick={() => setMonitorAttempt((value) => value + 1)}>{copy.retryStatus}</button> : null}
        {!canExecute && signInPath ? <Link href={signInPath}>{copy.signInLink}</Link> : null}
      </footer>
    </section>
  );
}
