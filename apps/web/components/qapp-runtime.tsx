"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isQappExecuteMessage, isQappReadyMessage, qappFrameDocument } from "../lib/qapp-frame";

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
  // The navigation tripwire. `QAPP_FRAME_CSP` closes every egress channel a
  // policy can close; the one it cannot is the frame navigating ITSELF, because
  // `navigate-to` ships in no browser and `sandbox` only governs navigating the
  // parent. A generated document that gets past the server-side pattern guard
  // can therefore replace itself with an attacker's page — putting whatever the
  // viewer typed in a URL, and then rendering that page inside Leona's chrome,
  // which is the worse half: it is a convincing place to ask for a password.
  //
  // A plain load counter does not work: browsers may fire a load for the
  // iframe's initial about:blank before `srcDoc` is parsed, and tearing a
  // working Qapp down on its own first paint would be a worse bug than the one
  // being fixed. So the frame identifies itself instead — the bridge, which runs
  // first in a head WE authored and before any generated markup, posts
  // `qapp.ready`. The rule is then exact: a load event arriving AFTER we have
  // heard ready is a second document, and a second document is not ours.
  //
  // The frame cannot spoof its way out. Replaying `qapp.ready` from the
  // attacker page does not help — teardown keys on `ready` having ALREADY been
  // seen, so another one only re-confirms it. Hanging the navigation forever
  // suppresses the load event, but then nothing renders and the phishing half
  // is dead anyway; the first request is gone either way and no design that
  // reacts to a navigation can recall it.
  const readyRef = useRef(false);
  const [navigatedAway, setNavigatedAway] = useState(false);
  // Reset both when the document changes, DURING RENDER rather than in an
  // effect. `channel` comes from `useId` and so is stable for the life of this
  // component, which means a different Qapp rendered into the same instance —
  // a client navigation from one `/q/<slug>` to another — swaps `srcDoc`
  // without remounting and without re-running the effect below. `readyRef`
  // would still be true from the Qapp that just left, the new Qapp's very
  // first load would be read as a navigation away, and a working Qapp would be
  // torn down on arrival. An effect is too late: it would race the new
  // document's load event. Adjusting state during render is React's documented
  // answer to exactly this, and the `key` on the iframe below makes the frame
  // itself a fresh element rather than one carrying the old document's history.
  const renderedDocument = useRef(document);
  if (renderedDocument.current !== document) {
    renderedDocument.current = document;
    readyRef.current = false;
    if (navigatedAway) setNavigatedAway(false);
  }

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
      if (isQappReadyMessage(event.data, channel)) {
        readyRef.current = true;
        return;
      }
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
      {navigatedAway ? (
        // Unmounted, not hidden. Leaving the element in the tree with the
        // attacker's document still loaded would keep exactly the surface this
        // is here to remove.
        <div className="qapp-runtime-frame qapp-runtime-blocked" role="alert">
          <p>This Qapp&rsquo;s interface tried to navigate away from Leona and was stopped.</p>
          <p>Nothing you type into a Qapp should ever be a password. Reload the page to try again.</p>
        </div>
      ) : (
        <iframe
          ref={frame}
          title="Qapp"
          srcDoc={document}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="qapp-runtime-frame"
          key={document}
          onLoad={() => {
            // Deferred by one task, and that is the whole fix for the
            // synchronous case. A hostile document can navigate itself from an
            // inline script, in the same turn the bridge ran: the bridge's
            // `qapp.ready` is already queued for us at that point — a posted
            // message survives its sender navigating — but it has not been
            // DELIVERED, so reading `readyRef` here would still see false and
            // wave the attacker's document through. `load` and `message` are
            // different task sources with no ordering guarantee between them,
            // so this cannot be reasoned away. A timeout enqueues a task behind
            // both of them, and by the time it runs, any `ready` the previous
            // document sent has been dispatched.
            //
            // The rule it then applies is unchanged: `ready` not yet seen means
            // this is the ordinary first paint — possibly the iframe's initial
            // about:blank — while a load after the bridge has spoken is a
            // second document, and a second document is not ours.
            window.setTimeout(() => {
              if (readyRef.current) setNavigatedAway(true);
            }, 0);
          }}
        />
      )}
      <footer className="qapp-runtime-status" aria-live="polite">
        <span>{notice ?? "Quantum execution is isolated; UI network and storage APIs are restricted."}</span>
        {!canExecute && signInPath ? <Link href={signInPath}>Sign in to run →</Link> : null}
      </footer>
    </section>
  );
}
