"use client";

import type { FormEvent } from "react";
import { PaperclipIcon } from "./icons";
import type { PublicLocale } from "../lib/public-locale";

// Kept as shared vocabulary for Studio's explicit execution controls. The chat
// composer intentionally exposes neither of these controls to the user.
export type ComposerMode = "execute" | "ideate" | "explain";
export type ComposerFramework = "qiskit" | "pennylane" | "cirq";

export function RunComposer({
  value,
  pending,
  error,
  onChange,
  onSubmit,
  onAttach,
  contextArtifact,
  onClearContext,
  centered = false,
  locale = "en",
}: {
  value: string;
  pending: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAttach?: () => void;
  contextArtifact?: { title: string; framework: string; codeAvailable: boolean } | null;
  onClearContext?: () => void;
  centered?: boolean;
  locale?: PublicLocale;
}) {
  const labels = locale === "ja"
    ? {
        task: "メッセージ",
        attach: "コンテキストを添付",
        pending: "応答中",
        send: "送信",
        context: "コンテキスト",
        codeAttached: "コードを添付済み",
        removeContext: "コンテキストを外す",
        hint: "Markdown · LaTeX",
      }
    : {
        task: "Message",
        attach: "Attach context",
        pending: "Thinking",
        send: "Send",
        context: "Context",
        codeAttached: "code attached",
        removeContext: "Remove context",
        hint: "Markdown · LaTeX",
      };

  return (
    <div className={`mj-composer-dock${centered ? " mj-composer-dock--centered" : ""}`}>
      <form className="mj-composer" onSubmit={onSubmit}>
        {contextArtifact ? (
          <div className="mj-composer-context" aria-label={`${labels.context}: ${contextArtifact.title}`}>
            <PaperclipIcon size={14} />
            <span>
              <strong>{contextArtifact.title}</strong>
              <small>{contextArtifact.framework} · {contextArtifact.codeAvailable ? labels.codeAttached : labels.context}</small>
            </span>
            {onClearContext ? (
              <button type="button" aria-label={labels.removeContext} title={labels.removeContext} onClick={onClearContext}>
                ×
              </button>
            ) : null}
          </div>
        ) : null}
        <textarea
          className="mj-composer-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={locale === "ja" ? "量子アルゴリズムについて何でも聞いてください…" : "Ask anything about quantum algorithms…"}
          aria-label={labels.task}
          rows={2}
          disabled={pending}
        />
        <div className="mj-composer-controls">
          <div className="mj-composer-left">
            <button className="mj-icon-button" type="button" aria-label={labels.attach} title={labels.attach} onClick={onAttach}>
              <PaperclipIcon size={16} />
            </button>
            <span className="mj-composer-model">{labels.hint}</span>
          </div>
          <div className="mj-composer-right">
            {error ? <span className="mj-composer-error" role="alert">{error}</span> : null}
            <button className="mj-primary-button" type="submit" disabled={pending || !value.trim()}>
              {pending ? labels.pending : labels.send}
              <span className="mj-command-hint">⌘↵</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
