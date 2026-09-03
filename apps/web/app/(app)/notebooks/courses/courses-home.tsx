"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { SearchIcon } from "../../../../components/icons";
import { refusalSentence } from "../../../../lib/api-error";
import { courseProgress } from "../../../../lib/course-progress";
import type {
  CourseList,
  CourseSummary,
  CourseTemplates,
  CreateCourseRequest,
  CreateCourseResponse,
  NotebookStarter,
} from "../../../../lib/course-types";
import type { PublicLocale } from "../../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../../lib/workspace-locale";

type AudienceLevel = "newcomer" | "engineer" | "student" | "researcher";
type MathLevel = "none" | "minimal" | "full";
type ModuleCountChoice = "auto" | "4" | "8" | "12";

const LEVEL_OPTIONS: AudienceLevel[] = ["newcomer", "engineer", "student", "researcher"];
const MATH_OPTIONS: MathLevel[] = ["none", "minimal", "full"];
const LANGUAGE_OPTIONS: Array<"en" | "ja"> = ["en", "ja"];
const MODULE_COUNT_OPTIONS: ModuleCountChoice[] = ["auto", "4", "8", "12"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The one field this page reads off a create response: the new course's id. */
function createdCourseId(payload: CreateCourseResponse | Record<string, unknown> | null): string | null {
  if (!payload || !isRecord(payload)) return null;
  const course = payload.course;
  if (!isRecord(course)) return null;
  return typeof course.id === "string" && course.id ? course.id : null;
}

/** A row of mutually-exclusive toggle pills — reuses the notebook composer's
 * own `.mj-notebooks-pill*` classes, since these are literally the same
 * preference chips (level, math, language) as that composer, not a re-skin. */
function PillToggle<T extends string>({
  legend,
  options,
  value,
  onChange,
  labelFor,
}: {
  legend: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelFor: (option: T) => string;
}) {
  return (
    <fieldset className="mj-notebooks-pill-group">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="mj-notebooks-pill"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {labelFor(option)}
        </button>
      ))}
    </fieldset>
  );
}

function ComposerField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mj-notebooks-field">
      <span className="mj-notebooks-field-label">{label}</span>
      {children}
    </div>
  );
}

