import { StudioWorkspace } from "./studio-workspace";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getAccountTier } from "../../../lib/account-tier-server";

export const metadata = { title: "Studio — Leona Quantum" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ artifact?: string; new?: string; example?: string }> }) {
  const [params, locale, { limits }] = await Promise.all([
    searchParams,
    getPublicLocale(),
    getAccountTier(),
  ]);
  // Only the numbers cross into the client component. The allowlist that
  // produced them stays on the server.
  //
  // `example` is keyed the same way `artifact` already is: a distinct query
  // value remounts StudioWorkspace, which is what lets its mount effect (the
  // same one that hydrates `?artifact=`) load the example fresh rather than
  // needing a second effect keyed off a prop change.
  return (
    <StudioWorkspace
      key={params.artifact ?? (params.example ? `example:${params.example}` : params.new === "1" ? "new" : "browse")}
      artifactId={params.artifact}
      newDraft={params.new === "1"}
      exampleId={params.example}
      locale={locale}
      limits={limits}
    />
  );
}
