import { getMajoranaAuth } from "../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
  forwardFromControlPlane,
} from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** One shared project's header, including the revision a client polls. */
export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(
        controlPlaneUrl(`/v1/shared/projects/${encodeURIComponent(projectId)}`),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

/**
 * Give up a grant made to you.
 *
 * The grantee's own move, and the only removal on this side of the feature:
 * `/api/workspace/projects/{id}/shares/{user}` is the owner revoking somebody,
 * which is a different route with a different authorization. Nothing here
 * carries a user id at all — the control plane keys the delete on the caller's
 * own identity, so this cannot be aimed at anybody else.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(
        controlPlaneUrl(`/v1/shared/projects/${encodeURIComponent(projectId)}`),
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
