"use client";

import { useEffect, useRef, useState } from "react";
import { refusalSentence } from "../../../../../lib/api-error";
import { formatDueDate, gradebookHasDueDates } from "../../../../../lib/course-due-dates";
import {
  gradebookColumns,
  gradebookCsvFilename,
  gradebookEntry,
  gradebookMemberName,
  gradebookTotalsPending,
} from "../../../../../lib/course-gradebook";
import type { CourseGradebook as CourseGradebookData, GradebookRow } from "../../../../../lib/course-types";
import type { PublicLocale } from "../../../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../../../lib/workspace-locale";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatWhen(value: string | null | undefined, locale: PublicLocale): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * Loads the gradebook and hands it to `CourseGradebookView`. Split in two so
 * `tests/forms/course-gradebook.test.tsx` can render the table from a fixture
 * without stubbing `fetch`, the same reason `CourseModuleCard` is exported.
 */
export function CourseGradebook({
  courseId,
  courseSlug,
  locale,
  refreshKey = 0,
  onLoaded,
}: {
  courseId: string;
  courseSlug: string;
  locale: PublicLocale;
  /** Changing it re-reads the gradebook, as after a due date is saved. */
  refreshKey?: number;
  /** Handed each gradebook as it arrives: the course page reads a member's own row
   * from it to mark a module overdue. */
  onLoaded?: (book: CourseGradebookData) => void;
}) {
  const coursesCopy = WORKSPACE_COPY[locale].courses;
  const [book, setBook] = useState<CourseGradebookData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const loadSeq = useRef(0);

  function load() {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${encodeURIComponent(courseId)}/gradebook`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || typeof payload.visibility !== "string") {
          throw new Error(refusalSentence(payload) ?? coursesCopy.gradebookLoadFailed);
        }
        if (seq === loadSeq.current) {
          setBook(payload as unknown as CourseGradebookData);
          onLoaded?.(payload as unknown as CourseGradebookData);
        }
      })
      .catch((cause) => {
        if (seq === loadSeq.current) {
          setError(cause instanceof Error ? cause.message : coursesCopy.gradebookLoadFailed);
        }
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- courseId change is a hard reset; copy.* are stable strings for the active locale
  useEffect(() => {
    setBook(null);
    setDownloadError(null);
    load();
    return () => {
      loadSeq.current += 1;
    };
  }, [courseId]);

  // A refresh keeps the table on screen while it re-reads; only a new course clears it.
  const firstRefresh = useRef(refreshKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load is recreated per render; the key is the trigger
  useEffect(() => {
    if (refreshKey === firstRefresh.current) return;
    load();
  }, [refreshKey]);

  async function downloadCsv() {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/gradebook/csv`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(refusalSentence(payload) ?? coursesCopy.gradebookDownloadCsvFailed);
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = gradebookCsvFilename(courseSlug);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : coursesCopy.gradebookDownloadCsvFailed);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <CourseGradebookView
      book={book}
      locale={locale}
      loading={loading}
      error={error}
      downloading={downloading}
      downloadError={downloadError}
      onRetry={load}
      onDownload={() => void downloadCsv()}
    />
  );
}

/**
 * The table itself. Who is in it was decided by the control plane: the course's
 * creator is sent every current member's row, started or not
 * (`visibility: "all_members"`), and anyone else only their own (`"own_row"`). This component titles the table from that
 * field and never filters rows, because a filter here would only hide data the
 * browser had already been sent.
 */
