"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type Ref } from "react";
import { ChevronIcon, PaperclipIcon } from "./icons";
import { ComposerGhostOverlay } from "./composer-ghost-overlay";
import type { PublicLocale } from "../lib/public-locale";
import { DELETE_MS_PER_CHARACTER, TYPE_MS_PER_CHARACTER, composerGhost, type GhostFrame } from "../lib/composer-ghost";
import { COMPOSER_MODES, type ComposerMode } from "../lib/run-mode";
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
  disabled = false,
  readingAttachments = false,
  inputRef,
  centered = false,
  locale = "en",
  suggestions,
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
  /** Loading conversation/context or attachments must block submission only. */
  disabled?: boolean;
  readingAttachments?: boolean;
  /** Lets a prompt suggestion return focus to the shared conversation input. */
  inputRef?: Ref<HTMLTextAreaElement>;
  centered?: boolean;
  locale?: PublicLocale;
  /**
   * Prompts typed into the empty box one after another, the same rotation the
   * cover draws (`lib/composer-ghost.ts`). Tab accepts the one on screen.
   * Omitted on a conversation in progress, where the box has a history to
   * stand next to.
   */
  suggestions?: readonly string[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const helpId = useId();
  const ghost = useGhostPrompt(suggestions, value);
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
        modeQapp: "Qapp",
        modeIdeate: "学ぶ",
        modeExplain: "解説",
        framework: "回路フレームワーク",
        keyboard: "⌘ / Ctrl + Enter で送信",
        reading: "添付ファイルを読み込み中…",
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
        modeQapp: "Qapp",
        modeIdeate: "Learn",
        modeExplain: "Explain",
        framework: "Circuit framework",
        keyboard: "⌘ / Ctrl + Enter to send",
        reading: "Reading attachments…",
      };

  // One line until there is more to show: the box grows with its contents and
  // the stylesheet's max-height caps it, after which it scrolls.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  function bindTextarea(element: HTMLTextAreaElement | null) {
    textareaRef.current = element;
    if (typeof inputRef === "function") inputRef(element);
    else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = element;
  }

  return (
    <div className={`mj-composer-dock${centered ? " mj-composer-dock--centered" : ""}`}>
      <form className="mj-composer" onSubmit={onSubmit} aria-busy={pending || disabled || readingAttachments}>
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
        <div className="mj-composer-ghost-wrap">
          {ghost ? <ComposerGhostOverlay frame={ghost} /> : null}
          <textarea
            ref={bindTextarea}
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
              // Tab only steals focus movement while there is something to
              // accept and the box is empty, so the composer never becomes a
              // keyboard trap.
              if (event.key === "Tab" && !event.shiftKey && !event.nativeEvent.isComposing && !value && ghost) {
                event.preventDefault();
                onChange(ghost.suggestion);
              }
            }}
            // Empty while the ghost draws, so the two never overprint.
            placeholder={ghost ? "" : basePlaceholder(locale)}
            aria-label={labels.task}
            aria-describedby={helpId}
            data-tour="run-prompt"
            rows={1}
          />
        </div>
        <span className="sr-only" id={helpId}>{labels.keyboard}</span>
        <div className="mj-composer-controls">
          <div className="mj-composer-left">
            {onFiles || onAttach ? <button
              className="mj-icon-button"
              type="button"
              aria-label={labels.attach}
              title={labels.attach}
              data-tour="run-attach"
              onClick={() => {
                if (onFiles) fileInputRef.current?.click();
                else onAttach?.();
              }}
            >
              <PaperclipIcon size={16} />
            </button> : null}
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
              <label className="mj-composer-select" data-tour="run-mode">
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
                          : option === "qapp"
                            ? labels.modeQapp
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
              <label className="mj-composer-select" data-tour="run-framework">
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
                <button className="mj-primary-button" type="submit" disabled={pending || disabled || readingAttachments || !value.trim()} data-tour="run-submit">
                  {pending ? labels.pending : labels.send}
                </button>
              </>
            )}
          </div>
        </div>
        {readingAttachments ? <p className="mj-composer-feedback" role="status">{labels.reading}</p> : null}
        {error ? <p className="mj-composer-feedback mj-composer-feedback--error" role="alert">{error}</p> : null}
      </form>
    </div>
  );
}

/**
 * The rotating suggestion as a clock. Runs only while there are suggestions,
 * the box is empty and the tab is visible; restarts from the first character
 * whenever the box empties; holds the first prompt still under reduced motion.
 * Bare timers on purpose: the test harness mocks the global clock.
 */
function useGhostPrompt(suggestions: readonly string[] | undefined, typedValue: string): GhostFrame | null {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const active = Boolean(suggestions?.length) && typedValue.length === 0;

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!active || reduceMotion) return;
    setElapsedMs(0);
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      const started = Date.now();
      timer = setInterval(() => setElapsedMs(Date.now() - started), Math.min(TYPE_MS_PER_CHARACTER, DELETE_MS_PER_CHARACTER));
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      stop();
      if (document.visibilityState !== "hidden") {
        setElapsedMs(0);
        start();
      }
    };
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, reduceMotion]);

  return composerGhost({ elapsedMs, suggestions, typedValue, reduceMotion });
}

function formatAttachmentSize(size: number): string {
  return size >= 1024 ? `${Math.round(size / 1024)} KB` : `${size} B`;
}

function basePlaceholder(locale: PublicLocale): string {
  return locale === "ja"
    ? "作りたい回路や調べたいことを入力"
    : "Describe your quantum task";
}
