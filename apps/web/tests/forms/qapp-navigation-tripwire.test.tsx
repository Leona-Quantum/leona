// The one egress channel the sandbox and the CSP cannot close.
//
// `QAPP_FRAME_CSP` shuts every ordinary way out of the generated frame — fetch,
// forms, subresources, nested frames. It cannot stop the frame navigating
// ITSELF: `navigate-to` ships in no browser, and `sandbox` governs a frame
// navigating its parent, never itself. `qapp-runtime.tsx` therefore watches for
// a second document and tears the frame out of the DOM.
//
// The whole design turns on ONE distinction — a load event before the bridge
// has spoken is the ordinary first paint (possibly the iframe's initial
// about:blank), and a load event after it is a document that is not ours. Both
// halves are asserted here, because a tripwire that fires on the first paint
// would break every working Qapp, and one that never fires is not a tripwire.
import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QappRuntime } from "../../components/qapp-runtime.tsx";

const UI = "<h1>Bell state</h1><script>/* generated */</script>";

/** The channel is React's `useId`, so it is only knowable from the rendered
 *  srcdoc — which is also the only place the real frame learns it. */
function channelFrom(iframe: HTMLIFrameElement): string {
  const srcdoc = iframe.getAttribute("srcdoc") ?? "";
  const match = srcdoc.match(/const channel="([^"]+)"/);
  assert.ok(match, "bridge script did not declare a channel — the harness is reading the wrong thing");
  return match[1];
}

// jsdom's MessageEvent, not the global one: under `node --test` the global is
// undici's, whose `source` must be a MessagePort and which rejects a Window
// outright. `qapp-runtime.tsx` compares `event.source` to the frame's window,
// so the test cannot substitute a port for it.
function messageFrom(source: Window | null, data: unknown): MessageEvent {
  const Ctor = (window as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent;
  return new Ctor("message", { data, source } as MessageEventInit);
}

function speakAsFrame(iframe: HTMLIFrameElement, data: unknown) {
  // A frame whose window this environment never populated would make every
  // sender check below compare null to null and pass without testing anything.
  assert.ok(iframe.contentWindow, "iframe has no contentWindow — the sender checks would be vacuous");
  window.dispatchEvent(messageFrom(iframe.contentWindow, data));
}

test("the first load is the ordinary one and does not tear the frame down", () => {
  const view = render(<QappRuntime slug="bell" uiDocument={UI} canExecute />);
  const iframe = view.container.querySelector("iframe");
  assert.ok(iframe, "no iframe rendered");

  fireEvent.load(iframe);

  assert.ok(
    view.container.querySelector("iframe"),
    "the frame was torn down on its own first paint — every working Qapp would break",
  );
  assert.equal(view.queryByRole("alert"), null);
});

test("a load after the bridge has spoken is a second document and the frame is removed", async () => {
  const view = render(<QappRuntime slug="bell" uiDocument={UI} canExecute />);
  const iframe = view.container.querySelector("iframe") as HTMLIFrameElement;
  const channel = channelFrom(iframe);

  fireEvent.load(iframe);
  speakAsFrame(iframe, { channel, type: "qapp.ready" });
  fireEvent.load(iframe);

  await waitFor(() => assert.ok(view.getByRole("alert")));
  assert.equal(
    view.container.querySelector("iframe"),
    null,
    "the attacker document was left mounted — hiding it keeps exactly the surface this removes",
  );
  assert.match(view.getByRole("alert").textContent ?? "", /tried to navigate away/);
});

test("a ready message from somewhere other than the frame does not arm the tripwire", async () => {
  const view = render(<QappRuntime slug="bell" uiDocument={UI} canExecute />);
  const iframe = view.container.querySelector("iframe") as HTMLIFrameElement;
  const channel = channelFrom(iframe);

  fireEvent.load(iframe);
  // Same channel, same shape, wrong sender — a second frame on the page, or any
  // opener. Arming from this would let one Qapp tear down another.
  assert.notEqual(iframe.contentWindow, window, "harness cannot distinguish the two senders");
  window.dispatchEvent(messageFrom(window, { channel, type: "qapp.ready" }));
  fireEvent.load(iframe);

  await waitFor(() => assert.ok(view.container.querySelector("iframe")));
  assert.equal(view.queryByRole("alert"), null);
});

test("a ready message on another channel does not arm the tripwire", async () => {
  const view = render(<QappRuntime slug="bell" uiDocument={UI} canExecute />);
  const iframe = view.container.querySelector("iframe") as HTMLIFrameElement;

  fireEvent.load(iframe);
  speakAsFrame(iframe, { channel: "leona-qapp-someone-else", type: "qapp.ready" });
  fireEvent.load(iframe);

  await waitFor(() => assert.ok(view.container.querySelector("iframe")));
  assert.equal(view.queryByRole("alert"), null);
});
