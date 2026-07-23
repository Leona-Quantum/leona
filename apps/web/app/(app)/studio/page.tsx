import { StudioWorkspace } from "./studio-workspace";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getAccountTier } from "../../../lib/account-tier-server";

export const metadata = { title: "Studio — Leona Quantum" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ artifact?: string; new?: string }> }) {
  const [params, locale, { limits }] = await Promise.all([
    searchParams,
    getPublicLocale(),
    getAccountTier(),
  ]);
  // Only the numbers cross into the client component. The allowlist that
  // produced them stays on the server.
  return <StudioWorkspace artifactId={params.artifact} newDraft={params.new === "1"} locale={locale} limits={limits} />;
}
