import { getPublicLocale } from "../../../../lib/public-locale-server";
import { CoursesHome } from "./courses-home";

export const metadata = { title: "Courses — Leona Quantum" };

export default async function CoursesPage() {
  const locale = await getPublicLocale();
  return <CoursesHome locale={locale} />;
}
