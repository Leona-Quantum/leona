"use client";

import { StageRail, type RailStage } from "@majorana/ui";
import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "../../../../../components/icons";
import { ChatMarkdown } from "../../../../../components/chat-markdown";
import { refusalSentence } from "../../../../../lib/api-error";
import {
  courseModuleStatusPill,
  courseProgress,
  mapModuleRunIds,
  resolveGenerateTargets,
  resolvePrerequisiteLinks,
} from "../../../../../lib/course-progress";
import type {
  Course,
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

  const reloadSeq = useRef(0);

  function loadCourse() {
    const seq = ++reloadSeq.current;
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
        setTitleDraft((current) => (editingTitle ? current : loaded.title));
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
    fetch(`/api/courses/${encodeURIComponent(courseId)}/turns`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || !Array.isArray(payload.items)) {
          throw new Error(refusalSentence(payload) ?? coursesCopy.chatLoadFailed);
        }
        setTurns(payload.items as CourseTurn[]);
        setTurnsError(null);
      })
      .catch((cause) => {
        setTurnsError(cause instanceof Error ? cause.message : coursesCopy.chatLoadFailed);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- courseId change is a hard reset; copy.* are stable strings for the active locale
  useEffect(() => {
    setCourse(null);
    setCourseError(null);
    setTurns([]);
    setFollowedPlanRunId(null);
    setPlanRunActive(false);
    setModuleRunIds({});
    loadCourse();
    loadTurns();
  }, [courseId]);

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
      setMessage("");
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
    return <div className="mj-course-workspace-empty mj-library-empty" role="alert"><strong>{courseError}</strong></div>;
  }
  if (!course) {
    return <div className="mj-course-workspace-empty mj-library-empty" role="status"><strong>{coursesCopy.loading}</strong></div>;
  }

  const progress = courseProgress(course);
  const orderedModules = [...course.modules].sort((a, b) => a.seq - b.seq);
  const generateAllDisabled = generatingAll || planRunActive || progress.ready === progress.total;

  return (
    <main className="mj-course-workspace">
      <header className="mj-course-workspace-header">
        <div className="mj-course-workspace-title">
          {editingTitle ? (
            <form className="mj-notebook-title-edit-form" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
              <input
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
            <div className="mj-course-progress-bar" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
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

      {courseError ? <p role="alert" className="mj-notebook-workspace-error">{courseError}</p> : null}
      {actionError ? <p role="alert" className="mj-notebook-workspace-error">{actionError}</p> : null}

      {planRunActive && planStages.length > 0 ? (
        <section className="mj-notebook-progress" aria-label={coursesCopy.progressLabel}>
          <StageRail stages={planStages.map((stage) => toRailStage(stage, coursesCopy.generateAllFailed))} />
        </section>
      ) : null}

      <div className="mj-course-workspace-body">
        <section className="mj-course-module-list">
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
            />
          ))}
        </section>

        <aside className="mj-notebook-workspace-chat" aria-label={coursesCopy.chatLabel}>
          <h2>{coursesCopy.chatLabel}</h2>
          {turnsError ? <p role="alert">{turnsError}</p> : null}
          {turns.length === 0 ? <p className="mj-notebook-chat-empty">{coursesCopy.chatEmpty}</p> : null}
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
    </main>
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
    </article>
  );
}
