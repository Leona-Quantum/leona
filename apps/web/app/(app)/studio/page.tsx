import { StudioWorkspace } from "./studio-workspace";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getAccountTier } from "../../../lib/account-tier-server";

export const metadata = { title: "Studio — Leona Quantum" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ artifact?: string; new?: string; example?: string; atlas?: string }> }) {
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
  //
  // `atlas` is an Atlas record slug: Studio imports that record into the
  // reader's workspace on arrival and then replaces the URL with the new
  // artifact's. It exists so a signed-out "Add to Studio" click can survive
  // the sign-in round trip (lib/atlas-studio-import.ts).
  return (
    <StudioWorkspace
      key={params.artifact ?? (params.example ? `example:${params.example}` : params.atlas ? `atlas:${params.atlas}` : params.new === "1" ? "new" : "browse")}
      artifactId={params.artifact}
      newDraft={params.new === "1"}
      exampleId={params.example}
      atlasSlug={params.atlas}
      locale={locale}
      limits={limits}
    />
  );
}
