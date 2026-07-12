"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function RunHome() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskPrompt = prompt.trim();
    if (!taskPrompt || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ task_prompt: taskPrompt }),
      });
      const payload = (await response.json()) as { id?: string; detail?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.detail ?? payload.error ?? `Run submission failed (${response.status})`);
      }
      router.push(`/run/${payload.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Run submission failed");
      setPending(false);
    }
  }

  return (
    <section style={{ maxWidth: "720px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "var(--fs-20)", fontWeight: 600 }}>Run</h1>
      <p style={{ color: "var(--text-1)" }}>
        Describe the circuit or problem to plan, generate, screen, compile, and verify it.
      </p>
      <form onSubmit={submit}>
        <textarea
          disabled={pending}
          rows={5}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Use Grover to recover the marked state 1100"
          aria-label="Task prompt"
          style={{
            width: "100%",
            background: "var(--bg-1)",
            border: "1px solid var(--border-0)",
            borderRadius: "var(--radius-control)",
            color: "var(--text-0)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-13)",
            padding: "var(--sp-3)",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--sp-3)", marginTop: "var(--sp-3)" }}>
          <span style={{ color: "var(--text-2)", fontSize: "var(--fs-12)" }}>
            Plan → research → verify → explain
          </span>
          <button type="submit" disabled={pending || !prompt.trim()}>
            {pending ? "Starting…" : "Start run"}
          </button>
        </div>
      </form>
      {error ? (
        <p role="alert" style={{ color: "var(--err)", fontSize: "var(--fs-13)" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
