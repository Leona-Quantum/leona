"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunEvent } from "@majorana/ui";
import { ChatMarkdown } from "../../../../components/chat-markdown";
import { archiveChat, deleteChat, loadChatHistory, rememberChat, updateChat, type ChatSummary } from "../../../../lib/chat-history";
import { RunComposer } from "../../../../components/run-composer";
import { RUN_FIXTURES } from "./fixtures";

type WireEvent = {
  run_id: string;
  seq?: number;
  type: string;
  kind?: "reasoning" | "output";
  text?: string;
  message?: string;
  status?: string;
  verifier_decision?: string | null;
  interpretation?: string;
};

type ConversationPayload = {
  id: string;
  turns: Array<{
    run: { id: string; task_prompt: string; conversation_id: string };
    events: WireEvent[];
  }>;
};

type Turn = {
  id: string;
  prompt: string;
  answer: string | null;
};

function parseEvent(block: string): { id: number | null; data: string } | null {
  const lines = block.split("\n");
  if (lines.some((line) => line.startsWith(":"))) return null;
  const idLine = lines.find((line) => line.startsWith("id:"));
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return null;
  const parsedId = idLine ? Number(idLine.slice("id:".length).trim()) : NaN;
  return { id: Number.isFinite(parsedId) ? parsedId : null, data };
}

function answerFromEvents(events: WireEvent[]): string | null {
  const completed = [...events].reverse().find((event) => event.type === "chat.completed" && event.text);
  if (completed?.text) return completed.text;
  const legacy = [...events].reverse().find((event) => event.type === "run.analysis" && event.interpretation);
  return legacy?.interpretation ?? null;
}

function turnsFromConversation(payload: ConversationPayload): Turn[] {
  return payload.turns.map((turn) => ({
    id: turn.run.id,
    prompt: turn.run.task_prompt,
    answer: answerFromEvents(turn.events),
  }));
}

function fixtureTurns(events: RunEvent[]): Turn[] {
  const queued = events.find((event) => event.type === "run.queued");
  const answer = events.find((event) => event.type === "run.analysis");
  return [{
    id: queued?.run_id ?? "example",
    prompt: "Use QAOA to solve MaxCut on a 5-node ring and verify the cut value.",
    answer: answer?.type === "run.analysis" ? answer.interpretation : "This is an example run transcript.",
  }];
}

