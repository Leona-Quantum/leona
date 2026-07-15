import { LibraryStudio } from "./library-studio";
import { getPublicLocale } from "../../../lib/public-locale-server";

export const metadata = { title: "Library — LeonaQ" };

export default async function LibraryList() {
  const locale = await getPublicLocale();
  return <LibraryStudio locale={locale} />;
}
