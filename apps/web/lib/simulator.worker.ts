import { createSimulatorContext, handleSimulatorRequest } from "./simulator-protocol.ts";

/**
 * The simulator worker: one dedicated worker, created by
 * `simulator-client.ts` with
 * `new Worker(new URL("./simulator.worker.ts", import.meta.url), { type: "module" })`.
 * That exact shape is what lets the bundler emit this file as same-origin
 * script under `/_next/static/`, which is the only kind of worker the site's
 * CSP admits: there is no `worker-src`, so workers fall back to
 * `script-src 'self' 'unsafe-inline'` (content-security-policy.ts), and a
 * `blob:` or `data:` worker is refused.
 *
 * What Turbopack actually emits for it (Next 16.3, checked on a production
 * build 2026-09-22): a small classic bootstrap, `static/chunks/turbopack-
 * worker-*.js`, that loads this file's chunks with `importScripts` and refuses
 * any other origin; `type: "module"` is dropped in favour of it. Under the
 * real CSP that loaded with no violation, while a `blob:` worker created on
 * the same page was refused (`worker-src` falling back to `script-src`). The
 * build also copies this file's raw source to `static/media/`, a module
 * nothing references; it carries no more than this file does.
 *
 * Everything it does is in `handleSimulatorRequest`, so the logic is tested in
 * Node without a Worker; this file is only the wiring. It answers one message
 * at a time, in order — the client never sends a second job before the first
 * is answered, which is what keeps stale work from queueing up here.
 */

type WorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown, transfer: ArrayBuffer[]) => void;
};

const scope = self as unknown as WorkerScope;
const context = createSimulatorContext();

scope.onmessage = (event) => {
  const handled = handleSimulatorRequest(event.data, context);
  if (handled) scope.postMessage(handled.response, handled.transfer);
};
