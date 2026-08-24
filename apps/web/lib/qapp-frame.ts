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

export function qappFrameDocument(uiDocument: string, channel: string): string {
  const controls = `<meta http-equiv="Content-Security-Policy" content="${QAPP_FRAME_CSP}"><meta name="referrer" content="no-referrer">${bridgeScript(channel)}`;
  const head = /<head(?:\s[^>]*)?>/i.exec(uiDocument);
  if (head?.index !== undefined) {
    const offset = head.index + head[0].length;
    return `${uiDocument.slice(0, offset)}${controls}${uiDocument.slice(offset)}`;
  }
  return `<!doctype html><html><head>${controls}</head><body>${uiDocument}</body></html>`;
}
