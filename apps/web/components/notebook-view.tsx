"use client";

import type { components } from "@majorana/contracts-gen";
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
  | "checkAttempt"
  // A `role=question` cell. Distinct from "checkAttempt" because the two go to
  // DIFFERENT halves of the same request: a code attempt is `code[cellId]`, an
  // answer is `answers[cellId]`, and the server grades them by different routes.
  // One action kind carrying both would have to guess from the cell's role, which
  // is the guess `graded` already exists to avoid making twice.
  | "answerQuestion";

/** One cell's verdict, straight off the generated contract rather than restated
 * here: the browser renders a verdict, it never decides one, so the only thing it
 * needs is the server's own shape. */
export type NotebookCellGrade = components["schemas"]["CellGrade"];

/** The redacted half of a question's answer key — see `answerPromptOf`. */
type AnswerPrompt = components["schemas"]["AnswerPrompt"];

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
  grades,
  gradingCellIds,
}: {
  cells: NotebookCellView[];
  locale?: PublicLocale;
  framework?: string;
  /** `detail` carries the reader's free-text attempt for `"checkAttempt"`;
   * every other action kind calls this with `detail` omitted. */
  onCellAction?: (cellId: string, action: NotebookCellActionKind, detail?: string) => void;
  /** Verdicts by cell id, from the last graded attempt. */
  grades?: Record<string, NotebookCellGrade>;
  /** Cells whose attempt is in the sandbox right now. */
  gradingCellIds?: ReadonlySet<string>;
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
          grade={grades?.[cell.id]}
          grading={gradingCellIds?.has(cell.id) ?? false}
          // Any attempt in flight locks EVERY graded cell's submit, not just its own.
          // The workspace follows one run at a time, so starting a second attempt
          // replaces the followed run and aborts the first one's stream — the first
          // cell would sit on "Running your code…" and its finished verdict would
          // never arrive. Greptile caught it on PR 832. One at a time is also the
          // honest reading of a single sandbox dispatch per attempt.
          locked={(gradingCellIds?.size ?? 0) > 0}
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
  grade,
  grading,
  locked,
}: {
  cell: NotebookCellView;
  copy: NotebookCopy;
  framework: string;
  onCellAction?: (cellId: string, action: NotebookCellActionKind, detail?: string) => void;
  grade?: NotebookCellGrade;
  grading?: boolean;
  locked?: boolean;
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
      {grading ? <p className="mj-notebook-cell-grade" data-status="grading">{copy.gradePending}</p> : null}
      {!grading && grade ? (
        <div className="mj-notebook-cell-grade" data-status={grade.status}>
          <p className="mj-notebook-cell-grade-verdict">{copy.gradeVerdict[grade.status]}</p>
          {grade.message ? <p>{grade.message}</p> : null}
          {/* The failed assertion, verbatim. "Your code did not satisfy
              `assert len(counts) == 2`" ends an argument that "the model thought
              your answer was incomplete" starts, which is the whole reason this
              path exists instead of asking Nala. */}
          {grade.detail ? <pre className="mj-code-body">{grade.detail}</pre> : null}
          {grade.hint ? <p className="mj-notebook-cell-grade-hint">{grade.hint}</p> : null}
          <p className="mj-notebook-cell-grade-by">
            {grade.graded_by === "deterministic" ? copy.gradeByCheck : copy.gradeByModel}
          </p>
        </div>
      ) : null}
      {/* Below the verdict, not above it: after a wrong answer the reader wants to see
          why before trying again, and an input rendered first pushes the explanation
          off the bottom of a long cell. */}
      {cell.answerPrompt && onCellAction ? (
        <NotebookAnswerInput
          cellId={cell.id}
          prompt={cell.answerPrompt}
          copy={copy}
          locked={locked || grading}
          onSubmit={(response) => onCellAction(cell.id, "answerQuestion", response)}
        />
      ) : null}
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
              disabled={!attemptText.trim() || locked}
              onClick={submitAttempt}
            >
              {cell.graded ? copy.checkAttemptGrade : copy.checkAttemptSubmit}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

/**
 * The input a `role=question` cell gets, and the only place a reader's answer is
 * composed. One component per kind because the shapes have nothing in common: a
 * choice submits an INDEX, a numeric submits a number as typed (the server owns the
 * tolerance), text and rubric submit prose.
 *
 * `prompt` is `NotebookCellView.answerPrompt`, which is the redacted half by
 * construction — see `answerPromptOf`. Nothing here receives the answer key, so
 * nothing here can render it, and that is the property to preserve if this file is
 * ever refactored to take the cell whole.
 */
function NotebookAnswerInput({
  cellId,
  prompt,
  copy,
  locked,
  onSubmit,
}: {
  cellId: string;
  prompt: AnswerPrompt;
  copy: NotebookCopy;
  locked?: boolean;
  onSubmit: (response: string) => void;
}) {
  const [value, setValue] = useState("");
  const answered = value.trim().length > 0;
  const name = `mj-answer-${cellId}`;

  function submit() {
    if (!answered || locked) return;
    onSubmit(value);
  }

  return (
    <div className="mj-notebook-cell-answer" data-kind={prompt.kind}>
      <fieldset>
        <legend>{copy.answerLegend}</legend>
        {prompt.kind === "choice" ? (
          <ul className="mj-notebook-answer-options">
            {(prompt.options ?? []).map((option, index) => (
              <li key={`${name}-${index}`}>
                <label>
                  <input
                    type="radio"
                    name={name}
                    // The INDEX, not the text. `deterministic_grade` compares
                    // `int(response)` against the key's `correct`, so sending the
                    // option's words would be graded as an unreadable option number
                    // and every reader would be told they were wrong.
                    value={String(index)}
                    checked={value === String(index)}
                    onChange={() => setValue(String(index))}
                  />
                  <span>{option}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : prompt.kind === "numeric" ? (
          <label className="mj-notebook-answer-numeric">
            <span className="sr-only">{copy.answerLegend}</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={value}
              placeholder={copy.answerNumericPlaceholder}
              onChange={(event) => setValue(event.target.value)}
            />
            {prompt.unit ? <span className="mj-notebook-answer-unit">{prompt.unit}</span> : null}
          </label>
        ) : prompt.kind === "text" ? (
          <label>
            <span className="sr-only">{copy.answerLegend}</span>
            <input
              type="text"
              value={value}
              placeholder={copy.answerTextPlaceholder}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        ) : (
          <label>
            <span className="sr-only">{copy.answerLegend}</span>
            <textarea
              value={value}
              rows={3}
              placeholder={copy.answerRubricPlaceholder}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        )}
      </fieldset>
      {/* Said before the reader answers, not after the verdict arrives. Which kind of
          grader is behind a question changes how much weight its verdict deserves, and
          that is worth knowing while deciding how much care to spend on the answer. */}
      {prompt.kind === "rubric" ? (
        <p className="mj-notebook-answer-note">{copy.answerModelGraded}</p>
      ) : null}
      <div className="mj-notebook-cell-attempt-actions">
        <button type="button" className="mj-secondary-button" onClick={() => setValue("")}>
          {copy.answerClear}
        </button>
        <button
          type="button"
          className="mj-primary-button"
          disabled={!answered || locked}
          onClick={submit}
        >
          {copy.answerSubmit}
        </button>
      </div>
    </div>
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