export function CoursesHome({ locale = "en" }: { locale?: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale];
  const coursesCopy = copy.courses;
  const router = useRouter();

  const [items, setItems] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [starters, setStarters] = useState<NotebookStarter[]>([]);

  const [brief, setBrief] = useState("");
  const [level, setLevel] = useState<AudienceLevel>("engineer");
  const [analogies, setAnalogies] = useState(true);
  const [mathLevel, setMathLevel] = useState<MathLevel>("minimal");
  const [language, setLanguage] = useState<"en" | "ja">(locale);
  const [moduleCount, setModuleCount] = useState<ModuleCountChoice>("auto");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetch("/api/courses", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || !Array.isArray(payload.items)) {
          throw new Error(refusalSentence(payload) ?? coursesCopy.listLoadFailed);
        }
        return (payload as unknown as CourseList).items;
      })
      .then((list) => {
        if (active) setItems(list);
      })
      .catch((cause) => {
        if (active) {
          setItems([]);
          setLoadError(cause instanceof Error ? cause.message : coursesCopy.listLoadFailed);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [coursesCopy.listLoadFailed]);

  useEffect(() => {
    let active = true;
    // Starters are a convenience, not load-bearing — same reasoning as
    // notebooks-home.tsx: a failed fetch degrades to "no starter cards", not
    // an error banner over an otherwise-working composer. `course_starters`
    // may be absent from an old cached payload, hence the `?? []`.
    fetch("/api/notebook-templates", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<CourseTemplates>) : null))
      .then((payload) => {
        if (active && payload) setStarters(payload.course_starters ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    if (!needle) return items;
    return items.filter((item) => item.title.toLocaleLowerCase(locale).includes(needle));
  }, [items, locale, query]);

  function applyStarter(starterBrief: string) {
    setBrief(starterBrief);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = brief.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: CreateCourseRequest = {
        brief: trimmed,
        audience: { level, assumes: [], not_assumed: [] },
        style: {
          analogies,
          analogy_domains: [],
          tone: "plain",
          math_level: mathLevel,
          visualizations: true,
          code_comments: "light",
          language,
        },
        // Qiskit is the only framework this surface wires through today —
        // same constraint as the notebook composer (design doc §7 Q4).
        framework: { name: "qiskit", version: ">=2.5,<2.6", execution: "local-statevector" },
        response_locale: locale,
      };
      if (moduleCount !== "auto") body.module_count = Number(moduleCount);
      const response = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as CreateCourseResponse | Record<string, unknown>;
      const courseId = createdCourseId(payload);
      if (!response.ok || !courseId) {
        throw new Error(refusalSentence(payload) ?? coursesCopy.createFailed);
      }
      router.push(`/notebooks/courses/${encodeURIComponent(courseId)}`);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : coursesCopy.createFailed);
      setSubmitting(false);
    }
  }

  return (
    <section className="mj-course-page">
      <div className="mj-course-scroll">
        <header className="mj-course-hero">
          <div>
            <p className="mj-section-label">{coursesCopy.title}</p>
            <h1>{coursesCopy.title}</h1>
            <p>{coursesCopy.lede}</p>
          </div>
          <Link className="mj-secondary-button" href="/notebooks">
            {copy.notebooks.title}
          </Link>
        </header>

        <form className="mj-course-composer" onSubmit={(event) => void submit(event)}>
          <p className="mj-section-label">{coursesCopy.planLabel}</p>
          <label className="mj-notebooks-brief">
            <span>{coursesCopy.briefLabel}</span>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={coursesCopy.briefPlaceholder}
              rows={4}
              required
            />
          </label>

          {starters.length > 0 ? (
            <div className="mj-notebooks-starters">
              <span className="mj-section-label">{coursesCopy.startersLabel}</span>
              <div className="mj-notebooks-starter-list">
                {starters.map((starter) => (
                  <button
                    key={starter.id}
                    type="button"
                    className="mj-notebooks-starter-chip"
                    onClick={() => applyStarter(starter.brief)}
                  >
                    <strong>{starter.title}</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mj-notebooks-fields">
            <ComposerField label={coursesCopy.moduleCountLabel}>
              <PillToggle
                legend={coursesCopy.moduleCountLabel}
                options={MODULE_COUNT_OPTIONS}
                value={moduleCount}
                onChange={setModuleCount}
                labelFor={(option) => coursesCopy.moduleCountOption[option]}
              />
            </ComposerField>
            <ComposerField label={copy.notebooks.audienceLevelLabel}>
              <PillToggle
                legend={copy.notebooks.audienceLevelLabel}
                options={LEVEL_OPTIONS}
                value={level}
                onChange={setLevel}
                labelFor={(option) => copy.notebooks.audienceLevelOption[option]}
              />
            </ComposerField>
            <ComposerField label={copy.notebooks.mathLevelLabel}>
              <PillToggle
                legend={copy.notebooks.mathLevelLabel}
                options={MATH_OPTIONS}
                value={mathLevel}
                onChange={setMathLevel}
                labelFor={(option) => copy.notebooks.mathLevelOption[option]}
              />
            </ComposerField>
            <ComposerField label={copy.notebooks.languageLabel}>
              <PillToggle
                legend={copy.notebooks.languageLabel}
                options={LANGUAGE_OPTIONS}
                value={language}
                onChange={setLanguage}
                labelFor={(option) => copy.notebooks.languageOption[option]}
              />
            </ComposerField>
            <ComposerField label={copy.notebooks.analogiesLabel}>
              <button
                type="button"
                className="mj-notebooks-pill"
                aria-pressed={analogies}
                onClick={() => setAnalogies((current) => !current)}
              >
                {copy.notebooks.analogiesLabel}
              </button>
            </ComposerField>
          </div>

          {submitError ? <p role="alert" className="mj-notebooks-error">{submitError}</p> : null}

          <div className="mj-notebooks-composer-actions">
            <button className="mj-primary-button" type="submit" disabled={submitting || !brief.trim()}>
              {submitting ? coursesCopy.creating : coursesCopy.create}
            </button>
          </div>
        </form>

        <div className="mj-library-toolbar">
          <label className="mj-library-search">
            <SearchIcon size={16} />
            <span className="sr-only">{coursesCopy.search}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={coursesCopy.searchPlaceholder} />
          </label>
        </div>

        {loading ? <CoursesNotice role="status" text={coursesCopy.listLoading} /> : null}
        {loadError ? <CoursesNotice role="alert" text={loadError} /> : null}
        {!loading && !loadError && visible.length === 0 ? (
          <CoursesNotice text={items.length ? coursesCopy.noMatch : coursesCopy.listEmpty} />
        ) : null}

        {!loading && !loadError && visible.length > 0 ? (
          <div className="mj-course-grid">
            {visible.map((course) => (
              <CourseCard key={course.id} course={course} locale={locale} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CourseCard({ course, locale }: { course: CourseSummary; locale: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].courses;
  const progress = courseProgress(course);
  return (
    <article className="mj-course-card">
      <div className="mj-course-card-meta">
        <span className={`mj-course-status-pill mj-course-status-pill--${course.status}`}>{copy.statusPill[course.status]}</span>
        <time dateTime={course.updated_at}>{copy.updated} {formatDate(course.updated_at, locale)}</time>
      </div>
      <div className="mj-course-card-copy">
        <h2><Link href={`/notebooks/courses/${encodeURIComponent(course.id)}`}>{course.title}</Link></h2>
        {course.summary ? <p>{course.summary}</p> : null}
      </div>
      <div className="mj-course-card-progress">
        <div className="mj-course-progress-bar" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress.percent}%` }} />
        </div>
        <span className="mj-mono-muted">{copy.progress(progress.ready, progress.total)}</span>
      </div>
      <div className="mj-course-card-actions">
        <Link className="mj-secondary-button" href={`/notebooks/courses/${encodeURIComponent(course.id)}`}>{copy.open}</Link>
      </div>
    </article>
  );
}

function CoursesNotice({ text, role }: { text: string; role?: "alert" | "status" }) {
  return <div className="mj-library-empty" role={role}><strong>{text}</strong></div>;
}

function formatDate(value: string, locale: PublicLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
