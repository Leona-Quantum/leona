import { getPublicLocale } from "../../../../lib/public-locale-server";
import { NotebookWorkspace } from "./notebook-workspace";

export const metadata = { title: "Notebook — Leona Quantum" };

export default async function NotebookPage({
  params,
}: {
  params: Promise<{ notebookId: string }>;
}) {
  const [{ notebookId }, locale] = await Promise.all([params, getPublicLocale()]);
  return <NotebookWorkspace notebookId={notebookId} locale={locale} />;
}
