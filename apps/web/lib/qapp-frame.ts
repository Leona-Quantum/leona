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
