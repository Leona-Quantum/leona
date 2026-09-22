"use client";

import { StageRail, type RailStage } from "@majorana/ui";
import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "../../../../../components/icons";
import { ChatMarkdown } from "../../../../../components/chat-markdown";
import { refusalSentence } from "../../../../../lib/api-error";
import {
  dueDateChanged,
  dueDateFromInput,
  dueDateInputValue,
  dueDatePatchBody,
  formatDueDate,
  moduleOverdue,
  ownGradebookRow,
  saveResponseApplies,
  viewerCreatedCourse,
} from "../../../../../lib/course-due-dates";
import { courseHasGradableNotebook } from "../../../../../lib/course-gradebook";
import {
  courseModuleStatusPill,
  courseProgress,
  mapModuleRunIds,
  resolveGenerateTargets,
  resolvePrerequisiteLinks,
} from "../../../../../lib/course-progress";
import type {
  Course,
  CourseGradebook as CourseGradebookData,
  CourseModule,
  CourseTurn,
  CreateCourseTurnResponse,
  GenerateCourseResponse,
} from "../../../../../lib/course-types";
import {
  notebookProgressFromEvents,
  type NotebookProgressEvent,
  type NotebookProgressStage,
} from "../../../../../lib/notebook-progress";
import type { PublicLocale } from "../../../../../lib/public-locale";
import { useRunProgress } from "../../../../../lib/use-run-progress";
import { WORKSPACE_COPY } from "../../../../../lib/workspace-locale";
import { CourseGradebook } from "./course-gradebook";

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

