import { createSimulatorContext, handleSimulatorRequest } from "./simulator-protocol.ts";

/**
 * The simulator worker: one dedicated module worker, created by
 * `simulator-client.ts` with
 * `new Worker(new URL("./simulator.worker.ts", import.meta.url), { type: "module" })`.
 * That exact shape is what lets the bundler emit this file as its own
 * same-origin chunk under `/_next/static/`, which is the only kind of worker
 * the site's CSP admits: there is no `worker-src`, so workers fall back to
 * `script-src 'self' 'unsafe-inline'` (content-security-policy.ts), and a
 * `blob:` or `data:` worker would be refused.
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
