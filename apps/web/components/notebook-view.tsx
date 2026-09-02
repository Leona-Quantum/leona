"use client";

import { SyntaxHighlightedCode } from "@majorana/ui";
import { ChatMarkdown } from "./chat-markdown";
import type { NotebookCellStatus, NotebookCellView } from "../lib/notebook-view";
import type { PublicLocale } from "../lib/public-locale";
import { WORKSPACE_COPY } from "../lib/workspace-locale";

export type NotebookCellActionKind = "explain" | "simplify" | "figure" | "exercise";

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
  onCellAction?: (cellId: string, action: NotebookCellActionKind) => void;
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
  onCellAction?: (cellId: string, action: NotebookCellActionKind) => void;
}) {
  return (
    <article className="mj-notebook-cell" data-kind={cell.kind} data-status={cell.status}>
      <div className="mj-notebook-cell-head">
        {cell.role ? <span className="mj-notebook-cell-role">{cell.role}</span> : null}
        <span className="mj-notebook-cell-pill" data-status={cell.status}>{copy.cellStatus[cell.status]}</span>
        {onCellAction ? (
          <div className="mj-notebook-cell-actions">
            <button type="button" onClick={() => onCellAction(cell.id, "explain")}>{copy.actionExplain}</button>
            <button type="button" onClick={() => onCellAction(cell.id, "simplify")}>{copy.actionSimplify}</button>
            <button type="button" onClick={() => onCellAction(cell.id, "figure")}>{copy.actionAddFigure}</button>
            <button type="button" onClick={() => onCellAction(cell.id, "exercise")}>{copy.actionExercise}</button>
          </div>
        ) : null}
      </div>
      {cell.kind === "markdown" ? (
        <ChatMarkdown source={cell.source} />
      ) : (
        <pre className="mj-notebook-cell-code">
          <SyntaxHighlightedCode code={cell.source} language={framework} />
        </pre>
      )}
      {cell.kind === "code" ? <NotebookCellOutputs cell={cell} copy={copy} /> : null}
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
