import { getPublicLocale } from "../../../../../lib/public-locale-server";
import { CourseWorkspace } from "./course-workspace";

export const metadata = { title: "Course — Leona Quantum" };

export default async function CoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const [{ courseId }, locale] = await Promise.all([params, getPublicLocale()]);
  return <CourseWorkspace courseId={courseId} locale={locale} />;
}
