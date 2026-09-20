import "./dom-env.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { RunWorkspace } from "../../app/(app)/run/run-workspace.tsx";
import { CompletedAssistant, LiveRun, type Turn } from "../../app/(app)/run/[taskId]/live-run.tsx";
import { RunCodeExport } from "../../components/run-code-export.tsx";
import { AgentActivity } from "@majorana/ui";
import { usePromptAttachments } from "../../lib/use-prompt-attachments.ts";
import { stubFetch } from "./dom-env.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { window.history.replaceState(null, "", "/"); window.localStorage.clear(); });

test("Nala home sends once for same-frame submits and preserves the prompt after failure", async () => {
  const response = deferred<{ status: number; body: unknown }>();
  const fetchStub = stubFetch(() => response.promise);
  try {
    const view = render(<RunWorkspace />);
    fireEvent.change(view.getByRole("textbox", { name: "Message" }), { target: { value: "Build a Bell state" } });
    const form = view.container.querySelector("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    assert.equal(fetchStub.calls.length, 1);
    await act(async () => response.resolve({ status: 503, body: {} }));
    await waitFor(() => assert.ok(view.getByRole("alert")));
    assert.equal((view.getByRole("textbox") as HTMLTextAreaElement).value, "Build a Bell state");
    fireEvent.submit(form);
    await waitFor(() => assert.equal(fetchStub.calls.length, 2));
  } finally { fetchStub.restore(); }
});

test("attachments merge out-of-order reads and block same-frame submission", async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  const { result } = renderHook(() => usePromptAttachments("en", () => {}));
  let readingFirst!: Promise<void>;
  let readingSecond!: Promise<void>;
  act(() => {
    readingFirst = result.current.addFiles([{ name: "a.py", size: 8, text: () => first.promise } as File]);
    readingSecond = result.current.addFiles([{ name: "b.py", size: 8, text: () => second.promise } as File]);
    assert.equal(result.current.isReading(), true);
  });
  await act(async () => { second.resolve("second"); await readingSecond; });
  assert.deepEqual(result.current.attachments.map((item) => item.name), ["b.py"]);
  assert.equal(result.current.reading, true);
  await act(async () => { first.resolve("first"); await readingFirst; });
  assert.deepEqual(result.current.attachments.map((item) => item.name), ["b.py", "a.py"]);
  assert.equal(result.current.reading, false);
  act(() => result.current.removeAttachment("a.py"));
  assert.deepEqual(result.current.attachments.map((item) => item.name), ["b.py"]);
});

test("the latest attachment selection wins when the same filename reads out of order", async () => {
  const older = deferred<string>();
  const newer = deferred<string>();
  const { result } = renderHook(() => usePromptAttachments("en", () => {}));
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = result.current.addFiles([{ name: "circuit.py", size: 8, text: () => older.promise } as File]);
    second = result.current.addFiles([{ name: "circuit.py", size: 8, text: () => newer.promise } as File]);
  });
  await act(async () => { newer.resolve("new circuit"); await second; });
  await act(async () => { older.resolve("old circuit"); await first; });
  assert.deepEqual(result.current.attachments.map(item => item.content), ["new circuit"]);
});

test("removing an attachment also cancels its pending replacement", async () => {
  const replacement = deferred<string>();
  const { result } = renderHook(() => usePromptAttachments("en", () => {}));
  await act(async () => { await result.current.addFiles([{ name: "circuit.py", size: 8, text: async () => "original" } as File]); });
  let reading!: Promise<void>;
  act(() => {
    reading = result.current.addFiles([{ name: "circuit.py", size: 8, text: () => replacement.promise } as File]);
    result.current.removeAttachment("circuit.py");
  });
  await act(async () => { replacement.resolve("replacement"); await reading; });
  assert.deepEqual(result.current.attachments, []);
});