export function CourseWorkspace({ courseId, locale = "en" }: { courseId: string; locale?: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale];
  const coursesCopy = copy.courses;

  const [course, setCourse] = useState<Course | null>(null);
  const [courseError, setCourseError] = useState<string | null>(null);
  const [turns, setTurns] = useState<CourseTurn[]>([]);
  const [turnsError, setTurnsError] = useState<string | null>(null);
  const [turnsLoading, setTurnsLoading] = useState(true);

  const [followedPlanRunId, setFollowedPlanRunId] = useState<string | null>(null);
  const [planRunActive, setPlanRunActive] = useState(false);
  const [moduleRunIds, setModuleRunIds] = useState<Record<string, string>>({});

  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [downloading, setDownloading] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingModuleId, setGeneratingModuleId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [savingDueModuleId, setSavingDueModuleId] = useState<string | null>(null);

  //: Who is looking, from `/api/me`, compared against `course.owner_user_id` to decide
  //: whether to offer the due-date controls. `null` until it answers, so the controls
  //: appear a moment late rather than appear for a member and then 403 on save.
  const [viewerId, setViewerId] = useState<string | null>(null);
  //: The gradebook as `CourseGradebook` last loaded it. A member's copy is their own
  //: row, which is where "overdue" comes from; the course page never works it out
  //: from the browser's clock.
  const [gradebook, setGradebook] = useState<CourseGradebookData | null>(null);
  //: Bumped after a due date is saved, so the gradebook re-reads late and missing.
  const [gradebookRefresh, setGradebookRefresh] = useState(0);

  const reloadSeq = useRef(0);
  const turnsSeq = useRef(0);
  //: The course on screen NOW, readable from a save that was started for an earlier
  //: one. `courseId` itself is captured per render, so inside a stale callback it is
  //: still the old id and cannot tell the two apart.
  const openCourseId = useRef(courseId);
  openCourseId.current = courseId;
  //: The due-date save in flight, aborted when the reader moves to another course.
  const dueSaveAbort = useRef<AbortController | null>(null);
  const titleEditing = useRef(false);
  titleEditing.current = editingTitle;

  function loadCourse() {
    const seq = ++reloadSeq.current;
    setCourseError(null);
    fetch(`/api/courses/${encodeURIComponent(courseId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || typeof payload.id !== "string") {
          throw new Error(refusalSentence(payload) ?? coursesCopy.loadFailed);
        }
        return payload as unknown as Course;
      })
      .then((loaded) => {
        if (seq !== reloadSeq.current) return;
        setCourse(loaded);
        setCourseError(null);
        setTitleDraft((current) => (titleEditing.current ? current : loaded.title));
        if (loaded.status === "planning" && loaded.plan_run_id) {
          setFollowedPlanRunId(loaded.plan_run_id);
          setPlanRunActive(true);
        }
      })
      .catch((cause) => {
        if (seq !== reloadSeq.current) return;
        setCourseError(cause instanceof Error ? cause.message : coursesCopy.loadFailed);
      });
  }

  function loadTurns() {
    const seq = ++turnsSeq.current;
    setTurnsLoading(true);
    setTurnsError(null);
    fetch(`/api/courses/${encodeURIComponent(courseId)}/turns`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || !Array.isArray(payload.items)) {
          throw new Error(refusalSentence(payload) ?? coursesCopy.chatLoadFailed);
        }
        if (seq !== turnsSeq.current) return;
        setTurns(payload.items as CourseTurn[]);
        setTurnsError(null);
      })
      .catch((cause) => {
        if (seq === turnsSeq.current) setTurnsError(cause instanceof Error ? cause.message : coursesCopy.chatLoadFailed);
      })
      .finally(() => { if (seq === turnsSeq.current) setTurnsLoading(false); });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- courseId change is a hard reset; copy.* are stable strings for the active locale
  useEffect(() => {
    setCourse(null);
    setCourseError(null);
    setTurns([]);
    setTurnsError(null);
    setActionError(null);
    setEditingTitle(false);
    setMessage("");
    setFollowedPlanRunId(null);
    setPlanRunActive(false);
    setModuleRunIds({});
    setGradebook(null);
    dueSaveAbort.current?.abort();
    dueSaveAbort.current = null;
    setSavingDueModuleId(null);
    loadCourse();
    loadTurns();
    return () => { reloadSeq.current += 1; turnsSeq.current += 1; };
  }, [courseId]);

  useEffect(() => {
    let active = true;
    void fetch("/api/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (!active || !isRecord(payload)) return;
        if (typeof payload.user_id === "string") setViewerId(payload.user_id);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const planEvents = useRunProgress(followedPlanRunId, () => {
    setPlanRunActive(false);
    loadCourse();
    loadTurns();
  });
  const planStages = notebookProgressFromEvents(planEvents as NotebookProgressEvent[]);

  async function sendTurn(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending || planRunActive) return;
    setSending(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = (await response.json()) as CreateCourseTurnResponse | Record<string, unknown>;
      if (!response.ok || !isRecord(payload) || !isRecord(payload.turn)) {
        throw new Error(refusalSentence(payload) ?? coursesCopy.chatSendFailed);
      }
      const runId = typeof payload.run_id === "string" ? payload.run_id : null;
      loadTurns();
      loadCourse();
      if (runId) {
        setFollowedPlanRunId(runId);
        setPlanRunActive(true);
      }
      setMessage((current) => current.trim() === trimmed ? "" : current);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : coursesCopy.chatSendFailed);
    } finally {
      setSending(false);
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendTurn(message);
  }

  async function saveTitle() {
    if (!course || savingTitle) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === course.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRecord(payload) || typeof payload.id !== "string") {
        throw new Error(refusalSentence(payload) ?? coursesCopy.titleEditFailed);
      }
      setCourse(payload as unknown as Course);
      setEditingTitle(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : coursesCopy.titleEditFailed);
    } finally {
      setSavingTitle(false);
    }
  }

  async function generate(moduleIds: string[] | null, targets: CourseModule[]) {
    setActionError(null);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module_ids: moduleIds }),
      });
      const payload = (await response.json()) as GenerateCourseResponse | Record<string, unknown>;
      if (!response.ok || !isRecord(payload) || !isRecord(payload.course)) {
        throw new Error(refusalSentence(payload) ?? coursesCopy.generateAllFailed);
      }
      const runIds = Array.isArray(payload.run_ids)
        ? payload.run_ids.filter((item): item is string => typeof item === "string")
        : [];
      setModuleRunIds((current) => ({ ...current, ...mapModuleRunIds(targets, runIds) }));
      setCourse(payload.course as unknown as Course);
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : coursesCopy.generateAllFailed);
      return false;
    }
  }

  async function generateAll() {
    if (!course || generatingAll) return;
    setGeneratingAll(true);
    await generate(null, resolveGenerateTargets(course.modules ?? [], null));
    setGeneratingAll(false);
  }

  async function generateModule(moduleId: string) {
    if (!course || generatingModuleId) return;
    setGeneratingModuleId(moduleId);
    await generate([moduleId], resolveGenerateTargets(course.modules ?? [], [moduleId]));
    setGeneratingModuleId(null);
  }

  async function moveModule(moduleId: string, direction: -1 | 1) {
    if (!course || reordering) return;
    const ordered = [...(course.modules ?? [])].sort((a, b) => a.seq - b.seq);
    const index = ordered.findIndex((candidate) => candidate.id === moduleId);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return;
    const a = ordered[index];
    const b = ordered[swapIndex];
    setReordering(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: [{ id: a.id, seq: b.seq }, { id: b.id, seq: a.seq }] }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRecord(payload) || typeof payload.id !== "string") {
        throw new Error(refusalSentence(payload) ?? coursesCopy.reorderFailed);
      }
      setCourse(payload as unknown as Course);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : coursesCopy.reorderFailed);
    } finally {
      setReordering(false);
    }
  }

  async function saveDueDate(moduleId: string, dueAt: string | null) {
    if (!course || savingDueModuleId) return;
    // A save answers for the course it was started on. If the reader has moved to
    // another course by the time it returns, writing its response into state would
    // put the OLD course on screen under the new id, and the page would sit on
    // "Loading course…" for good (review on PR 969). So the request is aborted when
    // the course changes, and a response that still gets through is dropped.
    const requested = courseId;
    const controller = new AbortController();
    dueSaveAbort.current = controller;
    setSavingDueModuleId(moduleId);
    setActionError(null);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(requested)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dueDatePatchBody(moduleId, dueAt)),
        signal: controller.signal,
      });
      const payload = (await response.json()) as unknown;
      if (!saveResponseApplies(requested, openCourseId.current, null)) return;
      if (!response.ok || !isRecord(payload) || typeof payload.id !== "string") {
        throw new Error(refusalSentence(payload) ?? coursesCopy.dueDateSaveFailed);
      }
      if (!saveResponseApplies(requested, openCourseId.current, payload.id)) return;
      setCourse(payload as unknown as Course);
      setGradebookRefresh((current) => current + 1);
    } catch (cause) {
      if (controller.signal.aborted || !saveResponseApplies(requested, openCourseId.current, null)) return;
      setActionError(cause instanceof Error ? cause.message : coursesCopy.dueDateSaveFailed);
    } finally {
      if (dueSaveAbort.current === controller) dueSaveAbort.current = null;
      // The course change already cleared this; clearing it again here would end the
      // "Saving…" state of a save started on the new course.
      if (saveResponseApplies(requested, openCourseId.current, null)) setSavingDueModuleId(null);
    }
  }

  async function downloadRepo() {
    if (!course || downloading || course.status !== "ready") return;
    setDownloading(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/export`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(refusalSentence(payload) ?? coursesCopy.downloadRepoFailed);
      }
      const blob = await response.blob();
      download(blob, `${course.slug}.zip`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : coursesCopy.downloadRepoFailed);
    } finally {
      setDownloading(false);
    }
  }

  if (courseError && !course) {
    return <div className="mj-course-workspace-empty mj-library-empty mj-notebooks-retry" role="alert"><strong>{courseError}</strong><button type="button" className="mj-secondary-button" onClick={loadCourse}>{locale === "ja" ? "再試行" : "Retry"}</button></div>;
  }
  if (!course || course.id !== courseId) {
    return <div className="mj-course-workspace-empty mj-library-empty" role="status"><strong>{coursesCopy.loading}</strong></div>;
  }

  const progress = courseProgress(course);
  const orderedModules = [...(course.modules ?? [])].sort((a, b) => a.seq - b.seq);
  const isCreator = viewerCreatedCourse(course, viewerId);
  const ownRow = ownGradebookRow(gradebook);
  const generateAllDisabled = generatingAll || planRunActive || progress.ready === progress.total;

  return (
    <section className="mj-course-workspace">
      <Link className="mj-notebooks-back" href="/notebooks/courses">{locale === "ja" ? "コース一覧" : "All courses"}</Link>
      <header className="mj-course-workspace-header">
        <div className="mj-course-workspace-title">
          {editingTitle ? (
            <form className="mj-notebook-title-edit-form" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
              <input
                aria-label={coursesCopy.saveTitle}
                onKeyDown={(event) => { if (event.key === "Escape") setEditingTitle(false); }}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                disabled={savingTitle}
                autoFocus
              />
              <button className="mj-secondary-button" type="submit" disabled={savingTitle}>
                {savingTitle ? coursesCopy.creating : coursesCopy.saveTitle}
              </button>
            </form>
          ) : (
            <h1>
              <button
                type="button"
                className="mj-notebook-title-edit"
                onClick={() => { setTitleDraft(course.title); setEditingTitle(true); }}
              >
                {course.title}
              </button>
            </h1>
          )}
          {course.summary ? <p className="mj-course-workspace-summary">{course.summary}</p> : null}
          <div className="mj-course-workspace-meta">
            <span className={`mj-course-status-pill mj-course-status-pill--${course.status}`}>{coursesCopy.statusPill[course.status]}</span>
            <div className="mj-course-progress-bar" role="progressbar" aria-label={course.title} aria-valuetext={coursesCopy.progress(progress.ready, progress.total)} aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${progress.percent}%` }} />
            </div>
            <span className="mj-mono-muted">{coursesCopy.progress(progress.ready, progress.total)}</span>
          </div>
        </div>
        <div className="mj-course-workspace-actions">
          <button
            className="mj-secondary-button"
            type="button"
            disabled={generateAllDisabled}
            onClick={() => void generateAll()}
          >
            {generatingAll ? coursesCopy.generatingAll : coursesCopy.generateAll}
          </button>
          <button
            className="mj-secondary-button"
            type="button"
            disabled={course.status !== "ready" || downloading}
            title={course.status !== "ready" ? coursesCopy.downloadRepoDisabledHint : undefined}
            onClick={() => void downloadRepo()}
          >
            {downloading ? coursesCopy.downloadingRepo : coursesCopy.downloadRepo}
          </button>
        </div>
      </header>

      {courseError ? <div className="mj-notebooks-retry" role="alert"><p>{courseError}</p><button type="button" className="mj-secondary-button" onClick={loadCourse}>{locale === "ja" ? "再試行" : "Retry"}</button></div> : null}
      {actionError ? <p role="alert" className="mj-notebook-workspace-error">{actionError}</p> : null}

      {planRunActive && planStages.length > 0 ? (
        <section className="mj-notebook-progress" aria-label={coursesCopy.progressLabel}>
          <StageRail stages={planStages.map((stage) => toRailStage(stage, coursesCopy.generateAllFailed))} />
        </section>
      ) : null}

      <div className="mj-course-workspace-body">
        <section className="mj-course-module-list">
          {!orderedModules.length && !planRunActive ? <p className="mj-notebook-chat-empty">{locale === "ja" ? "Nalaに学習内容を伝えて、コースを計画しましょう。" : "Tell Nala what you want to learn to plan your course."}</p> : null}
          {orderedModules.map((module, index) => (
            <CourseModuleCard
              key={module.id}
              module={module}
              modules={course.modules ?? []}
              locale={locale}
              runId={moduleRunIds[module.id] ?? null}
              generating={generatingModuleId === module.id}
              reordering={reordering}
              canMoveUp={index > 0}
              canMoveDown={index < orderedModules.length - 1}
              onGenerate={() => void generateModule(module.id)}
              onMoveUp={() => void moveModule(module.id, -1)}
              onMoveDown={() => void moveModule(module.id, 1)}
              onRunTerminal={loadCourse}
              canSetDueDate={isCreator}
              overdue={moduleOverdue(ownRow, module.id)}
              savingDueDate={savingDueModuleId === module.id}
              onSaveDueDate={(dueAt) => void saveDueDate(module.id, dueAt)}
            />
          ))}
        </section>

        <aside className="mj-notebook-workspace-chat" aria-label={coursesCopy.chatLabel}>
          <h2>{coursesCopy.chatLabel}</h2>
          {turnsError ? <div className="mj-notebooks-retry" role="alert"><p>{turnsError}</p><button type="button" className="mj-secondary-button" onClick={loadTurns}>{locale === "ja" ? "再試行" : "Retry"}</button></div> : null}
          {turnsLoading && turns.length === 0 ? <p className="mj-notebook-chat-empty" role="status">{coursesCopy.loading}</p> : null}
          {!turnsLoading && !turnsError && turns.length === 0 ? <p className="mj-notebook-chat-empty">{coursesCopy.chatEmpty}</p> : null}
          <div className="mj-chat-thread mj-notebook-chat-thread">
            {turns.map((turn) => (
              <div key={turn.id} className="mj-chat-turn">
                <div className={`mj-chat-message ${turn.role === "user" ? "mj-chat-message--user" : "mj-chat-message--assistant"}`}>
                  {turn.role === "nala" ? <ChatMarkdown source={turn.content} /> : <p>{turn.content}</p>}
                </div>
              </div>
            ))}
          </div>
          {planRunActive ? <p className="mj-notebook-chat-progress" role="status">{coursesCopy.progressLabel}</p> : null}
          <form className="mj-notebook-chat-composer" onSubmit={submitMessage}>
            <label>
              <span className="sr-only">{coursesCopy.chatLabel}</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={coursesCopy.chatPlaceholder}
                rows={2}
                disabled={planRunActive}
              />
            </label>
            <button className="mj-primary-button" type="submit" disabled={sending || planRunActive || !message.trim()}>
              {sending ? coursesCopy.chatSending : coursesCopy.chatSend}
            </button>
          </form>
        </aside>
      </div>

      {/* Only once a module has a notebook: before that there is nothing anyone
          could have been graded on, and an empty gradebook under a plan that is
          still being written reads as a failure rather than as "not yet". */}
      {courseHasGradableNotebook(course.modules ?? []) ? (
        <CourseGradebook
          courseId={course.id}
          courseSlug={course.slug}
          locale={locale}
          refreshKey={gradebookRefresh}
          onLoaded={setGradebook}
        />
      ) : null}
    </section>
  );
}

/**
 * Exported (unlike the notebook workspace's helpers) so
 * `tests/forms/course-workspace.test.tsx` can render the module list without
 * stubbing the fetch calls the rest of `CourseWorkspace` makes — passing
 * `runId={null}` here makes `useRunProgress` a no-op, so the card renders as
 * pure presentation from a `CourseModule` fixture alone.
 */
export function CourseModuleCard({
  module,
  modules,
  locale,
  runId,
  generating,
  reordering,
  canMoveUp,
  canMoveDown,
  onGenerate,
  onMoveUp,
  onMoveDown,
  onRunTerminal,
  canSetDueDate = false,
  overdue = false,
  savingDueDate = false,
  onSaveDueDate,
}: {
  module: CourseModule;
  modules: CourseModule[];
  locale: PublicLocale;
  runId: string | null;
  generating: boolean;
  reordering: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onGenerate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRunTerminal: () => void;
  /** The viewer created the course, so they may set this module's due date. */
  canSetDueDate?: boolean;
  /** Past due with no graded attempt from the viewer (their own gradebook row says so). */
  overdue?: boolean;
  savingDueDate?: boolean;
  /** Called with the instant in UTC, or `null` to clear the due date. */
  onSaveDueDate?: (dueAt: string | null) => void;
}) {
  const copy = WORKSPACE_COPY[locale];
  const coursesCopy = copy.courses;
  const events = useRunProgress(runId, onRunTerminal);
  const stages = notebookProgressFromEvents(events as NotebookProgressEvent[]);
  const pill = courseModuleStatusPill(module.status);
  const prerequisites = resolvePrerequisiteLinks(modules, module);
  const showRail = Boolean(runId) && (module.status === "queued" || module.status === "running") && stages.length > 0;
  const canReorder = module.status === "planned";

  return (
    <article className="mj-course-module-card" id={`course-module-${module.slug}`}>
      <div className="mj-course-module-head">
        <span className="mj-mono-muted">{coursesCopy.moduleSeqLabel(module.seq)}</span>
        <span className="mj-notebook-kind-badge">{copy.notebooks.kindOption[module.kind]}</span>
        <span className={`mj-course-status-pill mj-course-status-pill--${pill}`}>{coursesCopy.moduleStatusPill[pill]}</span>
        <div className="mj-course-module-reorder">
          <button
            type="button"
            className="mj-course-reorder-button"
            aria-label={coursesCopy.moveUp}
            disabled={!canMoveUp || !canReorder || reordering}
            onClick={onMoveUp}
          >
            <ChevronIcon size={14} style={{ transform: "rotate(-90deg)" }} />
          </button>
          <button
            type="button"
            className="mj-course-reorder-button"
            aria-label={coursesCopy.moveDown}
            disabled={!canMoveDown || !canReorder || reordering}
            onClick={onMoveDown}
          >
            <ChevronIcon size={14} style={{ transform: "rotate(90deg)" }} />
          </button>
        </div>
      </div>

      <h3 className="mj-course-module-title">{module.title}</h3>
      {module.due_at ? (
        <p className="mj-course-module-due">
          <time dateTime={module.due_at}>{coursesCopy.dueLabel(formatDueDate(module.due_at, locale))}</time>
          {overdue ? (
            <span className="mj-course-due-overdue">{coursesCopy.dueOverdue}</span>
          ) : null}
        </p>
      ) : null}
      <p className="mj-course-module-topic">{coursesCopy.topicLabel}: {module.topic}</p>

      {(module.key_concepts ?? []).length > 0 ? (
        <div className="mj-course-module-concepts">
          {(module.key_concepts ?? []).map((concept) => (
            <span key={concept} className="mj-course-concept-chip">{concept}</span>
          ))}
        </div>
      ) : null}

      {(module.objectives ?? []).length > 0 ? (
        <div>
          <span className="mj-section-label">{coursesCopy.objectivesLabel}</span>
          <ul className="mj-course-module-objectives">
            {(module.objectives ?? []).map((objective, index) => (
              <li key={index}>{objective}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mj-mono-muted">{coursesCopy.deliverableLabel}: {module.deliverable}</p>
      <p className="mj-mono-muted">
        {module.duration_minutes ? coursesCopy.durationLabel(module.duration_minutes) : coursesCopy.durationUnknown}
      </p>

      {prerequisites.length > 0 ? (
        <div className="mj-course-module-prereqs">
          <span className="mj-section-label">{coursesCopy.prerequisitesLabel}</span>
          <ul>
            {prerequisites.map((link) => (
              <li key={link.slug}>
                {link.module ? (
                  <a href={`#course-module-${link.module.slug}`}>{link.module.title}</a>
                ) : (
                  coursesCopy.prerequisiteUnresolved(link.slug)
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showRail ? (
        <div className="mj-course-module-progress">
          <StageRail stages={stages.map((stage) => toRailStage(stage, coursesCopy.generateModuleFailed))} />
        </div>
      ) : null}

      <div className="mj-course-module-actions">
        {module.notebook_id ? (
          <Link className="mj-secondary-button" href={`/notebooks/${encodeURIComponent(module.notebook_id)}`}>
            {coursesCopy.openNotebook}
          </Link>
        ) : module.status === "planned" ? (
          <button type="button" className="mj-secondary-button" disabled={generating} onClick={onGenerate}>
            {generating ? coursesCopy.generatingModule : coursesCopy.generateModule}
          </button>
        ) : null}
      </div>

      {canSetDueDate && onSaveDueDate ? (
        <DueDateEditor module={module} locale={locale} saving={savingDueDate} onSave={onSaveDueDate} />
      ) : null}
    </article>
  );
}

