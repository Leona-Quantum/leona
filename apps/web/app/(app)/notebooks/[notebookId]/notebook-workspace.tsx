"use client";

import type { components } from "@majorana/contracts-gen";
import { StageRail, type RailStage } from "@majorana/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ChatMarkdown } from "../../../../components/chat-markdown";
import { CommentsPanel } from "../../../../components/comments-panel";
import { PresenceBar } from "../../../../components/presence-bar";
import { isCommentableId } from "../../../../lib/comments";
import { isPresenceTrackableId } from "../../../../lib/presence";
import { NotebookDiffView } from "../../../../components/notebook-diff-view";
import { NotebookShareDialog } from "../../../../components/notebook-share-dialog";
import { NotebookReviewPanel } from "../../../../components/notebook-review-panel";
import {
  NotebookView,
  type NotebookCellActionKind,
  type NotebookCellEditState,
  type NotebookCellGrade,
} from "../../../../components/notebook-view";
import { refusalSentence } from "../../../../lib/api-error";
import { diffNotebookVersions } from "../../../../lib/notebook-diff";
import { NotebookEditor } from "../../../../components/notebook-editor";
import {
  applyCellEdit,
  cellsAreDirty,
  deleteCell,
  duplicateCell,
  insertCellAfter,
  moveCell,
  nextCellId,
  specWithCells,
  undoStructuralChange,
  type CellEdit,
  type StructuralChange,
} from "../../../../lib/notebook-editing";
import { notebookExportFilename } from "../../../../lib/notebook-export";
import { canDownloadSolutions } from "../../../../lib/notebook-download";
import { gradeSummary, hasGradesToShow, passRate } from "../../../../lib/notebook-grades";
import { hasMasteryToShow, notebookMastery } from "../../../../lib/notebook-mastery";
import { errorTracebackText, notebookCellViews, notebookStatusPill } from "../../../../lib/notebook-view";
import {
  notebookProgressFromEvents,
  type NotebookProgressEvent,
  type NotebookProgressStage,
} from "../../../../lib/notebook-progress";
import { liveNotebookFromEvents, type LiveNotebookEvent } from "../../../../lib/notebook-live";
import { NotebookLiveView } from "../../../../components/notebook-live-view";
import type { PublicLocale } from "../../../../lib/public-locale";
import { useRunProgress } from "../../../../lib/use-run-progress";
import { authoredPinAfterRun, type AuthoredVersion } from "../../../../lib/run-stream-outcome";
import { defaultVersionSeq } from "../../../../lib/notebook-version-choice";
import { WORKSPACE_COPY } from "../../../../lib/workspace-locale";