export function CourseGradebookView({
  book,
  locale,
  loading,
  error,
  downloading,
  downloadError,
  onRetry,
  onDownload,
}: {
  book: CourseGradebookData | null;
  locale: PublicLocale;
  loading: boolean;
  error: string | null;
  downloading: boolean;
  downloadError: string | null;
  onRetry: () => void;
  onDownload: () => void;
}) {
  const coursesCopy = WORKSPACE_COPY[locale].courses;
  const everyone = book?.visibility === "all_members";
  const title = book && !everyone ? coursesCopy.yourProgressTitle : coursesCopy.gradebookTitle;
  const lede = book && !everyone ? coursesCopy.yourProgressLede : coursesCopy.gradebookLede;
  const rows = book?.rows ?? [];
  const columns = book ? gradebookColumns(book) : [];
  // The creator is sent every current member, started or not, so "nobody has
  // started" is a table of "Not started" rows, not an empty list. Say it in words
  // as well, above the table, because a column of identical cells is easy to misread.
  const nobodyStarted = rows.every((row) => (row.entries ?? []).length === 0);
  const totalsPending = book ? gradebookTotalsPending(book) : null;
  const hasDueDates = book ? gradebookHasDueDates(book) : false;

  return (
    <section className="mj-course-gradebook" aria-labelledby="course-gradebook-title">
      <div className="mj-course-gradebook-head">
        <div>
          <h2 id="course-gradebook-title">{book ? title : coursesCopy.gradebookTitle}</h2>
          {book ? <p className="mj-course-gradebook-lede">{lede}</p> : null}
        </div>
        <div className="mj-course-gradebook-actions">
          <button type="button" className="mj-secondary-button" disabled={loading} onClick={onRetry}>
            {coursesCopy.gradebookRefresh}
          </button>
          {everyone ? (
            <button
              type="button"
              className="mj-secondary-button"
              disabled={downloading || rows.length === 0}
              onClick={onDownload}
            >
              {downloading ? coursesCopy.gradebookDownloadingCsv : coursesCopy.gradebookDownloadCsv}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mj-notebooks-retry" role="alert">
          <p>{error}</p>
          <button type="button" className="mj-secondary-button" onClick={onRetry}>
            {locale === "ja" ? "再試行" : "Retry"}
          </button>
        </div>
      ) : null}
      {downloadError ? <p role="alert" className="mj-notebook-workspace-error">{downloadError}</p> : null}
      {loading && !book ? <p className="mj-notebook-chat-empty" role="status">{coursesCopy.gradebookLoading}</p> : null}

      {book && nobodyStarted ? (
        <p className="mj-notebook-chat-empty">{everyone ? coursesCopy.gradebookEmpty : coursesCopy.yourProgressEmpty}</p>
      ) : null}

      {book && rows.length > 0 && totalsPending ? (
        <p className="mj-notebook-chat-empty">
          {coursesCopy.gradebookTotalsPending}
        </p>
      ) : null}

      {book && rows.length > 0 ? (
        <div className="mj-course-gradebook-scroll">
          <table className="mj-course-gradebook-table">
            <thead>
              <tr>
                <th scope="col">{coursesCopy.gradebookMemberColumn}</th>
                {columns.map((module) => (
                  <th scope="col" key={module.id}>
                    <span className="mj-mono-muted">{coursesCopy.moduleSeqLabel(module.seq)}</span>
                    <span className="mj-course-gradebook-module-title" title={module.title}>{module.title}</span>
                    {module.due_at ? (
                      <time className="mj-course-gradebook-due" dateTime={module.due_at}>
                        {coursesCopy.dueLabel(formatDueDate(module.due_at, locale))}
                      </time>
                    ) : null}
                  </th>
                ))}
                <th scope="col">{coursesCopy.gradebookTotalColumn}</th>
                <th scope="col">{coursesCopy.gradebookLastColumn}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <GradebookTableRow
                  key={row.user_id}
                  row={row}
                  columns={columns}
                  locale={locale}
                  label={everyone ? null : coursesCopy.gradebookYou}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {book && rows.length > 0 && hasDueDates ? (
        <p className="mj-course-gradebook-legend">{coursesCopy.gradebookLegend}</p>
      ) : null}
    </section>
  );
}

function Score({ passed, graded, locale }: { passed: number; graded: number; locale: PublicLocale }) {
  const sentence = WORKSPACE_COPY[locale].courses.gradebookScore(passed, graded);
  return (
    <span className="mj-course-gradebook-score" title={sentence}>
      <span aria-hidden="true">{`${passed}/${graded}`}</span>
      <span className="sr-only">{sentence}</span>
    </span>
  );
}

function GradebookTableRow({
  row,
  columns,
  locale,
  label,
}: {
  row: GradebookRow;
  columns: ReturnType<typeof gradebookColumns>;
  locale: PublicLocale;
  /** Replaces the name in the member's own view, where it would only be their own. */
  label: string | null;
}) {
  const coursesCopy = WORKSPACE_COPY[locale].courses;
  return (
    <tr>
      <th scope="row">
        {label ? (
          <strong>{label}</strong>
        ) : (
          <>
            <strong>{gradebookMemberName(row)}</strong>
            {row.display_name?.trim() ? <small>{row.email}</small> : null}
          </>
        )}
      </th>
      {columns.map((module) => {
        const entry = gradebookEntry(row, module.id);
        const due = module.due_at ? formatDueDate(module.due_at, locale) : "";
        if (!entry) {
          // Missing replaces "Not started" rather than sitting beside it: it IS "not
          // started", with the due date passed. The control plane decides which.
          if ((row.missing_module_ids ?? []).includes(module.id)) {
            return (
              <td key={module.id}>
                <span className="mj-course-gradebook-flag mj-course-gradebook-flag--missing" title={coursesCopy.gradebookMissingHint(due)}>
                  {coursesCopy.gradebookMissing}
                </span>
              </td>
            );
          }
          return (
            <td key={module.id} className="mj-course-gradebook-empty-cell">
              {coursesCopy.gradebookNotStarted}
            </td>
          );
        }
        return (
          <td key={module.id}>
            <Score passed={entry.passed} graded={entry.graded_cells} locale={locale} />
            {entry.late ? (
              <span className="mj-course-gradebook-flag mj-course-gradebook-flag--late" title={coursesCopy.gradebookLateHint(due)}>
                {coursesCopy.gradebookLate}
              </span>
            ) : null}
            {entry.stale ? (
              <small title={coursesCopy.gradebookOlderVersionHint(entry.version_seq)}>
                {coursesCopy.gradebookOlderVersion}
              </small>
            ) : null}
          </td>
        );
      })}
      {(row.entries ?? []).length === 0 ? (
        // Not "0/N": a member who has not started has not scored zero.
        <td className="mj-course-gradebook-empty-cell">{coursesCopy.gradebookNotStarted}</td>
      ) : row.total_graded_cells == null ? (
        // Not a smaller number: a module still without a ready notebook would be
        // missing from the denominator, and "3/4" would read better than it is.
        <td className="mj-course-gradebook-empty-cell">{coursesCopy.gradebookTotalUnknown}</td>
      ) : (
        <td>
          <Score passed={row.total_passed} graded={row.total_graded_cells} locale={locale} />
        </td>
      )}
      <td className="mj-mono-muted">{formatWhen(row.last_graded_at, locale)}</td>
    </tr>
  );
}
