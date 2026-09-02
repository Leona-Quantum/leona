import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** Re-execute the current version: `{ version, run_id }` (`RerunNotebookResponse`). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ notebookId: string }> },
) {
  const [{ accessToken }, { notebookId }] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    params,
  ]);
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(controlPlaneUrl(`/v1/notebooks/${encodeURIComponent(notebookId)}/run`), {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
