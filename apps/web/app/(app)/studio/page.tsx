import { StudioWorkspace } from "./studio-workspace";
import { getPublicLocale } from "../../../lib/public-locale-server";

export const metadata = { title: "Studio — Leona Quantum" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ artifact?: string; new?: string }> }) {
  const [params, locale] = await Promise.all([searchParams, getPublicLocale()]);
  return <StudioWorkspace artifactId={params.artifact} newDraft={params.new === "1"} locale={locale} />;
}
