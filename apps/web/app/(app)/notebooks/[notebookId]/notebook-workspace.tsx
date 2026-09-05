"use client";

import type { components } from "@majorana/contracts-gen";
import { StageRail, type RailStage } from "@majorana/ui";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ChatMarkdown } from "../../../../components/chat-markdown";
import { NotebookDiffView } from "../../../../components/notebook-diff-view";
import { NotebookReviewPanel } from "../../../../components/notebook-review-panel";
import {
  NotebookView,
  type NotebookCellActionKind,
  type NotebookCellGrade,
} from "../../../../components/notebook-view";
import { refusalSentence } from "../../../../lib/api-error";
import { diffNotebookVersions } from "../../../../lib/notebook-diff";
import { NotebookEditor } from "../../../../components/notebook-editor";
import {
  applyCellEdit,
  cellsAreDirty,
  deleteCell,
  insertCellAfter,
  moveCell,
  specWithCells,
  type CellEdit,
} from "../../../../lib/notebook-editing";
import { notebookExportFilename } from "../../../../lib/notebook-export";
import { gradeSummary, hasGradesToShow, passRate } from "../../../../lib/notebook-grades";
import { hasMasteryToShow, notebookMastery } from "../../../../lib/notebook-mastery";
import { errorTracebackText, notebookCellViews, notebookStatusPill } from "../../../../lib/notebook-view";
import {
  notebookProgressFromEvents,
  type NotebookProgressEvent,
  type NotebookProgressStage,
} from "../../../../lib/notebook-progress";
import type { PublicLocale } from "../../../../lib/public-locale";
import { useRunProgress } from "../../../../lib/use-run-progress";
import { authoredPinAfterRun, type AuthoredVersion } from "../../../../lib/run-stream-outcome";
import { WORKSPACE_COPY } from "../../../../lib/workspace-locale";

