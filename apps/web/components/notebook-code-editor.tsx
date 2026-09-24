"use client";

import { SyntaxHighlightedCode } from "@majorana/ui";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  dedent,
  deleteBackward,
  indent,
  lineAt,
  markedLines,
  newline,
  offsetOf,
  toggleComment,
  typeCharacter,
  type TextState,
} from "../lib/code-editing";
import type { NotebookIdeCopy } from "../lib/workspace-locale";
import "./notebook-ide.css";

/** One finding to draw: an underline in the code, a mark in the gutter, a line in the
 * list under the cell. Lines and columns are 1-based; `endCol` is exclusive. */
export interface EditorDiagnostic {
  line: number;
  col: number;
  endLine?: number | null;
  endCol?: number | null;
  severity: "error" | "warning";
  code: string;
  message: string;
}

/** A message's `code spans` as <code>, the rest as text. The messages are ours
 * (`workspace-locale.ts`), so an unbalanced backtick is a copy bug, not an attack. */
function withInlineCode(text: string): ReactNode[] {
  return text.split("`").map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part));
}

/**
 * The highlighted copy of the code and the layer of underlines and line numbers over it.
 *
 * Both render the text character for character — the `<pre>` through
 * `SyntaxHighlightedCode`, the line layer through `markedLines` — with the same font
 * metrics, wrapping and tab size as the textarea (one CSS rule sets all three), so an
 * underline, a line number and the caret all land on the same glyph. The `<pre>` is in the
 * normal flow and is what gives the editor its height; the trailing newline appended to it
 * is what makes a final empty line take a row, as it does in a textarea.
 */