type Notebook = components["schemas"]["Notebook"];
type NotebookVersion = components["schemas"]["NotebookVersion"];
type NotebookVersionSummary = components["schemas"]["NotebookVersionSummary"];
type NotebookTurn = components["schemas"]["NotebookTurn"];
type Cell = components["schemas"]["Cell"];
type GradeReport = components["schemas"]["GradeReport"];
type NotebookGradesSnapshot = components["schemas"]["NotebookGradesSnapshot"];

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
  const [loadedVersion, setVersion] = useState<NotebookVersion | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionAttempt, setVersionAttempt] = useState(0);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [turns, setTurns] = useState<NotebookTurn[]>([]);
  const [turnsError, setTurnsError] = useState<string | null>(null);
  const [turnsLoading, setTurnsLoading] = useState(true);

  const [followedRunId, setFollowedRunId] = useState<string | null>(null);
  /** Verdicts from the last graded attempt, by cell id. */
  const [grades, setGrades] = useState<Record<string, NotebookCellGrade>>({});
  /** The same verdicts as one report, for the summary strip above the notebook. */
  const [gradeReport, setGradeReport] = useState<GradeReport | null>(null);
  //: Set when the restored score was earned on a version that is no longer current.
  //: Null both when the score is current and when there is no score at all — the strip
  //: only renders at all if there is something to show, so the two never collide.
  const [staleGradeSeq, setStaleGradeSeq] = useState<number | null>(null);
  //: Whether a verdict has arrived on the live stream since this notebook was opened.
  //: A ref rather than state: the restore callback needs the value at the moment it
  //: settles, and a state read there would be the value captured when it was created.
  const liveGradesSeen = useRef(false);
  //: The signed-in user's id, for the one question this page asks of it: is the viewer
  //: the notebook's author? `null` until `/api/me` answers, which means the solutions
  //: button appears a moment late rather than appearing wrongly and then vanishing.
  const [viewerId, setViewerId] = useState<string | null>(null);
  //: The notebook currently on screen, readable from a callback that was created for a
  //: previous one. `notebookId` itself is captured per render and is therefore the same
  //: value inside a stale callback and outside it.
  const openNotebookId = useRef(notebookId);
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
  const [loadedCompareVersion, setCompareVersion] = useState<NotebookVersion | null>(null);
  const [compareAttempt, setCompareAttempt] = useState(0);
  const [compareError, setCompareError] = useState<string | null>(null);

  // The editor's draft. `null` means "not editing" — distinct from an empty array,
  // which is a notebook the reader has deleted every cell from and is about to save.
  const [draftCells, setDraftCells] = useState<Cell[] | null>(null);
  // "Ask Nala" on a cell starts a message in this box and focuses it.
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Per-cell editing, straight from the read view (ai-ops 375). `null` means no cell
  // is being edited or added — distinct from the page-level `draftCells`, which the
  // two must never both hold at once (rule 2 of the lane brief): the read view is not
  // even rendered while `draftCells !== null` (see the ternary in the JSX below), so
  // that direction is automatic; the page-level Edit button's own `disabled` is what
  // keeps the other direction true.
  const [cellEdit, setCellEdit] = useState<NotebookCellEditState | null>(null);
  // Whether a per-cell save (edit, add, delete, move, duplicate) is in flight — kept
  // apart from `saving`, which is specifically the page-level editor's own save, so the
  // two surfaces' busy states cannot be confused for one another.
  const [cellSaving, setCellSaving] = useState(false);
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
  const versionsRequest = useRef(0);
  const turnsRequest = useRef(0);
  const mutationPending = useRef(false);
  const titleEditing = useRef(false);
  titleEditing.current = editingTitle;

  function loadNotebook() {
    const seq = ++reloadSeq.current;
    setNotebookError(null);
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
        setTitleDraft((current) => (titleEditing.current ? current : loaded.title));
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
    const seq = ++versionsRequest.current;
    setVersionsError(null);
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/versions`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || !Array.isArray(payload.items)) {
          throw new Error(refusalSentence(payload) ?? copy.loadFailed);
        }
        if (seq === versionsRequest.current) setVersions(payload.items as NotebookVersionSummary[]);
      })
      .catch((cause) => {
        if (seq === versionsRequest.current) setVersionsError(cause instanceof Error ? cause.message : copy.loadFailed);
      });
  }

  /**
   * Restore this reader's last score (owner ruling ai-ops issue 260, option 1).
   *
   * The verdicts were always persisted — grading writes `notebook.grades` to
   * `run_events` — but nothing read them back, so closing the tab lost the score and
   * a reader returning to a notebook they had worked through saw an ungraded one.
   *
   * `null` is a real answer and means "no attempt yet", which is why it clears rather
   * than being ignored: an empty body is not an error and must not leave a previous
   * notebook's score on screen after switching notebooks.
   *
   * A score earned on an older version comes back `stale`. It is still shown — "you
   * scored 4/5 on the previous version" is worth knowing — but the strip says so, so a
   * pass is never rendered against cells that have since been rewritten.
   */
  // Once per mount, not per notebook: who is looking does not change when they open a
  // different notebook, and refetching it on every navigation would make the solutions
  // button flicker away and back.
  useEffect(() => {
    let active = true;
    void fetch("/api/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (!active || !isRecord(payload)) return;
        const id = payload.user_id;
        if (typeof id === "string") setViewerId(id);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function loadGrades() {
    // Which notebook this restore is for, compared later against a REF holding the one
    // currently open. The first version of this captured `notebookId` into a const and
    // compared it with `notebookId` — both reads of the same closure variable, so the
    // comparison was `A !== A` and the guard was a tautology that could never fire.
    // Greptile, PR 836. A ref is the only thing in scope whose value changes when the
    // reader navigates; every other binding here is frozen at the render that made it.
    const forNotebook = notebookId;
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/grades`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as unknown;
        // **A restored score never overwrites a live one.** This request is issued on
        // mount and settles whenever the network lets it; a reader who presses Check
        // straight away can have their real verdict on screen first, and an
        // unconditional restore then replaces it with the OLDER persisted snapshot —
        // the reader watches their new result turn back into their previous one.
        // Greptile caught it on PR 836. `liveGradesSeen` is set the moment the stream
        // applies a verdict, and this defers to it permanently: a restore is only ever
        // interesting before the first live result of the session.
        if (forNotebook !== openNotebookId.current || liveGradesSeen.current) return;
        if (payload === null) {
          setGrades({});
          setGradeReport(null);
          setStaleGradeSeq(null);
          return;
        }
        if (!isRecord(payload) || !isRecord(payload.grades)) return;
        const snapshot = payload as unknown as NotebookGradesSnapshot;
        const report = snapshot.grades;
        // The per-cell verdicts as well as the summary, mapped exactly the way the live
        // stream maps them. Restoring only the header strip would tell a reader they got
        // 4 of 5 and leave every cell unmarked, so the one thing they came back for —
        // WHICH one they got wrong — would still be gone.
        const next: Record<string, NotebookCellGrade> = {};
        for (const grade of report.cells ?? []) next[grade.id] = grade;
        setGrades(next);
        setGradeReport(report);
        setStaleGradeSeq(snapshot.stale ? snapshot.version_seq : null);
      })
      .catch(() => {});
  }

  function loadTurns() {
    const seq = ++turnsRequest.current;
    setTurnsLoading(true);
    setTurnsError(null);
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/turns`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || !Array.isArray(payload.items)) {
          throw new Error(refusalSentence(payload) ?? copy.chatLoadFailed);
        }
        if (seq !== turnsRequest.current) return;
        setTurns(payload.items as NotebookTurn[]);
        setTurnsError(null);
      })
      .catch((cause) => {
        if (seq === turnsRequest.current) setTurnsError(cause instanceof Error ? cause.message : copy.chatLoadFailed);
      })
      .finally(() => {
        if (seq === turnsRequest.current) setTurnsLoading(false);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- notebookId change is a hard reset; copy.* are stable strings for the active locale
  useEffect(() => {
    setNotebook(null);
    setNotebookError(null);
    setVersionError(null);
    setVersionsError(null);
    setTurnsError(null);
    setActionError(null);
    setEditingTitle(false);
    setSavingTitle(false);
    setMessage("");
    setSending(false);
    setSaving(false);
    setRerunning(false);
    setQuizzing(false);
    setDownloading(false);
    setCompareMode(false);
    setCompareSeq(null);
    setCompareVersion(null);
    setCompareError(null);
    mutationPending.current = false;
    authored.current = null;
    attemptSeq.current += 1;
    runAttempt.current.clear();
    pendingKeys.current.clear();
    inflightKey.current = null;
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
    setCellEdit(null);
    setCellSaving(false);
    setStaleGradeSeq(null);
    liveGradesSeen.current = false;
    openNotebookId.current = notebookId;
    loadNotebook();
    loadVersions();
    loadTurns();
    loadGrades();
    return () => {
      reloadSeq.current += 1;
      versionsRequest.current += 1;
      turnsRequest.current += 1;
      openNotebookId.current = "";
    };
  }, [notebookId]);

  // Follow the notebook's current version unless the reader pinned one from the picker.
  const selectedSeq =
    notebook?.id === notebookId
      ? pinnedSeq ?? defaultVersionSeq({ currentSeq: notebook.current_version_seq, versions })
      : null;
  const version = loadedVersion?.notebook_id === notebookId && loadedVersion.seq === selectedSeq ? loadedVersion : null;

  useEffect(() => {
    setVersionError(null);
    setVersionLoading(selectedSeq !== null);
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
      })
      .finally(() => {
        if (active) setVersionLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notebookId, selectedSeq, copy.loadFailed, versionAttempt]);

  // Versions strictly earlier than the one on screen — what the "compare
  // against" picker offers, and where the default (no explicit pin) comes
  // from: the nearest earlier version, i.e. "previous".
  const earlierVersions = versions.filter((item) => selectedSeq !== null && item.seq < selectedSeq);
  const defaultCompareSeq =
    earlierVersions.length > 0 ? Math.max(...earlierVersions.map((item) => item.seq)) : null;
  const effectiveCompareSeq = earlierVersions.some((item) => item.seq === compareSeq) ? compareSeq : defaultCompareSeq;
  const compareVersion = loadedCompareVersion?.notebook_id === notebookId && loadedCompareVersion.seq === effectiveCompareSeq ? loadedCompareVersion : null;

  useEffect(() => {
    setCompareError(null);
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
  }, [notebookId, compareMode, effectiveCompareSeq, copy.diffLoadFailed, compareAttempt]);

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
    // The lock is released and the reader is told, but the KEY IS KEPT. A lost stream
    // is not an observed outcome — the run may still be executing — so this is exactly
    // the case the key exists for, and dropping it would buy a second sandbox run for
    // a submission already accepted. My own rule two commits earlier said "dropped the
    // moment an outcome is observed", and I then applied it to a path where nothing is
    // observed. Greptile caught it on PR 832.
    if (outcome === "lost" && gradingCellIds.size > 0) {
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
    // Every event carries the run it came from (`routes/runs._event_json` spreads the
    // envelope over the payload), and that is what the verdict must be tied to — not to
    // whichever run `gradingRunId` currently names. `useRunProgress` clears its buffer
    // inside its own effect, which runs before this one but whose state update lands a
    // render later, so for exactly one pass the id is the NEW run's and the events are
    // the OLD run's. The ownership guard above passes, and without this filter the
    // previous verdict is shown as this attempt's and the new submission's pending key
    // is dropped before its outcome is known. Greptile, PR 832.
    const mine = gradingEvents.filter((item) => item.run_id === gradingRunId);
    const event = [...mine].reverse().find((item) => item.type === "notebook.grades");
    if (event) {
      const report = isRecord(event.grades) ? (event.grades as GradeReport) : null;
      if (!report) return;
      const next: Record<string, NotebookCellGrade> = {};
      for (const grade of report.cells ?? []) next[grade.id] = grade;
      // Outcome observed: this submission is settled, so its key is forgotten and a
      // later press of the same answer starts a genuinely new run.
      if (inflightKey.current) pendingKeys.current.delete(inflightKey.current);
      liveGradesSeen.current = true;
      setGrades((current) => ({ ...current, ...next }));
      setGradeReport(report);
      // A live verdict is by definition against the version being worked on, so the
      // "this is from an older version" note must go with the snapshot it described.
      setStaleGradeSeq(null);
      // Identity-stable, and not a style point: `gradingCellIds` is a dependency of
      // this effect and the verdict stays in `gradingEvents` forever, so installing a
      // fresh empty Set each pass changes the dependency, re-runs the effect, and the
      // render loop only ends at React's maximum-update-depth error. Greptile, PR 832.
      setGradingCellIds((current) => (current.size === 0 ? current : new Set()));
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
    const ended = mine.some(
      (item) => item.type === "run.finished" || item.type === "run.error",
    );
    // Guarded on `size > 0`, so unlike the verdict path above this cannot re-enter: the
    // set it installs fails the guard on the next pass.
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
  /**
   * `as` decides WHICH half of the attempt the submission lands in, and the two are
   * not interchangeable: `code` is substituted into the cell and run in the sandbox,
   * `answers` is compared against the cell's answer key in Python without executing
   * anything. Sending a question's answer as `code` would have the sandbox try to
   * execute the word "Hadamard".
   */
  async function gradeAttempt(cellId: string, attempt: string, as: "code" | "answer" = "code") {
    setActionError(null);
    const mine = (attemptSeq.current += 1);
    // The kind is part of the submission identity. Without it, answering a question
    // "2" and then submitting the code "2" against the same cell would hash to one
    // submission and reuse the first attempt's idempotency key — and the server would
    // answer 409, or worse hand back the earlier verdict for a different attempt.
    const submission = `${cellId}\u0000${as}\u0000${attempt}`;
    setGradingCellIds(new Set([cellId]));
    const body = JSON.stringify(
      as === "answer"
        ? { code: {}, answers: { [cellId]: attempt } }
        : { code: { [cellId]: attempt }, answers: {} },
    );
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
      if (openNotebookId.current !== notebookId) return;
      if (!response.ok || !isRecord(payload)) {
        throw new Error(refusalSentence(payload) ?? copy.gradeFailed);
      }
      const runId = typeof payload.run_id === "string" ? payload.run_id : null;
      if (!runId) throw new Error(copy.gradeFailed);
      runAttempt.current.set(runId, mine);
      setGradingRunId(runId);
    } catch (cause) {
      if (openNotebookId.current !== notebookId) return;
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
  const isAuthorOfARedactedNotebook = canDownloadSolutions(notebook, viewerId);
  // Broader than `isAuthorOfARedactedNotebook`, deliberately: sharing is not
  // limited to the `REDACTED_KINDS` a solutions download applies to — any
  // notebook the caller created can be shared, since `for_learner()` redacts
  // every kind the same way. The control plane enforces this independently
  // (`repos/notebook_share_links.py::_owned_notebook`); hiding the button for
  // a non-owner here just avoids showing a control that would 403.
  const isOwner = notebook !== null && viewerId !== null && notebook.owner_user_id === viewerId;

  const summary = gradeSummary(gradeReport);
  const rate = passRate(summary);
  const gradeSummaryStrip = hasGradesToShow(summary) ? (
    <section className="mj-notebook-grade-summary" aria-label={copy.gradeSummaryLabel}>
      <p>
        {copy.gradeSummary(summary.passed, summary.passed + summary.failed)}
        {rate !== null ? ` · ${Math.round(rate * 100)}%` : ""}
      </p>
      {summary.ungradable > 0 ? <p>{copy.gradeUngradable(summary.ungradable)}</p> : null}
      {staleGradeSeq !== null ? <p>{copy.gradeFromOlderVersion(staleGradeSeq)}</p> : null}
    </section>
  ) : null;

  async function sendTurn(text: string) {
    const trimmed = text.trim();
    // A turn can revise the notebook into a NEW version, which would pull the cell
    // array a per-cell edit's Save is about to build on out from under it (its
    // `originalCells` snapshot would no longer be the newest version's). Blocked the
    // same way the page-level editor already blocks it (`editing`, below) — see the
    // chat form's own `disabled` for the visible half of this rule.
    if (!trimmed || mutationPending.current || cellEdit !== null || RUNNING_STATUSES.has(notebook?.latest_status ?? "")) return;
    mutationPending.current = true;
    setSending(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = (await response.json()) as unknown;
      if (openNotebookId.current !== notebookId) return;
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
      setMessage((current) => current.trim() === trimmed ? "" : current);
    } catch (cause) {
      if (openNotebookId.current !== notebookId) return;
      setActionError(cause instanceof Error ? cause.message : copy.chatSendFailed);
    } finally {
      if (openNotebookId.current !== notebookId) return;
      mutationPending.current = false;
      setSending(false);
    }
  }

  // ------------------------------------------------------------------ editing

  const editing = draftCells !== null;
  const originalCells = (version?.spec?.cells ?? []) as Cell[];
  const dirty = editing && cellsAreDirty(originalCells, draftCells ?? []);

  function startEditing() {
    setCompareMode(false);
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

  function duplicateDraftCell(cellId: string) {
    setDraftCells((current) => {
      if (current === null) return current;
      const { cells: next, id } = duplicateCell(current, cellId);
      if (id) setFocusedCellId(id);
      return next;
    });
  }

  function undoDraftChange(change: StructuralChange) {
    setDraftCells((current) => (current === null ? current : undoStructuralChange(current, change)));
  }

  /** Save the draft as a new user-authored version. `runUntil` is "Run to here".
   * `reuseResults: false` is "Run everything fresh" — the escape hatch for
   * dependency-graph replay's known limit (state a cell changes OUTSIDE any
   * notebook-level variable it named, e.g. an RNG seed a helper function sets):
   * skips the cache entirely and re-runs every cell, ignoring what looks
   * unchanged. Defaults `true`, matching the server's own default. */
  async function saveDraft({
    execute,
    runUntil,
    reuseResults = true,
  }: {
    execute: boolean;
    runUntil?: string | null;
    reuseResults?: boolean;
  }) {
    const spec = version?.spec;
    if (!spec || draftCells === null || mutationPending.current) return;
    mutationPending.current = true;
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
          reuse_results: reuseResults,
        }),
      });
      const payload = (await response.json()) as unknown;
      if (openNotebookId.current !== notebookId) return;
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
      if (openNotebookId.current !== notebookId) return;
      setActionError(cause instanceof Error ? cause.message : copy.saveFailed);
    } finally {
      if (openNotebookId.current !== notebookId) return;
      mutationPending.current = false;
      setSaving(false);
    }
  }

  // ------------------------------------------------------------- per-cell editing
  //
  // Owner ruling ai-ops 375: every cell editable, addable, deletable and movable ON
  // ITS OWN, straight from the read view, with no page-level edit mode. Every change
  // below still goes through the exact same `POST .../versions` path `saveDraft`
  // above does — `saveCellsAsVersion` is that function's body, generalised to take
  // whatever cell array the caller already computed instead of `draftCells` — so a
  // per-cell change is a new version exactly like a bulk edit is, undoable from the
  // version picker the same way.

  /** Whether the cell currently open in the inline editor has anything unsaved. A
   * brand-new cell (`isNew`) is dirty once it has any text; an existing cell is dirty
   * when its draft source differs from the saved spec's. */
  function cellEditIsDirty(edit: NotebookCellEditState | null): boolean {
    if (!edit) return false;
    if (edit.isNew) return edit.source.trim() !== "";
    const saved = originalCells.find((item) => item.id === edit.cellId);
    return saved ? saved.source !== edit.source : edit.source !== "";
  }

  /** Runs `next` immediately, unless the inline editor currently open has unsaved
   * changes — then it confirms first (rule 1's "Opening a second one while the first
   * has unsaved changes asks first"). Shared by every way a new inline editor opens:
   * editing a different cell, or adding one. */
  function openCellEditor(next: () => void) {
    if (cellEditIsDirty(cellEdit) && !window.confirm(copy.ide.switchCellConfirm)) return;
    setActionError(null);
    next();
  }

  function startEditCell(cellId: string) {
    const cell = originalCells.find((item) => item.id === cellId);
    if (!cell) return;
    openCellEditor(() => setCellEdit({ cellId, kind: cell.kind, source: cell.source, isNew: false, insertAfterId: null }));
  }

  function startInsertCell(afterId: string, kind: Cell["kind"]) {
    openCellEditor(() =>
      setCellEdit({ cellId: nextCellId(originalCells), kind, source: "", isNew: true, insertAfterId: afterId }),
    );
  }

  function changeCellEditSource(source: string) {
    setCellEdit((current) => (current === null ? current : { ...current, source }));
  }

  function cancelCellEdit() {
    setCellEdit(null);
  }

  /** The body of `saveDraft` above, generalised: POST whatever cell array the caller
   * built, as a new version. Returns whether it succeeded, so a caller that opened an
   * inline editor knows whether to close it — a FAILED save must keep the cell's text
   * on screen (rule 4) rather than silently discard what the reader typed. */
  async function saveCellsAsVersion(
    nextCells: Cell[],
    { execute, runUntil }: { execute: boolean; runUntil?: string | null },
  ): Promise<boolean> {
    const spec = version?.spec;
    if (!spec || mutationPending.current) return false;
    mutationPending.current = true;
    setCellSaving(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: specWithCells(spec, nextCells),
          message: "",
          execute,
          run_until: runUntil ?? null,
        }),
      });
      const payload = (await response.json()) as unknown;
      if (openNotebookId.current !== notebookId) return false;
      if (!response.ok || !isRecord(payload) || !isRecord(payload.version)) {
        throw new Error(refusalSentence(payload) ?? copy.saveFailed);
      }
      const created = payload.version as unknown as NotebookVersionSummary;
      const runId = typeof payload.run_id === "string" ? payload.run_id : null;
      loadNotebook();
      loadVersions();
      loadTurns();
      if (runId) {
        authored.current = { runId, seq: created.seq };
        setFollowedRunId(runId);
      } else {
        setPinnedSeq(created.seq);
      }
      return true;
    } catch (cause) {
      if (openNotebookId.current !== notebookId) return false;
      setActionError(cause instanceof Error ? cause.message : copy.saveFailed);
      return false;
    } finally {
      // Not an early-`return` guard here, deliberately: a `return` inside `finally`
      // would override whatever `try`/`catch` above decided to hand back, which is
      // exactly the value `saveCellEdit` needs to know whether to close the editor.
      // The lock is always released; the state update is skipped if the reader has
      // since navigated to a different notebook.
      mutationPending.current = false;
      if (openNotebookId.current === notebookId) setCellSaving(false);
    }
  }

  /** "Save" / "Save & run to here" on the inline editor. Builds the final cell array
   * from the version's saved cells plus this one edit — an insert-then-set-source for
   * a new cell (composing `insertCellAfter` and `applyCellEdit` rather than adding a
   * third pure helper that would just call the other two), or a plain `applyCellEdit`
   * for an existing one. */
  async function saveCellEdit({ execute, runUntil }: { execute: boolean; runUntil?: string | null }) {
    if (!cellEdit) return;
    const nextCells = cellEdit.isNew
      ? (() => {
          const { cells: withInsert, id } = insertCellAfter(originalCells, cellEdit.insertAfterId, cellEdit.kind);
          return applyCellEdit(withInsert, id, { source: cellEdit.source });
        })()
      : applyCellEdit(originalCells, cellEdit.cellId, { source: cellEdit.source });
    const ok = await saveCellsAsVersion(nextCells, { execute, runUntil });
    // Only on success: a failed save keeps the editor open with what was typed (rule 4).
    if (ok) setCellEdit(null);
  }

  function deleteCellFromView(cellId: string) {
    if (!window.confirm(copy.ide.deleteCellConfirm)) return;
    void saveCellsAsVersion(deleteCell(originalCells, cellId), { execute: false });
  }

  function moveCellFromView(cellId: string, direction: "up" | "down") {
    void saveCellsAsVersion(moveCell(originalCells, cellId, direction), { execute: false });
  }

  function duplicateCellFromView(cellId: string) {
    const { cells: next } = duplicateCell(originalCells, cellId);
    void saveCellsAsVersion(next, { execute: false });
  }

  /** "Ask Nala to change this cell" (rule 3, "as well as by Nala"): starts a chat
   * message about the cell, the same shape `askNalaAbout` below does for "Ask Nala",
   * with its own prefix so the two read as different requests in the transcript. */
  function askNalaToChangeCell(cellId: string) {
    setMessage((current) => (current.trim() ? current : copy.ide.changeCellPrefix(cellId)));
    chatInputRef.current?.focus();
  }

  // Unsaved edits use native navigation so the browser's unload guard also
  // covers client-side links, including links in the surrounding sidebar.
  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function leaveThroughLink(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const target = new URL(link.href, window.location.href);
      if (target.origin !== window.location.origin || (target.pathname === window.location.pathname && target.search === window.location.search)) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(target.href);
    }
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", leaveThroughLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", leaveThroughLink, true);
    };
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
    if (action === "answerQuestion") {
      // No Nala fallback here, unlike `checkAttempt` below. A question cell reaches
      // this branch only because it HAS an answer prompt, and a prompt exists only
      // where the server holds a key — so there is no ungraded case to fall back for.
      void gradeAttempt(cellId, detail ?? "", "answer");
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

  /** "Ask Nala" on a cell: start a message about it rather than send one, so the
   * reader says what they want to know. A message already being typed is kept. */
  function askNalaAbout(cellId: string) {
    setMessage((current) => (current.trim() ? current : copy.ide.askNalaPrefix(cellId)));
    chatInputRef.current?.focus();
  }

  /** "Fix with Nala" on a cell that raised: a revise turn aimed at that cell alone,
   * carrying its traceback. "Explain this error" (`cellAction`) asks for an explanation
   * as well; this one only asks for the fix. */
  function fixWithNala(cellId: string) {
    const cell = cells.find((item) => item.id === cellId);
    void sendTurn(copy.ide.fixWithNalaTurn(cellId, errorTracebackText(cell?.error ?? null)));
  }

  /** From the editor, the Nala actions leave edit mode first: a turn revises the SAVED
   * version, so they are offered only when there are no unsaved edits to lose. */
  function leaveEditingThen(action: (cellId: string) => void): ((cellId: string) => void) | undefined {
    if (dirty) return undefined;
    return (cellId) => {
      stopEditing();
      action(cellId);
    };
  }

  /** Workspace-level, not per-cell: creates a NEW notebook seeded from this
   * one (worker-side resolution in `_seed_material_for`, `kind: "notebook"`)
   * and navigates to it once queued. */
  async function quizMe() {
    if (!notebook || mutationPending.current) return;
    mutationPending.current = true;
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
      if (openNotebookId.current !== notebookId) return;
      const newNotebookId =
        isRecord(payload) && isRecord(payload.notebook) && typeof payload.notebook.id === "string"
          ? payload.notebook.id
          : null;
      if (!response.ok || !newNotebookId) {
        throw new Error(refusalSentence(payload) ?? copy.quizButtonFailed);
      }
      router.push(`/notebooks/${encodeURIComponent(newNotebookId)}`);
    } catch (cause) {
      if (openNotebookId.current !== notebookId) return;
      setActionError(cause instanceof Error ? cause.message : copy.quizButtonFailed);
      mutationPending.current = false;
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
      if (openNotebookId.current !== notebookId) return;
      if (!response.ok || !isRecord(payload) || typeof payload.id !== "string") {
        throw new Error(refusalSentence(payload) ?? copy.titleEditFailed);
      }
      setNotebook(payload as unknown as Notebook);
      setEditingTitle(false);
    } catch (cause) {
      if (openNotebookId.current !== notebookId) return;
      setActionError(cause instanceof Error ? cause.message : copy.titleEditFailed);
    } finally {
      if (openNotebookId.current !== notebookId) return;
      setSavingTitle(false);
    }
  }

  /**
   * Download this version. `solutions` asks for the author's complete copy.
   *
   * The reader's copy of a challenge or a quiz is redacted — that is the point, and it
   * is decided on the server. But the author needs a way to get their own answer key
   * out of the product, and adding the redaction without adding this took a capability
   * away from the person who wrote the notebook: their download used to contain
   * everything and afterwards there was no route to it from the interface at all.
   */
  async function downloadVersion(solutions = false) {
    if (!notebook || !version || downloading) return;
    setDownloading(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/notebooks/${encodeURIComponent(notebookId)}/versions/${version.seq}/export` +
          (solutions ? "?build=solution" : ""),
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(copy.downloadFailed);
      const blob = await response.blob();
      download(
        blob,
        notebookExportFilename(
          solutions ? `${notebook.slug}-solutions` : notebook.slug,
          version.seq,
        ),
      );
    } catch (cause) {
      if (openNotebookId.current !== notebookId) return;
      setActionError(cause instanceof Error ? cause.message : copy.downloadFailed);
    } finally {
      if (openNotebookId.current !== notebookId) return;
      setDownloading(false);
    }
  }

  async function runAgain() {
    if (mutationPending.current || RUNNING_STATUSES.has(notebook?.latest_status ?? "")) return;
    mutationPending.current = true;
    setRerunning(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/run`, { method: "POST" });
      const payload = (await response.json()) as unknown;
      if (openNotebookId.current !== notebookId) return;
      if (!response.ok || !isRecord(payload)) {
        throw new Error(refusalSentence(payload) ?? copy.runAgainFailed);
      }
      const runId = typeof payload.run_id === "string" ? payload.run_id : null;
      loadNotebook();
      loadVersions();
      if (runId) setFollowedRunId(runId);
    } catch (cause) {
      if (openNotebookId.current !== notebookId) return;
      setActionError(cause instanceof Error ? cause.message : copy.runAgainFailed);
    } finally {
      if (openNotebookId.current !== notebookId) return;
      mutationPending.current = false;
      setRerunning(false);
    }
  }

  if (notebookError && !notebook) {
    return <div className="mj-notebook-workspace-empty mj-library-empty mj-notebooks-retry" role="alert"><strong>{notebookError}</strong><button type="button" className="mj-secondary-button" onClick={loadNotebook}>{locale === "ja" ? "再試行" : "Retry"}</button></div>;
  }
  if (!notebook || notebook.id !== notebookId) {
    return <div className="mj-notebook-workspace-empty mj-library-empty" role="status"><strong>{copy.loading}</strong></div>;
  }

  const pill = notebookStatusPill(notebook.latest_status);
  const isGenerating = RUNNING_STATUSES.has(notebook.latest_status);
  const cells = notebookCellViews(version?.spec?.cells, version?.report);
  const stages = notebookProgressFromEvents(progressEvents as NotebookProgressEvent[]);
  // Same `progressEvents` `useRunProgress` already collects — no second SSE
  // subscription. See `lib/notebook-live.ts` for why this reducer needs no
  // redaction of its own: the worker withholds a graded/solution-only cell's real
  // text before any event carrying it reaches this array.
  const liveState = liveNotebookFromEvents(progressEvents as LiveNotebookEvent[]);
  const mastery = notebookMastery(version?.spec?.cells, version?.report);
  const diff =
    compareMode && version?.spec && compareVersion?.spec
      ? diffNotebookVersions(compareVersion.spec, version.spec)
      : null;
  // Editing is offered only on the newest version, and only when nothing is running:
  // an edit is saved as the NEXT version, so branching from an older one would
  // silently discard everything after it, and `_assert_not_in_flight` would refuse a
  // save made while a run is going anyway — better not to offer the button.
  const latestSeq = versions.length > 0 ? Math.max(...versions.map((item) => item.seq)) : null;
  const canEdit =
    !isGenerating && !sending && !rerunning && !quizzing && !versionLoading &&
    version !== null &&
    version.status === "ready" &&
    version.spec !== null &&
    latestSeq !== null &&
    version.seq === latestSeq;

  return (
    <section className="mj-notebook-workspace">
      <Link className="mj-notebooks-back" href="/notebooks">{locale === "ja" ? "ノートブック一覧" : "All notebooks"}</Link>
      <header className="mj-notebook-workspace-header">
        <div className="mj-notebook-workspace-title">
          {editingTitle ? (
            <form className="mj-notebook-title-edit-form" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
              <input
                aria-label={locale === "ja" ? "ノートブック名" : "Notebook title"}
                onKeyDown={(event) => { if (event.key === "Escape" && !savingTitle) setEditingTitle(false); }}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                disabled={savingTitle}
                autoFocus
              />
              <button className="mj-secondary-button" type="submit" disabled={savingTitle || !titleDraft.trim()}>
                {savingTitle ? copy.saving : copy.saveTitle}
              </button>
              <button type="button" className="mj-secondary-button" disabled={savingTitle} onClick={() => setEditingTitle(false)}>{locale === "ja" ? "キャンセル" : "Cancel"}</button>
            </form>
          ) : (
            <h1>
              <button
                type="button"
                className="mj-notebook-title-edit"
                title={locale === "ja" ? "名前を変更" : "Rename"}
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
          {/* Who else in the workspace is looking at this notebook right now
              (proposal 9, second slice): about the notebook itself, not one
              version of it, the same reasoning the comments panel below uses. */}
          {isPresenceTrackableId(notebookId) ? (
            <PresenceBar targetType="notebook" targetId={notebookId} locale={locale} />
          ) : null}
          {versions.length > 0 ? (
            <label className="mj-notebook-version-picker mj-filter-select">
              <span className="sr-only">{copy.versionPickerLabel}</span>
              <select
                disabled={editing || saving || cellEdit !== null}
                value={selectedSeq ?? ""}
                onChange={(event) => setPinnedSeq(Number(event.target.value))}
              >
                {versions.map((item) => (
                  <option key={item.id} value={item.seq}>{copy.versionLabel(item.seq)}</option>
                ))}
              </select>
            </label>
          ) : null}
          {canEdit || editing ? (
            <button
              className="mj-primary-button"
              type="button"
              // Rule 2: a single-cell edit and the page-level bulk editor must not fight.
              // The other direction (bulk editing hides every per-cell button) is
              // automatic — the read view containing them is not even rendered while
              // `editing` is true, see the ternary around `NotebookView` below.
              disabled={saving || cellEdit !== null}
              onClick={() => (editing ? discardEdits() : startEditing())}
            >
              {editing ? copy.editExit : copy.edit}
            </button>
          ) : null}
          <details className="mj-notebooks-disclosure mj-notebook-toolbar-more">
            <summary>{locale === "ja" ? "その他の操作" : "More actions"}</summary>
            <div className="mj-notebook-toolbar-options">
          {earlierVersions.length > 0 ? (
            <>
              <button
                className="mj-secondary-button"
                type="button"
                disabled={editing || versionLoading}
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
          {isAuthorOfARedactedNotebook ? (
            <button
              className="mj-secondary-button"
              type="button"
              disabled={!version?.ipynb || downloading || versionLoading || editing}
              onClick={() => void downloadVersion(true)}
            >
              {downloading ? copy.creating : copy.downloadWithSolutions}
            </button>
          ) : null}
          <button
            className="mj-secondary-button"
            type="button"
            disabled={!version?.ipynb || downloading || versionLoading || editing}
            onClick={() => void downloadVersion()}
          >
            {downloading ? copy.creating : copy.download}
          </button>
          <button
            className="mj-secondary-button"
            type="button"
            disabled={rerunning || isGenerating || sending || quizzing || editing}
            onClick={() => void runAgain()}
          >
            {rerunning || isGenerating ? copy.running : copy.runAgain}
          </button>
          <button
            className="mj-secondary-button"
            type="button"
            disabled={quizzing || !version?.spec || versionLoading || sending || rerunning || isGenerating || editing}
            onClick={() => void quizMe()}
          >
            {quizzing ? copy.creating : copy.quizButtonLabel}
          </button>
          {isOwner ? <NotebookShareDialog notebookId={notebookId} locale={locale} /> : null}
            </div>
          </details>
        </div>
      </header>

      {notebookError || versionsError ? (
        <div className="mj-notebooks-retry" role="alert"><p>{notebookError ?? versionsError}</p><button type="button" className="mj-secondary-button" onClick={() => { loadNotebook(); loadVersions(); }}>{locale === "ja" ? "再試行" : "Retry"}</button></div>
      ) : null}
      {actionError ? <p role="alert" className="mj-notebook-workspace-error">{actionError}</p> : null}

      {isGenerating && stages.length > 0 ? (
        <section className="mj-notebook-progress" aria-label={copy.progressLabel}>
          <StageRail stages={stages.map((stage) => toRailStage(stage, copy.runAgainFailed))} />
        </section>
      ) : null}

      {/* The notebook developing in real time (plan 10-notebook-ide, "Live" lane):
          cell by cell as Nala writes it, then each cell's result, errors and
          repairs as they land. Placed once, right above the version body — for a
          fresh build there is no version yet to show, so this fills that gap; for
          a revise/rerun it sits above the CURRENT (still valid) version so the
          reader keeps seeing what they already had while the new one is written. */}
      {isGenerating ? (
        <NotebookLiveView state={liveState} locale={locale} framework={notebook.framework?.name ?? "qiskit"} />
      ) : null}

      <div className="mj-notebook-workspace-body">
        <section className="mj-notebook-workspace-notebook">
          {version?.status === "failed" ? (
            <div className="mj-notebook-version-failed" role="alert">
              <p><strong>{version.spec ? copy.versionFailedHeadline : copy.versionFailedNoCellsHeadline}</strong></p>
              {version.error ? <p>{version.error}</p> : null}
              <p>{version.spec ? copy.versionFailedHint : copy.versionFailedNoCellsHint}</p>
            </div>
          ) : null}
          {versionError ? <div className="mj-notebooks-retry" role="alert"><p>{versionError}</p><button type="button" className="mj-secondary-button" onClick={() => setVersionAttempt((current) => current + 1)}>{locale === "ja" ? "再試行" : "Retry"}</button></div> : null}
          {compareMode && compareError ? <div className="mj-notebooks-retry" role="alert"><p>{compareError}</p><button type="button" className="mj-secondary-button" onClick={() => setCompareAttempt((current) => current + 1)}>{locale === "ja" ? "再試行" : "Retry"}</button></div> : null}
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
                cellResults={cells}
                onRunAll={() => void saveDraft({ execute: true })}
                onSave={() => void saveDraft({ execute: false })}
                onDuplicate={duplicateDraftCell}
                onUndoStructural={undoDraftChange}
                onAskNala={leaveEditingThen(askNalaAbout)}
                onFixWithNala={leaveEditingThen(fixWithNala)}
                onExplainError={leaveEditingThen((cellId) => cellAction(cellId, "explainError"))}
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
                  title={copy.runEverythingFreshHint}
                  onClick={() => void saveDraft({ execute: true, reuseResults: false })}
                >
                  {copy.runEverythingFresh}
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
          ) : versionLoading || (!version && selectedSeq !== null && !versionError) ? (
            <p className="mj-notebook-workspace-empty-notebook" role="status">{copy.loading}</p>
          ) : compareMode && effectiveCompareSeq !== null ? (
            diff && version?.spec && compareVersion?.spec ? (
              <NotebookDiffView diff={diff} older={compareVersion.spec} newer={version.spec} locale={locale} />
            ) : (
              <p className="mj-notebook-workspace-empty-notebook" role="status">{compareError ? "" : copy.diffLoading}</p>
            )
          ) : version ? (
            <>
            {gradeSummaryStrip}
            <NotebookView
              key={`${notebookId}:${version.seq}`}
              busy={sending || isGenerating || rerunning || quizzing || cellSaving}
              cells={cells}
              locale={locale}
              framework={notebook.framework?.name ?? "qiskit"}
              onCellAction={cellAction}
              onRunAll={() => void runAgain()}
              // "Run everything fresh" (round 2 of the adversarial review): a
              // reader viewing results, not editing, needs the SAME cache
              // bypass the edit bar offers — `runAgain()` already sends a
              // plain rerun job, which never reuses a cell's result at all
              // (the `kind="rerun"` path is unaffected by dependency-graph
              // replay), so reusing it here is exact, not an approximation.
              onRunEverythingFresh={() => void runAgain()}
              onAskNala={askNalaAbout}
              onFixWithNala={fixWithNala}
              grades={grades}
              gradingCellIds={gradingCellIds}
              hardware={{ notebookId, seq: version.seq }}
              // Per-cell editing (rule 1 of the lane brief): offered under exactly the
              // conditions the page-level Edit button uses — `canEdit`, defined above —
              // so a share view, an older version, or a notebook mid-run shows none of
              // this, the same "only render what a caller wires" rule every other
              // optional callback on this component already follows.
              cellEdit={canEdit ? cellEdit : null}
              onStartEditCell={canEdit ? startEditCell : undefined}
              onStartInsertCell={canEdit ? startInsertCell : undefined}
              onChangeCellEditSource={canEdit ? changeCellEditSource : undefined}
              onSaveCellEdit={canEdit ? (options) => void saveCellEdit(options) : undefined}
              onCancelCellEdit={canEdit ? cancelCellEdit : undefined}
              onMoveCell={canEdit ? moveCellFromView : undefined}
              onDeleteCell={canEdit ? deleteCellFromView : undefined}
              onDuplicateCell={canEdit ? duplicateCellFromView : undefined}
              onAskNalaToChangeCell={askNalaToChangeCell}
            />
            </>
          ) : !isGenerating && !versionError ? (
            <p className="mj-notebook-workspace-empty-notebook">{locale === "ja" ? "ノートブックを準備しています。" : "Your notebook is being prepared."}</p>
          ) : null}
          {!editing && version?.warnings && version.warnings.length > 0 ? (
            <details className="mj-notebook-structure-notes mj-notebooks-disclosure">
              <summary>{copy.structureNotesLabel}</summary>
              <p className="mj-notebook-structure-notes-hint">{copy.structureNotesHint}</p>
              <ul>
                {version.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {!compareMode && version ? <NotebookReviewPanel review={version.review} locale={locale} /> : null}
          {/* The workspace's comments on this notebook (proposal 9): about the
              notebook itself, not one version of it, so they stay put when a
              revision lands. */}
          {isCommentableId(notebookId) ? (
            <CommentsPanel targetType="notebook" targetId={notebookId} locale={locale} />
          ) : null}
        </section>

        <aside className="mj-notebook-workspace-chat" aria-label={copy.chatLabel}>
          <h2>{copy.chatLabel}</h2>
          {turnsError ? <div className="mj-notebooks-retry" role="alert"><p>{turnsError}</p><button type="button" className="mj-secondary-button" onClick={loadTurns}>{locale === "ja" ? "再試行" : "Retry"}</button></div> : null}
          {turnsLoading && turns.length === 0 ? <p className="mj-notebook-chat-empty" role="status">{copy.loading}</p> : null}
          {!turnsLoading && !turnsError && turns.length === 0 ? <p className="mj-notebook-chat-empty">{copy.chatEmpty}</p> : null}
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
                ref={chatInputRef}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={copy.chatPlaceholder}
                rows={2}
              />
            </label>
            <button className="mj-primary-button" type="submit" disabled={sending || isGenerating || saving || rerunning || quizzing || editing || cellEdit !== null || !message.trim()}>
              {sending ? copy.chatSending : copy.chatSend}
            </button>
          </form>
        </aside>
      </div>
    </section>
  );
}