type Notebook = components["schemas"]["Notebook"];
type NotebookVersion = components["schemas"]["NotebookVersion"];
type NotebookVersionSummary = components["schemas"]["NotebookVersionSummary"];
type NotebookTurn = components["schemas"]["NotebookTurn"];
type Cell = components["schemas"]["Cell"];
type GradeReport = components["schemas"]["GradeReport"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toRailStage(stage: NotebookProgressStage, errorSummary: string): RailStage {
  if (stage.state === "fail") {
    return { id: stage.id, name: stage.id, elapsed: stage.elapsed, state: "fail", errorSummary };
  }
  return { id: stage.id, name: stage.id, elapsed: stage.elapsed, state: stage.state };
}

function download(content: Blob, filename: string) {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const RUNNING_STATUSES = new Set(["queued", "running"]);

export function NotebookWorkspace({ notebookId, locale = "en" }: { notebookId: string; locale?: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].notebooks;
  const router = useRouter();

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [notebookError, setNotebookError] = useState<string | null>(null);
  const [versions, setVersions] = useState<NotebookVersionSummary[]>([]);
  // `null` means "follow the notebook's current version" — the ordinary state,
  // including right after a chat-driven revision lands a new one. Picking a
  // version from the dropdown pins it here so browsing history does not get
  // silently yanked forward the next time this component reloads the notebook.
  const [pinnedSeq, setPinnedSeq] = useState<number | null>(null);
  const [version, setVersion] = useState<NotebookVersion | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [turns, setTurns] = useState<NotebookTurn[]>([]);
  const [turnsError, setTurnsError] = useState<string | null>(null);

  const [followedRunId, setFollowedRunId] = useState<string | null>(null);
  /** Verdicts from the last graded attempt, by cell id. */
  const [grades, setGrades] = useState<Record<string, NotebookCellGrade>>({});
  /** The same verdicts as one report, for the summary strip above the notebook. */
  const [gradeReport, setGradeReport] = useState<GradeReport | null>(null);
  /** Cells whose attempt is in the sandbox right now — one at a time, because the
   * reader submits one cell at a time and a second attempt supersedes the first. */
  const [gradingCellIds, setGradingCellIds] = useState<ReadonlySet<string>>(new Set());

  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [downloading, setDownloading] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [quizzing, setQuizzing] = useState(false);

  // "Compare with previous" (task 1): `null` compareSeq means "the nearest
  // earlier version" — computed below from `versions` — the same "follow
  // unless pinned" pattern `pinnedSeq` uses for the main version picker.
  const [compareMode, setCompareMode] = useState(false);
  const [compareSeq, setCompareSeq] = useState<number | null>(null);
  const [compareVersion, setCompareVersion] = useState<NotebookVersion | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  // The editor's draft. `null` means "not editing" — distinct from an empty array,
  // which is a notebook the reader has deleted every cell from and is about to save.
  const [draftCells, setDraftCells] = useState<Cell[] | null>(null);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The version an in-flight save is writing, AND the run writing it. Pinned once
  // that run finishes, rather than immediately: a queued version has no spec to
  // render, and if the run FAILS the notebook's `current_version_id` never moves —
  // so following "current" would show the reader their previous version and hide the
  // failure they need to see.
  //
  // Keyed to the run because "once the run finishes" used to mean "once ANY run
  // finishes": if this run's stream was lost or superseded, the pin sat pending and
  // the next run to end applied it, selecting a version that had nothing to do with
  // what the reader had just done. `lib/run-stream-outcome.ts` owns that rule.
  const authored = useRef<AuthoredVersion | null>(null);

  const reloadSeq = useRef(0);

  function loadNotebook() {
    const seq = ++reloadSeq.current;
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || typeof payload.id !== "string") {
          throw new Error(refusalSentence(payload) ?? copy.loadFailed);
        }
        return payload as unknown as Notebook;
      })
      .then((loaded) => {
        if (seq !== reloadSeq.current) return;
        setNotebook(loaded);
        setNotebookError(null);
        setTitleDraft((current) => (editingTitle ? current : loaded.title));
        if (RUNNING_STATUSES.has(loaded.latest_status) && loaded.latest_run_id) {
          setFollowedRunId(loaded.latest_run_id);
        }
      })
      .catch((cause) => {
        if (seq !== reloadSeq.current) return;
        setNotebookError(cause instanceof Error ? cause.message : copy.loadFailed);
      });
  }

  function loadVersions() {
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/versions`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (response.ok && isRecord(payload) && Array.isArray(payload.items)) {
          setVersions(payload.items as NotebookVersionSummary[]);
        }
      })
      .catch(() => {});
  }

  function loadTurns() {
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/turns`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || !Array.isArray(payload.items)) {
          throw new Error(refusalSentence(payload) ?? copy.chatLoadFailed);
        }
        setTurns(payload.items as NotebookTurn[]);
        setTurnsError(null);
      })
      .catch((cause) => {
        setTurnsError(cause instanceof Error ? cause.message : copy.chatLoadFailed);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- notebookId change is a hard reset; copy.* are stable strings for the active locale
  useEffect(() => {
    setNotebook(null);
    setVersion(null);
    setVersions([]);
    setPinnedSeq(null);
    setTurns([]);
    setFollowedRunId(null);
    setGrades({});
    setGradeReport(null);
    setGradingCellIds(new Set());
    setGradingRunId(null);
    setDraftCells(null);
    setFocusedCellId(null);
    loadNotebook();
    loadVersions();
    loadTurns();
  }, [notebookId]);

  // Follow the notebook's current version unless the reader pinned one from the picker.
  const selectedSeq = pinnedSeq ?? notebook?.current_version_seq ?? null;

  useEffect(() => {
    if (selectedSeq === null) {
      setVersion(null);
      return;
    }
    let active = true;
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/versions/${selectedSeq}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || typeof payload.seq !== "number") {
          throw new Error(refusalSentence(payload) ?? copy.loadFailed);
        }
        return payload as unknown as NotebookVersion;
      })
      .then((loaded) => {
        if (active) {
          setVersion(loaded);
          setVersionError(null);
        }
      })
      .catch((cause) => {
        if (active) setVersionError(cause instanceof Error ? cause.message : copy.loadFailed);
      });
    return () => {
      active = false;
    };
  }, [notebookId, selectedSeq, copy.loadFailed]);

  // Versions strictly earlier than the one on screen — what the "compare
  // against" picker offers, and where the default (no explicit pin) comes
  // from: the nearest earlier version, i.e. "previous".
  const earlierVersions = versions.filter((item) => selectedSeq !== null && item.seq < selectedSeq);
  const defaultCompareSeq =
    earlierVersions.length > 0 ? Math.max(...earlierVersions.map((item) => item.seq)) : null;
  const effectiveCompareSeq = compareSeq ?? defaultCompareSeq;

  useEffect(() => {
    if (!compareMode || effectiveCompareSeq === null) {
      setCompareVersion(null);
      return;
    }
    let active = true;
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/versions/${effectiveCompareSeq}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || typeof payload.seq !== "number") {
          throw new Error(refusalSentence(payload) ?? copy.diffLoadFailed);
        }
        return payload as unknown as NotebookVersion;
      })
      .then((loaded) => {
        if (active) {
          setCompareVersion(loaded);
          setCompareError(null);
        }
      })
      .catch((cause) => {
        if (active) setCompareError(cause instanceof Error ? cause.message : copy.diffLoadFailed);
      });
    return () => {
      active = false;
    };
  }, [notebookId, compareMode, effectiveCompareSeq, copy.diffLoadFailed]);

  // Follow the active run's SSE stream. The reader itself lives in
  // `lib/use-run-progress.ts` (extracted from what used to be inline here) so
  // the courses workspace's per-module and per-plan-run rails can reuse the
  // exact same connect/parse/reconnect-free logic instead of a second copy.
  const progressEvents = useRunProgress(followedRunId, (outcome, streamRunId) => {
    // The server is the truth about what the run did, whichever way the stream
    // ended — so reload either way, and let the decision below say what may be
    // concluded about the version this editor session authored.
    loadNotebook();
    loadVersions();
    loadTurns();
    const decision = authoredPinAfterRun(authored.current, streamRunId, outcome);
    if (decision.pin !== null) setPinnedSeq(decision.pin);
    if (decision.clear) authored.current = null;
    if (decision.warn) setActionError(copy.runStreamLost);
  });

  // Grading follows its OWN stream, not `followedRunId`.
  //
  // `followedRunId` is written by every run-starting action in this workspace — a chat
  // turn, Quiz me, an authored version, a re-run — so a single slot means any of them
  // aborts a grading stream in flight and the sandbox's completed verdict is dropped on
  // the floor. The attempt lock could not cover that: it disables the attempt buttons,
  // and none of those actions is an attempt button. Greptile caught it on PR 832.
  //
  // Two slots is also the honest model. A grading run writes no version, so none of the
  // reloads the general callback does on every terminal event apply to it, and it has
  // no business making the header read "generating".
  const [gradingRunId, setGradingRunId] = useState<string | null>(null);
  /** Which attempt each grading run belongs to, and which attempt is current.
   *
   * A finished run's stream stays open until it reports, and the reader can start the
   * next attempt in the meantime — the lock is taken the moment they press the button,
   * a whole POST round-trip before the new run id exists. In that window the OLD
   * stream reporting `lost` would clear the NEW attempt's lock and announce its
   * failure. Comparing run ids does not close it, because the new attempt has no run
   * id yet; a monotonic attempt number does. Greptile caught it on PR 832. */
  const attemptSeq = useRef(0);
  const runAttempt = useRef(new Map<string, number>());
  /**
   * Idempotency keys for submissions whose OUTCOME WE NEVER LEARNED, keyed by the
   * submission itself.
   *
   * Two requirements pull opposite ways and both are real. A lost 202 must not be
   * charged twice, so pressing again has to send the key the accepted request carried
   * — a fresh UUID per press cannot. A run that FAILED must be retryable, so the key
   * must not be permanent — a hash of the body is, and replays the stored failure
   * forever. Greptile caught both, one round apart.
   *
   * The tie-break is what we know: a key lives only while the attempt's outcome is
   * unknown, and is dropped the moment one is observed — verdict or failure alike. So
   * a lost response replays the original run (the server hands back its id, we follow
   * it, and learn the outcome we missed), and an observed failure starts a fresh run
   * on the next press. The failure case costs one extra press and never becomes
   * permanent, which is the trade the other two designs each got wrong in one
   * direction.
   */
  const pendingKeys = useRef(new Map<string, string>());
  const inflightKey = useRef<string | null>(null);
  const gradingEvents = useRunProgress(gradingRunId, (outcome, streamRunId) => {
    // A LOST stream produces no terminal event, so the effect below cannot see it and
    // the lock would be held forever. Disjoint from that path by construction:
    // `useRunProgress` reports "lost" only when no terminal event ever arrived.
    if (runAttempt.current.get(streamRunId) !== attemptSeq.current) return;
    if (outcome === "lost" && gradingCellIds.size > 0) {
      if (inflightKey.current) pendingKeys.current.delete(inflightKey.current);
      setGradingCellIds(new Set());
      setActionError(copy.gradeFailed);
    }
  });

  // Verdicts arrive on the SAME stream the rest of the run does, as
  // `notebook.grades`. Read from the event list rather than from the terminal
  // callback: the callback fires once the run has ENDED, and by then the grades
  // event is already in `progressEvents` — waiting for the end would also mean
  // showing nothing if the stream drops after the verdicts but before `run.finished`.
  useEffect(() => {
    // The same window the callback guards, and the OTHER consumer of it. While a new
    // attempt's POST is in flight `gradingRunId` still points at the previous run, so
    // this effect would read that run's events: showing its verdict as the new
    // attempt's, or reporting the still-running attempt as failed. Guarding one
    // consumer and not the other left half the race open. Greptile, PR 832.
    if (gradingRunId === null || runAttempt.current.get(gradingRunId) !== attemptSeq.current) {
      return;
    }
    const event = [...gradingEvents].reverse().find((item) => item.type === "notebook.grades");
    if (event) {
      const report = isRecord(event.grades) ? (event.grades as GradeReport) : null;
      if (!report) return;
      const next: Record<string, NotebookCellGrade> = {};
      for (const grade of report.cells ?? []) next[grade.id] = grade;
      // Outcome observed: this submission is settled, so its key is forgotten and a
      // later press of the same answer starts a genuinely new run.
      if (inflightKey.current) pendingKeys.current.delete(inflightKey.current);
      setGrades((current) => ({ ...current, ...next }));
      setGradeReport(report);
      setGradingCellIds(new Set());
      // A delivered verdict SUPERSEDES a grading-failure message, and this is the
      // only place that can be decided. Grades can arrive and the stream then drop
      // before any terminal event, so the lost-stream callback fires afterwards and
      // announces a failure over a verdict the reader is already looking at. Guarding
      // that callback on "is the lock still held" does not fix it — whether the lock
      // is clear by then depends on React having flushed this effect first, which is
      // exactly the ordering that cannot be relied on. Greptile caught it on PR 832.
      //
      // Clearing here instead is race-free in the direction that matters: this effect
      // always runs after the grades land, whatever order the two paths ran in.
      // Narrowed to `gradeFailed` so a real error from some other action survives.
      setActionError((current) => (current === copy.gradeFailed ? null : current));
      // Why nothing could be graded, when that is the answer. Without this a guard
      // refusal reads as "not graded yet", which tells the reader their code was fine
      // and something else went wrong.
      if (typeof event.note === "string" && event.note) setActionError(event.note);
      return;
    }
    // The run ended and no verdict came. Releasing the lock is the whole point: it
    // gates EVERY graded cell's submit, so leaving it held after a failed run makes
    // the notebook's grading permanently dead until a reload, and the submitted cell
    // sits on "Running your code…" forever. Greptile caught it on PR 832 — it is the
    // cost of the lock added for the previous finding, which is the shape a fix that
    // introduces its own failure usually has.
    //
    // Decided HERE rather than in the terminal callback, and that is not a style
    // choice: `useRunProgress` calls its callback in the same tick it appends the
    // event, so the callback runs BEFORE this effect sees the grades. A callback
    // asking "did a verdict arrive?" would answer no on a perfectly good run.
    const ended = gradingEvents.some(
      (item) => item.type === "run.finished" || item.type === "run.error",
    );
    if (ended && gradingCellIds.size > 0) {
      if (inflightKey.current) pendingKeys.current.delete(inflightKey.current);
      setGradingCellIds(new Set());
      setActionError(copy.gradeFailed);
    }
  }, [gradingEvents, gradingRunId, gradingCellIds, copy.gradeFailed]);

  /**
   * Send one reader's attempt to be graded by the exercise's own test.
   *
   * The alternative this replaces is still here for cells with no test behind them:
   * `cellAction` falls back to asking Nala. The difference is not cosmetic — one is
   * an assertion that either raised or did not, the other is a model's opinion — so
   * the button says which one the reader is about to get.
   */
  async function gradeAttempt(cellId: string, attempt: string) {
    setActionError(null);
    const mine = (attemptSeq.current += 1);
    const submission = `${cellId}\u0000${attempt}`;
    setGradingCellIds(new Set([cellId]));
    const body = JSON.stringify({ code: { [cellId]: attempt }, answers: {} });
    try {
      // Reused for THIS submission until its outcome is known — see `pendingKeys`.
      const key = pendingKeys.current.get(submission) ?? crypto.randomUUID();
      pendingKeys.current.set(submission, key);
      inflightKey.current = submission;
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/attempts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Grading costs a sandbox run, so a retry must not buy a second one. The
          // server has taken this header since the route existed; nothing sent one,
          // which made the protection real and unreachable at the same time.
          "Idempotency-Key": key,
        },
        body,
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRecord(payload)) {
        throw new Error(refusalSentence(payload) ?? copy.gradeFailed);
      }
      const runId = typeof payload.run_id === "string" ? payload.run_id : null;
      if (!runId) throw new Error(copy.gradeFailed);
      runAttempt.current.set(runId, mine);
      setGradingRunId(runId);
    } catch (cause) {
      // Deliberately NOT clearing the key here. A thrown fetch is the ambiguous case
      // this whole mechanism exists for: the server may have accepted the attempt and
      // only the response was lost, so the next press must carry the same key. It is
      // dropped once an outcome is actually observed, which a replay will deliver.
      setGradingCellIds(new Set());
      setActionError(cause instanceof Error ? cause.message : copy.gradeFailed);
    }
  }

  // The strip above the notebook: what has been GRADED, which is a different
  // question from what ran. `lib/notebook-grades.ts` owns the counting rule that
  // makes it honest — `ungradable` cells stay out of the denominator, because a
  // grader that could not run has established nothing about the reader.
  const summary = gradeSummary(gradeReport);
  const rate = passRate(summary);
  const gradeSummaryStrip = hasGradesToShow(summary) ? (
    <section className="mj-notebook-grade-summary" aria-label={copy.gradeSummaryLabel}>
      <p>
        {copy.gradeSummary(summary.passed, summary.passed + summary.failed)}
        {rate !== null ? ` · ${Math.round(rate * 100)}%` : ""}
      </p>
      {summary.ungradable > 0 ? <p>{copy.gradeUngradable(summary.ungradable)}</p> : null}
    </section>
  ) : null;

  async function sendTurn(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRecord(payload) || !isRecord(payload.turn) || !isRecord(payload.version)) {
        throw new Error(refusalSentence(payload) ?? copy.chatSendFailed);
      }
      const runId = typeof payload.run_id === "string" ? payload.run_id : null;
      loadTurns();
      loadVersions();
      // The turn response carries no `notebook` field (`CreateNotebookTurnResponse`
      // is `{ turn, version, run_id }`) — reload it too so the header's status
      // pill flips to "generating" as soon as the revise run is queued.
      loadNotebook();
      if (runId) setFollowedRunId(runId);
      setMessage("");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : copy.chatSendFailed);
    } finally {
      setSending(false);
    }
  }

  // ------------------------------------------------------------------ editing

  const editing = draftCells !== null;
  const originalCells = (version?.spec?.cells ?? []) as Cell[];
  const dirty = editing && cellsAreDirty(originalCells, draftCells ?? []);

  function startEditing() {
    setDraftCells(originalCells.map((cell) => ({ ...cell })));
    setFocusedCellId(null);
    setActionError(null);
  }

  function stopEditing() {
    setDraftCells(null);
    setFocusedCellId(null);
  }

  function discardEdits() {
    if (dirty && !window.confirm(copy.discardConfirm)) return;
    stopEditing();
  }

  function editCell(cellId: string, edit: CellEdit) {
    setDraftCells((current) => (current === null ? current : applyCellEdit(current, cellId, edit)));
  }

  function insertCell(afterId: string | null, kind: Cell["kind"]) {
    setDraftCells((current) => {
      if (current === null) return current;
      const { cells: next, id } = insertCellAfter(current, afterId, kind);
      setFocusedCellId(id);
      return next;
    });
  }

  function removeCell(cellId: string) {
    setDraftCells((current) => (current === null ? current : deleteCell(current, cellId)));
    setFocusedCellId((current) => (current === cellId ? null : current));
  }

  function shiftCell(cellId: string, direction: "up" | "down") {
    setDraftCells((current) => (current === null ? current : moveCell(current, cellId, direction)));
  }

  /** Save the draft as a new user-authored version. `runUntil` is "Run to here". */
  async function saveDraft({ execute, runUntil }: { execute: boolean; runUntil?: string | null }) {
    const spec = version?.spec;
    if (!spec || draftCells === null || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: specWithCells(spec, draftCells),
          message: "",
          execute,
          run_until: runUntil ?? null,
        }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRecord(payload) || !isRecord(payload.version)) {
        // `title` is what the API's problem+json puts the sentence in — the parse
        // error from a source edit, or the reason two inputs were refused.
        throw new Error(refusalSentence(payload) ?? copy.saveFailed);
      }
      const created = payload.version as unknown as NotebookVersionSummary;
      const runId = typeof payload.run_id === "string" ? payload.run_id : null;
      stopEditing();
      loadNotebook();
      loadVersions();
      loadTurns();
      if (runId) {
        authored.current = { runId, seq: created.seq };
        setFollowedRunId(runId);
      } else {
        // No run to wait for: the version is already `ready`, so show it now.
        setPinnedSeq(created.seq);
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : copy.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  // The browser's own guard. It fires only on a real unload (tab close, reload,
  // external link) — an in-app route change does not reach it, which is why
  // `discardEdits` asks separately rather than relying on this.
  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendTurn(message);
  }

  function cellAction(cellId: string, action: NotebookCellActionKind, detail?: string) {
    if (action === "explainError") {
      // `cells` (below) is this render's join of the pinned version's spec
      // against its report — the same lookup the card itself used to decide
      // whether to show this action at all.
      const cell = cells.find((item) => item.id === cellId);
      const traceback = errorTracebackText(cell?.error ?? null);
      void sendTurn(
        `Cell \`${cellId}\` failed with:\n\`\`\`\n${traceback}\n\`\`\`\nExplain what went wrong and fix the cell.`,
      );
      return;
    }
    if (action === "checkAttempt") {
      const attempt = detail ?? "";
      // A cell with a test behind it gets the test, not an opinion. Nala's judgement
      // stays the answer for every other kind of cell — a checkpoint the reader wants
      // discussed, an exercise with no grader — but where a real verdict exists it
      // wins, because a model saying "looks right" to a wrong answer is the failure
      // this whole path was built to remove.
      const graded = cells.find((item) => item.id === cellId)?.graded ?? false;
      if (graded) {
        void gradeAttempt(cellId, attempt);
        return;
      }
      void sendTurn(
        `Here is my attempt at cell \`${cellId}\`:\n\`\`\`python\n${attempt}\n\`\`\`\nGrade it against the intended solution, say what is right, what is wrong, and give one hint before the full fix. Do not change the notebook.`,
      );
      return;
    }
    const templates: Record<"explain" | "simplify" | "figure" | "exercise", string> = {
      explain: `Explain cell ${cellId} in simpler terms.`,
      simplify: `Simplify cell ${cellId}.`,
      figure: `Add a figure after cell ${cellId}.`,
      exercise: `Turn cell ${cellId} into an exercise.`,
    };
    void sendTurn(templates[action]);
  }

  /** Workspace-level, not per-cell: creates a NEW notebook seeded from this
   * one (worker-side resolution in `_seed_material_for`, `kind: "notebook"`)
   * and navigates to it once queued. */
  async function quizMe() {
    if (!notebook || quizzing) return;
    setQuizzing(true);
    setActionError(null);
    try {
      // `Seed.kind: "notebook"` is landing in the generated TS contracts via
      // Lane D, in parallel with this lane — until it reaches
      // `@majorana/contracts-gen`, this is a local, unchecked literal rather
      // than a typed `Seed`.
      const seeds = [{ kind: "notebook" as const, ref: notebookId, note: "" }];
      const response = await fetch("/api/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          brief:
            "A short quiz (6–8 questions, mixed multiple-choice and predict-the-output) on the ideas in this notebook, with answers hidden in solution cells",
          kind: "quiz",
          framework: notebook.framework,
          seeds,
          response_locale: locale,
        }),
      });
      const payload = (await response.json()) as unknown;
      const newNotebookId =
        isRecord(payload) && isRecord(payload.notebook) && typeof payload.notebook.id === "string"
          ? payload.notebook.id
          : null;
      if (!response.ok || !newNotebookId) {
        throw new Error(refusalSentence(payload) ?? copy.quizButtonFailed);
      }
      router.push(`/notebooks/${encodeURIComponent(newNotebookId)}`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : copy.quizButtonFailed);
      setQuizzing(false);
    }
  }

  async function saveTitle() {
    if (!notebook || savingTitle) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === notebook.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRecord(payload) || typeof payload.id !== "string") {
        throw new Error(refusalSentence(payload) ?? copy.titleEditFailed);
      }
      setNotebook(payload as unknown as Notebook);
      setEditingTitle(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : copy.titleEditFailed);
    } finally {
      setSavingTitle(false);
    }
  }

  async function downloadVersion() {
    if (!notebook || !version || downloading) return;
    setDownloading(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/notebooks/${encodeURIComponent(notebookId)}/versions/${version.seq}/export`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(copy.downloadFailed);
      const blob = await response.blob();
      download(blob, notebookExportFilename(notebook.slug, version.seq));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : copy.downloadFailed);
    } finally {
      setDownloading(false);
    }
  }

  async function runAgain() {
    if (rerunning) return;
    setRerunning(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/run`, { method: "POST" });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRecord(payload)) {
        throw new Error(refusalSentence(payload) ?? copy.runAgainFailed);
      }
      const runId = typeof payload.run_id === "string" ? payload.run_id : null;
      loadNotebook();
      loadVersions();
      if (runId) setFollowedRunId(runId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : copy.runAgainFailed);
    } finally {
      setRerunning(false);
    }
  }

  if (notebookError && !notebook) {
    return <div className="mj-notebook-workspace-empty mj-library-empty" role="alert"><strong>{notebookError}</strong></div>;
  }
  if (!notebook) {
    return <div className="mj-notebook-workspace-empty mj-library-empty" role="status"><strong>{copy.loading}</strong></div>;
  }

  const pill = notebookStatusPill(notebook.latest_status);
  const isGenerating = RUNNING_STATUSES.has(notebook.latest_status);
  const cells = notebookCellViews(version?.spec?.cells, version?.report);
  const stages = notebookProgressFromEvents(progressEvents as NotebookProgressEvent[]);
  const mastery = notebookMastery(version?.spec?.cells, version?.report);
  const diff =
    compareMode && version?.spec && compareVersion?.spec
      ? diffNotebookVersions(compareVersion.spec, version.spec)
      : null;
  // Editing is offered only on the newest version, and only when nothing is running:
  // an edit is saved as the NEXT version, so branching from an older one would
  // silently discard everything after it, and `_assert_not_in_flight` would refuse a
  // save made while a run is going anyway — better not to offer the button.
  const latestSeq = versions.length > 0 ? versions[versions.length - 1].seq : null;
  const canEdit =
    !isGenerating &&
    version !== null &&
    version.status === "ready" &&
    version.spec !== null &&
    latestSeq !== null &&
    version.seq === latestSeq;

  return (
    <main className="mj-notebook-workspace">
      <header className="mj-notebook-workspace-header">
        <div className="mj-notebook-workspace-title">
          {editingTitle ? (
            <form className="mj-notebook-title-edit-form" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
              <input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                disabled={savingTitle}
                autoFocus
              />
              <button className="mj-secondary-button" type="submit" disabled={savingTitle}>
                {savingTitle ? copy.creating : copy.saveTitle}
              </button>
            </form>
          ) : (
            <h1>
              <button
                type="button"
                className="mj-notebook-title-edit"
                onClick={() => { setTitleDraft(notebook.title); setEditingTitle(true); }}
              >
                {notebook.title}
              </button>
            </h1>
          )}
          <div className="mj-notebook-workspace-meta">
            <span className="mj-notebook-kind-badge">{copy.kindOption[notebook.kind]}</span>
            <span className={`mj-notebook-status-pill mj-notebook-status-pill--${pill}`}>{copy.statusPill[pill]}</span>
          </div>
          {hasMasteryToShow(mastery) ? (
            <p className="mj-notebook-progress-strip">{copy.progressSummary(mastery)}</p>
          ) : null}
        </div>
        <div className="mj-notebook-workspace-actions">
          {versions.length > 0 ? (
            <label className="mj-notebook-version-picker mj-filter-select">
              <span className="sr-only">{copy.versionPickerLabel}</span>
              <select
                value={selectedSeq ?? ""}
                onChange={(event) => setPinnedSeq(Number(event.target.value))}
              >
                {versions.map((item) => (
                  <option key={item.id} value={item.seq}>{copy.versionLabel(item.seq)}</option>
                ))}
              </select>
            </label>
          ) : null}
          {earlierVersions.length > 0 ? (
            <>
              <button
                className="mj-secondary-button"
                type="button"
                aria-pressed={compareMode}
                onClick={() => setCompareMode((current) => !current)}
              >
                {copy.compareToggle}
              </button>
              {compareMode ? (
                <label className="mj-notebook-compare-picker mj-filter-select">
                  <span className="sr-only">{copy.comparePickerLabel}</span>
                  <select
                    value={effectiveCompareSeq ?? ""}
                    onChange={(event) => setCompareSeq(Number(event.target.value))}
                  >
                    {earlierVersions.map((item) => (
                      <option key={item.id} value={item.seq}>{copy.versionLabel(item.seq)}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          ) : null}
          <button
            className="mj-secondary-button"
            type="button"
            disabled={!version?.ipynb || downloading}
            onClick={() => void downloadVersion()}
          >
            {downloading ? copy.creating : copy.download}
          </button>
          <button
            className="mj-secondary-button"
            type="button"
            disabled={rerunning || isGenerating}
            onClick={() => void runAgain()}
          >
            {rerunning || isGenerating ? copy.running : copy.runAgain}
          </button>
          <button
            className="mj-secondary-button"
            type="button"
            disabled={quizzing || !version?.spec}
            onClick={() => void quizMe()}
          >
            {quizzing ? copy.creating : copy.quizButtonLabel}
          </button>
          {canEdit || editing ? (
            <button
              className="mj-secondary-button"
              type="button"
              disabled={saving}
              onClick={() => (editing ? discardEdits() : startEditing())}
            >
              {editing ? copy.editExit : copy.edit}
            </button>
          ) : null}
        </div>
      </header>

      {notebookError ? <p role="alert" className="mj-notebook-workspace-error">{notebookError}</p> : null}
      {actionError ? <p role="alert" className="mj-notebook-workspace-error">{actionError}</p> : null}

      {isGenerating && stages.length > 0 ? (
        <section className="mj-notebook-progress" aria-label={copy.progressLabel}>
          <StageRail stages={stages.map((stage) => toRailStage(stage, copy.runAgainFailed))} />
        </section>
      ) : null}

      <div className="mj-notebook-workspace-body">
        <section className="mj-notebook-workspace-notebook">
          {version?.status === "failed" ? (
            <div className="mj-notebook-version-failed" role="alert">
              <p><strong>{copy.versionFailedHeadline}</strong></p>
              {version.error ? <p>{version.error}</p> : null}
              <p>{copy.versionFailedHint}</p>
            </div>
          ) : null}
          {versionError ? <p role="alert" className="mj-notebook-workspace-error">{versionError}</p> : null}
          {compareError ? <p role="alert" className="mj-notebook-workspace-error">{compareError}</p> : null}
          {editing && draftCells !== null ? (
            <>
              <NotebookEditor
                cells={draftCells}
                locale={locale}
                focusedCellId={focusedCellId}
                busy={saving}
                onEdit={editCell}
                onInsert={insertCell}
                onDelete={removeCell}
                onMove={shiftCell}
                onFocusCell={setFocusedCellId}
                onRunToHere={(cellId) => void saveDraft({ execute: true, runUntil: cellId })}
              />
              <div className="mj-notebook-edit-bar" role="group" aria-label={copy.edit}>
                <button
                  className="mj-primary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void saveDraft({ execute: true })}
                >
                  {saving ? copy.saving : copy.saveAndRun}
                </button>
                <button
                  className="mj-secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void saveDraft({ execute: false })}
                >
                  {copy.saveWithoutRunning}
                </button>
                <button
                  className="mj-secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => discardEdits()}
                >
                  {copy.discard}
                </button>
              </div>
            </>
          ) : compareMode ? (
            diff && version?.spec && compareVersion?.spec ? (
              <NotebookDiffView diff={diff} older={compareVersion.spec} newer={version.spec} locale={locale} />
            ) : (
              <p className="mj-notebook-workspace-empty-notebook">{copy.diffLoading}</p>
            )
          ) : version ? (
            <>
            {gradeSummaryStrip}
            <NotebookView
              cells={cells}
              locale={locale}
              framework={notebook.framework?.name ?? "qiskit"}
              onCellAction={cellAction}
              grades={grades}
              gradingCellIds={gradingCellIds}
            />
            </>
          ) : !isGenerating ? (
            <p className="mj-notebook-workspace-empty-notebook">{copy.loadFailed}</p>
          ) : null}
          {!editing && version?.warnings && version.warnings.length > 0 ? (
            <section className="mj-notebook-structure-notes" aria-label={copy.structureNotesLabel}>
              <h2>{copy.structureNotesLabel}</h2>
              <p className="mj-notebook-structure-notes-hint">{copy.structureNotesHint}</p>
              <ul>
                {version.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {!compareMode && version ? <NotebookReviewPanel review={version.review} locale={locale} /> : null}
        </section>

        <aside className="mj-notebook-workspace-chat" aria-label={copy.chatLabel}>
          <h2>{copy.chatLabel}</h2>
          {turnsError ? <p role="alert">{turnsError}</p> : null}
          {turns.length === 0 ? <p className="mj-notebook-chat-empty">{copy.chatEmpty}</p> : null}
          <div className="mj-chat-thread mj-notebook-chat-thread">
            {turns.map((turn) => (
              <div key={turn.id} className="mj-chat-turn">
                <div className={`mj-chat-message ${turn.role === "user" ? "mj-chat-message--user" : "mj-chat-message--assistant"}`}>
                  {turn.role === "nala" ? <ChatMarkdown source={turn.content} /> : <p>{turn.content}</p>}
                </div>
              </div>
            ))}
          </div>
          {isGenerating ? <p className="mj-notebook-chat-progress" role="status">{copy.progressLabel}</p> : null}
          <form className="mj-notebook-chat-composer" onSubmit={submitMessage}>
            <label>
              <span className="sr-only">{copy.chatLabel}</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={copy.chatPlaceholder}
                rows={2}
              />
            </label>
            <button className="mj-primary-button" type="submit" disabled={sending || !message.trim()}>
              {sending ? copy.chatSending : copy.chatSend}
            </button>
          </form>
        </aside>
      </div>
    </main>
  );
}
