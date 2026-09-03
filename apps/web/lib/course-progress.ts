/**
 * Pure joins and classifications for the courses surface — the course
 * equivalent of `lib/notebook-view.ts`. Nothing here touches the DOM or
 * imports React: `course-workspace.tsx` and `courses-home.tsx` are the
 * renderers, this is what they render from.
 */
import type { CourseModule, CourseModuleStatus } from "./course-types";

export interface CourseProgress {
  ready: number;
  total: number;
  /** 0-100, rounded. `total === 0` reads as 0%, never `NaN` or `Infinity`. */
  percent: number;
}

export function courseProgress(course: { ready_count: number; module_count: number }): CourseProgress {
  const total = Math.max(0, course.module_count);
  const ready = Math.min(Math.max(0, course.ready_count), total);
  const percent = total === 0 ? 0 : Math.round((ready / total) * 100);
  return { ready, total, percent };
}

/**
 * The pill state a module's status renders as. Mirrors
 * `notebookStatusPill`'s collapse of "running" into "generating" — the same
 * reasoning applies here: "running" tells a reader the sandbox is mid-execution,
 * which is true but not the headline they need from a one-word pill.
 */
export type CourseModuleStatusPill = "planned" | "queued" | "generating" | "ready" | "failed";

export function courseModuleStatusPill(status: CourseModuleStatus): CourseModuleStatusPill {
  return status === "running" ? "generating" : status;
}

/**
 * Which modules a "Generate" action targets.
 *
 * `module_ids: null` (the "Generate all" button) means every module that has
 * no notebook yet — `notebook_id === null` reads that off the module record
 * directly rather than trusting `status === "planned"`, so a module stuck in a
 * status the UI doesn't recognize is still resolved correctly rather than
 * silently skipped. `module_ids` given (a single per-card "Generate this
 * module" click) means exactly those modules, in the COURSE's own seq order —
 * not the order the ids were passed in — because that is the order the
 * `POST .../generate` response's `run_ids` are assumed to correspond to (the
 * API returns `course.modules` in seq order, and this module builds the
 * mapping off that same order for consistency).
 */
export function resolveGenerateTargets(
  modules: readonly CourseModule[],
  moduleIds: readonly string[] | null | undefined,
): CourseModule[] {
  const ordered = [...modules].sort((a, b) => a.seq - b.seq);
  if (moduleIds === null || moduleIds === undefined) {
    return ordered.filter((module) => module.notebook_id === null);
  }
  const wanted = new Set(moduleIds);
  return ordered.filter((module) => wanted.has(module.id));
}

/**
 * Zip a `POST .../generate` response's `run_ids` onto the modules it targeted,
 * by position — the response carries no other way to say which run belongs to
 * which module. `targets` must be `resolveGenerateTargets`'s own output (or
 * built the same way) for the positions to line up; a length mismatch drops
 * the extra ids rather than throwing, since a stale response should degrade to
 * "some modules show no progress rail" rather than crash the page.
 */
export function mapModuleRunIds(
  targets: readonly CourseModule[],
  runIds: readonly string[],
): Record<string, string> {
  const byModuleId: Record<string, string> = {};
  const count = Math.min(targets.length, runIds.length);
  for (let index = 0; index < count; index += 1) {
    byModuleId[targets[index].id] = runIds[index];
  }
  return byModuleId;
}

export interface PrerequisiteLink {
  slug: string;
  /** The module that slug resolves to, or `null` if no module in this course has it. */
  module: CourseModule | null;
}

/**
 * Resolve a module's `prerequisites` (slugs) against the rest of the course,
 * for rendering as links to the earlier module cards. A prerequisite that
 * cannot be resolved (a stale slug after a module was retitled or removed)
 * renders as plain text instead of a dead link — `module: null` is what tells
 * the caller to do that, rather than the caller re-deriving the same lookup.
 */
export function resolvePrerequisiteLinks(
  modules: readonly CourseModule[],
  module: Pick<CourseModule, "prerequisites">,
): PrerequisiteLink[] {
  const bySlug = new Map(modules.map((candidate) => [candidate.slug, candidate] as const));
  return (module.prerequisites ?? []).map((slug) => ({ slug, module: bySlug.get(slug) ?? null }));
}
