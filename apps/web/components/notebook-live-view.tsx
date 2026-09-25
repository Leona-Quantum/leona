"use client";

import { SyntaxHighlightedCode } from "@majorana/ui";
import { ChatMarkdown } from "./chat-markdown";
import type { LiveCellView, LiveNotebookState } from "../lib/notebook-live";
import type { PublicLocale } from "../lib/public-locale";
import { NOTEBOOK_CHECK_COPY, WORKSPACE_COPY } from "../lib/workspace-locale";

type LiveCopy = (typeof WORKSPACE_COPY)[PublicLocale]["notebooks"]["live"];

/**
 * Renders a notebook developing in real time (plan 10-notebook-ide, "Live" lane):
 * markdown cells as `ChatMarkdown`, code cells syntax-highlighted, a writing caret on
 * the cell currently streaming, a status chip per code cell, the error under a raised
 * one, and a plain banner while a repair is in flight. Fed `state` from
 * `liveNotebookFromEvents` (`lib/notebook-live.ts`) — this component has no SSE
 * subscription of its own and does no redaction: the worker withholds a graded or
 * solution-only cell's real text before any event carrying it reaches the browser, so
 * there is nothing here for this component to hide.
 *
 * `null` cell.role and every string shown here is server data, rendered as text —
 * never through React's raw-HTML injection prop; `ChatMarkdown` is the same
 * renderer the chat thread and `NotebookView` already trust with model output.
 *
 * The writing caret (`▍`) is a static character, not an animation — the simplest way
 * to respect reduced motion is to have no motion to reduce.
 */
export function NotebookLiveView({
  state,
  locale = "en",
  framework = "qiskit",
}: {
  state: LiveNotebookState;
  locale?: PublicLocale;
  framework?: string;
}) {
  const copy = WORKSPACE_COPY[locale].notebooks.live;
  if (state.phase === "idle") return null;

  return (
    <section className="mj-notebook-live" aria-label={copy.phase[state.phase]}>
      <p className="mj-notebook-live-phase" role="status">
        {copy.phase[state.phase]}
      </p>
      {state.currentRepair ? (
        <p className="mj-notebook-live-repair-banner" role="status">
          {state.currentRepair.beforeRunning
            ? copy.checkingBanner(state.currentRepair.cellId)
            : copy.repairBanner(state.currentRepair.cellId, state.currentRepair.attempt, state.currentRepair.of)}
        </p>
      ) : null}
      {state.cells.length > 0 ? (
        <div className="mj-notebook-live-cells">
          {state.cells.map((cell) => (
            <LiveCell key={cell.id} cell={cell} locale={locale} framework={framework} copy={copy} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function LiveCell({
  cell,
  locale,
  framework,
  copy,
}: {
  cell: LiveCellView;
  locale: PublicLocale;
  framework: string;
  copy: LiveCopy;
}) {
  const cellErrorLabel = WORKSPACE_COPY[locale].notebooks.cellErrorLabel;
  const checkCopy = NOTEBOOK_CHECK_COPY[locale];
  return (
    <article className="mj-notebook-cell mj-notebook-live-cell" data-kind={cell.kind} data-status={cell.status}>
      <div className="mj-notebook-cell-head">
        {cell.role ? <span className="mj-notebook-cell-role">{cell.role}</span> : null}
        {cell.kind === "code" ? (
          <span className="mj-notebook-cell-pill" data-status={cell.status}>
            {copy.cellStatus[cell.status]}
          </span>
        ) : null}
        {/* A `role=check` cell's live verdict (ai-ops 382): a compact dot rather than
            the full card — the finished report's `NotebookCheckCard` is where the
            statement, author and teeth live, and this stream carries none of that,
            only the status (`NotebookLiveCellResult.check`). */}
        {cell.role === "check" && cell.check ? (
          <span className="mj-notebook-live-check-dot" data-status={cell.check} title={checkCopy.statusChip[cell.check]}>
            <span className="sr-only">{checkCopy.statusChip[cell.check]}</span>
          </span>
        ) : null}
      </div>
      {cell.kind === "markdown" ? (
        <div className="mj-chat-message mj-chat-message--assistant">
          <ChatMarkdown source={cell.source} />
        </div>
      ) : (
        <pre className="mj-notebook-cell-code mj-code-body">
          <SyntaxHighlightedCode code={cell.source} language={framework} />
        </pre>
      )}
      {cell.writing ? (
        <span className="mj-notebook-live-caret" aria-hidden="true">
          ▍<span className="sr-only">{copy.writingLabel}</span>
        </span>
      ) : null}
      {cell.status === "raised" && cell.ename ? (
        <pre className="mj-notebook-cell-error" role="alert">
          <strong>{cellErrorLabel}:</strong> {cell.ename}: {cell.evalue}
        </pre>
      ) : null}
    </article>
  );
}
