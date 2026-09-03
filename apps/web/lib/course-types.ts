/**
 * Course types for the `/v1/courses` API — every one an alias onto the generated
 * contract in `@majorana/contracts-gen`, so the web app can never disagree with
 * `packages/py/contracts/src/majorana_contracts/courses.py` about a field name.
 * (This file began as a hand-written stand-in while the contract was being
 * written in a sibling lane; at merge every shape matched and the aliases replaced
 * the declarations. Keep importing from here so a rename lands in one place.)
 */
import type { components } from "@majorana/contracts-gen";

export type Audience = components["schemas"]["Audience"];
export type Style = components["schemas"]["Style"];
export type NotebookFramework = components["schemas"]["NotebookFramework"];
export type NotebookKind = components["schemas"]["NotebookKind"];
export type Seed = components["schemas"]["Seed"];
export type NotebookStarter = components["schemas"]["NotebookStarter"];
export type CourseStatus = components["schemas"]["CourseStatus"];
export type CourseModuleStatus = components["schemas"]["CourseModuleStatus"];
export type CourseModule = components["schemas"]["CourseModule"];
export type Course = components["schemas"]["Course"];
export type CourseSummary = components["schemas"]["CourseSummary"];
export type CreateCourseRequest = components["schemas"]["CreateCourseRequest"];
export type CreateCourseResponse = components["schemas"]["CreateCourseResponse"];
export type CourseList = components["schemas"]["CourseList"];
export type UpdateCourseModulePatch = components["schemas"]["CourseModulePatch"];
export type UpdateCourseRequest = components["schemas"]["UpdateCourseRequest"];
export type GenerateCourseRequest = components["schemas"]["GenerateCourseRequest"];
export type GenerateCourseResponse = components["schemas"]["GenerateCourseResponse"];
export type CourseTurn = components["schemas"]["CourseTurn"];
export type CreateCourseTurnRequest = components["schemas"]["CreateCourseTurnRequest"];
export type CreateCourseTurnResponse = components["schemas"]["CreateCourseTurnResponse"];
export type CourseTurnList = components["schemas"]["CourseTurnList"];
export type CourseTemplates = components["schemas"]["NotebookTemplates"];
