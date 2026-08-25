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


test("a document that navigates before its ready message is delivered is still caught", async () => {
  // Sourcery caught this on PR 764 and it was real. A hostile document can set
  // its own location from an inline script in the same turn the bridge ran. The
  // bridge's `qapp.ready` is queued for the host at that moment but not yet
  // DELIVERED, so a tripwire that read the flag straight out of the load handler
  // saw false and admitted the attacker's document. `load` and `message` are
  // different task sources with no ordering guarantee, so the handler defers by
  // one task and reads the flag behind both.
  //
  // Settling the frame's own native load FIRST is what makes this test mean
  // something. jsdom fires exactly one load of its own on a srcDoc iframe,
  // asynchronously — measured, not assumed — and an earlier version of this test
  // did not wait for it. That stray load arrived after the ready message and
  // tripped the teardown on its own, so the test passed even with the deferral
  // removed: it was reporting the fix while testing the harness.
  const view = render(<QappRuntime slug="bell" uiDocument={UI} canExecute />);
  const iframe = view.container.querySelector("iframe") as HTMLIFrameElement;
  const channel = channelFrom(iframe);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(view.queryByRole("alert"), null, "torn down before the race was even set up");

  // The race, in one synchronous block: the attacker's document finishes loading
  // and only THEN is the queued ready message dispatched. Exactly one load.
  fireEvent.load(iframe);
  speakAsFrame(iframe, { channel, type: "qapp.ready" });

  await waitFor(() => assert.ok(view.getByRole("alert")));
  assert.equal(view.container.querySelector("iframe"), null);
});

test("a second Qapp rendered into the same component is not torn down on arrival", async () => {
  // Also Sourcery's, also real. `channel` comes from useId and is stable for the
  // component's life, so a client navigation between two /q/<slug> pages swaps
  // srcDoc without remounting. With `readyRef` left true from the Qapp that just
  // left, the arriving Qapp's very first load read as a navigation away.
  const view = render(<QappRuntime slug="bell" uiDocument={UI} canExecute />);
  const first = view.container.querySelector("iframe") as HTMLIFrameElement;
  const channel = channelFrom(first);

  fireEvent.load(first);
  speakAsFrame(first, { channel, type: "qapp.ready" });
  await new Promise((resolve) => setTimeout(resolve, 5));

  view.rerender(<QappRuntime slug="ghz" uiDocument="<h1>GHZ</h1><script>/* other */</script>" canExecute />);
  const second = view.container.querySelector("iframe") as HTMLIFrameElement;
  assert.ok(second, "the second Qapp never rendered a frame at all");
  fireEvent.load(second);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(
    view.queryByRole("alert"),
    null,
    "the arriving Qapp was torn down on its own first paint because readyRef survived the one that left",
  );
  assert.ok(view.container.querySelector("iframe"), "the arriving Qapp's frame was removed");
});
