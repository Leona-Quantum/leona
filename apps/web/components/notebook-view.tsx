"use client";

import { SyntaxHighlightedCode } from "@majorana/ui";
import { useState } from "react";
import { ChatMarkdown } from "./chat-markdown";
import type { NotebookCellStatus, NotebookCellView } from "../lib/notebook-view";
import type { PublicLocale } from "../lib/public-locale";
import { WORKSPACE_COPY } from "../lib/workspace-locale";

export type NotebookCellActionKind =
  | "explain"
  | "simplify"
  | "figure"
  | "exercise"
  // Learner actions (Lane E): "explainError" needs no reader input and fires
  // immediately; "checkAttempt" opens the inline textarea below before it
  // fires — see `onCellAction`'s `detail` parameter.
  | "explainError"
  | "checkAttempt";

/** Roles the "Check my attempt" action shows on — exactly the roles a reader
 * writes their own code against: a stand-alone exercise, a challenge's own
 * solution cell (grading an alternate attempt), and a checkpoint (the
 * assertion that says whether earlier work was right). */
const CHECKABLE_ROLES = new Set(["exercise", "solution", "checkpoint"]);

type NotebookCopy = (typeof WORKSPACE_COPY)[PublicLocale]["notebooks"];

/**
 * Renders one notebook version's cells, in spec order — the reader's lesson,
 * joined with whatever the sandbox produced for it (`notebookCellViews`,
 * `lib/notebook-view.ts`). Never renders `text/html` output as HTML: model
 * output crosses this boundary as data, and the classification in
 * `lib/notebook-view.ts` already made sure no "html" kind exists here to
 * reach for React's raw-HTML injection prop on.
 */
export function NotebookView({
  cells,
  locale = "en",
  framework = "qiskit",
  onCellAction,
}: {
  cells: NotebookCellView[];
  locale?: PublicLocale;
  framework?: string;
  /** `detail` carries the reader's free-text attempt for `"checkAttempt"`;
   * every other action kind calls this with `detail` omitted. */
  onCellAction?: (cellId: string, action: NotebookCellActionKind, detail?: string) => void;
}) {
  const copy = WORKSPACE_COPY[locale].notebooks;
  if (!cells.length) return null;
  return (
    <div className="mj-notebook-view">
      {cells.map((cell) => (
        <NotebookCellCard
          key={cell.id}
          cell={cell}
          copy={copy}
          framework={framework}
          onCellAction={onCellAction}
        />
      ))}
    </div>
  );
}

function NotebookCellCard({
  cell,
  copy,
  framework,
  onCellAction,
}: {
  cell: NotebookCellView;
  copy: NotebookCopy;
  framework: string;
  onCellAction?: (cellId: string, action: NotebookCellActionKind, detail?: string) => void;
}) {
  const [attemptOpen, setAttemptOpen] = useState(false);
  const [attemptText, setAttemptText] = useState("");
  const showExplainError = cell.error !== null;
  const showCheckAttempt = cell.role !== null && CHECKABLE_ROLES.has(cell.role);

  function submitAttempt() {
    if (!onCellAction || !attemptText.trim()) return;
    onCellAction(cell.id, "checkAttempt", attemptText);
    setAttemptOpen(false);
    setAttemptText("");
  }

  return (
    <article className="mj-notebook-cell" data-kind={cell.kind} data-status={cell.status}>
      <div className="mj-notebook-cell-head">
        {cell.role ? <span className="mj-notebook-cell-role">{cell.role}</span> : null}
        <span className="mj-notebook-cell-pill" data-status={cell.status}>{copy.cellStatus[cell.status]}</span>
        {onCellAction ? (
          <div className="mj-notebook-cell-actions mj-library-row-actions">
            <button type="button" onClick={() => onCellAction(cell.id, "explain")}>{copy.actionExplain}</button>
            <button type="button" onClick={() => onCellAction(cell.id, "simplify")}>{copy.actionSimplify}</button>
            <button type="button" onClick={() => onCellAction(cell.id, "figure")}>{copy.actionAddFigure}</button>
            <button type="button" onClick={() => onCellAction(cell.id, "exercise")}>{copy.actionExercise}</button>
            {showExplainError ? (
              <button type="button" onClick={() => onCellAction(cell.id, "explainError")}>
                {copy.actionExplainError}
              </button>
            ) : null}
            {showCheckAttempt ? (
              <button type="button" aria-pressed={attemptOpen} onClick={() => setAttemptOpen((open) => !open)}>
                {copy.actionCheckAttempt}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {cell.kind === "markdown" ? (
        // Reuses the chat thread's own typography (headings, code, lists,
        // links) rather than restating it: `.mj-chat-message` is styled once,
        // in styles.css, and every renderer of model/author markdown —
        // Nala's replies and a notebook's markdown cells alike — wraps in it.
        <div className="mj-chat-message mj-chat-message--assistant">
          <ChatMarkdown source={cell.source} />
        </div>
      ) : (
        <pre className="mj-notebook-cell-code mj-code-body">
          <SyntaxHighlightedCode code={cell.source} language={framework} />
        </pre>
      )}
      {cell.kind === "code" ? <NotebookCellOutputs cell={cell} copy={copy} /> : null}
      {showCheckAttempt && attemptOpen ? (
        <div className="mj-notebook-cell-attempt">
          <label>
            <span className="sr-only">{copy.actionCheckAttempt}</span>
            <textarea
              value={attemptText}
              onChange={(event) => setAttemptText(event.target.value)}
              placeholder={copy.checkAttemptPlaceholder}
              rows={4}
              autoFocus
            />
          </label>
          <div className="mj-notebook-cell-attempt-actions">
            <button
              type="button"
              className="mj-secondary-button"
              onClick={() => {
                setAttemptOpen(false);
                setAttemptText("");
              }}
            >
              {copy.actionCheckAttemptCancel}
            </button>
            <button
              type="button"
              className="mj-primary-button"
              disabled={!attemptText.trim()}
              onClick={submitAttempt}
            >
              {copy.checkAttemptSubmit}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function NotebookCellOutputs({ cell, copy }: { cell: NotebookCellView; copy: NotebookCopy }) {
  const idle: NotebookCellStatus[] = ["not_run", "skipped"];
  if (idle.includes(cell.status) && !cell.stdout && !cell.stderr && cell.outputs.length === 0 && !cell.error) {
    return null;
  }
  return (
    <div className="mj-notebook-cell-outputs">
      {cell.stdout ? (
        <pre className="mj-notebook-cell-stdout">
          <span className="sr-only">{copy.cellStdout}</span>
          {cell.stdout}
        </pre>
      ) : null}
      {cell.stderr ? (
        <pre className="mj-notebook-cell-stderr">
          <span className="sr-only">{copy.cellStderr}</span>
          {cell.stderr}
        </pre>
      ) : null}
      {cell.outputs.map((output, index) =>
        output.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URI, not an optimizable remote asset
          <img key={index} className="mj-notebook-cell-figure" alt="figure" src={output.src} />
        ) : (
          <pre key={index} className="mj-notebook-cell-output-text">{output.text}</pre>
        ),
      )}
      {cell.error ? (
        <pre className="mj-notebook-cell-error" role="alert">
          <strong>{copy.cellErrorLabel}:</strong> {cell.error.ename}: {cell.error.evalue}
        </pre>
      ) : null}
      {cell.truncated ? <p className="mj-notebook-cell-truncated-note">{copy.cellTruncated}</p> : null}
    </div>
  );
}
