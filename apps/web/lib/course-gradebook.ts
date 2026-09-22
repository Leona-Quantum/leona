/**
 * Pure joins for the course gradebook, the table `course-gradebook.tsx` renders.
 * Nothing here touches the DOM or imports React.
 *
 * Who is in the table is decided by the control plane, not here: the course's
 * creator is sent every current member's row, started or not, and anyone else
 * only their own (`repos.courses.course_gradebook`). The client reads `visibility`
 * to title the table honestly and never filters rows itself, because a filter in
 * the browser would be a filter over data the browser had already been sent.
 */
import type { CourseGradebook, GradebookEntry, GradebookModule, GradebookRow } from "./course-types";

/** What the members page shows as a person's name: their display name, else their email. */
export function gradebookMemberName(row: Pick<GradebookRow, "display_name" | "email">): string {
  const name = row.display_name?.trim();
  return name ? name : row.email;
}

/** The modules as table columns, in course order. */
export function gradebookColumns(book: Pick<CourseGradebook, "modules">): GradebookModule[] {
  return [...(book.modules ?? [])].sort((a, b) => a.seq - b.seq);
}

/**
 * This member's latest graded attempt at this module, or `null` when they have
 * not been graded on it. `null`, not a zeroed entry: "has not tried" and "tried
 * and got nothing right" are different facts about a learner.
 */
export function gradebookEntry(row: Pick<GradebookRow, "entries">, moduleId: string): GradebookEntry | null {
  return (row.entries ?? []).find((entry) => entry.module_id === moduleId) ?? null;
}

/** Whether the course has anything a member could have been graded on yet. */
export function courseHasGradableNotebook(modules: ReadonlyArray<{ notebook_id?: string | null }>): boolean {
  return modules.some((module) => Boolean(module.notebook_id));
}

/** The file the CSV download is saved as, matching the control plane's own name. */
export function gradebookCsvFilename(slug: string): string {
  return `${slug}-gradebook.csv`;
}