function CodeLayers({
  value,
  language,
  highlight,
  diagnostics,
  preHidden,
  layersRef,
}: {
  value: string;
  language: string;
  highlight: boolean;
  diagnostics: readonly EditorDiagnostic[];
  /** In the editor the textarea carries the text for assistive technology, so the copy
   * is hidden from it; in the reading view the `<pre>` IS the text. */
  preHidden: boolean;
  layersRef?: (node: HTMLDivElement | null) => void;
}) {
  const lines = useMemo(() => markedLines(value, diagnostics), [value, diagnostics]);
  const markers = useMemo(() => {
    const byLine = new Map<number, { severity: "error" | "warning"; message: string }>();
    for (const diagnostic of diagnostics) {
      const current = byLine.get(diagnostic.line);
      byLine.set(diagnostic.line, {
        severity: current?.severity === "error" || diagnostic.severity === "error" ? "error" : "warning",
        message: current ? `${current.message}\n${diagnostic.message}` : diagnostic.message,
      });
    }
    return byLine;
  }, [diagnostics]);
  return (
    <div className="mj-code-editor-layers" ref={layersRef}>
      <pre className="mj-code-editor-metrics mj-code-editor-highlight" aria-hidden={preHidden || undefined}>
        {highlight ? <SyntaxHighlightedCode code={value} language={language} /> : <code>{value}</code>}
        {"\n"}
      </pre>
      <div className="mj-code-editor-metrics mj-code-editor-lines" aria-hidden="true">
        {lines.map((segments, index) => {
          const marker = markers.get(index + 1);
          return (
            <div className="mj-code-editor-line" key={index}>
              <span className="mj-code-editor-line-number">{index + 1}</span>
              {marker ? (
                // Focusable so the message reaches a keyboard user, not only a mouse
                // hover: `role="img"` plus `aria-label` gives assistive tech the same
                // text the CSS tooltip shows from `data-message` on `:hover`/`:focus`.
                <span
                  className="mj-code-editor-gutter-mark"
                  data-severity={marker.severity}
                  data-message={marker.message}
                  role="img"
                  aria-label={marker.message}
                  tabIndex={0}
                />
              ) : null}
              <span className="mj-code-editor-line-content">
                {segments.length === 0
                  ? "​"
                  : segments.map((segment, segmentIndex) =>
                      segment.severity ? (
                        <span key={segmentIndex} className="mj-code-editor-mark" data-severity={segment.severity}>
                          {segment.text}
                        </span>
                      ) : (
                        segment.text
                      ),
                    )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProblemList({
  id,
  label,
  diagnostics,
  copy,
  currentLine,
  onJump,
}: {
  id: string;
  label: string;
  diagnostics: readonly EditorDiagnostic[];
  copy: NotebookIdeCopy;
  currentLine?: number | null;
  onJump?: (diagnostic: EditorDiagnostic) => void;
}) {
  return (
    <div className="mj-code-editor-problems" id={id}>
      <p className="mj-code-editor-problems-count">{copy.problemsCount(diagnostics.length)}</p>
      <ul aria-label={label}>
        {diagnostics.map((diagnostic, index) => {
          const body = (
            <>
              <span className="mj-code-editor-problem-where">
                <strong data-severity={diagnostic.severity}>{copy.severity[diagnostic.severity]}</strong>
                {" · "}
                {copy.problemAt(diagnostic.line)}
              </span>
              <span className="mj-code-editor-problem-message">{withInlineCode(diagnostic.message)}</span>
            </>
          );
          return (
            <li
              key={`${diagnostic.line}:${diagnostic.col}:${diagnostic.code}:${index}`}
              data-severity={diagnostic.severity}
              data-current={currentLine === diagnostic.line || undefined}
            >
              {onJump ? (
                <button type="button" className="mj-code-editor-problem" onClick={() => onJump(diagnostic)}>
                  {body}
                </button>
              ) : (
                <span className="mj-code-editor-problem">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function gutterStyle(value: string): CSSProperties {
  // Digits of the last line number, so the gutter is exactly wide enough and a cell that
  // grows past line 99 does not shift its code sideways by guesswork.
  const digits = Math.max(2, String(value.split("\n").length).length);
  return { "--mj-code-editor-digits": String(digits) } as CSSProperties;
}

/**
 * A cell's code, read-only: the same layers as the editor without the textarea, so line
 * numbers and underlines read the same in both modes and the problem list's "Line 5"
 * points at a numbered line.
 */
export function NotebookCodeView({
  value,
  language = "python",
  diagnostics = [],
  problemsLabel,
  copy,
}: {
  value: string;
  language?: string;
  diagnostics?: readonly EditorDiagnostic[];
  problemsLabel: string;
  copy: NotebookIdeCopy;
}) {
  const problemsId = useId();
  return (
    <div className="mj-code-editor mj-code-editor--view">
      <div className="mj-code-editor-surface" style={gutterStyle(value)}>
        <div className="mj-code-editor-code">
          <CodeLayers value={value} language={language} highlight diagnostics={diagnostics} preHidden={false} />
        </div>
      </div>
      {diagnostics.length > 0 ? (
        <ProblemList id={problemsId} label={problemsLabel} diagnostics={diagnostics} copy={copy} />
      ) : null}
    </div>
  );
}

/**
 * The notebook's code editor: a real `<textarea>` over a syntax-highlighted copy of its
 * own text, with a line-number gutter and lint underlines.
 *
 * Why not CodeMirror or Monaco: production CSP sets `style-src-elem 'self'` plus one hash,
 * and both inject `<style>` elements at runtime, which that policy refuses (inline style
 * ATTRIBUTES are allowed, and are all this uses). And the textarea keeps what a
 * contenteditable editor has to rebuild: a screen reader reads it as a text field, a
 * phone keyboard types into it, and the browser's own undo stack covers every edit —
 * including the ones made here, because they go through `document.execCommand("insertText")`
 * (see `apply`) rather than by replacing the value.
 *
 * The text in the textarea is transparent; what the reader sees is the `<pre>` underneath,
 * which lays out identically (same font, size, line height, padding, tab size and
 * wrapping, from one CSS rule). The textarea is sized by that `<pre>`, so it never scrolls
 * on its own; `onScroll` still carries any scroll to the layers, for the one browser that
 * decides to.
 *
 * Keys, all from `lib/code-editing.ts` except the ones that leave the editor: Tab and
 * Shift+Tab indent and outdent (selections too), Enter keeps and opens indentation,
 * brackets and quotes pair where they cannot guess wrong, Cmd/Ctrl+/ toggles comments,
 * Cmd/Ctrl+Enter runs, Shift+Enter runs and moves on, Cmd/Ctrl+S saves, Esc leaves.
 *
 * Tab is captured — Python cannot be written otherwise — and Shift+Tab with it, so the
 * way out for a keyboard user is Esc (to the cell, in command mode) and then Tab. The
 * textarea's description says so, which is what WCAG 2.1.2 asks of a field that keeps Tab.
 */
export function NotebookCodeEditor({
  value,
  onChange,
  label,
  problemsLabel,
  copy,
  language = "python",
  python = true,
  disabled = false,
  diagnostics = [],
  onFocus,
  onRun,
  onRunAndAdvance,
  onEscape,
  onSave,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The textarea's accessible name. */
  label: string;
  problemsLabel: string;
  copy: NotebookIdeCopy;
  /** Passed to the highlighter as its `language` (it is a data attribute there). */
  language?: string;
  /** Python typing rules and highlighting. Off for a markdown cell, which keeps only
   * Tab, the gutter, and the keys that leave the editor. */
  python?: boolean;
  disabled?: boolean;
  diagnostics?: readonly EditorDiagnostic[];
  onFocus?: () => void;
  onRun?: () => void;
  onRunAndAdvance?: () => void;
  onEscape?: () => void;
  onSave?: () => void;
  inputRef?: (node: HTMLTextAreaElement | null) => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const problemsId = useId();
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const layers = useRef<HTMLDivElement | null>(null);
  /** Where the caret goes once React has rendered a value this component set itself
   * (the fallback path in `apply`): setting it before would be undone by the render. */
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const [caretLine, setCaretLine] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = textarea.current;
    const pending = pendingSelection.current;
    if (!node || !pending || node.value !== value) return;
    pendingSelection.current = null;
    node.setSelectionRange(pending.start, pending.end);
  }, [value]);

  function apply(next: TextState) {
    const node = textarea.current;
    if (!node) return;
    const current = node.value;
    if (next.value !== current) {
      // Replace only the span that changed, so the browser's undo step is that span.
      let prefix = 0;
      const shorter = Math.min(current.length, next.value.length);
      while (prefix < shorter && current[prefix] === next.value[prefix]) prefix += 1;
      let suffix = 0;
      while (
        suffix < shorter - prefix &&
        current[current.length - 1 - suffix] === next.value[next.value.length - 1 - suffix]
      ) {
        suffix += 1;
      }
      const inserted = next.value.slice(prefix, next.value.length - suffix);
      node.setSelectionRange(prefix, current.length - suffix);
      let done = false;
      try {
        // Deprecated in name only: it is still the one way to edit a textarea that the
        // browser's own undo stack records. Where it is missing (jsdom, some future
        // browser) the value is set through React instead, and undo loses this step.
        done =
          typeof document.execCommand === "function" &&
          document.execCommand(inserted ? "insertText" : "delete", false, inserted);
      } catch {
        done = false;
      }
      if (!done || node.value !== next.value) {
        pendingSelection.current = { start: next.start, end: next.end };
        onChange(next.value);
        return;
      }
    }
    node.setSelectionRange(next.start, next.end);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Keys that belong to an IME composition (Japanese input) are the IME's.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const node = event.currentTarget;
    const state: TextState = { value: node.value, start: node.selectionStart, end: node.selectionEnd };
    const mod = event.metaKey || event.ctrlKey;

    if (event.key === "Escape") {
      if (onEscape) {
        event.preventDefault();
        onEscape();
      }
      return;
    }
    if (event.key === "Enter" && mod && !event.altKey) {
      if (onRun) {
        event.preventDefault();
        onRun();
      }
      return;
    }
    if (event.key === "Enter" && event.shiftKey && !mod && !event.altKey) {
      if (onRunAndAdvance) {
        event.preventDefault();
        onRunAndAdvance();
      }
      return;
    }
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
      // Taken only when there is a save to do; otherwise the browser keeps its own.
      if (onSave) {
        event.preventDefault();
        onSave();
      }
      return;
    }
    if (disabled || node.readOnly) return;
    if (mod && !event.altKey && event.key === "/") {
      if (!python) return;
      event.preventDefault();
      apply(toggleComment(state));
      return;
    }
    if (mod || event.altKey) return;
    if (event.key === "Tab") {
      event.preventDefault();
      apply(event.shiftKey ? dedent(state) : indent(state));
      return;
    }
    if (!python) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      apply(newline(state));
      return;
    }
    if (event.key === "Backspace" && !event.shiftKey) {
      const next = deleteBackward(state);
      if (next) {
        event.preventDefault();
        apply(next);
      }
      return;
    }
    if (event.key.length === 1) {
      const next = typeCharacter(state, event.key);
      if (next) {
        event.preventDefault();
        apply(next);
      }
    }
  }

  function trackCaret() {
    if (diagnostics.length === 0) return;
    const node = textarea.current;
    if (!node) return;
    const line = lineAt(node.value, node.selectionStart);
    setCaretLine((current) => (current === line ? current : line));
  }

  function syncScroll() {
    const node = textarea.current;
    const target = layers.current;
    if (!node || !target) return;
    target.style.transform =
      node.scrollTop || node.scrollLeft ? `translate(${-node.scrollLeft}px, ${-node.scrollTop}px)` : "";
  }

  function jumpTo(diagnostic: EditorDiagnostic) {
    const node = textarea.current;
    if (!node) return;
    const start = offsetOf(node.value, diagnostic.line, diagnostic.col);
    const end =
      diagnostic.endLine != null && diagnostic.endCol != null
        ? offsetOf(node.value, diagnostic.endLine, diagnostic.endCol)
        : start;
    node.focus();
    node.setSelectionRange(start, Math.max(start, end));
  }

  const describedBy = diagnostics.length > 0 ? `${hintId} ${problemsId}` : hintId;

  return (
    <div className="mj-code-editor" data-disabled={disabled || undefined}>
      <div className="mj-code-editor-surface" style={gutterStyle(value)}>
        <div className="mj-code-editor-code">
          <CodeLayers
            value={value}
            language={language}
            highlight={python}
            diagnostics={diagnostics}
            preHidden
            layersRef={(node) => {
              layers.current = node;
            }}
          />
          <label htmlFor={inputId} className="sr-only">
            {label}
          </label>
          <textarea
            id={inputId}
            ref={(node) => {
              textarea.current = node;
              inputRef?.(node);
            }}
            className="mj-code-editor-metrics mj-code-editor-input"
            value={value}
            rows={1}
            wrap="soft"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            disabled={disabled}
            aria-describedby={describedBy}
            onFocus={onFocus}
            onKeyDown={handleKeyDown}
            onSelect={trackCaret}
            onScroll={syncScroll}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      </div>
      <p id={hintId} className="sr-only">
        {copy.editorKeys}
      </p>
      {diagnostics.length > 0 ? (
        <ProblemList
          id={problemsId}
          label={problemsLabel}
          diagnostics={diagnostics}
          copy={copy}
          currentLine={caretLine}
          onJump={jumpTo}
        />
      ) : null}
    </div>
  );
}
