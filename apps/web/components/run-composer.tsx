"use client";

import { useRef, type FormEvent } from "react";
import { ChevronIcon, PaperclipIcon } from "./icons";
import type { PublicLocale } from "../lib/public-locale";

export type ComposerMode = "execute" | "ideate" | "explain";
export type ComposerFramework = "qiskit" | "pennylane" | "cirq";

export interface ComposerAttachment {
  name: string;
  size: number;
}

export const COMPOSER_ATTACHMENT_ACCEPT = ".py,.txt,.md,.json,.qasm,.csv";

export function RunComposer({
  value,
  pending,
  error,
  onChange,
  onSubmit,
  onAttach,
  onFiles,
  attachments,
  onRemoveAttachment,
  contextArtifact,
  onClearContext,
  framework,
  onFrameworkChange,
  centered = false,
  locale = "en",
}: {
  value: string;
  pending: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAttach?: () => void;
  onFiles?: (files: File[]) => void;
  attachments?: ComposerAttachment[];
  onRemoveAttachment?: (name: string) => void;
  contextArtifact?: { title: string; framework: string; codeAvailable: boolean } | null;
  onClearContext?: () => void;
  framework?: ComposerFramework;
  onFrameworkChange?: (framework: ComposerFramework) => void;
  centered?: boolean;
  locale?: PublicLocale;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const labels = locale === "ja"
    ? {
        task: "メッセージ",
        attach: "ファイルを添付",
        pending: "応答中",
        send: "送信",
        context: "コンテキスト",
        codeAttached: "コードを添付済み",
        removeContext: "コンテキストを外す",
        hint: "Markdown · LaTeX",
        framework: "回路フレームワーク",
      }
    : {
        task: "Message",
        attach: "Attach files",
        pending: "Thinking",
        send: "Send",
        context: "Context",
        codeAttached: "code attached",
        removeContext: "Remove context",
        hint: "Markdown · LaTeX",
        framework: "Circuit framework",
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
        {attachments?.length ? (
          <div className="mj-composer-attachments" aria-label={locale === "ja" ? "添付ファイル" : "Attachments"}>
            {attachments.map((attachment) => (
              <span className="mj-composer-attachment" key={attachment.name}>
                <PaperclipIcon size={12} />
                <span>{attachment.name}</span>
                <small>{formatAttachmentSize(attachment.size)}</small>
                {onRemoveAttachment ? (
                  <button type="button" aria-label={`${locale === "ja" ? "添付を削除" : "Remove attachment"} ${attachment.name}`} onClick={() => onRemoveAttachment(attachment.name)}>×</button>
                ) : null}
              </span>
            ))}
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
            <button
              className="mj-icon-button"
              type="button"
              aria-label={labels.attach}
              title={labels.attach}
              onClick={() => {
                if (onFiles) fileInputRef.current?.click();
                else onAttach?.();
              }}
            >
              <PaperclipIcon size={16} />
            </button>
            {onFiles ? (
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept={COMPOSER_ATTACHMENT_ACCEPT}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length) onFiles(files);
                  event.target.value = "";
                }}
              />
            ) : null}
            {framework && onFrameworkChange ? (
              <label className="mj-composer-select">
                <span className="sr-only">{labels.framework}</span>
                <select
                  aria-label={labels.framework}
                  value={framework}
                  disabled={pending}
                  onChange={(event) => onFrameworkChange(event.target.value as ComposerFramework)}
                >
                  <option value="qiskit">Qiskit</option>
                  <option value="cirq">Cirq</option>
                  <option value="pennylane">PennyLane</option>
                </select>
                <ChevronIcon size={12} />
              </label>
            ) : null}
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

function formatAttachmentSize(size: number): string {
  return size >= 1024 ? `${Math.round(size / 1024)} KB` : `${size} B`;
}
