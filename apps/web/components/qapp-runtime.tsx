"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isQappExecuteMessage, qappFrameDocument } from "../lib/qapp-frame";

type Execution = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result?: Record<string, unknown> | null;
  error_code?: string | null;
};

export function QappRuntime({
  slug,
  uiDocument,
  canExecute,
  signInPath,
}: {
  slug: string;
  uiDocument: string;
  canExecute: boolean;
  signInPath?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const reactId = useId();
  const channel = `leona-qapp-${reactId.replace(/[^a-z0-9-]/gi, "")}`;
  const document = useMemo(() => qappFrameDocument(uiDocument, channel), [uiDocument, channel]);
  const runningRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    async function execute(requestId: string, inputs: Record<string, unknown>) {
      if (runningRef.current) {
        frame.current?.contentWindow?.postMessage({ channel, type: "qapp.response", requestId, ok: false, error: "Another execution is already running." }, "*");
        return;
      }
      if (!canExecute) {
        setNotice("Sign in to run this public Qapp. Viewing stays public.");
        frame.current?.contentWindow?.postMessage({ channel, type: "qapp.response", requestId, ok: false, error: "Sign in to execute this Qapp." }, "*");
        return;
      }
      runningRef.current = true;
      setNotice("Running in an isolated quantum sandbox…");
      try {
        const submitted = await fetch(`/api/qapps/${encodeURIComponent(slug)}/executions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inputs }),
        });
        // problem+json: the reason is `title`, not FastAPI's `detail`.
        const initial = await submitted.json() as Execution | { title?: string };
        if (!submitted.ok || !("id" in initial)) throw new Error("title" in initial && initial.title ? initial.title : "Execution could not be submitted.");
        let execution = initial;
        for (let attempt = 0; attempt < 150 && !disposed; attempt += 1) {
          if (execution.status === "succeeded" || execution.status === "failed") break;
          await new Promise((resolve) => setTimeout(resolve, 800));
          const response = await fetch(`/api/qapps/executions/${encodeURIComponent(execution.id)}`, { cache: "no-store" });
          if (!response.ok) throw new Error("Execution status is unavailable.");
          execution = await response.json() as Execution;
        }
        if (disposed) return;
        if (execution.status !== "succeeded") throw new Error(execution.error_code ?? "Execution failed.");
        frame.current?.contentWindow?.postMessage({ channel, type: "qapp.response", requestId, ok: true, result: execution.result ?? {} }, "*");
        setNotice("Execution complete.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Execution failed.";
        if (!disposed) {
          frame.current?.contentWindow?.postMessage({ channel, type: "qapp.response", requestId, ok: false, error: message }, "*");
          setNotice(message);
        }
      } finally {
        runningRef.current = false;
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
      window.removeEventListener("message", receive);
    };
  }, [canExecute, channel, slug]);

  return (
    <section className="qapp-runtime">
      <iframe
        ref={frame}
        title="Qapp"
        srcDoc={document}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="qapp-runtime-frame"
      />
      <footer className="qapp-runtime-status" aria-live="polite">
        <span>{notice ?? "Quantum execution is isolated; UI network and storage APIs are restricted."}</span>
        {!canExecute && signInPath ? <Link href={signInPath}>Sign in to run →</Link> : null}
      </footer>
    </section>
  );
}
