/**
 * Local TypeScript types for the `/v1/courses` API.
 *
 * Lane A (this branch's sibling lane) is building that API and its contracts in
 * `packages/py/contracts/src/majorana_contracts/courses.py` concurrently with this
 * surface. Until its regenerated `packages/ts/contracts-gen` types reach this
 * branch, every shape below is the source of truth for the web app — imported
 * from here, never redeclared inline at a call site — so the orchestrator can
 * swap the imports to `@majorana/contracts-gen` at merge time with a search and
 * replace, provided the field names below still match the real contract.
 *
 * `Audience`, `Style`, `NotebookFramework`, `NotebookKind`, `Seed` and
 * `NotebookStarter` are NOT redeclared: they already exist in
 * `@majorana/contracts-gen` (the notebooks contract) and courses reuse them
 * verbatim, so importing them here keeps exactly one definition of each.
 */
import type { components } from "@majorana/contracts-gen";

export type Audience = components["schemas"]["Audience"];
export type Style = components["schemas"]["Style"];
export type NotebookFramework = components["schemas"]["NotebookFramework"];
export type NotebookKind = components["schemas"]["NotebookKind"];
export type Seed = components["schemas"]["Seed"];
export type NotebookStarter = components["schemas"]["NotebookStarter"];

export type CourseStatus = "planning" | "planned" | "generating" | "ready" | "failed";
export type CourseModuleStatus = "planned" | "queued" | "running" | "ready" | "failed";

export interface CourseModule {
  id: string;
  seq: number;
  slug: string;
  title: string;
  topic: string;
  key_concepts: string[];
  objectives: string[];
  deliverable: string;
  kind: NotebookKind;
  duration_minutes: number | null;
  /** Slugs of earlier modules in this course — never ids. */
  prerequisites: string[];
  brief: string;
  notebook_id: string | null;
  status: CourseModuleStatus;
  notebook_version_seq: number | null;
}

export interface Course {
  id: string;
  slug: string;
  title: string;
  summary: string;
  brief: string;
  kind: "course";
  audience: Audience;
  style: Style;
  framework: NotebookFramework;
  language: "en" | "ja";
  status: CourseStatus;
  plan_run_id: string | null;
  modules: CourseModule[];
  module_count: number;
  ready_count: number;
  created_at: string;
  updated_at: string;
}

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: CourseStatus;
  language: "en" | "ja";
  module_count: number;
  ready_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCourseRequest {
  brief: string;
  title?: string;
  audience?: Audience;
  style?: Style;
  framework?: NotebookFramework;
  /** 2..16 */
  module_count?: number;
  seeds?: Seed[];
  response_locale?: "en" | "ja";
}

export interface CreateCourseResponse {
  course: Course;
  run_id: string;
}

export interface CourseList {
  items: CourseSummary[];
  next_cursor: string | null;
}

export interface UpdateCourseModulePatch {
  id: string;
  title?: string;
  brief?: string;
  objectives?: string[];
  kind?: NotebookKind;
  seq?: number;
}

export interface UpdateCourseRequest {
  title?: string;
  summary?: string;
  modules?: UpdateCourseModulePatch[];
}

export interface GenerateCourseRequest {
  /** `null` (or omitted) means every module without a notebook yet. */
  module_ids?: string[] | null;
}

export interface GenerateCourseResponse {
  course: Course;
  run_ids: string[];
}

export interface CourseTurn {
  id: string;
  seq: number;
  role: "user" | "nala";
  content: string;
  created_at: string;
}

export interface CreateCourseTurnRequest {
  message: string;
}

export interface CreateCourseTurnResponse {
  turn: CourseTurn;
  run_id: string;
}

export interface CourseTurnList {
  items: CourseTurn[];
}

/**
 * `GET /v1/notebook-templates` gains this field; an old cached payload (or a
 * control plane that hasn't deployed the change yet) simply omits it, so every
 * reader treats it as optional and falls back to `[]` rather than throwing.
 */
export interface CourseTemplates {
  course_starters?: NotebookStarter[];
}
