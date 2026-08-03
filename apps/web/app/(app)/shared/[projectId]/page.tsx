import { getPublicLocale } from "../../../../lib/public-locale-server";
import { SharedProjectView } from "./shared-project-view";

export const dynamic = "force-dynamic";

/**
 * One project somebody else's workspace has shared with you.
 *
 * A page of its own rather than a mode of Studio. Studio's workspace component
 * reads the workspace-keyed artifact mirror, the project rail, the drafts store
 * and the run allowance — every one of which is about the caller's OWN
 * workspace, and none of which is true of these rows. Threading a "this one is
 * somebody else's" flag through all of it would put that condition in front of
 * every read in a two-thousand-line component, and the first one that forgot it
 * would write another tenant's circuit into this browser's local mirror.
 *
 * So the surface is small and separate, and everything on it goes through
 * `/api/shared/...`, which cannot return anything the grant does not cover.
 */
export default async function SharedProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const locale = await getPublicLocale();
  return <SharedProjectView projectId={projectId} locale={locale} />;
}
