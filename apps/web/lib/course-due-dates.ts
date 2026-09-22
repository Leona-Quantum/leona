/**
 * Due dates on course modules: the conversions between what a `datetime-local`
 * input holds and what the control plane stores, and the small decisions the
 * course page and the gradebook make from them. Pure: no DOM, no React.
 *
 * ## The one rule about time zones
 *
 * The control plane stores an instant and sends it in UTC
 * (`CourseModule.due_at`). A person never sees UTC: the input shows the instant
 * in the viewer's own zone, and so does every label. An instructor in Tokyo who
 * types 17:00 stores 08:00 UTC, and a member in London reads 09:00 on the same
 * day. Nothing here names a zone; the browser's own does the work, which is what
 * "shown in the viewer's local time" means.
 *
 * ## Late and missing are decided by the control plane
 *
 * `GradebookEntry.late` and `GradebookRow.missing_module_ids` arrive computed, on
 * one clock, with the boundary written down in one place (an attempt graded AT
 * the due instant is on time). This module reads them and never re-derives them
 * from the browser's clock, which can be minutes or a whole zone wrong.
 */
import type { CourseGradebook, GradebookRow } from "./course-types";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The value a `datetime-local` input shows for a stored due date, in the viewer's
 * zone, to the minute (`2026-09-30T17:00`). Empty when there is no due date, or
 * when the stored value does not parse, so the input reads as unset rather than
 * as a wrong date.
 */
export function dueDateInputValue(dueAt: string | null | undefined): string {
  if (!dueAt) return "";
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return "";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * What to send for what the input holds: the instant in UTC, with its `Z`, or
 * `null` when the input is empty or holds something that is not a date.
 *
 * `new Date("2026-09-30T17:00")` reads a date-time with no offset as LOCAL time
 * (ECMAScript's rule for that form), which is exactly the reading wanted. The
 * API refuses a time with no offset, so this conversion cannot be skipped.
 */
export function dueDateFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * A due date as a person reads it, in their zone and their language, with the
 * zone named. Named because a deadline is the one time on the page where being an
 * hour out matters, and a class can span zones.
 */
export function formatDueDate(dueAt: string, locale: "en" | "ja"): string {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return dueAt;
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/** The body of the PATCH that sets (an instant) or clears (`null`) one module's due date. */
export function dueDatePatchBody(moduleId: string, dueAt: string | null): {
  modules: Array<{ id: string; due_at: string | null }>;
} {
  // `due_at: null` is sent, never dropped: the control plane reads an absent key
  // as "leave the due date alone" and an explicit null as "clear it".
  return { modules: [{ id: moduleId, due_at: dueAt }] };
}

/**
 * Whether the input holds a change worth saving: a valid date that differs from
 * the stored one, compared as instants so a stored `…Z` and the same minute typed
 * back in do not count as a change.
 */
export function dueDateChanged(value: string, stored: string | null | undefined): boolean {
  const next = dueDateFromInput(value);
  if (next === null) return false;
  if (!stored) return true;
  const storedTime = new Date(stored).getTime();
  return Number.isNaN(storedTime) || new Date(next).getTime() !== storedTime;
}

/**
 * Whether to offer the due-date controls: the viewer created this course.
 *
 * The control plane refuses anyone else (403), so this only decides whether to
 * OFFER the control. `false` until `/api/me` answers and whenever the course names
 * no creator, so the control appears a moment late rather than appearing for a
 * member and failing when they press it.
 */
export function viewerCreatedCourse(
  course: { owner_user_id?: string | null } | null | undefined,
  viewerId: string | null | undefined,
): boolean {
  return Boolean(viewerId && course?.owner_user_id && course.owner_user_id === viewerId);
}

/**
 * The viewer's own gradebook row, when the gradebook they were sent is theirs
 * alone (`own_row`). `null` for the course's creator, whose gradebook lists
 * everyone: the module list then has no single learner to mark overdue.
 */
export function ownGradebookRow(book: CourseGradebook | null | undefined): GradebookRow | null {
  if (!book || book.visibility !== "own_row") return null;
  return (book.rows ?? [])[0] ?? null;
}

/**
 * Whether a module is overdue FOR THIS VIEWER: its due date has passed and they
 * have no graded attempt at it. Straight from the control plane's
 * `missing_module_ids`, so the course page and the gradebook can never disagree.
 */
export function moduleOverdue(row: Pick<GradebookRow, "missing_module_ids"> | null, moduleId: string): boolean {
  return Boolean(row?.missing_module_ids?.includes(moduleId));
}

/** Whether the gradebook needs its legend: some module has a due date. */
export function gradebookHasDueDates(book: Pick<CourseGradebook, "modules">): boolean {
  return (book.modules ?? []).some((module) => Boolean(module.due_at));
}
