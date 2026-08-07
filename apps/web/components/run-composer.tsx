"use client";

import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";
import { ChevronIcon, PaperclipIcon } from "./icons";
import type { PublicLocale } from "../lib/public-locale";
import { COMPOSER_MODES, type ComposerMode } from "../lib/run-mode";
import { ghostFrame } from "../lib/composer-ghost";
import {
  COMPOSER_FRAMEWORKS,
  type ComposerFramework,
} from "../lib/framework-selection";

export type { ComposerFramework } from "../lib/framework-selection";

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
  mode,
  onModeChange,
  framework,
  onFrameworkChange,
  onStop,
  stopping = false,
  suggestions,
  inputRef,
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
  mode?: ComposerMode;
  onModeChange?: (mode: ComposerMode) => void;
  framework?: ComposerFramework;
  onFrameworkChange?: (framework: ComposerFramework) => void;
  /** Present only where a run can actually be cancelled. */
  onStop?: () => void;
  stopping?: boolean;
  /** Prompts the placeholder types out; Tab accepts the one on screen. */
  suggestions?: readonly string[];
  /** Lets a prompt suggestion return focus to the shared conversation input. */
  inputRef?: Ref<HTMLTextAreaElement>;
  centered?: boolean;
  locale?: PublicLocale;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const labels = locale === "ja"
    ? {
        task: "メッセージ",
        attach: "ファイルを添付",
        pending: "実行中",
        send: "送信",
        stop: "停止",
        stopping: "停止しています",
        context: "コンテキスト",
        codeAttached: "コードを添付済み",
        removeContext: "コンテキストを外す",
        mode: "応答モード",
        modeAuto: "自動",
        modeExecute: "実行",
        modeIdeate: "考える",
        modeExplain: "解説",
        framework: "回路フレームワーク",
        tabHint: "Tab キーで例を入力できます",
      }
    : {
        task: "Message",
        attach: "Attach files",
        pending: "Working",
        send: "Send",
        stop: "Stop",
        stopping: "Stopping",
        context: "Context",
        codeAttached: "code attached",
        removeContext: "Remove context",
        mode: "Response mode",
        modeAuto: "Auto",
        modeExecute: "Execute",
        modeIdeate: "Ideate",
        modeExplain: "Explain",
        framework: "Circuit framework",
        tabHint: "Press Tab to use the suggested prompt",
      };
  const ghost = useGhostPrompt(suggestions, value.length === 0);

  return (
    <div className={`mj-composer-dock${centered ? " mj-composer-dock--centered" : ""}`}>
      <form className="mj-composer" onSubmit={onSubmit} aria-busy={pending}>
        {pending ? (
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {stopping ? labels.stopping : labels.pending}
          </span>
        ) : null}
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
          ref={inputRef}
          className="mj-composer-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter"
              && (event.metaKey || event.ctrlKey)
              && !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
              return;
            }
            // Tab only steals focus movement while there is something to accept
            // and the box is empty, so the composer never becomes a keyboard trap.
            if (
              event.key === "Tab"
              && !event.shiftKey
              && !event.nativeEvent.isComposing
              && !value
              && ghost
            ) {
              event.preventDefault();
              onChange(ghost.suggestion);
            }
          }}
          placeholder={ghost?.text || basePlaceholder(locale)}
          aria-label={labels.task}
          aria-describedby={ghost ? "mj-composer-tab-hint" : undefined}
          rows={1}
        />
        {ghost ? <span className="sr-only" id="mj-composer-tab-hint">{labels.tabHint}</span> : null}
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
            {mode && onModeChange ? (
              <label className="mj-composer-select">
                <span className="sr-only">{labels.mode}</span>
                <select
                  aria-label={labels.mode}
                  value={mode}
                  onChange={(event) => onModeChange(event.target.value as ComposerMode)}
                >
                  {COMPOSER_MODES.map((option) => (
                    <option key={option} value={option}>
                      {option === "auto"
                        ? labels.modeAuto
                        : option === "execute"
                          ? labels.modeExecute
                          : option === "ideate"
                            ? labels.modeIdeate
                            : labels.modeExplain}
                    </option>
                  ))}
                </select>
                <ChevronIcon size={12} />
              </label>
            ) : null}
            {framework && onFrameworkChange ? (
              <label className="mj-composer-select">
                <span className="sr-only">{labels.framework}</span>
                <select
                  aria-label={labels.framework}
                  value={framework}
                  onChange={(event) => onFrameworkChange(event.target.value as ComposerFramework)}
                >
                  {COMPOSER_FRAMEWORKS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
                <ChevronIcon size={12} />
              </label>
            ) : null}
          </div>
          <div className="mj-composer-right">
            {error ? <span className="mj-composer-error" role="alert">{error}</span> : null}
            {/* Stop takes the send button's place rather than sitting beside it:
                the control the reader is already looking at is the one that has
                to cancel, and two buttons here would mean deciding which is
                primary while a response is mid-flight. */}
            {pending && onStop ? (
              <button
                className="mj-primary-button mj-composer-stop"
                type="button"
                disabled={stopping}
                onClick={onStop}
              >
                {stopping ? labels.stopping : labels.stop}
                <span className="mj-composer-stop-mark" aria-hidden="true" />
              </button>
            ) : (
              <>
                {!pending ? <kbd className="mj-command-hint">⌘/Ctrl ↵</kbd> : null}
                <button className="mj-primary-button" type="submit" disabled={pending || !value.trim()}>
                  {pending ? labels.pending : labels.send}
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function formatAttachmentSize(size: number): string {
  return size >= 1024 ? `${Math.round(size / 1024)} KB` : `${size} B`;
}

function basePlaceholder(locale: PublicLocale): string {
  return locale === "ja"
    ? "作りたい回路や検証したいことを入力してください…"
    : "Ask anything about quantum algorithms…";
}

/**
 * The typed-and-backspaced placeholder, driven off a clock rather than a counter.
 *
 * A 60 Hz animation frame would re-render the whole composer sixty times a
 * second for a placeholder; the interval is set to the typing cadence instead.
 * Under `prefers-reduced-motion` the suggestion is still offered — Tab accepts
 * it exactly the same way — it just stops typing itself out.
 */
function useGhostPrompt(suggestions: readonly string[] | undefined, active: boolean) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const hasSuggestions = Boolean(suggestions?.length);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!hasSuggestions || !active || reduceMotion) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsedMs(Date.now() - started), 55);
    return () => window.clearInterval(timer);
  }, [hasSuggestions, active, reduceMotion]);

  if (!suggestions?.length || !active) return null;
  const frame = ghostFrame(reduceMotion ? 0 : elapsedMs, suggestions);
  if (!frame) return null;
  // Reduced motion gets the whole prompt sitting still rather than an empty box.
  return reduceMotion ? { ...frame, text: frame.suggestion } : frame;
}