/**
 * The creator's due-date control on one module card: a `datetime-local` input in
 * the viewer's own zone, a save, and a remove once one is set. What is sent is the
 * instant in UTC (`dueDateFromInput`); what comes back replaces the draft.
 */
function DueDateEditor({
  module,
  locale,
  saving,
  onSave,
}: {
  module: CourseModule;
  locale: PublicLocale;
  saving: boolean;
  onSave: (dueAt: string | null) => void;
}) {
  const coursesCopy = WORKSPACE_COPY[locale].courses;
  const stored = module.due_at ?? null;
  const [draft, setDraft] = useState(() => dueDateInputValue(stored));
  // A saved (or cleared) value arriving from the server replaces the draft; an
  // unrelated re-render of the card does not.
  useEffect(() => {
    setDraft(dueDateInputValue(stored));
  }, [stored]);
  const inputId = `course-module-due-${module.id}`;
  const hintId = `${inputId}-hint`;

  return (
    <form
      className="mj-course-due-form"
      onSubmit={(event) => {
        event.preventDefault();
        const next = dueDateFromInput(draft);
        if (next && dueDateChanged(draft, stored)) onSave(next);
      }}
    >
      <label htmlFor={inputId} className="mj-section-label">{coursesCopy.dueDateLabel}</label>
      <div className="mj-course-due-controls">
        <input
          id={inputId}
          type="datetime-local"
          value={draft}
          aria-describedby={hintId}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="mj-secondary-button" type="submit" disabled={saving || !dueDateChanged(draft, stored)}>
          {saving ? coursesCopy.savingDueDate : coursesCopy.saveDueDate}
        </button>
        {stored ? (
          <button className="mj-secondary-button" type="button" disabled={saving} onClick={() => onSave(null)}>
            {coursesCopy.clearDueDate}
          </button>
        ) : null}
      </div>
      <p id={hintId} className="mj-course-due-hint">{coursesCopy.dueDateHint}</p>
    </form>
  );
}