export function LiveRun({ taskId }: { taskId: string }) {
  const router = useRouter();
  const fixtureEvents = RUN_FIXTURES[taskId] ?? null;
  const [turns, setTurns] = useState<Turn[]>(fixtureEvents ? fixtureTurns(fixtureEvents) : []);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [streaming, setStreaming] = useState(!fixtureEvents);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; size: number; content: string }>>([]);
  const [existingChat, setExistingChat] = useState<ChatSummary | null>(null);
  const lastEventId = useRef<number | null>(null);

  useEffect(() => {
    setExistingChat(
      loadChatHistory({ includeArchived: true }).find(
        (item) => item.id === taskId || item.conversationId === conversationId,
      ) ?? null,
    );
  }, [conversationId, taskId]);

  const title = existingChat?.title ?? turns[0]?.prompt ?? "Quantum chat";

  useEffect(() => {
    if (fixtureEvents) return;
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    async function loadConversation() {
      const response = await fetch(`/api/runs/${encodeURIComponent(taskId)}/conversation`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Conversation could not be loaded (${response.status})`);
      const payload = (await response.json()) as ConversationPayload;
      if (!controller.signal.aborted) {
        setConversationId(payload.id);
        setTurns(turnsFromConversation(payload));
        setPending(payload.turns.some((turn) => turn.run.id === taskId && !answerFromEvents(turn.events)));
      }
    }

    async function consume() {
      void loadConversation().catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Conversation could not be loaded");
      });

      while (!controller.signal.aborted) {
        try {
          const headers: Record<string, string> = {};
          if (lastEventId.current !== null) headers["Last-Event-ID"] = String(lastEventId.current);
          const response = await fetch(`/api/runs/${encodeURIComponent(taskId)}/events/stream`, {
            headers,
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Response stream failed (${response.status})`);
          if (!response.body) throw new Error("Response stream returned no body");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let terminal = false;
          while (!terminal) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
              const parsed = parseEvent(block);
              if (!parsed) continue;
              const event = JSON.parse(parsed.data) as WireEvent;
              if (parsed.id !== null) lastEventId.current = parsed.id;
              if (event.type === "chat.delta" && event.text) {
                setStreaming(true);
                if (event.kind === "reasoning") setReasoningText((current) => `${current}${event.text}`);
                else setStreamingText((current) => `${current}${event.text}`);
              }
              if (event.type === "chat.completed" && event.text) {
                setStreamingText(event.text);
                setStreaming(false);
              }
              if (event.type === "chat.error" || event.type === "run.error") {
                setError(event.message ?? "The assistant could not complete this response.");
                setStreaming(false);
                setPending(false);
              }
              if (event.type === "run.finished") {
                terminal = true;
                setPending(false);
                setStreaming(false);
                updateChat(taskId, { status: event.status === "succeeded" ? "draft" : "failed" });
                if (event.status === "succeeded") void loadConversation().catch(() => undefined);
              }
            }
          }
          if (terminal) return;
          throw new Error("Response stream ended before the response finished");
        } catch (cause) {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "Response stream failed");
          await new Promise<void>((resolve) => {
            reconnectTimer = setTimeout(resolve, 1000);
          });
          setError(null);
        }
      }
    }

    void consume();
    return () => {
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [fixtureEvents, taskId]);

  function addFiles(files: File[]) {
    void (async () => {
      const candidates: Array<{ name: string; size: number; content: string }> = [];
      const errors: string[] = [];
      for (const file of files) {
        const lowered = file.name.toLowerCase();
        if (![".py", ".txt", ".md", ".json", ".qasm", ".csv"].some((extension) => lowered.endsWith(extension))) {
          errors.push(`${file.name} is not a supported text attachment (.py, .txt, .md, .json, .qasm, .csv).`);
          continue;
        }
        if (file.size > 64 * 1024) {
          errors.push(`${file.name} is larger than 64 KB — paste the relevant part instead.`);
          continue;
        }
        try {
          candidates.push({ name: file.name, size: file.size, content: await file.text() });
        } catch {
          errors.push(`${file.name} could not be read.`);
        }
      }
      const nextByName = new Map(attachments.map((item) => [item.name, item]));
      for (const candidate of candidates) {
        if (!nextByName.has(candidate.name) && nextByName.size >= 4) {
          errors.push("Up to 4 attachments per message.");
          continue;
        }
        nextByName.set(candidate.name, candidate);
      }
      setAttachments([...nextByName.values()]);
      setError([...new Set(errors)].join(" ") || null);
    })();
  }

  async function submitFollowup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskPrompt = prompt.trim();
    if (!taskPrompt || pending) return;
    setPending(true);
    setError(null);
    const attachmentBlocks = attachments.map((attachment) => `\n\n--- Attachment: ${attachment.name} ---\n${attachment.content}`).join("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ task_prompt: `${taskPrompt}${attachmentBlocks}`, conversation_id: conversationId }),
      });
      const payload = (await response.json()) as { id?: string; conversation_id?: string; detail?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.detail ?? payload.error ?? `Message submission failed (${response.status})`);
      rememberChat({
        id: payload.id,
        conversationId: payload.conversation_id ?? conversationId ?? undefined,
        title: titleFromPrompt(taskPrompt),
        prompt: taskPrompt,
        createdAt: new Date().toISOString(),
        status: "queued",
      });
      router.push(`/run/${payload.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message submission failed");
      setPending(false);
    }
  }

  const activePrompt = turns.find((turn) => turn.id === taskId)?.prompt ?? existingChat?.prompt;
  const showActiveUser = Boolean(activePrompt && !turns.some((turn) => turn.id === taskId));

  return (
    <div className="mj-run-task">
      <div className="mj-run-task-scroll">
        <div className="mj-chat-content">
          <header className="mj-chat-header">
            <div>
              <h1>{title}</h1>
              <span className="mj-chat-subtitle">{fixtureEvents ? "Example conversation" : streaming || pending ? "Streaming response" : "Conversation"}</span>
            </div>
            <div className="mj-run-task-actions">
              <span className="mj-run-home-status">
                <span className="mj-status-dot" aria-hidden="true" />
                {fixtureEvents ? "Example" : streaming || pending ? "Live" : "Ready"}
              </span>
              {!fixtureEvents && existingChat ? (
                <>
                  <button className="mj-secondary-button" type="button" onClick={() => { archiveChat(existingChat.id, existingChat); router.push("/run"); }}>Archive</button>
                  <button className="mj-secondary-button mj-danger-button" type="button" onClick={() => { deleteChat(existingChat.id); router.push("/run"); }}>Delete</button>
                </>
              ) : null}
            </div>
          </header>
          {error ? <p className="mj-run-stream-error" role="status">{error}</p> : null}
          <div className="mj-chat-thread" aria-live="polite">
            {turns.map((turn) => (
              <div className="mj-chat-turn" key={turn.id}>
                <div className="mj-chat-message mj-chat-message--user">
                  <ChatMarkdown source={turn.prompt} />
                </div>
                {turn.answer ? (
                  <div className="mj-chat-message mj-chat-message--assistant">
                    <ChatMarkdown source={turn.answer} />
                  </div>
                ) : turn.id === taskId && (streamingText || reasoningText) ? (
                  <AssistantMessage reasoning={reasoningText} text={streamingText} streaming={streaming} />
                ) : turn.id === taskId && pending ? (
                  <AssistantLoading />
                ) : null}
              </div>
            ))}
            {showActiveUser ? (
              <div className="mj-chat-turn">
                <div className="mj-chat-message mj-chat-message--user"><ChatMarkdown source={activePrompt ?? ""} /></div>
                {streamingText || reasoningText ? (
                  <AssistantMessage reasoning={reasoningText} text={streamingText} streaming={streaming} />
                ) : pending ? <AssistantLoading /> : null}
              </div>
            ) : null}
            {!turns.length && !activePrompt && !pending ? <p className="mj-run-waiting">Connecting to the conversation…</p> : null}
          </div>
        </div>
      </div>
      <RunComposer
        value={prompt}
        pending={pending}
        error={null}
        onChange={setPrompt}
        onSubmit={submitFollowup}
        onFiles={addFiles}
        attachments={attachments.map(({ name, size }) => ({ name, size }))}
        onRemoveAttachment={(name) => setAttachments((current) => current.filter((item) => item.name !== name))}
      />
    </div>
  );
}

function AssistantMessage({ reasoning, text, streaming }: { reasoning: string; text: string; streaming: boolean }) {
  return (
    <div className="mj-chat-message mj-chat-message--assistant">
      {reasoning ? (
        <details className="mj-chat-thinking" open={streaming}>
          <summary>Thinking</summary>
          <ChatMarkdown source={reasoning} />
        </details>
      ) : null}
      {text ? <ChatMarkdown source={text} /> : <AssistantLoading />}
      {streaming ? <span className="mj-chat-caret" aria-label="Response is streaming" /> : null}
    </div>
  );
}

function AssistantLoading() {
  return (
    <div className="mj-chat-message mj-chat-message--assistant mj-chat-message--loading" aria-label="Waiting for response">
      <span className="mj-chat-loading-dot" />
      <span className="mj-chat-loading-dot" />
      <span className="mj-chat-loading-dot" />
    </div>
  );
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 54 ? `${firstLine.slice(0, 54).trimEnd()}…` : firstLine;
}
