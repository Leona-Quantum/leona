import { getPublicLocale } from "../../../lib/public-locale-server";
import { NotebooksHome } from "./notebooks-home";

export const metadata = { title: "Notebooks — Leona Quantum" };

export default async function NotebooksPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string }>;
}) {
  const [params, locale] = await Promise.all([searchParams, getPublicLocale()]);
  // Only "atlas-record:<slug>" is recognised — an atlas record card is the one
  // caller that links here with a seed today (repository-export.tsx). Anything
  // else is ignored rather than guessed at.
  const seedSlug = params.seed?.startsWith("atlas-record:") ? params.seed.slice("atlas-record:".length) : "";
  return <NotebooksHome locale={locale} seedSlug={seedSlug} />;
}