test("delayed artifact context preserves an edited and deliberately cleared prompt", async () => {
  window.history.replaceState(null, "", "/run?artifact=custom-context");
  const response = deferred<{ status: number; body: unknown }>();
  const fetchStub = stubFetch(() => response.promise);
  try {
    const view = render(<RunWorkspace />);
    const input = view.getByRole("textbox");
    fireEvent.change(input, { target: { value: "My draft" } });
    fireEvent.change(input, { target: { value: "" } });
    await act(async () => response.resolve({ status: 200, body: { id: "custom-context", title: "Saved circuit", framework: "qiskit" } }));
    await waitFor(() => assert.ok(view.getByRole("button", { name: "Remove context" })));
    assert.equal((input as HTMLTextAreaElement).value, "");
  } finally { fetchStub.restore(); }
});

test("unavailable artifact context can be removed so the user can continue", async () => {
  window.history.replaceState(null, "", "/run?artifact=missing");
  const fetchStub = stubFetch(() => ({ status: 404 }));
  try {
    const view = render(<RunWorkspace />);
    fireEvent.change(view.getByRole("textbox"), { target: { value: "Use a new circuit" } });
    await waitFor(() => assert.ok(view.getByRole("button", { name: "Continue without the circuit" })));
    assert.equal((view.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled, true);
    fireEvent.click(view.getByRole("button", { name: "Continue without the circuit" }));
    assert.equal((view.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled, false);
    assert.equal(view.queryByRole("alert"), null);
  } finally { fetchStub.restore(); }
});

test("source copy and download survive failed formats; replacing the artifact cannot show old code", async () => {
  const copied: string[] = [];
  const originalClipboard = navigator.clipboard;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
  const fetchStub = stubFetch(() => ({ status: 503 }));
  const downloads: string[] = [];
  const originalClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  try {
    const view = render(<RunCodeExport artifactId="one" title="One" fallback={{ label: "Code", language: "python", source: "print(1)" }} />);
    assert.equal(fetchStub.calls.length, 0);
    fireEvent.click(view.getByRole("button", { name: "Copy" }));
    await waitFor(() => assert.deepEqual(copied, ["print(1)"]));
    fireEvent.click(view.getByRole("button", { name: /Download/ }));
    assert.deepEqual(downloads, ["generated-source.py"]);
    fireEvent.click(view.getByRole("button", { name: "More formats" }));
    await waitFor(() => assert.ok(view.getByRole("button", { name: "Retry formats" })));
    assert.match(view.getByLabelText("Source code").textContent ?? "", /print\(1\)/);
    view.rerender(<RunCodeExport artifactId="two" title="Two" fallback={{ label: "Code", language: "python", source: "print(2)" }} />);
    assert.match(view.getByLabelText("Source code").textContent ?? "", /print\(2\)/);
    assert.doesNotMatch(view.container.textContent ?? "", /print\(1\)/);
  } finally {
    fetchStub.restore();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
    window.HTMLAnchorElement.prototype.click = originalClick;
  }
});

test("a failed response without a candidate renders one outcome", () => {
  const turn: Turn = { id: "failed", prompt: "Build", answer: null, followUps: [], terminal: true, verificationSummary: null, events: [
    { type: "run.queued", run_id: "failed", mode: "execute" },
    { type: "run.error", run_id: "failed", stage: "code", message: "Provider unavailable" },
    { type: "run.finished", run_id: "failed", status: "failed" },
  ] };
  const view = render(<CompletedAssistant turn={turn} />);
  assert.equal(view.container.querySelectorAll(".mj-run-outcome").length, 1);
});

test("closed activity does not mount its detail until opened", async () => {
  let mounted = 0;
  const view = render(<AgentActivity activity={{ label: "Activity", headline: "Complete", items: [{ id: "code", icon: "code", label: "Code", title: "Generated", state: "done", status: "Done", detail: {} }] }} renderDetail={() => { mounted++; return <p>Heavy detail</p>; }} />);
  assert.equal(mounted, 0);
  const details = view.container.querySelector("details")!;
  await act(async () => { details.open = true; fireEvent(details, new Event("toggle")); });
  assert.ok(view.getByText("Heavy detail"));
});

function conversation(running: boolean) {
  return { id: "conversation-one", turns: [{ run: { id: "run-one", task_prompt: "Initial request", conversation_id: "conversation-one", framework: "cirq", finished_at: running ? null : "2026-09-06T00:00:00Z" }, events: running ? [] : [{ type: "chat.completed", run_id: "run-one", text: "Initial answer" }, { type: "run.finished", run_id: "run-one", status: "succeeded" }] }] };
}

function liveFetch(respond: (url: string, init?: RequestInit) => Promise<Response> | Response | undefined) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const result = respond(url, init);
    if (result) return result;
    if (url.endsWith("/events/stream")) return new Response(new ReadableStream({ start(controller) { init?.signal?.addEventListener("abort", () => { try { controller.close(); } catch {} }, { once: true }); } }), { headers: { "Content-Type": "text/event-stream" } });
    if (url === "/api/runs/run-one") return Response.json({ status: "running" });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("a cold running conversation blocks send and exposes a same-frame-safe Stop after hydration", async () => {
  const hydrate = deferred<Response>();
  const cancel = deferred<Response>();
  let cancels = 0;
  const restore = liveFetch((url) => {
    if (url.endsWith("/conversation")) return hydrate.promise;
    if (url.endsWith("/cancel")) { cancels++; return cancel.promise; }
  });
  const view = render(<LiveRun taskId="run-one" />);
  try {
    fireEvent.change(view.getByRole("textbox"), { target: { value: "Next request" } });
    assert.equal((view.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled, true);
    await act(async () => hydrate.resolve(Response.json(conversation(true))));
    const stop = await view.findByRole("button", { name: "Stop" });
    act(() => { fireEvent.click(stop); fireEvent.click(stop); });
    assert.equal(cancels, 1);
    await act(async () => cancel.resolve(Response.json({}, { status: 503 })));
    await waitFor(() => assert.equal((view.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled, false));
  } finally { view.unmount(); restore(); }
});

test("follow-up sends once, preserves framework, and restores the draft after refusal", async () => {
  const response = deferred<Response>();
  const bodies: Record<string, unknown>[] = [];
  const restore = liveFetch((url, init) => {
    if (url.endsWith("/conversation")) return Response.json(conversation(false));
    if (url === "/api/runs") { bodies.push(JSON.parse(String(init?.body))); return response.promise; }
  });
  const view = render(<LiveRun taskId="run-one" />);
  try {
    await view.findByText("Initial answer");
    fireEvent.change(view.getByRole("textbox"), { target: { value: "Continue my circuit" } });
    const form = view.container.querySelector("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].framework, "cirq");
    assert.equal(bodies[0].conversation_id, "conversation-one");
    assert.equal(view.queryByRole("button", { name: "Stop" }), null);
    await act(async () => response.resolve(Response.json({}, { status: 503 })));
    await waitFor(() => assert.equal((view.getByRole("textbox") as HTMLTextAreaElement).value, "Continue my circuit"));
  } finally { view.unmount(); restore(); }
});

test("connection notice persists through a retry until the stream actually reconnects", async () => {
  let streams = 0;
  const retry = deferred<Response>();
  const restore = liveFetch((url) => {
    if (url.endsWith("/conversation")) return Response.json(conversation(true));
    if (url.endsWith("/events/stream")) { streams++; return streams === 1 ? Response.json({}, { status: 503 }) : retry.promise; }
  });
  const view = render(<LiveRun taskId="run-one" />);
  try {
    await view.findByText("Connection interrupted. Reconnecting…");
    fireEvent.click(view.getByRole("button", { name: "Retry now" }));
    await waitFor(() => assert.equal(streams, 2));
    assert.ok(view.getByText("Connection interrupted. Reconnecting…"));
    await act(async () => retry.resolve(new Response(new ReadableStream())));
    await waitFor(() => assert.equal(view.queryByText("Connection interrupted. Reconnecting…"), null));
  } finally { view.unmount(); restore(); }
});

function otherConversation() {
  const payload = conversation(false);
  return {
    ...payload,
    id: "conversation-two",
    turns: payload.turns.map((turn) => ({ ...turn, run: { ...turn.run, id: "run-two", conversation_id: "conversation-two", task_prompt: "Another chat" } })),
  };
}

test("a follow-up that lands after the reader opened another chat does not take that chat over", async () => {
  // The page is not remounted when `taskId` changes, so a POST that resumes after
  // the switch used to call followRun() on whatever conversation was now showing.
  for (const outcome of ["accepted", "refused"] as const) {
    const response = deferred<Response>();
    const requested: string[] = [];
    const restore = liveFetch((url) => {
      requested.push(url);
      if (url === "/api/runs/run-one/conversation") return Response.json(conversation(false));
      if (url === "/api/runs/run-two/conversation") return Response.json(otherConversation());
      if (url === "/api/runs") return response.promise;
      if (url === "/api/runs/run-two" || url === "/api/runs/run-three") return Response.json({ status: "succeeded" });
    });
    const view = render(<LiveRun taskId="run-one" />);
    try {
      await view.findByText("Initial answer");
      fireEvent.change(view.getByRole("textbox"), { target: { value: "Continue my circuit" } });
      act(() => { fireEvent.submit(view.container.querySelector("form")!); });

      view.rerender(<LiveRun taskId="run-two" />);
      await waitFor(() => assert.ok(requested.includes("/api/runs/run-two/conversation")));
      // The message in flight was the other conversation's; it is not shown here.
      await waitFor(() => assert.equal(view.queryByText("Continue my circuit"), null));

      await act(async () => response.resolve(
        outcome === "accepted"
          ? Response.json({ id: "run-three", conversation_id: "conversation-one" })
          : Response.json({}, { status: 503 }),
      ));
      // Give a wrongly-followed run the chance to open its stream before asserting it did not.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

      assert.deepEqual(requested.filter((url) => url.includes("run-three")), [], `${outcome}: the other chat must not start following this run`);
      assert.equal((view.getByRole("textbox") as HTMLTextAreaElement).value, "", `${outcome}: the other chat's composer must stay empty`);
      assert.equal(view.queryByRole("alert"), null, `${outcome}: the other chat must not show this message's error`);
    } finally { view.unmount(); restore(); }
  }
});

test("a late reply to the old chat's message does not re-open the new chat's composer mid-send", async () => {
  // Sourcery on PR 929: the old request's `finally` cleared the submitting flag
  // unconditionally, so if the reader had already sent something in the chat they
  // moved to, that chat's send guard dropped and a second message could go through.
  const first = deferred<Response>();
  const second = deferred<Response>();
  const posts: string[] = [];
  const restore = liveFetch((url, init) => {
    if (url === "/api/runs/run-one/conversation") return Response.json(conversation(false));
    if (url === "/api/runs/run-two/conversation") return Response.json(otherConversation());
    if (url === "/api/runs") {
      posts.push(String(JSON.parse(String(init?.body)).conversation_id));
      return posts.length === 1 ? first.promise : second.promise;
    }
    if (url.startsWith("/api/runs/run-")) return Response.json({ status: "succeeded" });
  });
  const view = render(<LiveRun taskId="run-one" />);
  try {
    await view.findByText("Initial answer");
    fireEvent.change(view.getByRole("textbox"), { target: { value: "For chat one" } });
    act(() => { fireEvent.submit(view.container.querySelector("form")!); });

    view.rerender(<LiveRun taskId="run-two" />);
    await view.findByRole("heading", { name: "Another chat" });
    fireEvent.change(view.getByRole("textbox"), { target: { value: "For chat two" } });
    act(() => { fireEvent.submit(view.container.querySelector("form")!); });
    assert.deepEqual(posts, ["conversation-one", "conversation-two"]);

    // Chat one's request fails late. Chat two is still sending and must stay guarded.
    await act(async () => first.resolve(Response.json({}, { status: 503 })));
    fireEvent.change(view.getByRole("textbox"), { target: { value: "A second message" } });
    act(() => { fireEvent.submit(view.container.querySelector("form")!); });
    assert.deepEqual(posts, ["conversation-one", "conversation-two"], "chat two's in-flight send must still block another");
  } finally { view.unmount(); restore(); second.resolve(Response.json({}, { status: 503 })); }
});
