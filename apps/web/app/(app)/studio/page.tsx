import { StudioWorkspace } from "./studio-workspace";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getAccountTier } from "../../../lib/account-tier-server";
import { LAYER_GRAPH } from "../../../lib/repository/layer-graph.ts";
import { slimLayerGraph } from "../../../lib/workflow-planner/graph.ts";
import { leanPlannerGraph } from "../../../lib/workflow-planner/lean.ts";

export const metadata = { title: "Studio" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ artifact?: string; new?: string; example?: string; atlas?: string; plan?: string }> }) {
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
  //
  // `plan` is a flag, not the plan itself — the sentence and numbers live
  // only in the URL fragment (`#plan=…`), which this server component never
  // sees. It exists so the planner graph (the lean one, about 30 KB: the panel renders no node prose) is shipped to
  // the client ONLY on a link that will actually read it, never on an
  // ordinary Studio load. The same `getPublicLocale()` this page already
  // reads decides which language the graph is slimmed to, matching how the
  // planner page itself slims it (`app/[locale]/repository/plan/page.tsx`).
  const planGraph = params.plan === "1" ? leanPlannerGraph(slimLayerGraph(LAYER_GRAPH, locale)) : null;
  return (
    <StudioWorkspace
      key={params.artifact ?? (params.example ? `example:${params.example}` : params.atlas ? `atlas:${params.atlas}` : params.new === "1" ? "new" : "browse")}
      artifactId={params.artifact}
      newDraft={params.new === "1"}
      exampleId={params.example}
      atlasSlug={params.atlas}
      locale={locale}
      limits={limits}
      planGraph={planGraph}
    />
  );
}
