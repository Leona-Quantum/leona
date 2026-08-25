/**
 * Egress policy for the generated document.
 *
 * Every ordinary channel out of the frame is named here and closed: no fetch,
 * XHR, WebSocket or beacon (`connect-src 'none'`), no subresource that could
 * carry bytes in a URL (`img-src` is data:/blob: only; `font-src`, `media-src`,
 * `object-src` none), no form post (`form-action 'none'`), no nested browsing
 * context (`frame-src`, `worker-src` none), and no relative-URL rebasing
 * (`base-uri 'none'`). `default-src 'none'` covers whatever is left.
 *
 * ONE channel is deliberately not in this list, because CSP cannot close it:
 * **the frame navigating itself.** `navigate-to` was removed from the spec and
 * ships in no browser, and the `sandbox` attribute restricts a frame navigating
 * its PARENT (which is why `allow-top-navigation` is absent) but never a frame
 * navigating itself. So a document that gets past
 * `qapp_validation.py::_FORBIDDEN_UI_PATTERNS` at generation time can still set
 * its own location and put whatever a viewer typed into the query string of a
 * URL it chooses — and, worse than the exfiltration, can then render an
 * attacker-controlled page inside Leona's chrome.
 *
 * That is the residual risk ADR-0031 records, and it is accepted there under the
 * ai-ops issue 177 ruling. (Written out rather than with a hash, because
 * `check-raw-hex.mjs` reads a three-digit issue reference as a colour literal,
 * and it is right to — three hex digits is a valid colour.) What covers it is
 * the generation-time pattern guard in `qapp_validation.py`, which is a filter
 * on how a document is WRITTEN and not a boundary; the comment is here so nobody reads the absence from this list as an
 * oversight and "fixes" it with a directive that does nothing.
 *
 * A runtime tripwire in the host was built for this and then removed, because it
 * cannot be made correct. The parent cannot attribute a `load` event to a
 * document — the origin is opaque before and after a navigation, and WindowProxy
 * identity survives it — so "our document has not announced itself yet" and "this
 * document will never announce itself" are the same observation. Every rule that
 * catches a frame navigating before its own load also tears down a legitimate
 * Qapp whose announcement has not been delivered yet. See ADR-0031.
 */
export const QAPP_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export type QappExecuteMessage = {
  channel: string;
  type: "qapp.execute";
  requestId: string;
  inputs: Record<string, unknown>;
};

export function isQappExecuteMessage(value: unknown, channel: string): value is QappExecuteMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.channel !== channel
    || candidate.type !== "qapp.execute"
    || typeof candidate.requestId !== "string"
    || candidate.requestId.length < 1
    || candidate.requestId.length > 100
    || !candidate.inputs
    || typeof candidate.inputs !== "object"
    || Array.isArray(candidate.inputs)
  ) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(candidate.inputs)).byteLength <= 16_384;
  } catch {
    return false;
  }
}

function bridgeScript(channel: string): string {
  const encodedChannel = JSON.stringify(channel).replace(/</g, "\\u003c");
  return `<script>(()=>{
    const channel=${encodedChannel};
    const pending=new Map();
    let sequence=0;
    window.qapp=Object.freeze({run(inputs){
      return new Promise((resolve,reject)=>{
        // Refused HERE, not by silence over there. The host drops any message
        // that fails isQappExecuteMessage, so a frame that sent an oversized or
        // malformed payload got no reply at all and its promise never settled --
        // a Qapp that hangs forever with no error a reader can see. The two
        // conditions mirror the host's, so the frame learns the same answer.
        if(!inputs||typeof inputs!=="object"||Array.isArray(inputs)){
          reject(new Error("Qapp inputs must be an object."));return;
        }
        let encoded;
        try{encoded=new TextEncoder().encode(JSON.stringify(inputs)).byteLength;}
        catch(error){reject(new Error("Qapp inputs could not be serialised."));return;}
        if(encoded>16384){reject(new Error("Qapp inputs exceed 16 KB."));return;}
        const requestId=String(++sequence);
        pending.set(requestId,{resolve,reject});
        window.parent.postMessage({channel,type:"qapp.execute",requestId,inputs},"*");
      });
    }});
    window.addEventListener("message",event=>{
      const message=event.data;
      if(!message||message.channel!==channel||message.type!=="qapp.response")return;
      const request=pending.get(message.requestId);
      if(!request)return;
      pending.delete(message.requestId);
      if(message.ok)request.resolve(message.result);else request.reject(new Error(message.error||"Qapp execution failed"));
    });
  })();</script>`;
}

/**
 * Wrap a generated document so the policy and the bridge are parsed first.
 *
 * This deliberately does NOT look for the generated document's own `<head>` and
 * splice into it. Splicing means an attacker-controlled string decides where our
 * policy lands, and a regex cannot tell markup from a comment, a JS string or an
 * attribute value. All four of these pass the server-side document guard and
 * each one defeats the policy a different way:
 *
 *   `<!--<head>-->`                  the meta and the whole bridge land inside a comment
 *   `<script>var s="<head>";</script>`  they land inside a JavaScript string literal
 *   `<div data-x="<head>">`          they land inside an attribute value
 *   `<script>…</script><head>`       the generated script runs before the policy exists
 *
 * Wrapping removes the choice: the controls are always the first thing in the
 * head of a document we authored, and the generated markup can only follow them.
 * The parser folds a generated `<!doctype>`, `<html>`, `<head>` or `<body>` that
 * arrives inside the body — `<title>` and `<style>` are still honoured there — so
 * an ordinary well-formed generated page renders unchanged.
 *
 * The iframe `sandbox` attribute, not this policy, is the security boundary; the
 * policy is the layer that stops ordinary subresource and fetch egress, and it
 * cannot do that from inside a comment.
 */
export function qappFrameDocument(uiDocument: string, channel: string): string {
  const controls = `<meta http-equiv="Content-Security-Policy" content="${QAPP_FRAME_CSP}"><meta name="referrer" content="no-referrer">${bridgeScript(channel)}`;
  return `<!doctype html><html><head>${controls}</head><body>${uiDocument}</body></html>`;
}
