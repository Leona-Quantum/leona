import { StudioWorkspace } from "./studio-workspace";
import { getPublicLocale } from "../../../lib/public-locale-server";

export const metadata = { title: "Studio — LeonaQ" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ artifact?: string }> }) {
  const [params, locale] = await Promise.all([searchParams, getPublicLocale()]);
  return <StudioWorkspace artifactId={params.artifact} locale={locale} />;
}
